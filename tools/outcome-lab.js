import * as THREE from 'three'
import { HEROES } from '../src/data/heroes.js'
import { loadModelData, buildModel } from '../src/core/model.js'
import { Actor } from '../src/entities/actor.js'
import { Vfx, vfxTexturesReady } from '../src/world/vfx.js'
import { HeroFx } from '../src/world/hero-fx.js'
import { LOBBY_LIGHT, tickCharacters } from '../src/world/character-shader.js'

const RESULT_LIGHT = {
  victory: { ambient: [0.7924528, 0.6709682, 0.6304734], reflection: 0.8 },
  defeat: { ambient: [0.3243542, 0.3636881, 0.5031446], reflection: 0.726 },
}
const MAIN_FROM_CAMERA = new THREE.Vector3(-0.224, 0.529, 0.819).normalize()
const RIM_FROM_CAMERA = new THREE.Vector3(0.323, 0.531, -0.784).normalize()
const RIM_COLOR = [0, 0.568, 1]
const INTRO_EXIT = 0.85
const INTRO_BLEND = 0.8

const params = new URLSearchParams(location.search)
const heroId = params.get('hero') || 'ricklow'
const kind = params.get('kind') || 'victory'
const light = params.get('light') || kind
const fps = Number(params.get('fps') || 30)
const out = Number(params.get('size') || 512)
const ss = Number(params.get('ss') || 2)
const fov = Number(params.get('fov') || 30)
const frameH = Number(params.get('fh') || 2.2)
const targetY = Number(params.get('ty') || 1.45)
const lift = Number(params.get('lift') || 0)
const rimGain = Number(params.get('rim') || 2.4)
const skin = params.get('skin') !== '0'
const turn = Number(params.get('turn') || 0)
const feather = Number(params.get('feather') || 0.12)
const plan = params.get('plan') ? JSON.parse(params.get('plan')) : null

const hero = HEROES.find(h => h.id === heroId) || HEROES[0]
const canvas = document.getElementById('c')
const outCanvas = document.getElementById('out')
const side = out * ss
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.setSize(side, side, false)
renderer.setClearColor(0x000000, 0)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
const gl = renderer.getContext()

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100)
const dist = frameH / 2 / Math.tan(THREE.MathUtils.degToRad(fov / 2))
camera.position.set(0, targetY + lift, dist)
camera.lookAt(0, targetY, 0)
camera.updateMatrixWorld()

function applyResultLight() {
  const l = RESULT_LIGHT[light] || RESULT_LIGHT.victory
  LOBBY_LIGHT.uLobbyAmbient.value.setRGB(...l.ambient, THREE.SRGBColorSpace)
  LOBBY_LIGHT.uLobbyReflection.value = l.reflection
  LOBBY_LIGHT.uLobbyLightColor.value.setRGB(1.5, 1.5, 1.5)
  LOBBY_LIGHT.uLobbyLightDir.value.copy(MAIN_FROM_CAMERA).applyQuaternion(camera.quaternion)
  LOBBY_LIGHT.uLobbyRimDir.value.copy(RIM_FROM_CAMERA).applyQuaternion(camera.quaternion)
  LOBBY_LIGHT.uLobbyRimColor.value.setRGB(...RIM_COLOR, THREE.SRGBColorSpace).multiplyScalar(rimGain)
}

const vfx = new Vfx(scene)
const heroFx = new HeroFx(vfx, camera)
const lab = { t: 0, frame: 0, fps, kind, hero: hero.id, events: [], steps: [], duration: 0 }
window.lab = lab

function restPositions(root) {
  const map = new Map()
  root.traverse(o => { if (o.name) map.set(o.name, o.position) })
  return map
}

function sharedBones(lobRoot, ingRoot) {
  const lob = restPositions(lobRoot)
  const ing = restPositions(ingRoot)
  const shared = new Set()
  for (const [name, p] of lob) {
    const q = ing.get(name)
    if (q && p.distanceTo(q) < 1e-3) shared.add(name)
  }
  return shared
}

function bodyClip(clip, shared) {
  const tracks = clip.tracks.filter(t => {
    const [bone, prop] = t.name.split('.')
    return shared.has(bone) && (prop === 'quaternion' || bone === 'Root_M' || bone === 'Base')
  })
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
}

function defaultPlan(actor) {
  if (kind === 'victory') {
    const intro = actor.model.clips.get('IntroLOB')
    const exit = intro ? intro.duration * INTRO_EXIT : 0
    return [
      { clip: 'IntroLOB', once: true, intro: true },
      { clip: 'IdleLOB', at: exit, fade: INTRO_BLEND },
    ]
  }
  return [{ clip: 'IdleLOB' }]
}

function playStep(actor, step) {
  const rig = actor.rig
  const clip = actor.model.clips.get(step.clip)
  if (!clip) {
    console.warn('missing clip', step.clip)
    return
  }
  rig.state = step.clip
  rig.stateT = 0
  rig.queue = []
  rig.looping = !step.once
  rig.oneShotDone = rig.looping
  rig.total = clip.duration
  const previous = rig.action
  rig.start({ clip, speed: step.speed || 1 }, lab.frame === 0 ? 0 : step.fade ?? 0.2)
  if (step.rest && lab.restClip && !lab.restAction) {
    const rest = rig.mixer.clipAction(lab.restClip)
    rest.setLoop(THREE.LoopRepeat, Infinity)
    rest.play()
    rest.time = previous ? previous.time % lab.restClip.duration : 0
    lab.restAction = rest
  }
  if (lab.restAction && !step.once) lab.restAction.setEffectiveTimeScale(lab.restClip.duration / clip.duration)
  if (step.intro) {
    const total = clip.duration
    for (const [t, name, off] of hero.intro || []) {
      const life = off ? off - t : Math.max(0.5, total * INTRO_EXIT + INTRO_BLEND - t)
      lab.events.push({ at: lab.t + t, name, life })
    }
    lab.events.sort((a, b) => a.at - b.at)
  }
}

