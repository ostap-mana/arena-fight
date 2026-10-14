import * as THREE from 'three'
import { safeFragment } from './safe-shader.js'
import gsap from 'gsap'
import { T, tiled, paletteFor } from './fx.js'
import { Flipbooks } from './flipbook.js'
import { LobbyAmbient } from './lobby-ambient.js'
import { stream } from '../core/rng.js'

const random = stream('lobby')
import { createStand } from './stand-circle.js'

const HAZE_TINT = { fire: 0x6a3a2a, water: 0x2e4a5c, earth: 0x4a4432, wind: 0x55606a, light: 0x6a5c44, dark: 0x3a2e4a }
const IDLE_DIM = 0.55
const PICKED_GAIN = 1
const IDLE_RIM = 0.22
const PICKED_RIM = 0
const IDLE_RIM_COLOR = new THREE.Color(0x9fb4d8)
const FOCUS_TIME = 0.35
const CIRCLE_SIZE = 3.6
const CONTACT_SIZE = 1.6
const STAND_Y = 0.04
const PORTRAIT_STAND = 0.82
const PORTRAIT_IDLE = 0.3
const EXPOSURE = { fire: 0.66 }
const FLASH_DECAY = 3.5
const FLOOR_BOOK = 'stand_floor'
const FLAME_BOOK = 'stand_flame'
const BURST_BOOK = 'stand_burst'
const STAND_BOOKS = [FLOOR_BOOK, FLAME_BOOK, BURST_BOOK]
const FLOOR_SIZE = 3.4
const BURST_SIZE = 4.2
const FLAME_COUNT = 14
const FLAME_RADIUS = 1.28
const FLAME_SIZE = [0.5, 0.8]
const BURST_WINDOW = 0.6
const STAND_FX_FADE = 0.35
const SELECT_FOG = 0.03
const SELECT_FOG_TINT = 0.45
const SELECT_SHADOW = 0.85
const floorGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const smooth = k => k * k * (3 - 2 * k)

const FLOOR_VS = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const CONTACT_FS = `
  uniform sampler2D uMap;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float a = texture2D(uMap, vUv).r * uAlpha;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }`

const CIRCLE_FS = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOn;
  uniform float uIdle;
  uniform float uExposure;
  uniform float uFlash;
  varying vec2 vUv;
  const float TAU = 6.2831853;
  const float SECTOR = TAU / 3.0;
  const float RING_R = 0.78;
  const float INNER_R = 0.39;
  const float SPIN = 0.5;
  float stroke(float d, float width) {
    float aa = max(fwidth(d), 1e-5);
    float w = max(width, aa);
    return 1.0 - smoothstep(w - aa * 0.5, w + aa * 0.5, d);
  }
  float triangleEdge(vec2 p, float angle, float spin) {
    float k = floor(mod(angle - spin - TAU * 0.25, TAU) / SECTOR);
    float mid = TAU * 0.25 + spin + (k + 0.5) * SECTOR;
    return dot(p, vec2(cos(mid), sin(mid))) - RING_R * 0.5;
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float angle = r > 1e-5 ? atan(p.y, p.x) : 0.0;
    float spin = uTime * SPIN;
    float dRing = abs(r - RING_R);
    float dTri = abs(triangleEdge(p, angle, spin));
    float dInner = abs(r - INNER_R);
    float ring = stroke(dRing, 0.012);
    float tri = stroke(dTri, 0.009);
    float inner = stroke(dInner, 0.008);
    float halo = exp(-dRing * 34.0) + exp(-dTri * 40.0) * 0.8 + exp(-dInner * 44.0) * 0.7;
    float behind = 1.0 - fract((angle - spin - TAU * 0.25) / SECTOR);
    float streak = exp(-dRing * dRing / 0.00018) * (exp(-behind * 6.0) * 0.9 + exp(-behind * 24.0) * 1.6) * smoothstep(0.0, 0.006, behind);
    float idle = (1.0 - uOn) * uIdle;
    float lit = uOn * (1.0 + 0.8 * uFlash);
    float energy = (ring + tri * 0.9 + inner * 0.8) * lit * 2.2 + halo * lit * 0.45 + streak * uOn * 2.4 + ring * idle * 0.35;
    float hot = ((ring + tri + inner) * (0.1 + 0.45 * uFlash) + streak * 0.5) * uOn;
    vec3 col = 1.0 - exp(-uColor * uExposure * energy - hot);
    gl_FragColor = vec4(col, 1.0);
  }`

function additive(vertexShader, fragmentShader, uniforms, extra) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader: safeFragment(fragmentShader),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...extra,
  })
}

function addRimLight(material) {
  if (material.userData.rim) return material.userData.rim
  const uniforms = {
    uStandRimColor: { value: new THREE.Color() },
    uStandRim: { value: 0 },
    uStandDim: { value: 1 },
  }
  const baseCompile = material.onBeforeCompile
  const baseKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader, renderer) => {
    baseCompile.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uStandRimColor;\nuniform float uStandRim;\nuniform float uStandDim;')
      .replace(
        '#include <opaque_fragment>',
        `float rimFacing = saturate(dot(normal, normalize(vViewPosition)));
