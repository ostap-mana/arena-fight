import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js'
import { loadModelData } from '../core/model.js'
import { CHAIN_FADE } from '../core/rig.js'
import { stream } from '../core/rng.js'
import { removeAt } from '../core/list.js'

const random = stream('sim')

const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _q = new THREE.Quaternion()
const _s = new THREE.Vector3()
const _e = new THREE.Euler()
const _up = new THREE.Vector3(0, 1, 0)
const PROJECTILE_SPEED = 17
const HIT_SCALE = 0.8
const SHOT_STAGGER = 0.07
const LINGER = 0.25
const SCRIPT_SKILL = { 1: 'ActiveSkill1', 2: 'ActiveSkill2', 3: 'ActiveSkill3', 4: 'Ultimate' }
const ANCHOR_HEIGHT = { FX_Bot: 0, FX_Center: 0.55, FX_Front: 0.55, FX_Head: 0.92, FX_Top: 1 }

export function comboType(index) {
  return index === 0 ? 10 : 4 + index
}

export function scriptCombo(index) {
  return index === 0 ? 'ComboZero' : `Combo${index}`
}

function sampleCurve(c, k) {
  if (!c) return 0
  const s = c.samples
  const x = Math.min(1, Math.max(0, k)) * (s.length - 1)
  const i = Math.min(s.length - 2, Math.floor(x))
  return s[i] + (s[i + 1] - s[i]) * (x - i)
}

function curveAmount(c, dist) {
  if (!c) return 0
  const r = c.range
  const pick = r ? r[0] + (r[1] - r[0]) * random() : 1
  const side = c.randomSide && random() < 0.5 ? -1 : 1
  return c.mul * pick * side * (c.byDistance ? dist : 1)
}

function copiedRotation(quat, axes) {
  if (!axes) return new THREE.Quaternion()
  if (axes[0] && axes[1] && axes[2]) return quat.clone()
  _e.setFromQuaternion(quat, 'YXZ')
  if (!axes[0]) _e.x = 0
  if (!axes[1]) _e.y = 0
  if (!axes[2]) _e.z = 0
  return new THREE.Quaternion().setFromEuler(_e)
}

const RIM_VS = `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <beginnormal_vertex>
    #include <skinnormal_vertex>
    #include <skinning_vertex>
    vUv = uv;
    vec4 wp = modelMatrix * vec4(transformed, 1.0);
    vNormal = normalize(mat3(modelMatrix) * objectNormal);
    vView = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const RIM_FS = `
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform vec3 uRim;
  uniform float uRimBias;
  uniform float uRimScale;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 base = texture2D(uMap, vUv).rgb * uTint;
    float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
    float rim = clamp((1.0 - facing - (1.0 - uRimBias)) * uRimScale, 0.0, 1.0);
    gl_FragColor = vec4(base + uRim * rim, 1.0);
    #include <colorspace_fragment>
  }