function simulate(dt) {
  const actor = lab.actor
  while (lab.steps.length && (lab.steps[0].at || 0) <= lab.t + 1e-6) playStep(actor, lab.steps.shift())
  while (lab.events.length && lab.events[0].at <= lab.t + 1e-6) {
    const e = lab.events.shift()
    if (hero.vfx) heroFx.playLobby(hero.vfx, actor, e.name, e.life)
  }
  tickCharacters(dt)
  actor.update(dt, {})
  heroFx.update(dt)
  vfx.update(dt, camera)
  lab.t += dt
  lab.frame++
}

function edgeRamp(k) {
  if (feather <= 0) return 1
  const t = Math.min(1, Math.max(0, k / feather))
  return t * t * (3 - 2 * t)
}

const vignette = Number(params.get('vignette') || 0)
const edge = new Float32Array(out)
for (let i = 0; i < out; i++) edge[i] = edgeRamp((i + 0.5) / out) * edgeRamp(1 - (i + 0.5) / out)
const fade = new Float32Array(out * out)
for (let y = 0; y < out; y++) {
  for (let x = 0; x < out; x++) {
    if (vignette > 0) {
      const r = Math.hypot((x + 0.5) / out * 2 - 1, (y + 0.5) / out * 2 - 1)
      const t = Math.min(1, Math.max(0, (r - vignette) / (1 - vignette)))
      fade[y * out + x] = 1 - t * t * (3 - 2 * t)
    } else {
      fade[y * out + x] = edge[x] * edge[y]
    }
  }
}

const pixels = new Uint8Array(side * side * 4)
const image = new ImageData(out, out * 2)
const straight = new ImageData(out, out)
const outCtx = outCanvas.getContext('2d')
outCanvas.width = out
outCanvas.height = out * 2

function grab() {
  renderer.render(scene, camera)
  gl.readPixels(0, 0, side, side, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const d = image.data
  const s = straight.data
  const n = ss * ss
  const alphaRow = out * out * 4
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < ss; dy++) {
        const row = side - 1 - (y * ss + dy)
        for (let dx = 0; dx < ss; dx++) {
          const i = (row * side + x * ss + dx) * 4
          r += pixels[i]
          g += pixels[i + 1]
          b += pixels[i + 2]
          a += pixels[i + 3]
        }
      }
      const f = fade[y * out + x] / n
      r = Math.round(r * f)
      g = Math.round(g * f)
      b = Math.round(b * f)
      a = Math.max(Math.round(a * f), r, g, b)
      const o = (y * out + x) * 4
      d[o] = r
      d[o + 1] = g
      d[o + 2] = b
      d[o + 3] = 255
      d[alphaRow + o] = a
      d[alphaRow + o + 1] = a
      d[alphaRow + o + 2] = a
      d[alphaRow + o + 3] = 255
      const k = a ? 255 / a : 0
      s[o] = Math.min(255, Math.round(r * k))
      s[o + 1] = Math.min(255, Math.round(g * k))
      s[o + 2] = Math.min(255, Math.round(b * k))
      s[o + 3] = a
    }
  }
  outCtx.putImageData(image, 0, 0)
  return outCanvas.toDataURL('image/png')
}

lab.capture = () => {
  simulate(1 / fps)
  return grab()
}

lab.still = () => {
  const c = document.createElement('canvas')
  c.width = out
  c.height = out
  c.getContext('2d').putImageData(straight, 0, 0)
  return c.toDataURL('image/png')
}

lab.ready = (async () => {
  const [data] = await Promise.all([loadModelData(hero.lobby || hero.model), hero.vfx ? vfx.preload([hero.vfx]) : null])
  if (params.get('ing')) {
    const ing = await loadModelData(hero.model)
    const shared = sharedBones(data.scene, ing.scene)
    for (const name of params.get('ing').split(',')) {
      const clip = ing.clips.get(name)
      if (clip && !data.clips.has(name)) data.clips.set(name, bodyClip(clip, shared))
    }
    const idle = data.clips.get('IdleLOB')
    if (idle) lab.restClip = new THREE.AnimationClip('IdleLOB_rest', idle.duration, idle.tracks.filter(t => !shared.has(t.name.split('.')[0])))
  }
  await vfxTexturesReady()
  const actor = new Actor(buildModel(data, { castShadow: false, projectedShadow: false }), { targetHeight: 1.9 })
  actor.setPos(0, 0)
  actor.facing = actor.targetFacing = (hero.turn || 0) + turn
  scene.add(actor.root)
  lab.actor = actor
  applyResultLight()
  if (skin && hero.vfx) heroFx.attachSkin(hero.vfx, actor, { lobby: true })
  lab.steps = (plan || defaultPlan(actor)).map(s => ({ ...s }))
  lab.plan = lab.steps.map(s => ({ ...s }))
  lab.clipDurations = Object.fromEntries([...actor.model.clips].map(([n, c]) => [n, c.duration]))
  for (let i = 0; i < 4; i++) renderer.render(scene, camera)
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {})
  await new Promise(r => setTimeout(r, 1500))
  renderer.render(scene, camera)
  return true
})()