outgoingLight = outgoingLight * uStandDim + uStandRimColor * pow(1.0 - rimFacing, 3.5) * uStandRim;
#include <opaque_fragment>`
      )
  }
  material.customProgramCacheKey = () => baseKey + '|hero-rim'
  material.needsUpdate = true
  material.userData.rim = uniforms
  return uniforms
}

function rimsOf(actor) {
  const rims = []
  actor.root.traverse(o => {
    if (!o.isMesh || Array.isArray(o.material)) return
    const m = o.material
    if (!m.isMeshStandardMaterial || m.blending === THREE.AdditiveBlending) return
    rims.push(addRimLight(m))
    o.receiveShadow = true
  })
  return rims
}

export class Showcase {
  constructor(scene, actors, heroes, arena) {
    this.scene = scene
    this.arena = arena
    this.group = new THREE.Group()
    scene.add(this.group)
    this.time = 0
    this.contact = T('T_character_highlight_3', false)
    this.books = new Flipbooks(this.group)
    this.picked = -1
    this.camera = null
    this.stands = actors.map((a, i) => this.buildStand(a, heroes[i]))
    this.ambient = new LobbyAmbient(this.group, { tint: HAZE_TINT[arena.id] ?? HAZE_TINT.fire, arena: arena.id })
    this.catcher = arena.shadowCatcher.material
    this.baseShadow = this.catcher.opacity
    gsap.to(this.catcher, { opacity: SELECT_SHADOW, duration: 0.8 })
    this.fog = scene.fog
    if (this.fog) {
      this.baseFog = this.fog.density
      this.baseFogColor = this.fog.color.clone()
      const dark = this.baseFogColor.clone().multiplyScalar(SELECT_FOG_TINT)
      gsap.to(this.fog, { density: SELECT_FOG, duration: 1.2, ease: 'power2.out' })
      gsap.to(this.fog.color, { r: dark.r, g: dark.g, b: dark.b, duration: 1.2, ease: 'power2.out' })
    }
  }

  buildStand(actor, hero) {
    const color = new THREE.Color(hero.color)

    const contact = new THREE.Mesh(floorGeo, new THREE.ShaderMaterial({
      uniforms: { uMap: { value: this.contact }, uAlpha: { value: 0.6 } },
      vertexShader: FLOOR_VS,
      fragmentShader: safeFragment(CONTACT_FS),
      transparent: true,
      depthWrite: false,
    }))
    contact.scale.set(CONTACT_SIZE, 1, CONTACT_SIZE)
    contact.renderOrder = 2

    const circle = new THREE.Mesh(floorGeo, additive(FLOOR_VS, CIRCLE_FS, {
      uColor: { value: color },
      uTime: { value: 0 },
      uOn: { value: 0 },
      uIdle: { value: 1 },
      uExposure: { value: EXPOSURE[hero.element] ?? 1 },
      uFlash: { value: 0 },
    }))
    circle.scale.set(CIRCLE_SIZE, 1, CIRCLE_SIZE)
    circle.renderOrder = 3
    circle.visible = false
    contact.onBeforeRender = (renderer, scene, camera) => { this.camera = camera }

    const stand = new THREE.Group()
    stand.add(contact, circle)
    this.group.add(stand)
    const variant = createStand({ THREE, stand, contact, circle, color, hero, actor, size: CIRCLE_SIZE, T, tiled, safeFragment, additive, floorGeo, FLOOR_VS })
    if (variant) circle.visible = false
    const vstate = { t: 0, dt: 0, w: 0, idle: 1, flashT: Infinity, flash: 0, portrait: 0, scale: 1, index: 0, picked: false }
    return { actor, color, palette: paletteFor(color.getHex()), stand, contact, circle, variant, vstate, rims: rimsOf(actor), focus: 0, weight: 0, flashT: Infinity, pickedAt: 0, fx: null }
  }

  syncStandFx(selected) {
    if (selected !== this.picked) {
      const prev = this.stands[this.picked]
      if (prev) this.stopStandFx(prev)
      this.picked = selected
      const next = this.stands[selected]
      if (next) {
        next.flashT = 0
        next.pickedAt = this.time
      }
    }
    const s = this.stands[this.picked]
    if (s && !s.fx && this.standBooksReady()) this.startStandFx(s)
  }

