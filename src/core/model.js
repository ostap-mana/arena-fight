import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { characterMaterial, addProjectedShadow } from '../world/character-shader.js'
import { meshVfxMaterial } from '../world/vfx.js'

const loader = new GLTFLoader()
const COMPACT = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
const modelCache = new Map()
const IGNORED_CLIP = /^(FXA_|New Animation)/
const SWING_BONE = /^(WeaponRoot_[LR]|Weapon1_[LR]|Wrist_[LR]|Elbow_[LR]|Shoulder_[LR])$/
const WING_BONE = /^Wing/
const WING_ANCHOR = 'Chest_M'
const WING_SCALE = 1.35
const WING_CLIP = { Run: 'Run', Walk: 'Run', Dash: 'Dash', Death: 'Death' }
const _v = new THREE.Vector3()

export function texturesReady() {
  return Promise.resolve()
}

export function loadModelData(id) {
  if (!modelCache.has(id)) {
    const file = COMPACT && /_lob$/.test(id) ? `${id}_m` : id
    modelCache.set(id, loader.loadAsync(`assets/glb/${file}.glb`).then(prepareModel))
  }
  return modelCache.get(id)
}

export function loadWingedModel(id, wingsId) {
  const key = `${id}+${wingsId}`
  if (!modelCache.has(key)) {
    modelCache.set(key, Promise.all([loadModelData(id), loadModelData(wingsId)]).then(([body, wings]) => graftWings(body, wings)))
  }
  return modelCache.get(key)
}

function graftWings(body, wings) {
  const scene = cloneSkinned(body.scene)
  const source = cloneSkinned(wings.scene)
  scene.updateMatrixWorld(true)
  source.updateMatrixWorld(true)
  const anchor = scene.getObjectByName(WING_ANCHOR) || scene
  const sourceAnchor = source.getObjectByName(WING_ANCHOR) || source
  const rebase = anchor.matrixWorld.clone().invert().multiply(sourceAnchor.matrixWorld)
  const roots = []
  const meshes = []
  source.traverse(o => {
    if (o.isBone && WING_BONE.test(o.name) && !WING_BONE.test(o.parent.name)) roots.push(o)
    if (o.isSkinnedMesh) meshes.push(o)
  })
  const grafted = new Set()
  for (const bone of roots) {
    bone.matrix.premultiply(rebase).decompose(bone.position, bone.quaternion, bone.scale)
    bone.scale.multiplyScalar(WING_SCALE)
    anchor.add(bone)
    bone.traverse(b => grafted.add(b))
  }
  for (const mesh of meshes) {
    const bones = mesh.skeleton.bones.map(b => (grafted.has(b) ? b : scene.getObjectByName(b.name) || anchor))
    mesh.userData.attachment = true
    scene.add(mesh)
    mesh.bind(new THREE.Skeleton(bones, mesh.skeleton.boneInverses), mesh.bindMatrix)
  }
  const rebased = { names: new Set(roots.map(b => b.name)), matrix: rebase, rotation: new THREE.Quaternion().setFromRotationMatrix(rebase) }
  const clips = new Map()
  for (const [name, clip] of body.clips) clips.set(name, withWingTracks(clip, wings.clips.get(WING_CLIP[name] || 'Idle'), rebased))
  return { scene, clips, impacts: body.impacts, metrics: null }
}

function rebaseValues(track, rebased) {
  const [bone, property] = track.name.split('.')
  if (!rebased.names.has(bone)) return track.values
  const values = track.values.slice()
  if (property === 'quaternion') {
    const q = new THREE.Quaternion()
    for (let i = 0; i < values.length; i += 4) {
      q.fromArray(values, i).premultiply(rebased.rotation).toArray(values, i)
    }
  } else if (property === 'position') {
    for (let i = 0; i < values.length; i += 3) _v.fromArray(values, i).applyMatrix4(rebased.matrix).toArray(values, i)
  } else if (property === 'scale') {
    for (let i = 0; i < values.length; i++) values[i] *= WING_SCALE
  }
  return values
}

