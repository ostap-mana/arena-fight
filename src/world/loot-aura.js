import * as THREE from 'three'
import { safeFragment } from './safe-shader.js'
import { T, tiled } from './fx.js'

const TIME_WRAP = 600
const GROW_TIME = 0.45
const FADE_IN = 0.18
const FADE_OUT = 0.22
const RIBBON_STEPS = 28
const BOLT_STEPS = 7
const CROWN_STEPS = 24

const LOOKS = {
  common: { deep: [0.42, 0.36, 0.26], main: [0.86, 0.8, 0.62], light: [1, 0.97, 0.86], height: 6.5, halo: 1.25, sides: 1, ribbons: 2, bolts: 1, sparks: 5, crown: 0.5 },
  uncommon: { deep: [0.02, 0.3, 0.04], main: [0.2, 0.92, 0.1], light: [0.72, 1, 0.5], height: 7.8, halo: 1.4, sides: 2, ribbons: 2, bolts: 2, sparks: 7, crown: 0.55 },
  rare: { deep: [0.01, 0.1, 0.55], main: [0.08, 0.48, 1], light: [0.58, 0.86, 1], height: 8.6, halo: 1.5, sides: 2, ribbons: 3, bolts: 2, sparks: 8, crown: 0.6 },
  epic: { deep: [0.22, 0.01, 0.48], main: [0.68, 0.14, 1], light: [0.93, 0.68, 1], height: 9.8, halo: 1.75, sides: 3, ribbons: 3, bolts: 3, sparks: 10, crown: 0.66 },
  legendary: { deep: [0.55, 0.12, 0], main: [1, 0.56, 0.05], light: [1, 0.9, 0.48], height: 11, halo: 1.8, sides: 3, ribbons: 3, bolts: 3, sparks: 12, crown: 0.7 },
}

const KIND = { beam: 0, ribbon: 1, bolt: 2, spark: 3, crown: 4 }
const ROLE = { sheath: 0, core: 1, streak: 2 }

const VS = `
uniform float uTime;
uniform float uGrow;
attribute float aKind;
attribute vec4 aA;
attribute vec4 aB;
varying vec2 vUv;
varying float vKind;
varying float vGlow;
varying float vRole;
varying float vPhase;
varying float vRep;
varying float vSpeed;

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec3 boltPoint(float i, float key) {
  float a0 = hash(key) * 6.2831853;
  float a1 = a0 + (hash(key + 1.7) - 0.5) * 1.8;
  float reach = aA.z * (0.55 + 0.45 * hash(key + 2.3));
  vec3 from = vec3(cos(a0) * 0.1, mix(aB.x, aB.y, hash(key + 3.9)), sin(a0) * 0.1);
  vec3 to = vec3(cos(a1) * reach, mix(aB.x, aB.y, hash(key + 5.1)), sin(a1) * reach);
  float t = i / aB.w;
  vec3 jitter = vec3(hash(key + i * 7.31), hash(key + i * 11.17), hash(key + i * 13.71)) - 0.5;
  return mix(from, to, t) + jitter * aB.z * sin(3.14159265 * t);
}

void main() {
  vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(modelMatrix[0].xyz);
  vec3 toCam = cameraPosition - origin;
  vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
  vec3 world = origin;
  vUv = uv;
  vKind = aKind;
  vGlow = 1.0;
  vRole = 0.0;
  vPhase = 0.0;
  vRep = 1.0;
  vSpeed = 0.0;
  if (aKind < 0.5) {
    float flick = 1.0 + 0.06 * sin(uTime * 2.3 + aB.y * 3.0);
    float taper = mix(1.3, 0.55, position.y);
    world += (vec3(aA.x, position.y * aA.w * uGrow, aA.y) + right * position.x * aA.z * flick * taper) * scale;
    vGlow = aB.z;
    vRole = aB.w;
    vPhase = aB.y;
    vSpeed = aB.x;
    vRep = clamp(aA.w / (aA.z * 3.0), 1.0, 6.0);
  } else if (aKind < 1.5) {
    float ang = uTime * aA.x + aA.y;
    float c = cos(ang);
    float s = sin(ang);
    vec3 p = vec3(position.x * c - position.z * s, position.y * uGrow, position.x * s + position.z * c);
    world += p * scale;
    vGlow = aA.w;
    vSpeed = aA.z;
    vPhase = aA.y;
  } else if (aKind < 2.5) {
    float cycle = uTime * aA.y + aA.x * 0.37;
    float epoch = floor(cycle);
    float key = aA.x * 17.0 + epoch * 3.1;
    float i = position.x;
    vec3 p0 = boltPoint(i, key);
    vec3 tangent = boltPoint(min(i + 1.0, aB.w), key) - boltPoint(max(i - 1.0, 0.0), key);
    vec3 wp = origin + p0 * scale;
    vec3 side = normalize(cross(normalize(tangent + vec3(1e-4)), normalize(cameraPosition - wp)));
    world = wp + side * position.y * aA.w * scale;
    vGlow = step(0.3, hash(key + 9.0)) * (1.0 - fract(cycle) * 0.5) * uGrow;
  } else if (aKind < 3.5) {
    float life = fract(uTime * aA.z + aA.w);
    float ang = aA.x + life * 1.4;
    float r = aA.y * (1.0 - 0.5 * life);
    vec3 base = vec3(cos(ang) * r, life * aB.x * uGrow, sin(ang) * r);
    world += (base + right * position.x * aB.z + vec3(0.0, position.y * aB.y, 0.0)) * scale;
    vGlow = sin(3.14159265 * life) * uGrow;
  } else {
    float ang = uTime * aA.x + aA.y;
    float c = cos(ang);
    float s = sin(ang);
    float lift = uGrow * (1.0 + 0.14 * sin(uTime * 4.7 + aA.y));
    vec3 p = vec3(position.x * c - position.z * s, position.y * lift, position.x * s + position.z * c);
    world += p * scale;
    vGlow = aA.z;
    vPhase = aA.y;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`