  standBooksReady() {
    for (let i = 0; i < STAND_BOOKS.length; i++) if (this.books.has(STAND_BOOKS[i])) return true
    return false
  }

  startStandFx(s) {
    const books = this.books
    const { x, z } = s.actor.pos
    const palette = s.palette
    const fx = []
    if (books.has(FLOOR_BOOK)) {
      fx.push(books.spawn(FLOOR_BOOK, { x, y: 0.09, z, billboard: 'ground', size: FLOOR_SIZE, palette, loop: true, rot: 0, fadeIn: 0.4 }))
    }
    if (books.has(FLAME_BOOK)) {
      for (let k = 0; k < FLAME_COUNT; k++) {
        const a = (k / FLAME_COUNT) * Math.PI * 2
        const size = FLAME_SIZE[0] + random() * (FLAME_SIZE[1] - FLAME_SIZE[0])
        fx.push(books.spawn(FLAME_BOOK, {
          x: x + Math.cos(a) * FLAME_RADIUS,
          y: 0.07,
          z: z + Math.sin(a) * FLAME_RADIUS,
          billboard: 'up',
          size,
          palette,
          loop: true,
          rot: 0,
          fadeIn: 0.25 + random() * 0.3,
        }))
      }
    }
    if (books.has(BURST_BOOK) && this.time - s.pickedAt < BURST_WINDOW) {
      books.spawn(BURST_BOOK, { x, y: 0.1, z, billboard: 'ground', size: BURST_SIZE, palette, rot: random() * Math.PI * 2 })
    }
    s.fx = fx
  }

  stopStandFx(s) {
    for (const h of s.fx || []) h.stop(STAND_FX_FADE)
    s.fx = null
  }

  update(dt, selected, portrait = 0) {
    this.time += dt
    const t = this.time
    const standScale = 1 + (PORTRAIT_STAND - 1) * portrait
    const idleGain = 1 + (PORTRAIT_IDLE - 1) * portrait
    const shown = selected
    for (let i = 0; i < this.stands.length; i++) {
      const s = this.stands[i]
      const goal = i === shown ? 1 : 0
      s.focus = goal ? 1 : Math.max(0, s.focus - dt / FOCUS_TIME)
      if (Math.abs(goal - s.focus) < 1e-3) s.focus = goal
      s.weight = smooth(s.focus)
      const w = s.weight
      s.stand.position.set(s.actor.pos.x, STAND_Y, s.actor.pos.z)
      s.stand.scale.setScalar(standScale)
      s.contact.material.uniforms.uAlpha.value = 0.5 + 0.15 * w
      s.flashT += dt
      const cu = s.circle.material.uniforms
      cu.uTime.value = t + i * 3.1
      cu.uOn.value = w
      cu.uIdle.value = idleGain
      cu.uFlash.value = Math.exp(-s.flashT * FLASH_DECAY)
      if (s.variant) {
        const v = s.vstate
        v.t = t + i * 3.1
        v.dt = dt
        v.w = w
        v.idle = idleGain
        v.flashT = s.flashT
        v.flash = cu.uFlash.value
        v.portrait = portrait
        v.scale = standScale
        v.index = i
        v.picked = i === shown
        s.variant.update(v)
      }
      for (const r of s.rims) {
        r.uStandRim.value = IDLE_RIM + (PICKED_RIM - IDLE_RIM) * w
        r.uStandDim.value = IDLE_DIM + (PICKED_GAIN - IDLE_DIM) * w
        r.uStandRimColor.value.copy(IDLE_RIM_COLOR).lerp(s.color, w)
      }
    }
    this.ambient.update(dt, this.camera, Math.min(1, t / 1.5))
    this.syncStandFx(shown)
    if (this.camera) this.books.update(dt, this.camera, this.scene.fog)
  }

  dispose() {
    for (const s of this.stands) {
      for (const r of s.rims) {
        r.uStandRim.value = 0
        r.uStandDim.value = 1
      }
      s.actor.root.traverse(o => { if (o.isMesh) o.receiveShadow = false })
      for (const o of [s.contact, s.circle]) o.material.dispose()
      if (s.variant && s.variant.dispose) s.variant.dispose()
    }
    this.ambient.dispose()
    this.books.dispose()
    this.scene.remove(this.group)
    gsap.to(this.catcher, { opacity: this.baseShadow, duration: 0.9 })
    if (this.fog) {
      const c = this.baseFogColor
      gsap.to(this.fog, { density: this.baseFog, duration: 0.9, ease: 'power2.inOut' })
      gsap.to(this.fog.color, { r: c.r, g: c.g, b: c.b, duration: 0.9, ease: 'power2.inOut' })
    }
  }
}