function withWingTracks(clip, source, rebased) {
  const out = clip.clone()
  if (!source || !source.duration) return out
  const repeats = Math.max(1, Math.round(clip.duration / source.duration))
  const span = clip.duration / repeats
  const stretch = span / source.duration
  for (const track of source.tracks) {
    const base = rebaseValues(track, rebased)
    const count = track.times.length
    const times = new Float32Array(count * repeats)
    const values = new base.constructor(base.length * repeats)
    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < count; i++) times[r * count + i] = track.times[i] * stretch + r * span
      values.set(base, r * base.length)
    }
    out.tracks.push(new track.constructor(track.name, times, values))
  }
  return out
}

function prepareModel(gltf) {
  const scene = gltf.scene
  const base = scene.getObjectByName('Base')
  const pelvis = scene.getObjectByName('Root_M')
  const clips = new Map()
  const impacts = new Map()
  for (const clip of gltf.animations) {
    if (IGNORED_CLIP.test(clip.name) || clips.has(clip.name)) continue
    if (base && pelvis) pinRootMotion(clip, base, pelvis)
    clips.set(clip.name, clip)
    impacts.set(clip.name, findImpact(clip))
  }
  return { scene, clips, impacts, metrics: null }
}

function pinRootMotion(clip, base, pelvis) {
  const track = clip.tracks.find(t => t.name === `${pelvis.name}.position`)
  if (!track) return
  const rest = pelvis.position
  const values = new Float32Array(track.values.length)
  for (let i = 0; i < track.values.length; i += 3) {
    _v.set(rest.x - track.values[i], 0, rest.z - track.values[i + 2])
    _v.multiply(base.scale).applyQuaternion(base.quaternion).add(base.position)
    values[i] = _v.x
    values[i + 1] = _v.y
    values[i + 2] = _v.z
  }
  clip.tracks.push(new THREE.VectorKeyframeTrack(`${base.name}.position`, track.times.slice(), values))
}

function findImpact(clip) {
  let fastest = 0
  let at = clip.duration * 0.35
  for (const track of clip.tracks) {
    const [bone, property] = track.name.split('.')
    if (property !== 'quaternion' || !SWING_BONE.test(bone)) continue
    const { times, values } = track
    for (let i = 1; i < times.length; i++) {
      const mid = (times[i] + times[i - 1]) / 2
      if (mid < 0.06 || mid > clip.duration * 0.8) continue
      const a = i * 4
      const b = a - 4
      const dot = Math.abs(values[a] * values[b] + values[a + 1] * values[b + 1] + values[a + 2] * values[b + 2] + values[a + 3] * values[b + 3])
      const speed = (2 * Math.acos(Math.min(1, dot))) / Math.max(times[i] - times[i - 1], 1e-4)
      if (speed > fastest) {
        fastest = speed
        at = mid
      }
    }
  }
  return at
}

function largestSkin(root) {
  let body = null
  let count = -1
  root.traverse(o => {
    if (!o.isSkinnedMesh || o.userData.attachment) return
    const n = o.geometry.getAttribute('position').count
    if (n > count) {
      count = n
      body = o
    }
  })
  return body
}

function measure(data) {
  if (data.metrics) return data.metrics
  const root = cloneSkinned(data.scene)
  const idle = data.clips.get('Idle')
  if (idle) {
    const mixer = new THREE.AnimationMixer(root)
    mixer.clipAction(idle).play()
    mixer.update(0)
  }
  root.updateMatrixWorld(true)
  const body = largestSkin(root)
  body.computeBoundingBox()
  const footY = body.boundingBox.min.y
  const head = root.getObjectByName('Head_M')
  const topY = head ? head.getWorldPosition(_v).y + 0.18 : body.boundingBox.max.y
  data.metrics = { footY, height: Math.max(0.2, topY - footY) }
  return data.metrics
}

const STRIDE_BONES = ['Ankle_L', 'Ankle_R', 'Toes_L', 'Toes_R']
const STRIDE_SAMPLES = 60
const STRIDE_PLANTED = 0.15
const strideCache = new WeakMap()