const FS = `
uniform float uTime;
uniform float uFade;
uniform vec3 uDeep;
uniform vec3 uMain;
uniform vec3 uLight;
uniform sampler2D uStrand;
uniform sampler2D uTrail;
uniform sampler2D uNoise;
uniform sampler2D uTeeth;
varying vec2 vUv;
varying float vKind;
varying float vGlow;
varying float vRole;
varying float vPhase;
varying float vRep;
varying float vSpeed;

vec3 ramp(float i) {
  vec3 c = mix(uDeep, uMain, smoothstep(0.24, 0.3, i));
  c = mix(c, uLight, smoothstep(0.55, 0.61, i));
  return mix(c, vec3(1.0), smoothstep(0.8, 0.86, i));
}

float beam() {
  float x = vUv.x * 2.0 - 1.0;
  float across = max(1.0 - x * x, 0.0);
  float y = vUv.y;
  float rise = uTime * vSpeed;
  float s = texture2D(uStrand, vec2(vUv.x * 1.6 + vPhase, y * vRep * 0.35 - rise)).r;
  float n = texture2D(uNoise, vec2(vUv.x * 0.6 + vPhase * 1.7, y * vRep * 0.3 - rise * 0.5)).r;
  float foot = smoothstep(0.0, 0.02, y);
  if (vRole > 1.5) return pow(across, 0.8) * smoothstep(0.25, 0.75, s) * pow(1.0 - y, 0.9) * foot * vGlow;
  if (vRole > 0.5) return (pow(across, 2.5) * (0.85 + 0.35 * s) + 0.04) * pow(1.0 - y, 0.55) * foot * vGlow;
  return pow(across, 1.2) * (0.05 + 0.95 * smoothstep(0.2, 0.9, s)) * (0.55 + 0.7 * n) * pow(1.0 - y, 0.9) * foot * 0.85 * vGlow;
}

float ribbon() {
  float d = fract(vUv.x - uTime * vSpeed - vPhase);
  float tr = texture2D(uTrail, vec2(vUv.x * 1.4 - uTime * vSpeed * 1.3 + vPhase, vUv.y)).r;
  float ends = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.72, vUv.x);
  return tr * ends * (0.5 + 0.65 * pow(1.0 - d, 3.0)) * vGlow;
}

float bolt() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  return pow(across, 1.1) * 1.05 * vGlow;
}

float spark() {
  float x = abs(vUv.x * 2.0 - 1.0);
  float y = abs(vUv.y * 2.0 - 1.0);
  return max(1.0 - x - y * 0.85, 0.0) * 1.6 * vGlow;
}

float crown() {
  float teeth = texture2D(uTeeth, vec2(vUv.x * 4.0 + vPhase, vUv.y * 0.92 + 0.04)).r;
  float n = texture2D(uNoise, vec2(vUv.x * 3.0 + vPhase, vUv.y * 0.8 - uTime * 0.9)).r;
  return teeth * (0.45 + 0.8 * n) * smoothstep(0.0, 0.08, vUv.y) * vGlow;
}

void main() {
  float i;
  float hold;
  if (vKind < 0.5) {
    i = beam();
    hold = vRole < 0.5 ? 0.35 : 0.15;
  } else if (vKind < 1.5) {
    i = ribbon();
    hold = 0.3;
  } else if (vKind < 2.5) {
    i = bolt();
    hold = 0.2;
  } else if (vKind < 3.5) {
    i = spark();
    hold = 0.2;
  } else {
    i = crown();
    hold = 0.45;
  }
  float a = smoothstep(0.1, 0.15, i) * uFade;
  float cover = hold * (1.0 - smoothstep(0.45, 0.8, i));
  gl_FragColor = vec4(ramp(i) * a, a * cover);
}`

