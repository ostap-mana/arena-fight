import * as THREE from 'three'
import gsap from 'gsap'
import { T, tiled, paletteFor } from './fx.js'
import { Flipbooks } from './flipbook.js'
import { LobbyAmbient } from './lobby-ambient.js'
import { stream } from '../core/rng.js'

const random = stream('lobby')

const HAZE_TINT = { fire: 0x6a3a2a, water: 0x2e4a5c, earth: 0x4a4432, wind: 0x55606a, light: 0x6a5c44, dark: 0x3a2e4a }
const IDLE_DIM = 0.55
const PICKED_GAIN = 1
const IDLE_RIM = 0.22
const PICKED_RIM = 0
const IDLE_RIM_COLOR = new THREE.Color(0x9fb4d8)
const FOCUS_TIME = 0.35
const CIRCLE_SIZE = 3.6
const WALL_RADIUS = CIRCLE_SIZE * 0.4
const WALL_HEIGHT = 0.38
const CONTACT_SIZE = 1.6
const STAND_Y = 0.04
const PORTRAIT_STAND = 0.82
const PORTRAIT_IDLE = 0.3
const EXPOSURE = { fire: 0.66 }
const ARRIVE_NDC = 0.5
const ARRIVE_MAX = 0.8
const SHOCK_TIME = 0.7
const REVEAL_TIME = 0.75
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
const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true).translate(0, 0.5, 0)
const smooth = k => k * k * (3 - 2 * k)
const _ndc = new THREE.Vector3()

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
  uniform sampler2D uGlow;
  uniform sampler2D uRunes;
  uniform sampler2D uRing;
  uniform sampler2D uSeal;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOn;
  uniform float uIdle;
  uniform float uExposure;
  uniform float uFlash;
  uniform float uShock;
  uniform float uReveal;
  varying vec2 vUv;
  const float TAU = 6.2831853;
  const float ORBIT_R = 0.6;
  const float PULSE_PERIOD = 2.8;
  vec2 spin(vec2 p, float a, float scale) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y) / scale * 0.5 + 0.5;
  }
  float comets(vec2 p, float r, float turn, float t) {
    float band = exp(-pow((r - ORBIT_R) / 0.02, 2.0));
    float sum = 0.0;
    for (int i = 0; i < 3; i++) {
      float head = fract(t * 0.14 + float(i) / 3.0);
      float behind = fract(head - turn);
      float a = (head - 0.5) * TAU;
      float d = length(p - ORBIT_R * vec2(cos(a), sin(a)));
      sum += band * exp(-behind * 9.0) * 1.4 + exp(-d * d / 0.0008) * 2.0 + exp(-d * d / 0.01) * 0.3;
    }
    return sum;
  }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float t = uTime;
    float ang = atan(p.y, p.x);
    float turn = ang / TAU + 0.5;
    float front = abs(atan(p.x, -p.y)) / 3.14159265;
    float idle = (1.0 - uOn) * uIdle;
    float open = mix(0.8, 1.0, uOn);
    float sweep = uReveal * 1.08;
    float drawn = smoothstep(front, front + 0.08, sweep);
    float edge = exp(-abs(front + 0.04 - sweep) * 28.0) * smoothstep(1.0, 0.8, uReveal);
    float lit = uOn * drawn;

    float glint = pow(0.5 + 0.5 * cos((turn - t * 0.09) * TAU), 10.0);
    float glint2 = pow(0.5 + 0.5 * cos((turn + t * 0.13 + 0.5) * TAU), 14.0);

    vec2 runeUv = spin(p, t * 0.07, 0.78 * open);
    vec2 sealUv = spin(p, -t * 0.12, 0.56 * open);
    float runes = texture2D(uRunes, runeUv).r;
    float runeHalo = texture2D(uRunes, runeUv, 3.0).r;
    float ring = texture2D(uRing, spin(p, -t * 0.02, 0.84 * open)).r;
    float seal = texture2D(uSeal, sealUv).r;
    float sealHalo = texture2D(uSeal, sealUv, 3.0).r;
    float glow = texture2D(uGlow, vUv).r;
    float pulseT = fract(t / PULSE_PERIOD);
    float pulse = texture2D(uRing, spin(p, 0.0, mix(0.42, 1.02, pulseT))).r * pow(1.0 - pulseT, 2.0) * smoothstep(0.0, 0.08, pulseT);
    float shock = texture2D(uRing, spin(p, 0.0, mix(0.35, 1.0, uShock))).r * pow(1.0 - uShock, 2.0);
    float fill = smoothstep(0.15, 0.78, r) * smoothstep(0.84, 0.74, r);

    float line = runes * (0.14 * idle + lit * (1.0 + 1.4 * glint))
      + ring * (0.12 * idle + lit * (0.7 + 0.9 * glint2))
      + seal * (0.05 * idle + lit * (0.6 + 0.5 * glint2))
      + comets(p, r, turn, t) * lit
      + (runes + seal) * uFlash * 1.4;
    float soft = runeHalo * lit * 0.28
      + sealHalo * lit * 0.2
      + glow * (0.02 + 0.04 * uOn)
      + fill * lit * 0.07
      + pulse * lit * 0.55
      + shock * uOn * 1.4
      + edge * uOn * step(r, 0.86) * smoothstep(0.2, 0.5, r) * 0.9;
    vec3 col = 1.0 - exp(-uColor * uExposure * (line * 3.0 + soft * 1.7));
    gl_FragColor = vec4(col, 1.0);
  }`

const WALL_VS = `
  varying vec2 vUv;
  varying vec2 vLocal;
  void main() {
    vUv = uv;
    vLocal = position.xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const WALL_FS = `
  uniform sampler2D uNoise;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOn;
  uniform float uReveal;
  uniform float uFlash;
  varying vec2 vUv;
  varying vec2 vLocal;
  void main() {
    float front = abs(atan(vLocal.x, vLocal.y)) / 3.14159265;
    float drawn = smoothstep(front, front + 0.08, uReveal * 1.08);
    float h = vUv.y;
    float streak = texture2D(uNoise, vec2(vUv.x * 9.0, h * 0.35 - uTime * 0.45)).r;
    float streak2 = texture2D(uNoise, vec2(vUv.x * 17.0 + 0.3, h * 0.6 - uTime * 0.8)).r;
    float rise = streak * streak2 * 2.2;
    float fade = pow(1.0 - h, 2.2);
    float base = exp(-h * 14.0);
    float k = (fade * (0.28 + rise * 1.3) + base * 0.9 + uFlash * fade * 1.8) * uOn * drawn;
    vec3 col = 1.0 - exp(-uColor * k * 2.0);
    gl_FragColor = vec4(col, 1.0);
  }`

function additive(vertexShader, fragmentShader, uniforms, extra) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
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
    this.glow = T('T_character_highlight_2', false)
    this.contact = T('T_character_highlight_3', false)
    this.runes = T('T_FX_Decal_47_2', false)
    this.ring = T('T_FX_Circle_12_1', false)
    this.seal = T('T_FX_Decal_65_1_CEL', false)
    this.noise = tiled(T('T_FX_Noise_45_1', false))
    this.books = new Flipbooks(this.group)
    this.picked = -1
    this.wanted = -1
    this.wantedAt = 0
    this.shown = -1
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
      fragmentShader: CONTACT_FS,
      transparent: true,
      depthWrite: false,
    }))
    contact.scale.set(CONTACT_SIZE, 1, CONTACT_SIZE)
    contact.renderOrder = 2

    const circle = new THREE.Mesh(floorGeo, additive(FLOOR_VS, CIRCLE_FS, {
      uGlow: { value: this.glow },
      uRunes: { value: this.runes },
      uRing: { value: this.ring },
      uSeal: { value: this.seal },
      uNoise: { value: this.noise },
      uColor: { value: color },
      uTime: { value: 0 },
      uOn: { value: 0 },
      uIdle: { value: 1 },
      uExposure: { value: EXPOSURE[hero.element] ?? 1 },
      uFlash: { value: 0 },
      uShock: { value: 1 },
      uReveal: { value: 1 },
    }))
    circle.scale.set(CIRCLE_SIZE, 1, CIRCLE_SIZE)
    circle.renderOrder = 3
    circle.onBeforeRender = (renderer, scene, camera) => { this.camera = camera }

    const cu = circle.material.uniforms
    const wall = new THREE.Mesh(wallGeo, additive(WALL_VS, WALL_FS, {
      uNoise: cu.uNoise,
      uColor: cu.uColor,
      uTime: cu.uTime,
      uOn: cu.uOn,
      uReveal: cu.uReveal,
      uFlash: cu.uFlash,
    }, { side: THREE.DoubleSide }))
    wall.renderOrder = 4
    wall.visible = false

    const stand = new THREE.Group()
    stand.add(contact, circle, wall)
    this.group.add(stand)
    return { actor, color, palette: paletteFor(color.getHex()), stand, contact, circle, wall, rims: rimsOf(actor), focus: 0, weight: 0, flashT: Infinity, pickedAt: 0, fx: null }
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

  showPick(selected, portrait) {
    if (selected !== this.wanted) {
      this.wanted = selected
      this.wantedAt = this.time
    }
    if (this.shown === this.wanted) return this.shown
    if (this.shown < 0 || portrait <= 0 || this.time - this.wantedAt >= ARRIVE_MAX || this.inView(this.wanted)) this.shown = this.wanted
    return this.shown
  }

  inView(i) {
    const s = this.stands[i]
    if (!s || !this.camera) return true
    _ndc.copy(s.actor.pos).project(this.camera)
    return Math.abs(_ndc.x) < ARRIVE_NDC
  }

  update(dt, selected, portrait = 0) {
    this.time += dt
    const t = this.time
    const standScale = 1 + (PORTRAIT_STAND - 1) * portrait
    const idleGain = 1 + (PORTRAIT_IDLE - 1) * portrait
    const shown = this.showPick(selected, portrait)
    for (let i = 0; i < this.stands.length; i++) {
      const s = this.stands[i]
      const goal = i === shown ? 1 : 0
      s.focus = Math.max(0, Math.min(1, s.focus + Math.sign(goal - s.focus) * dt / FOCUS_TIME))
      if (Math.abs(goal - s.focus) < 1e-3) s.focus = goal
      s.weight = smooth(s.focus)
      const w = s.weight
      s.stand.position.set(s.actor.pos.x, STAND_Y, s.actor.pos.z)
      s.stand.scale.setScalar(standScale)
      s.contact.material.uniforms.uAlpha.value = 0.5 + 0.15 * w
      s.wall.visible = w > 1e-3
      s.wall.scale.set(WALL_RADIUS, WALL_HEIGHT * w, WALL_RADIUS)
      s.flashT += dt
      const cu = s.circle.material.uniforms
      cu.uTime.value = t + i * 3.1
      cu.uOn.value = w
      cu.uIdle.value = idleGain
      cu.uShock.value = Math.min(1, s.flashT / SHOCK_TIME)
      cu.uFlash.value = Math.exp(-s.flashT * FLASH_DECAY)
      cu.uReveal.value = smooth(Math.min(1, s.flashT / REVEAL_TIME))
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
      for (const o of [s.contact, s.circle, s.wall]) o.material.dispose()
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