export function strideSpeed(model, name) {
  const clip = model.clips.get(name)
  if (!clip) return 0
  if (strideCache.has(clip)) return strideCache.get(clip)
  const root = cloneSkinned(model.root)
  root.position.set(0, 0, 0)
  root.quaternion.identity()
  root.scale.set(1, 1, 1)
  const feet = STRIDE_BONES.map(n => root.getObjectByName(n)).filter(Boolean)
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.play()
  const paths = feet.map(() => [])
  for (let i = 0; i <= STRIDE_SAMPLES; i++) {
    action.time = (clip.duration * i) / STRIDE_SAMPLES
    mixer.update(0)
    root.updateMatrixWorld(true)
    feet.forEach((f, k) => paths[k].push(f.getWorldPosition(new THREE.Vector3())))
  }
  const dt = clip.duration / STRIDE_SAMPLES
  let sum = 0
  let n = 0
  for (const path of paths) {
    const ys = path.map(p => p.y)
    const low = Math.min(...ys)
    const limit = low + (Math.max(...ys) - low) * STRIDE_PLANTED
    for (let i = 1; i < path.length; i++) {
      if (path[i].y > limit || path[i - 1].y > limit) continue
      sum += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z) / dt
      n++
    }
  }
  const speed = n ? sum / n : 0
  strideCache.set(clip, speed)
  return speed
}

export function landingTime(data, name) {
  const clip = data.clips.get(name)
  if (!clip) return 0
  const root = cloneSkinned(data.scene)
  const pelvis = root.getObjectByName('Root_M')
  if (!pelvis) return clip.duration
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.play()
  const step = 1 / 30
  const heights = []
  for (let t = 0; t <= clip.duration; t += step) {
    action.time = t
    mixer.update(0)
    root.updateMatrixWorld(true)
    heights.push(pelvis.getWorldPosition(_v).y)
  }
  const peak = heights.indexOf(Math.max(...heights))
  const rest = heights[heights.length - 1]
  const drop = heights[peak] - rest
  const landed = heights.findIndex((y, i) => i > peak && y - rest < drop * 0.1)
  return (landed < 0 ? heights.length - 1 : landed) * step
}

function dressMaterial(source, opts) {
  const vfx = source.userData && source.userData.vfx && meshVfxMaterial(source.userData.vfx, source.map)
  if (vfx) return vfx
  const character = source.userData && source.userData.character
  const m = character && opts.gameShader !== false ? characterMaterial(source, character) : source.clone()
  if (m.userData.fx === 'additive') {
    m.blending = THREE.AdditiveBlending
    m.depthWrite = false
    m.transparent = true
    m.emissive.set(0xffffff)
    m.emissiveMap = m.map
    m.emissiveIntensity = 1.5
  } else if (opts.emissive) {
    m.emissive.set(opts.emissive)
    m.emissiveIntensity = opts.emissiveIntensity ?? 0.35
    if (m.map) m.emissiveMap = m.map
  }
  return m
}

export function buildModel(data, opts = {}) {
  const { footY, height } = measure(data)
  const root = cloneSkinned(data.scene)
  const bones = []
  const byName = new Map()
  const skins = []
  root.traverse(o => {
    if (o.name && !byName.has(o.name)) byName.set(o.name, o)
    if (o.isBone) bones.push(o)
    if (!o.isMesh) return
    o.material = dressMaterial(o.material, opts)
    o.frustumCulled = false
    o.castShadow = !!opts.castShadow
    o.receiveShadow = false
    if (o.isSkinnedMesh) skins.push(o)
  })
  const model = {
    root,
    bones,
    byName,
    skins,
    body: largestSkin(root),
    height,
    footY,
    clips: data.clips,
    impacts: data.impacts,
  }
  if (opts.projectedShadow !== false && skins.some(s => s.material.userData.character)) addProjectedShadow(model)
  return model
}

export function disposeModel(m) {
  for (const s of m.skins) s.material.dispose()
}