function seeded(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

class Builder {
  constructor() {
    this.pos = []
    this.uv = []
    this.kind = []
    this.a = []
    this.b = []
    this.index = []
  }

  vertex(p, uv, kind, a, b) {
    this.pos.push(p[0], p[1], p[2])
    this.uv.push(uv[0], uv[1])
    this.kind.push(kind)
    this.a.push(a[0], a[1], a[2], a[3])
    this.b.push(b[0], b[1], b[2], b[3])
    return this.kind.length - 1
  }

  strip(count) {
    const start = this.kind.length - count * 2
    for (let i = 0; i < count - 1; i++) {
      const v = start + i * 2
      this.index.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
    }
  }

  quad(kind, a, b) {
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) this.vertex([x, y, 0], [x + 0.5, y], kind, a, b)
    this.strip(2)
  }

  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('aKind', new THREE.Float32BufferAttribute(this.kind, 1))
    g.setAttribute('aA', new THREE.Float32BufferAttribute(this.a, 4))
    g.setAttribute('aB', new THREE.Float32BufferAttribute(this.b, 4))
    g.setIndex(this.index)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 8)
    return g
  }
}

function addBeams(b, look, rnd) {
  const h = look.height
  b.quad(KIND.beam, [0, 0, look.halo * 0.6, h], [0.3, rnd(), 1, ROLE.sheath])
  b.quad(KIND.beam, [0, 0, 0.3, h * 1.04], [0.5, rnd(), 1, ROLE.core])
  for (let i = 0; i < look.sides; i++) {
    const ang = rnd() * Math.PI * 2
    const r = 0.18 + rnd() * 0.22
    b.quad(KIND.beam, [Math.cos(ang) * r, Math.sin(ang) * r, 0.1 + rnd() * 0.05, h * (0.45 + rnd() * 0.3)], [0.9 + rnd() * 0.6, rnd(), 1, ROLE.streak])
  }
}

function addCrown(b, look, rnd) {
  const r = look.crown
  const h = 0.75 + r * 0.6
  const a = [0.35 + rnd() * 0.2, rnd() * 6, 1, 0]
  for (let k = 0; k <= CROWN_STEPS; k++) {
    const s = k / CROWN_STEPS
    const theta = s * Math.PI * 2
    const x = Math.cos(theta) * r
    const z = Math.sin(theta) * r
    b.vertex([x, 0, z], [s, 0], KIND.crown, a, [0, 0, 0, 0])
    b.vertex([x * 1.12, h, z * 1.12], [s, 1], KIND.crown, a, [0, 0, 0, 0])
  }
  b.strip(CROWN_STEPS + 1)
}

function addRibbon(b, rnd, i, count) {
  const theta0 = (i / count) * Math.PI * 2 + rnd() * 0.8
  const turns = 0.55 + rnd() * 0.3
  const r0 = 0.75 + rnd() * 0.2
  const h = 1.8 + rnd() * 0.8
  const y0 = rnd() * 0.12
  const w0 = 0.4 + rnd() * 0.1
  const a = [1.5 + rnd() * 0.7, rnd() * 6, 0.7 + rnd() * 0.45, 1]
  const t = new THREE.Vector3()
  const n = new THREE.Vector3()
  const w = new THREE.Vector3()
  const p = new THREE.Vector3()
  for (let k = 0; k <= RIBBON_STEPS; k++) {
    const s = k / RIBBON_STEPS
    const theta = theta0 + turns * Math.PI * 2 * s
    const r = r0 * (1 - 0.55 * s)
    p.set(Math.cos(theta) * r, y0 + h * s, Math.sin(theta) * r)
    t.set(-Math.sin(theta) * r * turns * Math.PI * 2 - Math.cos(theta) * r0 * 0.55, h, Math.cos(theta) * r * turns * Math.PI * 2 - Math.sin(theta) * r0 * 0.55)
    n.set(Math.cos(theta), 0, Math.sin(theta))
    w.crossVectors(t, n).normalize().multiplyScalar(w0 * (1 - 0.45 * s) * 0.5)
    b.vertex([p.x - w.x, p.y - w.y, p.z - w.z], [s, 0], KIND.ribbon, a, [0, 0, 0, 0])
    b.vertex([p.x + w.x, p.y + w.y, p.z + w.z], [s, 1], KIND.ribbon, a, [0, 0, 0, 0])
  }
  b.strip(RIBBON_STEPS + 1)
}