`

const rimTextures = new Map()

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function modelTexture(name) {
  const file = `assets/vfx/tex/${name}.webp`
  if (!rimTextures.has(file)) {
    const tex = new THREE.TextureLoader().load(file)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.flipY = false
    rimTextures.set(file, tex)
  }
  return rimTextures.get(file)
}

function glowMaterial(spec) {
  const tint = spec.colors._Tint || [1, 1, 1, 1]
  return new THREE.MeshBasicMaterial({
    map: modelTexture(spec.texture),
    color: new THREE.Color(...tint.slice(0, 3).map(srgbToLinear)),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
}

function modelMaterial(spec) {
  return /Rim/.test(spec.shader || '') ? rimMaterial(spec) : glowMaterial(spec)
}

function rimMaterial(spec) {
  const tint = spec.colors._Tint || [1, 1, 1, 1]
  const rim = spec.colors._RimColor || [0, 0, 0, 1]
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: modelTexture(spec.texture) },
      uTint: { value: new THREE.Vector3(...tint.slice(0, 3).map(srgbToLinear)) },
      uRim: { value: new THREE.Vector3(...rim.slice(0, 3).map(srgbToLinear)) },
      uRimBias: { value: spec.floats._RimBias ?? 0.87 },
      uRimScale: { value: spec.floats._RimScale ?? 2 },
    },
    vertexShader: RIM_VS,
    fragmentShader: RIM_FS,
  })
}

export function prefabRole(name) {
  if (/Projectile/i.test(name)) return 'projectile'
  if (/Hit|Target|Chaining(?!_Precast)/i.test(name)) return 'hit'
  if (/AOE|Explosion/i.test(name)) return 'aoe'
  return 'caster'
}

function byBlock(entries) {
  const groups = new Map()
  for (const e of entries) {
    if (!groups.has(e.block)) groups.set(e.block, [])
    groups.get(e.block).push(e)
  }
  return [...groups.values()]
}

const _back = new THREE.Vector3(0, 0, -1)

function yawQuat(yaw) {
  return new THREE.Quaternion().setFromAxisAngle(_up, yaw + Math.PI)
}

export class HeroFx {
  constructor(vfx, camera) {
    this.vfx = vfx
    this.camera = camera
    this.flights = []
    this.shots = []
    this.links = []
    this.timers = []
    this.skinMutes = new Map()
    this.lobbyFocus = new Map()
    this.onSpawn = null
    this.models = []
    this.modelData = new Map()
    this.tracked = []
  }

  script(id) {
    const lib = this.lib(id)
    return (lib && lib.data.script) || null
  }

  hasScript(id) {
    return !!this.script(id)
  }

  scriptedSkill(id, key) {
    const s = this.script(id)
    return (s && key && s.skills[key]) || null
  }

  skillFxNames(id) {
    const lib = this.lib(id)
    const names = new Set()
    if (!lib) return names
    for (const s of Object.values(lib.skills)) for (const e of s.fx) names.add(e.fx)
    const script = this.script(id)
    if (script) {
      for (const s of Object.values(script.skills)) {
        for (const e of s.fx) {
          names.add(e.fx)
          for (const h of e.impact || []) names.add(h.fx)
        }
      }
    }
    return names
  }

  scriptRanged(id) {
    const s = this.script(id)
    if (!s) return false
    return Object.entries(s.skills).some(([key, skill]) => /^Combo/.test(key) && skill.fx.some(e => e.kind === 'projectile'))
  }

  scriptShape(id, type) {
    const s = this.scriptedSkill(id, SCRIPT_SKILL[type])
    const kinds = new Set(s ? s.fx.map(e => e.kind) : [])
    return { projectile: kinds.has('projectile'), chaining: kinds.has('chaining') }
  }

  warmSkills(id, at) {
    const out = []
    for (const name of this.skillFxNames(id)) {
      const inst = this.vfx.spawn(id, name, { pos: at, scale: 0.001, lifetime: 0.1, camera: this.camera })
      if (!inst) continue
      this.attachModel(id, name, inst)
      out.push(inst)
    }
    return out
  }

  async preloadModels(id) {
    const s = this.script(id)
    if (!s || !s.models) return
    await Promise.all(Object.values(s.models).map(spec =>
      loadModelData(spec.model).then(data => this.modelData.set(spec.model, data)).catch(() => null)))
  }

  clipStarts(actor, clips) {
    const starts = {}
    let at = 0
    for (const name of clips) {
      starts[name] = at
      const clip = actor.model.clips.get(name)
      at += Math.max(0, (clip ? clip.duration : 0) - CHAIN_FADE)
    }
    return starts
  }

  timeline(id, key, actor) {
    const s = this.scriptedSkill(id, key)
    if (!s) return null
    const starts = this.clipStarts(actor, s.clips)
    const list = s.fx.map(e => ({ e, at: (starts[e.clip] || 0) + e.t }))
    const hits = list.filter(x => x.e.kind === 'target')
    const direct = hits.filter(x => !x.e.area && !/Precast/.test(x.e.fx))
    const timed = direct.length ? direct : hits
    const hitAt = timed.length ? Math.min(...timed.map(x => x.at)) : null
    const shots = list.filter(x => x.e.kind === 'projectile')
    return { list, hits, hitAt, shots }
  }

  point(id, actor, name, out) {
    const node = this.anchor(id, actor, name)
    if (node && node !== actor.root) {
      node.updateWorldMatrix(true, false)
      return node.getWorldPosition(out)
    }
    return out.copy(actor.pos).setY(actor.pos.y + actor.height * (ANCHOR_HEIGHT[name] ?? 0.55))
  }

  strikeAt(id, e, caster, center) {
    const pos = new THREE.Vector3(center.x, Math.max(0.02, center.y || 0), center.z)
    return this.spawn(id, e.fx, { pos, quat: yawQuat(caster.facing), scale: caster.scale, lifetime: e.dying + LINGER, camera: this.camera })
  }

  shoot(id, e, caster, target, fallback, onArrive) {
    const socket = this.anchor(id, caster, e.socket) || caster.root
    socket.updateWorldMatrix(true, false)
    const from = socket.getWorldPosition(new THREE.Vector3())
    const end = fallback ? fallback.clone() : from.clone().add(_v.set(Math.sin(caster.facing), 0, Math.cos(caster.facing)).multiplyScalar(8 * caster.scale))
    const goal = out => (target && !target.dead ? this.point(id, target, e.target, out) : out.copy(end))
    const dist = from.distanceTo(goal(_v2))
    const speed = (e.speed || PROJECTILE_SPEED) * caster.scale
    const dur = Math.max(0.05, e.mode === 'fixed_time' ? e.flight : dist / speed)
    const inst = this.spawn(id, e.fx, { pos: from.clone(), quat: yawQuat(caster.facing), scale: caster.scale, camera: this.camera })
    this.shots.push({
      inst, e, from, goal, dur, t: 0,
      side: curveAmount(e.side, dist) * caster.scale,
      height: curveAmount(e.height, dist) * caster.scale,
      last: from.clone(),
      pos: from.clone(),
      onArrive,
    })
  }

  chain(id, e, caster, target) {
    if (!target || target.dead) return null
    const inst = this.spawn(id, e.fx, { pos: caster.pos.clone(), scale: caster.scale, lifetime: e.dying + LINGER, camera: this.camera })
    if (!inst) return null
    const link = { inst, id, e, caster, target, to: new THREE.Vector3() }
    this.links.push(link)
    this.placeLink(link)
    return inst
  }

  placeLink(l) {
    const from = this.point(l.id, l.caster, l.e.socket, _v)
    if (!l.target.dead) this.point(l.id, l.target, l.e.target, l.to)
    _v2.copy(l.to).sub(from)
    const dist = Math.max(0.01, _v2.length())
    _q.setFromUnitVectors(_back, _v2.multiplyScalar(1 / dist))
    l.inst.span(from, _q, dist / ((l.e.length || 1) * l.inst.scale))
  }

  updateShots(dt) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]
      s.t += dt
      const k = Math.min(1, s.t / s.dur)
      const to = s.goal(_v2)
      _v.copy(to).sub(s.from)
      const along = s.e.progress ? sampleCurve(s.e.progress, k) : k
      const pos = s.pos.copy(s.from).addScaledVector(_v, along)
      _s.crossVectors(_up, _v)
      if (_s.lengthSq() > 1e-8) pos.addScaledVector(_s.normalize(), sampleCurve(s.e.side, k) * s.side)
      pos.y += sampleCurve(s.e.height, k) * s.height
      _v.copy(pos).sub(s.last)
      if (s.inst) {
        if (_v.lengthSq() > 1e-8) _q.setFromUnitVectors(_back, _v.normalize())
        s.inst.moveTo(pos, _v.lengthSq() > 0 ? _q : null)
      }
      s.last.copy(pos)
      if (k < 1) continue
      this.shots.splice(i, 1)
      if (s.inst) s.inst.stop()
      if (s.onArrive) s.onArrive(pos)
    }
  }

  updateLinks() {
    for (let i = this.links.length - 1; i >= 0; i--) {
      const l = this.links[i]
      if (!l.inst.root.parent) {
        this.links.splice(i, 1)
        continue
      }
      this.placeLink(l)
    }
  }

  anchor(id, actor, name) {
    if (!name) return actor.root
    const lib = this.lib(id)
    const s = lib && lib.sockets[name]
    if (s && (!s.bone || actor.model.byName.has(s.bone) || lib.sockets[s.bone])) return this.vfx.socket(id, actor, name)
    return actor.model.byName.get(name) || null
  }

  produce(id, e, caster) {
    const socket = this.anchor(id, caster, e.socket) || caster.root
    socket.updateWorldMatrix(true, false)
    socket.matrixWorld.decompose(_v, _q, _s)
    const full = !!(e.copyRot && e.copyRot[0] && e.copyRot[1] && e.copyRot[2])
    const inst = this.spawn(id, e.fx, {
      follow: e.follow ? socket : null,
      copyRot: !!(e.follow && full),
      pos: _v.clone(),
      quat: copiedRotation(_q, e.copyRot),
      scale: caster.scale,
      lifetime: e.dying + LINGER,
      camera: this.camera,
    })
    if (inst) this.attachModel(id, e.fx, inst)
    return inst
  }

  strike(id, e, caster, target) {
    if (!target || target.dead) return null
    const node = this.anchor(id, target, e.target)
    const socketed = node && node !== target.root
    const pos = this.point(id, target, e.target, new THREE.Vector3())
    const yaw = e.toProducer ? Math.atan2(caster.pos.x - target.pos.x, caster.pos.z - target.pos.z) : target.facing
    return this.spawn(id, e.fx, {
      follow: e.follow && socketed ? node : null,
      copyRot: false,
      pos,
      quat: yawQuat(yaw),
      scale: caster.scale,
      lifetime: e.dying + LINGER,
      camera: this.camera,
    })
  }

  playScripted(id, key, caster, targets, opts = {}) {
    const tl = this.timeline(id, key, caster)
    if (!tl) return null
    const pick = () => (typeof targets === 'function' ? targets() : targets) || []
    const ahead = () => caster.pos.clone().add(_v.set(Math.sin(caster.facing), 0, Math.cos(caster.facing)).multiplyScalar(3 * caster.scale))
    const center = () => {
      const first = pick().find(t => t && !t.dead)
      return opts.center || (first ? first.pos.clone() : ahead())
    }
    const area = e => {
      const first = pick().find(t => t && !t.dead)
      if (first) this.strike(id, e, caster, first)
      else this.strikeAt(id, e, caster, center())
    }
    let shot = 0
    for (const { e, at } of tl.list) {
      if (e.kind === 'producer') this.later(at, () => { if (!caster.dead) this.produce(id, e, caster) })
      else if (e.kind === 'projectile') {
        const n = shot++
        this.later(at, () => {
          if (caster.dead) return
          const list = pick().filter(t => t && !t.dead)
          const target = list.length ? list[n % list.length] : null
          this.shoot(id, e, caster, target, opts.fallback || null, () => {
            if (target && !target.dead) for (const h of e.impact || []) this.strike(id, h, caster, target)
            if (target && opts.onHit) opts.onHit(target, n, 1)
            if (opts.onImpact && n === 0) opts.onImpact(1)
          })
        })
      } else if (e.kind === 'chaining') this.later(at, () => { if (!caster.dead) for (const t of pick()) this.chain(id, e, caster, t) })
      else if (e.area) this.later(at, () => area(e))
      else if (!opts.manualHits) this.later(at, () => { for (const t of pick()) this.strike(id, e, caster, t) })
    }
    const hitAt = tl.hitAt ?? opts.impact ?? 0.35
    if (!tl.shots.length && (opts.onHit || opts.onImpact)) {
      const times = (opts.timing && opts.timing.hits) || [hitAt]
      const share = 1 / times.length
      for (const at of times) {
        this.later(at, () => {
          if (opts.onHit) pick().forEach((t, i) => opts.onHit(t, i, share))
          if (opts.onImpact) opts.onImpact(share)
        })
      }
    }
    return { hitAt, timeline: tl, ranged: tl.shots.length > 0 }
  }

  strikeLater(id, key, caster, target) {
    const tl = this.timeline(id, key, caster)
    if (!tl || tl.hitAt === null) return
    for (const { e, at } of tl.hits) this.later(at - tl.hitAt, () => this.strike(id, e, caster, target))
  }

  attachModel(id, name, inst) {
    const s = this.script(id)
    const spec = s && s.models && s.models[name]
    const data = spec && this.modelData.get(spec.model)
    if (!data) return
    const compiled = inst.lib.prefab(name)
    const at = compiled.findIndex(c => c.n.n === spec.node)
    if (at < 0) return
    const host = inst.nodes[at].parent
    const scene = cloneSkinned(data.scene)
    const materials = new Map()
    const pickMaterial = name => {
      const own = spec.materials && spec.materials[name]
      const key = own ? name : ''
      if (!materials.has(key)) materials.set(key, modelMaterial(own || spec.material))
      return materials.get(key)
    }
    scene.traverse(o => {
      if (!o.isMesh) return
      o.material = pickMaterial(o.material && o.material.name)
      o.frustumCulled = false
    })
    host.add(scene)
    inst.hosting = true
    const inside = new Set([at])
    const pairs = []
    const clones = new Map()
    scene.traverse(o => { if (o.name && !clones.has(o.name)) clones.set(o.name, o) })
    compiled.forEach((c, i) => {
      if (i <= at || !inside.has(c.n.p)) return
      inside.add(i)
      const twin = clones.get(c.n.n)
      if (twin) pairs.push([twin, inst.nodes[i]])
    })
    const mixer = new THREE.AnimationMixer(scene)
    const clip = spec.clip && data.clips.get(spec.clip)
    if (clip) {
      const action = mixer.clipAction(clip)
      action.setLoop(THREE.LoopOnce, 1)
      action.clampWhenFinished = true
      action.play()
    }
    this.models.push({ inst, host, scene, mixer, pairs })
  }

  updateModels(dt) {
    for (let i = this.models.length - 1; i >= 0; i--) {
      const m = this.models[i]
      if (!m.inst.root.parent) {
        m.host.remove(m.scene)
        this.models.splice(i, 1)
        continue
      }
      m.mixer.update(dt)
      const pairs = m.pairs
      for (let j = 0; j < pairs.length; j++) {
        const from = pairs[j][0]
        const to = pairs[j][1]
        to.position.copy(from.position)
        to.quaternion.copy(from.quaternion)
        to.scale.copy(from.scale)
      }
    }
  }

  attachAmbient(id, actor) {
    const s = this.script(id)
    actor.skinFx = []
    const ambient = s.ambient.map(a => {
      if (!a.active || !this.lib(id).prefabs[a.fx]) return null
      const socket = this.anchor(id, actor, a.socket) || actor.root
      socket.updateWorldMatrix(true, false)
      const inst = this.vfx.spawn(id, a.fx, {
        follow: socket,
        copyRot: true,
        pos: socket.getWorldPosition(new THREE.Vector3()),
        quat: socket.getWorldQuaternion(new THREE.Quaternion()),
        scale: actor.scale,
        lifetime: Infinity,
        mute: this.skinMutes.get(id) || null,
        camera: this.camera,
      })
      if (inst) actor.skinFx.push(inst)
      return inst
    })
    this.tracked.push({ actor, script: s, ambient, clip: null, t: 0, fired: 0 })
  }

  trackEvents() {
    const tracked = this.tracked
    for (let n = tracked.length - 1; n >= 0; n--) {
      const tr = tracked[n]
      const a = tr.actor
      if (!a.skinFx || !a.skinFx.length || a.skinFx[0] !== tr.ambient.find(Boolean)) {
        removeAt(tracked, n)
        continue
      }
      const action = a.rig.action
      if (!action) continue
      const clip = action.getClip().name
      const t = action.time
      if (clip !== tr.clip || t < tr.t) {
        tr.clip = clip
        tr.fired = 0
      }
      tr.t = t
      const list = tr.script.events[clip]
      while (list && tr.fired < list.length && list[tr.fired][0] <= t) {
        const toggle = tr.script.toggles[list[tr.fired][1]]
        if (toggle) {
          for (const k of toggle.ambient) {
            const inst = tr.ambient[k]
            if (!inst) continue
            if (inst.ribbons.length) for (const r of inst.ribbons) r.emitting = toggle.value
            else if (!toggle.value) inst.stop()
          }
        }
        tr.fired++
      }
    }
  }

  spawn(id, name, opts) {
    const inst = this.vfx.spawn(id, name, opts)
    if (inst && this.onSpawn) this.onSpawn(name, opts.pos)
    return inst
  }

  muteSkin(id, names) {
    this.skinMutes.set(id, new Set(names))
  }

  focusLobby(id, names) {
    this.lobbyFocus.set(id, new Set(names))
  }

  lib(id) {
    return this.vfx.library(id)
  }

  entries(id, type) {
    const s = this.vfx.skill(id, type)
    return s ? s.fx : []
  }

  isRanged(id) {
    for (let k = 0; k <= 5; k++) {
      if (this.entries(id, comboType(k)).some(e => prefabRole(e.fx) === 'projectile')) return true
    }
    return false
  }

  hasSkill(id, type) {
    if (this.hasScript(id)) return !!this.scriptedSkill(id, SCRIPT_SKILL[type])
    return this.entries(id, type).length > 0
  }

  wrapper(id, name) {
    const lib = this.lib(id)
    const nodes = lib && lib.prefabs[name]
    return (nodes && nodes[0] && nodes[0].fx) || {}
  }

  later(delay, fn) {
    this.timers.push({ t: delay, fn })
  }

  spawnOn(id, name, actor, opts = {}) {
    const w = this.wrapper(id, name)
    const socketName = opts.socket || w.socket || 'FX_Center'
    const socket = this.vfx.socket(id, actor, socketName)
    if (!socket) return null
    socket.updateWorldMatrix(true, false)
    const pos = socket.getWorldPosition(new THREE.Vector3())
    if (opts.ground) pos.y = Math.max(0.02, actor.pos.y + 0.02)
    const yaw = opts.yaw !== undefined ? opts.yaw : actor.facing
    return this.spawn(id, name, {
      follow: w.follow && !opts.ground ? socket : null,
      copyRot: !!(w.follow && w.copyRot && !opts.ground),
      pos,
      quat: yawQuat(yaw),
      scale: opts.scale || actor.scale,
      lifetime: opts.lifetime === undefined ? (w.follow ? 1.6 : 3) : opts.lifetime,
      camera: this.camera,
    })
  }

  skinNames(id, lobby = false) {
    const lib = this.lib(id)
    if (!lib) return []
    if (lobby) return Object.keys(lib.lobbySockets).filter(n => lib.prefabs[n] && /Skin/.test(n) && !lib.lobbySockets[n].off)
    return Object.keys(lib.prefabs).filter(n => /^FX_/.test(n) && /Skin/.test(n) && !/LOB|Lobby|Trail|Intro/.test(n))
  }

  emitterHeight(id, name) {
    const nodes = this.lib(id).prefabs[name] || []
    const acc = []
    let top = 0
    nodes.forEach((n, i) => {
      acc[i] = (n.t ? n.t[1] : 0) + (n.p >= 0 ? acc[n.p] || 0 : 0)
      if (n.ps) top = Math.max(top, acc[i])
    })
    return top
  }

  attachSkin(id, actor, opts = {}) {
    this.detachSkin(actor)
    const lib = this.lib(id)
    if (!lib || !actor) return
    if (!opts.lobby && this.hasScript(id)) {
      this.attachAmbient(id, actor)
      return
    }
    actor.skinFx = []
    const lobby = !!(opts.lobby && lib.lobbySockets)
    const sockets = lobby ? lib.lobbySockets : lib.sockets
    for (const name of this.skinNames(id, lobby)) {
      const socketName = sockets[name] ? name : this.wrapper(id, name).socket || 'FX_Center'
      const socket = this.emitterHeight(id, name) > 1 ? actor.root : this.vfx.socket(id, actor, socketName, lobby)
      if (!socket) continue
      socket.updateWorldMatrix(true, false)
      const inst = this.vfx.spawn(id, name, {
        follow: socket,
        copyRot: true,
        pos: socket.getWorldPosition(new THREE.Vector3()),
        quat: socket.getWorldQuaternion(new THREE.Quaternion()),
        scale: actor.scale,
        lifetime: Infinity,
        mute: this.skinMutes.get(id) || null,
        focus: lobby ? this.lobbyFocus.get(id) || null : null,
        camera: this.camera,
      })
      if (inst) actor.skinFx.push(inst)
    }
  }

  detachSkin(actor) {
    if (!actor || !actor.skinFx) return
    for (const inst of actor.skinFx) inst.stop()
    actor.skinFx = []
  }

  playLobby(id, actor, name, lifetime) {
    const lib = this.lib(id)
    if (!lib || !actor || !lib.prefabs[name]) return null
    const socket = this.vfx.socket(id, actor, name, true)
    if (!socket) return null
    socket.updateWorldMatrix(true, false)
    return this.vfx.spawn(id, name, {
      follow: socket,
      copyRot: true,
      pos: socket.getWorldPosition(new THREE.Vector3()),
      quat: socket.getWorldQuaternion(new THREE.Quaternion()),
      scale: actor.scale,
      lifetime,
      focus: this.lobbyFocus.get(id) || null,
      camera: this.camera,
    })
  }

  spawnAt(id, name, pos, yaw, scale, lifetime = 3) {
    return this.spawn(id, name, { pos, quat: yawQuat(yaw), scale, lifetime, camera: this.camera })
  }

  fly(id, name, caster, target, opts) {
    const w = this.wrapper(id, name)
    const socket = this.vfx.socket(id, caster, opts.socket || w.socket || 'FX_Projectile_R')
    const from = socket ? socket.getWorldPosition(new THREE.Vector3()) : caster.pos.clone().setY(caster.height * 0.6)
    const inst = this.spawn(id, name, { pos: from, quat: yawQuat(caster.facing), scale: caster.scale, camera: this.camera })
    const aim = () => {
      if (target && !target.dead) {
        const s = this.vfx.socket(id, target, 'FX_Center')
        if (s) return s.getWorldPosition(_v2)
        return _v2.copy(target.pos).setY(target.pos.y + target.height * 0.55)
      }
      return _v2.copy(opts.fallback || from)
    }
    const f = { inst, pos: from.clone(), aim, speed: opts.speed || PROJECTILE_SPEED, onArrive: opts.onArrive, age: 0, maxAge: opts.maxAge || 1.6, arc: opts.arc || 0 }
    f.dist0 = Math.max(0.5, from.distanceTo(aim()))
    this.flights.push(f)
    return f
  }

  castSkill(id, type, caster, targets, opts = {}) {
    if (this.hasScript(id)) return !!this.playScripted(id, SCRIPT_SKILL[type], caster, opts.targetsAt || targets, opts)
    const list = this.entries(id, type)
    if (!list.length) return false
    const timing = opts.timing || {}
    const blockAt = timing.at || {}
    const impact = opts.impact || 0.35
    const hits = timing.hits || [impact]
    const share = 1 / hits.length
    const primary = targets[0] || null
    const center = opts.center || (primary ? primary.pos : caster.pos.clone().add(new THREE.Vector3(Math.sin(caster.facing) * 3, 0, Math.cos(caster.facing) * 3)))
    const byRole = { caster: [], projectile: [], hit: [], aoe: [] }
    for (const e of list) {
      if (e.fx in blockAt) this.later(blockAt[e.fx] + e.t, () => this.spawnEntry(id, e.fx, caster, targets, center))
      else byRole[prefabRole(e.fx)].push(e)
    }
    for (const e of byRole.caster) this.later(e.t, () => this.spawnOn(id, e.fx, caster))
    for (const e of byRole.aoe) this.later(hits[0] + e.t, () => this.spawnAt(id, e.fx, _v.set(center.x, 0.03, center.z).clone(), caster.facing, caster.scale))
    const hitBlocks = byBlock(byRole.hit)
    const hitTarget = (t, k) => {
      if (!hitBlocks.length) return
      for (const e of hitBlocks[k % hitBlocks.length]) this.later(e.t, () => t && this.hitOn(id, e.fx, caster, t))
    }
    if (byRole.projectile.length) {
      const shotBlocks = byBlock(byRole.projectile)
      const times = timing.shots || [impact]
      const count = Math.max(times.length, targets.length, 1)
      for (let i = 0; i < count; i++) {
        const t = targets.length ? targets[i % targets.length] : null
        const at = times[Math.min(i, times.length - 1)] + Math.max(0, i - times.length + 1) * (opts.stagger ?? SHOT_STAGGER)
        shotBlocks[i % shotBlocks.length].forEach((e, n) => this.later(at + e.t, () => {
          this.fly(id, e.fx, caster, t, {
            fallback: center,
            onArrive: n ? null : () => {
              hitTarget(t, i)
              if (opts.onHit) opts.onHit(t, i, 1)
            },
          })
        }))
      }
      if (opts.onImpact) this.later(times[0], () => opts.onImpact(1))
      return true
    }
    hits.forEach((at, k) => {
      targets.forEach((t, i) => {
        const step = timing.chain ? i * timing.chain : 0
        this.later(at + step, () => {
          hitTarget(t, timing.chain ? i : k)
          if (opts.onHit) opts.onHit(t, i, share)
        })
      })
      if (opts.onImpact) this.later(at, () => opts.onImpact(share))
    })
    return true
  }

  hitOn(id, name, caster, target) {
    return this.spawnOn(id, name, target, { yaw: Math.atan2(caster.pos.x - target.pos.x, caster.pos.z - target.pos.z), scale: caster.scale * HIT_SCALE })
  }

  spawnEntry(id, name, caster, targets, center) {
    const role = prefabRole(name)
    if (role === 'caster') return this.spawnOn(id, name, caster)
    if (role === 'aoe') return this.spawnAt(id, name, new THREE.Vector3(center.x, 0.03, center.z), caster.facing, caster.scale)
    if (role !== 'hit') return this.fly(id, name, caster, targets[0] || null, { fallback: center })
    for (const t of targets) if (t && !t.dead) this.hitOn(id, name, caster, t)
    return null
  }

  morph(id, type, caster, origin, targets, opts = {}) {
    const list = this.entries(id, type)
    if (!list.length) return false
    const impact = opts.impact || 0
    const ground = () => new THREE.Vector3(caster.pos.x, 0.03, caster.pos.z)
    for (const e of list) {
      if (/Target/.test(e.fx)) {
        this.later(e.t, () => origin && this.spawnOn(id, e.fx, origin, { scale: caster.scale }))
      } else if (/AOE/.test(e.fx)) {
        this.later(impact + e.t, () => this.spawnAt(id, e.fx, ground(), caster.facing, caster.scale))
      } else if (/Hit/.test(e.fx)) {
        for (const t of targets) this.later(impact + e.t, () => {
          if (t.dead) return
          this.spawnOn(id, e.fx, t, { yaw: Math.atan2(caster.pos.x - t.pos.x, caster.pos.z - t.pos.z), scale: caster.scale * HIT_SCALE })
        })
      } else {
        this.later(e.t, () => this.spawnOn(id, e.fx, caster))
      }
    }
    this.later(impact, () => {
      if (opts.onHit) targets.forEach(t => opts.onHit(t))
      if (opts.onImpact) opts.onImpact()
    })
    return true
  }

  attack(id, comboIndex, caster, target, opts = {}) {
    if (this.hasScript(id)) {
      const key = scriptCombo(comboIndex)
      if (this.scriptRanged(id)) {
        const res = this.playScripted(id, key, caster, target ? [target] : [], {
          fallback: opts.fallback,
          onHit: opts.onHit ? t => opts.onHit(t) : null,
        })
        return res ? { ranged: true, scripted: true, hitAt: res.hitAt } : false
      }
      const res = this.playScripted(id, key, caster, [], { manualHits: true })
      if (!res) return false
      return { ranged: false, scripted: true, hitAt: res.hitAt, onTarget: t => this.strikeLater(id, key, caster, t) }
    }
    const type = comboType(comboIndex)
    const list = this.entries(id, type)
    if (!list.length) return false
    const impact = opts.impact || 0.3
    for (const e of list) {
      const role = prefabRole(e.fx)
      if (role === 'caster') this.later(Math.min(e.t, impact), () => this.spawnOn(id, e.fx, caster))
    }
    const projectiles = list.filter(e => prefabRole(e.fx) === 'projectile')
    const hits = list.filter(e => prefabRole(e.fx) === 'hit')
    const aoes = list.filter(e => prefabRole(e.fx) === 'aoe')
    const onTarget = t => {
      for (const e of hits) this.later(e.t, () => t && this.spawnOn(id, e.fx, t, { yaw: Math.atan2(caster.pos.x - t.pos.x, caster.pos.z - t.pos.z), scale: caster.scale * HIT_SCALE }))
      for (const e of aoes) this.later(e.t, () => {
        const c = t ? t.pos : caster.pos
        this.spawnAt(id, e.fx, new THREE.Vector3(c.x, 0.03, c.z), caster.facing, caster.scale)
      })
    }
    if (projectiles.length) {
      const e = projectiles[Math.floor(random() * projectiles.length)]
      this.later(impact, () => this.fly(id, e.fx, caster, target, {
        fallback: caster.pos.clone().add(new THREE.Vector3(Math.sin(caster.facing) * 8, caster.height * 0.55, Math.cos(caster.facing) * 8)),
        onArrive: () => {
          onTarget(target)
          if (opts.onHit) opts.onHit(target)
        },
      }))
      return { ranged: true }
    }
    return { ranged: false, onTarget }
  }

  hitFx(id, comboIndex, caster, target) {
    if (this.hasScript(id)) {
      this.strikeLater(id, scriptCombo(comboIndex), caster, target)
      return
    }
    this.skillHitFx(id, comboType(comboIndex), caster, target)
  }

  skillHitFx(id, type, caster, target) {
    const list = this.entries(id, type)
    for (const e of list) {
      if (prefabRole(e.fx) !== 'hit') continue
      this.later(e.t, () => this.spawnOn(id, e.fx, target, { yaw: Math.atan2(caster.pos.x - target.pos.x, caster.pos.z - target.pos.z), scale: caster.scale * HIT_SCALE }))
    }
  }

  update(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i]
      t.t -= dt
      if (t.t <= 0) {
        this.timers.splice(i, 1)
        t.fn()
      }
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]
      f.age += dt
      const goal = f.aim()
      _v.copy(goal).sub(f.pos)
      const d = _v.length()
      const step = f.speed * dt
      if (d <= step || f.age >= f.maxAge) {
        f.pos.copy(goal)
        if (f.inst) {
          f.inst.moveTo(f.pos)
          f.inst.stop()
        }
        this.flights.splice(i, 1)
        if (f.onArrive) f.onArrive()
        continue
      }
      f.pos.addScaledVector(_v, step / d)
      if (f.inst) {
        _q.setFromUnitVectors(_back, _v.normalize())
        f.inst.moveTo(f.pos, _q)
      }
    }
    this.updateShots(dt)
    this.updateLinks()
    this.updateModels(dt)
    this.trackEvents()
  }

  clear() {
    this.flights.length = 0
    this.shots.length = 0
    this.links.length = 0
    this.timers.length = 0
  }
}