function addBolt(b, rnd, i) {
  const a = [i + rnd(), 9 + rnd() * 5, 0.8 + rnd() * 0.4, 0.13]
  const bb = [0.05, 1.1, 0.3, BOLT_STEPS]
  for (let k = 0; k <= BOLT_STEPS; k++) {
    b.vertex([k, -1, 0], [k / BOLT_STEPS, 0], KIND.bolt, a, bb)
    b.vertex([k, 1, 0], [k / BOLT_STEPS, 1], KIND.bolt, a, bb)
  }
  b.strip(BOLT_STEPS + 1)
}

function addSpark(b, rnd) {
  b.quad(KIND.spark, [rnd() * Math.PI * 2, 0.2 + rnd() * 0.5, 0.45 + rnd() * 0.4, rnd()], [2.5 + rnd() * 1.5, 0.5, 0.11, 0])
}

function buildGeometry(look, seed) {
  const rnd = seeded(seed)
  const b = new Builder()
  addBeams(b, look, rnd)
  for (let i = 0; i < look.ribbons; i++) addRibbon(b, rnd, i, look.ribbons)
  for (let i = 0; i < look.bolts; i++) addBolt(b, rnd, i)
  for (let i = 0; i < look.sparks; i++) addSpark(b, rnd)
  return b.geometry()
}

function color(rgb) {
  return new THREE.Color(rgb[0], rgb[1], rgb[2])
}

export class LootAura {
  constructor(parent) {
    this.parent = parent
    this.time = { value: 0 }
    this.maps = null
    this.geometries = new Map()
    this.pool = new Map()
    this.live = []
    this.probeAura = null
  }

  textures() {
    if (!this.maps) {
      this.maps = {
        uStrand: { value: tiled(T('T_FX_Noise_2_1', false)) },
        uTrail: { value: tiled(T('T_FX_Trail_16_1', false)) },
        uNoise: { value: tiled(T('T_FX_Noise_20_1', false)) },
        uTeeth: { value: tiled(T('T_FX_Shape_3_4_Teeth_Noise', false)) },
      }
    }
    return this.maps
  }

  geometry(rarity) {
    let g = this.geometries.get(rarity)
    if (!g) {
      g = buildGeometry(LOOKS[rarity] || LOOKS.common, 0x51a7 + Object.keys(LOOKS).indexOf(rarity) * 977)
      this.geometries.set(rarity, g)
    }
    return g
  }

  make(rarity) {
    const look = LOOKS[rarity] || LOOKS.common
    const uniforms = {
      ...this.textures(),
      uTime: this.time,
      uGrow: { value: 0 },
      uFade: { value: 0 },
      uDeep: { value: color(look.deep) },
      uMain: { value: color(look.main) },
      uLight: { value: color(look.light) },
    }
    const mesh = new THREE.Mesh(this.geometry(rarity), new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VS,
      fragmentShader: safeFragment(FS),
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    }))
    mesh.name = `loot-aura-${rarity}`
    mesh.frustumCulled = false
    mesh.renderOrder = 3
    return { mesh, uniforms, rarity, t: 0, out: false }
  }

  take(rarity, x, z) {
    const spare = this.pool.get(rarity)
    const aura = spare && spare.length ? spare.pop() : this.make(rarity)
    aura.t = 0
    aura.out = false
    aura.uniforms.uGrow.value = 0
    aura.uniforms.uFade.value = 0
    aura.mesh.position.set(x, 0, z)
    this.parent.add(aura.mesh)
    this.live.push(aura)
    return aura
  }

  follow(aura, x, z) {
    if (!aura) return
    aura.mesh.position.x = x
    aura.mesh.position.z = z
  }

  release(aura) {
    if (aura) aura.out = true
  }

  retire(i) {
    const aura = this.live[i]
    this.live[i] = this.live[this.live.length - 1]
    this.live.pop()
    this.parent.remove(aura.mesh)
    let spare = this.pool.get(aura.rarity)
    if (!spare) {
      spare = []
      this.pool.set(aura.rarity, spare)
    }
    spare.push(aura)
  }

  probe() {
    if (!this.probeAura) {
      this.probeAura = this.make('epic')
      this.probeAura.uniforms.uGrow.value = 1
      this.probeAura.uniforms.uFade.value = 1
    }
    return this.probeAura.mesh
  }

  update(dt) {
    this.time.value = (this.time.value + dt) % TIME_WRAP
    for (let i = this.live.length - 1; i >= 0; i--) {
      const aura = this.live[i]
      const u = aura.uniforms
      if (aura.out) {
        u.uFade.value -= dt / FADE_OUT
        if (u.uFade.value <= 0) this.retire(i)
        continue
      }
      aura.t += dt
      const k = Math.min(1, aura.t / GROW_TIME)
      u.uGrow.value = 1 - (1 - k) * (1 - k) * (1 - k)
      u.uFade.value = Math.min(1, aura.t / FADE_IN)
    }
  }

  clear() {
    for (let i = this.live.length - 1; i >= 0; i--) this.retire(i)
  }
}
