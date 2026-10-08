import * as THREE from 'three'
import { Flipbooks } from './flipbook.js'
import { stream } from '../core/rng.js'
import { LOW_TIER } from '../core/tier.js'

const random = stream('fx')

const loader = new THREE.TextureLoader()
const cache = new Map()

export function T(file, srgb = true) {
  const key = srgb ? file : `${file}#linear`
  if (cache.has(key)) return cache.get(key)
  const t = loader.load(`assets/fx/${file}.webp`)
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.anisotropy = LOW_TIER ? 4 : 16
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  cache.set(key, t)
  return t
}

export function tiled(t) {
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  return t
}

const _color = new THREE.Color()
const _hsl = {}
const WARN_BURST = 0.28

export function paletteFor(color) {
  _color.set(color).getHSL(_hsl)
  const h = _hsl.h * 360
  if (_hsl.s < 0.12) return 'holy'
  if (h >= 330 || h < 12) return 'blood'
  if (h < 42) return 'fire'
  if (h < 70) return 'holy'
  if (h < 165) return 'nature'
  if (h < 255) return 'water'
  return 'arcane'
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

const FLAT_VS = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`

const RING_FS = `
  uniform sampler2D uLut;
  uniform sampler2D uNoise;
  uniform vec3 uColor;
  uniform float uT;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float t = clamp(uT, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - t, 3.0);
    float R = mix(0.08, 0.97, e);
    float th = R * mix(0.7, 0.28, e) + 0.015;
    float s = (R - r) / th;
    float band = step(0.0, s) * step(s, 1.0) * smoothstep(0.0, 0.035, s) * smoothstep(1.0, 0.7, s);
    float ls = (s - 0.07) / 0.05;
    float prof = (texture2D(uLut, vec2(0.5, clamp(s, 0.0, 1.0))).r * 1.4 + exp(-ls * ls) * 0.5) * band;
    float a = r > 0.001 ? atan(p.y, p.x) * 0.15915494 : 0.0;
    float n = texture2D(uNoise, vec2(a * 3.0 + uSeed, r * 0.7 - t * 0.5)).r;
    float fill = (1.0 - smoothstep(0.0, R, r)) * pow(1.0 - t, 4.0) * 0.1;
    float k = (prof * (0.4 + 1.1 * n) * pow(1.0 - t, 1.2) + fill) * smoothstep(1.0, 0.97, r);
    vec3 col = uColor * k * 2.0 + vec3(k * k * k) * 0.3;
    gl_FragColor = vec4(col, 1.0);
  }`

const DECAL_FS = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uLut;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    vec4 t = texture2D(uMap, uLut > 0.5 ? vec2(0.5, clamp(1.0 - r, 0.0, 1.0)) : vUv);
    float circ = smoothstep(1.0, 0.82, r);
    gl_FragColor = vec4(t.rgb * t.a * uColor * circ * uAlpha, 1.0);
  }`

const WARN_FS = `
  uniform vec3 uColor;
  uniform float uFill;
  uniform float uAlpha;
  uniform float uArc;
  uniform float uRect;
  uniform vec2 uSize;
  uniform float uThick;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float inside;
    float edge;
    float lead;
    if (uRect > 0.5) {
      vec2 q = abs(p);
      inside = step(q.x, 1.0) * step(q.y, 1.0);
      edge = min((1.0 - q.x) * uSize.x, (1.0 - q.y) * uSize.y);
      lead = ((1.0 - vUv.y) - uFill) * uSize.y * 2.0;
      inside *= mix(0.14, 0.5, step(1.0 - vUv.y, uFill));
    } else {
      float r = length(p);
      float ang = atan(abs(p.x), -p.y);
      inside = (1.0 - smoothstep(uArc - 0.015, uArc, ang)) * (1.0 - smoothstep(0.985, 1.0, r));
      edge = (1.0 - r) * uSize.x;
      if (uArc < 3.1) edge = min(edge, (uArc - ang) * r * uSize.x);
      lead = (r - uFill) * uSize.x;
      inside *= mix(0.14, 0.5, step(r, uFill));
    }
    float border = step(0.001, inside) * (1.0 - smoothstep(0.0, uThick, edge));
    float front = step(0.001, inside) * exp(-lead * lead * 18.0);
    float k = (inside + border * 1.1 + front * 0.9) * uAlpha;
    gl_FragColor = vec4(uColor * k * 1.6 + vec3(front * 0.25 * uAlpha), 1.0);
  }`

const SLASH_VS = `
  uniform float uSpan;
  uniform float uR;
  uniform float uW;
  uniform float uDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    float a = (uv.x - 0.5) * uSpan * uDir;
    float taper = 0.3 + 0.7 * sin(3.14159265 * uv.x);
    float r = uR + (uv.y - 0.5) * uW * taper;
    vec3 p = vec3(sin(a) * r, 0.0, cos(a) * r);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`

const SLASH_FS = `
  uniform sampler2D uMask;
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uTail;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float x = (uHead - vUv.x) / uTail;
    if (x <= 0.0 || x >= 1.0) discard;
    float y = vUv.y;
    float m = texture2D(uMask, vec2(0.02 + x * 0.96, y)).r;
    float edge = smoothstep(0.0, 0.03, x) * smoothstep(1.0, 0.5, x)
      * smoothstep(0.0, 0.14, y) * smoothstep(1.0, 0.9, y)
      * smoothstep(0.0, 0.05, vUv.x) * smoothstep(1.0, 0.95, vUv.x);
    float lead = pow(1.0 - x, 1.4);
    float dy = (y - 0.66) / 0.26;
    float body = exp(-dy * dy) * lead * 0.35;
    float ly = (y - 0.84) / 0.045;
    float line = exp(-ly * ly) * lead * lead;
    m = m * edge;
    float hot = smoothstep(0.45, 1.0, m) * lead;
    vec3 col = uColor * (m * 2.3 + body * edge + line * edge * 0.8) + vec3(hot * 0.8 + line * edge * 0.45);
    gl_FragColor = vec4(col * uAlpha, 1.0);
  }`

const BEAM_VS = `
  uniform vec3 uFrom;
  uniform vec3 uTo;
  uniform float uWidth;
  varying vec2 vP;
  void main() {
    vec3 d = uTo - uFrom;
    float len = length(d);
    vec3 ax = len > 0.0001 ? d / len : vec3(1.0, 0.0, 0.0);
    float pad = uWidth * 0.9;
    float along = mix(-pad, len + pad, uv.x);
    vec3 c = uFrom + ax * along;
    vec3 side = cross(ax, normalize(cameraPosition - c));
    float sl = length(side);
    side = sl > 0.0001 ? side / sl : vec3(0.0, 1.0, 0.0);
    float across = (uv.y * 2.0 - 1.0) * pad;
    vP = vec2(along, across);
    gl_Position = projectionMatrix * viewMatrix * vec4(c + side * across, 1.0);
  }`

const BEAM_FS = `
  uniform sampler2D uTex;
  uniform vec3 uColor;
  uniform float uWidth;
  uniform float uLen;
  uniform float uHead;
  uniform float uThin;
  uniform float uAlpha;
  uniform float uAge;
  uniform float uSeed;
  varying vec2 vP;
  void main() {
    float head = uLen * uHead;
    float cx = clamp(vP.x, 0.0, head);
    float f = clamp(cx / max(uLen, 0.001), 0.0, 1.0);
    float rad = max(uWidth * 0.5 * uThin * mix(1.0, 0.6, f), 0.0001);
    vec2 q = vec2(vP.x - cx, vP.y) / rad;
    float d2 = dot(q, q);
    float glow = exp(-d2 * 2.2);
    float core = exp(-d2 * 16.0);
    vec2 sv = vec2(vP.x / (uWidth * 3.5) - uAge * 4.0 + uSeed, vP.y / (uWidth * 1.8) + 0.5);
    float n = texture2D(uTex, sv).r;
    float n2 = texture2D(uTex, vec2(sv.x * 0.6 - uAge * 2.5 + 0.37, 1.0 - sv.y)).r;
    float w2 = uWidth * uWidth;
    vec2 h = vP - vec2(head, 0.0);
    float muzzle = exp(-dot(vP, vP) / (w2 * 0.1));
    float tip = exp(-dot(h, h) / (w2 * 0.08));
    float edge = smoothstep(uWidth * 0.9, uWidth * 0.6, abs(vP.y));
    float k = (glow * (0.15 + 0.85 * n + 0.65 * n2) + muzzle * 0.8 + tip * 0.5) * edge * uAlpha;
    vec3 col = uColor * k * 1.25 + mix(uColor, vec3(1.0), 0.35) * core * edge * uAlpha * 0.9;
    gl_FragColor = vec4(col, 1.0);
  }`

const PILLAR_VS = `
  uniform float uH;
  uniform float uRad;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 v = cameraPosition - base;
    v.y = 0.0;
    float l = length(v);
    v = l > 0.0001 ? v / l : vec3(0.0, 0.0, 1.0);
    vec3 side = vec3(v.z, 0.0, -v.x);
    float w = uRad * mix(1.0, 1.25, uv.y);
    vec3 p = base + side * (uv.x * 2.0 - 1.0) * w + vec3(0.0, uv.y * uH, 0.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`

const PILLAR_FS = `
  uniform sampler2D uTex;
  uniform vec3 uColor;
  uniform float uAge;
  uniform float uAlpha;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    float x = vUv.x * 2.0 - 1.0;
    float y = vUv.y;
    float side = 1.0 - x * x;
    side = side * side * side;
    float core = exp(-x * x * 22.0);
    float vert = smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.2, 1.0, y));
    float n = texture2D(uTex, vec2(vUv.x * 0.6 + uSeed, y * 0.6 - uAge * 1.8)).r;
    float n2 = texture2D(uTex, vec2(vUv.x * 0.45 + uSeed + 0.5, y * 0.35 - uAge * 1.1)).r;
    float k = (side * (0.1 + 0.8 * n + 0.5 * n2) * 0.8 + core * 0.55) * vert * uAlpha;
    vec3 col = uColor * k * 1.5 + vec3(core * vert * uAlpha * 0.2);
    gl_FragColor = vec4(col, 1.0);
  }`

const BILL_VS = `
  uniform float uSize;
  uniform float uRot;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float cs = cos(uRot);
    float sn = sin(uRot);
    vec2 o = (uv - 0.5) * uSize;
    o = vec2(o.x * cs - o.y * sn, o.x * sn + o.y * cs);
    vec4 pv = vec4(c.xy + o, c.z, 1.0);
    gl_Position = projectionMatrix * pv;
    vec4 pz = projectionMatrix * vec4(pv.xy, min(pv.z + uSize * 0.5, -0.5), 1.0);
    gl_Position.z = pz.z / pz.w * gl_Position.w;
  }`

const FLASH_FS = `
  uniform sampler2D uMap;
  uniform vec3 uColor;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r2 = dot(p, p);
    vec4 t = texture2D(uMap, vUv);
    float glow = exp(-r2 * 12.0) * 0.35;
    float circ = smoothstep(1.0, 0.85, sqrt(r2));
    vec3 col = (t.rgb * t.a * uColor + uColor * glow + vec3(glow * glow) * 0.3) * circ * uAlpha;
    gl_FragColor = vec4(col, 1.0);
  }`

const PUFF_FS = `
  uniform sampler2D uMap;
  uniform sampler2D uNoise;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uT;
  uniform float uSeed;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float m = texture2D(uMap, vUv).r * 2.0;
    float n = texture2D(uNoise, vUv * 0.8 + vec2(uSeed, uT * 0.2)).r;
    float erode = smoothstep(uT * 0.9 - 0.05, uT * 0.9 + 0.3, n);
    float k = m * (0.3 + 0.8 * n) * erode * smoothstep(1.0, 0.7, r) * uAlpha;
    gl_FragColor = vec4(uColor * k, 1.0);
  }`

class Pool {
  constructor(make) {
    this.make = make
    this.free = []
    this.live = []
  }
  get() {
    const o = this.free.pop() || this.make()
    this.live.push(o)
    o.visible = true
    return o
  }
  release(o) {
    o.visible = false
    const i = this.live.indexOf(o)
    if (i >= 0) this.live.splice(i, 1)
    this.free.push(o)
  }
  warm() {
    const o = this.make()
    o.visible = true
    this.free.push(o)
    return o
  }
}

function glowMaterial(vertexShader, fragmentShader, uniforms, extra) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    ...extra,
  })
}

export class FX {
  constructor(scene) {
    this.scene = scene
    this.items = []
    this.group = new THREE.Group()
    scene.add(this.group)

    this.slashTex = [T('T_FX_Mask_22_1_Slash', false), T('T_FX_Mask_20_1_Slash', false), T('T_FX_Mask_21_1_Slash', false)]
    this.glow = T('T_FX_Glow_Particle_1_1')
    this.flare = T('T_FX_flare_00')
    this.ring = T('T_FX_ExplosionRing_Gradient_1', false)
    this.smoke = T('T_FX_Smoke_3_1', false)
    this.trail = tiled(T('T_FX_Trail_1_1', false))
    this.crack = T('T_FX_Cracked_Glow_1_1')
    this.bullet = T('T_FX_Obj_Bullet_1_1')
    this.shape = T('T_FX_Shape_5_1')
    this.noise = tiled(T('T_FX_Noise_45_1', false))
    this.streaks = tiled(T('T_FX_Noise_2_1', false))
    this.cloud = tiled(T('T_FX_Noise_20_1', false))
    this.slashFlip = 1
    this.camPos = new THREE.Vector3(0, 13, 13)

    this.initSparks()
    this.books = new Flipbooks(this.group)

    const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const slashGeo = new THREE.PlaneGeometry(1, 1, 40, 3)
    const beamGeo = new THREE.PlaneGeometry(1, 1, 16, 1)
    const quadGeo = new THREE.PlaneGeometry(1, 1)

    const add = (geo, mat, cull = true) => {
      const m = new THREE.Mesh(geo, mat)
      m.frustumCulled = cull
      m.visible = false
      this.group.add(m)
      return m
    }

    this.ringPool = new Pool(() => add(flatGeo, glowMaterial(FLAT_VS, RING_FS, {
      uLut: { value: this.ring },
      uNoise: { value: this.noise },
      uColor: { value: new THREE.Color() },
      uT: { value: 0 },
      uSeed: { value: 0 },
    })))
    this.decalPool = new Pool(() => add(flatGeo, glowMaterial(FLAT_VS, DECAL_FS, {
      uMap: { value: this.crack },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0 },
      uLut: { value: 0 },
    })))
    this.slashPool = new Pool(() => {
      const m = add(slashGeo, glowMaterial(SLASH_VS, SLASH_FS, {
        uMask: { value: this.slashTex[0] },
        uColor: { value: new THREE.Color() },
        uSpan: { value: 2.6 },
        uR: { value: 1 },
        uW: { value: 0.5 },
        uDir: { value: 1 },
        uHead: { value: 0 },
        uTail: { value: 0.75 },
        uAlpha: { value: 0 },
      }, { depthTest: false }), false)
      m.rotation.order = 'YXZ'
      return m
    })
    this.beamPool = new Pool(() => add(beamGeo, glowMaterial(BEAM_VS, BEAM_FS, {
      uTex: { value: this.trail },
      uColor: { value: new THREE.Color() },
      uFrom: { value: new THREE.Vector3() },
      uTo: { value: new THREE.Vector3(1, 0, 0) },
      uWidth: { value: 1 },
      uLen: { value: 1 },
      uHead: { value: 0 },
      uThin: { value: 1 },
      uAlpha: { value: 0 },
      uAge: { value: 0 },
      uSeed: { value: 0 },
    }), false))
    this.pillarPool = new Pool(() => add(quadGeo, glowMaterial(PILLAR_VS, PILLAR_FS, {
      uTex: { value: this.streaks },
      uColor: { value: new THREE.Color() },
      uH: { value: 1 },
      uRad: { value: 1 },
      uAge: { value: 0 },
      uAlpha: { value: 0 },
      uSeed: { value: 0 },
    }), false))
    this.flashPool = new Pool(() => add(quadGeo, glowMaterial(BILL_VS, FLASH_FS, {
      uMap: { value: this.flare },
      uColor: { value: new THREE.Color() },
      uSize: { value: 1 },
      uRot: { value: 0 },
      uAlpha: { value: 0 },
    }), false))
    this.puffPool = new Pool(() => add(quadGeo, glowMaterial(BILL_VS, PUFF_FS, {
      uMap: { value: this.smoke },
      uNoise: { value: this.cloud },
      uColor: { value: new THREE.Color() },
      uSize: { value: 1 },
      uRot: { value: 0 },
      uAlpha: { value: 0 },
      uT: { value: 0 },
      uSeed: { value: 0 },
    }), false))

    this.warnPool = new Pool(() => {
      const m = add(flatGeo, glowMaterial(FLAT_VS, WARN_FS, {
        uColor: { value: new THREE.Color() },
        uFill: { value: 0 },
        uAlpha: { value: 0 },
        uArc: { value: Math.PI + 0.1 },
        uRect: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) },
        uThick: { value: 0.2 },
      }), false)
      m.renderOrder = 2
      return m
    })

    this.pools = [this.ringPool, this.decalPool, this.slashPool, this.beamPool, this.pillarPool, this.flashPool, this.puffPool, this.warnPool]
    this.warmed = this.pools.map(p => [p, p.warm()])
  }

  initSparks() {
    this.maxSpark = 900
    this.sPos = new Float32Array(this.maxSpark * 3)
    this.sVel = new Float32Array(this.maxSpark * 3)
    this.sLife = new Float32Array(this.maxSpark)
    this.sMax = new Float32Array(this.maxSpark)
    this.sCol = new Float32Array(this.maxSpark * 3)
    this.sSize = new Float32Array(this.maxSpark)
    this.sBase = new Float32Array(this.maxSpark)
    this.sHead = 0
    this.sAwake = false
    this.sparkGeo = new THREE.BufferGeometry()
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3))
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sCol, 3))
    this.sparkGeo.setAttribute('size', new THREE.BufferAttribute(this.sSize, 1))
    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 320 } },
      vertexShader: `
        attribute float size;
        uniform float uScale;
        varying vec3 vC;
        void main() {
          vC = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.001, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vC;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float d = dot(p, p);
          if (d >= 1.0) discard;
          float a = exp(-d * 3.5) * (1.0 - d);
          gl_FragColor = vec4(vC * a * 1.6 + vec3(a * a * a) * 0.55, 1.0);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
    })
    this.sparks = new THREE.Points(this.sparkGeo, this.sparkMat)
    this.sparks.frustumCulled = false
    this.group.add(this.sparks)
  }

  spark(x, y, z, n, color, speed = 6, up = 1, size = 0.3) {
    const c = _color.set(color)
    for (let i = 0; i < n; i++) {
      const k = this.sHead
      this.sHead = (this.sHead + 1) % this.maxSpark
      this.sPos[k * 3] = x
      this.sPos[k * 3 + 1] = y
      this.sPos[k * 3 + 2] = z
      const a = random() * Math.PI * 2
      const e = random() * 0.9
      const s = speed * (0.35 + random() * 0.9)
      this.sVel[k * 3] = Math.cos(a) * Math.cos(e) * s
      this.sVel[k * 3 + 1] = (Math.sin(e) * s + 1.5) * up
      this.sVel[k * 3 + 2] = Math.sin(a) * Math.cos(e) * s
      this.sLife[k] = this.sMax[k] = 0.34 + random() * 0.5
      this.sCol[k * 3] = c.r
      this.sCol[k * 3 + 1] = c.g
      this.sCol[k * 3 + 2] = c.b
      this.sBase[k] = this.sSize[k] = size * (0.6 + random() * 0.8)
    }
    this.sAwake = true
    this.sColorDirty = true
  }

  decal(x, z, size, color, life, texture, spin = 0) {
    const m = this.decalPool.get()
    const u = m.material.uniforms
    const map = texture || this.ring
    u.uMap.value = map
    u.uLut.value = map === this.ring ? 1 : 0
    u.uColor.value.set(color)
    u.uAlpha.value = 0
    m.position.set(x, 0.09, z)
    m.rotation.set(0, random() * Math.PI * 2, 0)
    m.scale.set(size, 1, size)
    this.items.push({ kind: 'decal', o: m, pool: this.decalPool, t: 0, life, size, spin })
    return m
  }

  shock(x, z, size, color, life = 0.55) {
    const m = this.ringPool.get()
    const u = m.material.uniforms
    u.uColor.value.set(color)
    u.uT.value = 0
    u.uSeed.value = random()
    m.position.set(x, 0.11, z)
    m.rotation.set(0, random() * Math.PI * 2, 0)
    m.scale.set(size, 1, size)
    this.items.push({ kind: 'shock', o: m, pool: this.ringPool, t: 0, life, size })
  }

  slash(x, y, z, angle, scale, color, life = 0.22) {
    const m = this.slashPool.get()
    const u = m.material.uniforms
    this.slashFlip = -this.slashFlip
    const dir = this.slashFlip
    const r = 0.6 + scale * 0.45
    u.uMask.value = this.slashTex[(random() * this.slashTex.length) | 0]
    u.uColor.value.set(color)
    u.uSpan.value = 2.5 + random() * 0.4
    u.uR.value = r
    u.uW.value = 0.45 + scale * 0.42
    u.uDir.value = dir
    u.uHead.value = 0
    u.uAlpha.value = 1
    const sa = Math.sin(angle)
    const ca = Math.cos(angle)
    const back = r * 0.75
    const cx = this.camPos.x - x
    const cz = this.camPos.z - z
    const cl = Math.hypot(cx, cz) || 1
    const lx = (cx * ca - cz * sa) / cl
    const lz = (cx * sa + cz * ca) / cl
    m.position.set(x - sa * back, y, z - ca * back)
    m.rotation.set(lz * 0.2, angle, -lx * 0.36 + (random() - 0.5) * 0.24)
    this.items.push({ kind: 'slash', o: m, pool: this.slashPool, t: 0, life, scale, r })
  }

  flash(x, y, z, size, color, life = 0.3, tex) {
    const m = this.flashPool.get()
    const u = m.material.uniforms
    u.uMap.value = tex || this.flare
    u.uColor.value.set(color)
    u.uSize.value = size
    u.uRot.value = random() * Math.PI * 2
    u.uAlpha.value = 1
    m.position.set(x, y, z)
    this.items.push({ kind: 'flash', o: m, pool: this.flashPool, t: 0, life, size, spin: (random() - 0.5) * 1.2 })
  }

  puff(x, y, z, size, color, life = 0.7) {
    const m = this.puffPool.get()
    const u = m.material.uniforms
    u.uColor.value.set(color)
    u.uSize.value = size
    u.uRot.value = random() * Math.PI * 2
    u.uAlpha.value = 0
    u.uT.value = 0
    u.uSeed.value = random()
    m.position.set(x, y, z)
    this.items.push({ kind: 'puff', o: m, pool: this.puffPool, t: 0, life, size, vy: 1.2 + random(), spin: (random() - 0.5) * 2 })
  }

  beam(from, to, width, color, life = 0.3) {
    const m = this.beamPool.get()
    const u = m.material.uniforms
    u.uFrom.value.copy(from)
    u.uTo.value.copy(to)
    u.uLen.value = from.distanceTo(to)
    u.uWidth.value = width
    u.uColor.value.set(color)
    u.uHead.value = 0
    u.uThin.value = 0.7
    u.uAlpha.value = 1
    u.uAge.value = 0
    u.uSeed.value = random()
    this.items.push({ kind: 'beam', o: m, pool: this.beamPool, t: 0, life, width })
  }

  pillar(x, z, height, radius, color, life = 0.9) {
    const m = this.pillarPool.get()
    const u = m.material.uniforms
    u.uColor.value.set(color)
    u.uH.value = height
    u.uRad.value = radius
    u.uAge.value = 0
    u.uAlpha.value = 0
    u.uSeed.value = random()
    m.position.set(x, 0.02, z)
    this.items.push({ kind: 'pillar', o: m, pool: this.pillarPool, t: 0, life, height, radius })
  }

  warn({ x, z, yaw = 0, radius = 3, arc = Math.PI, width = 0, length = 0, windup = 1, color = 0xff2a1a }) {
    const m = this.warnPool.get()
    const u = m.material.uniforms
    const rect = width > 0
    u.uColor.value.set(color)
    u.uFill.value = 0
    u.uAlpha.value = 0
    u.uRect.value = rect ? 1 : 0
    u.uArc.value = arc >= Math.PI ? Math.PI + 0.1 : arc
    u.uSize.value.set(rect ? width / 2 : radius, rect ? length / 2 : radius)
    m.position.set(x, 0.1, z)
    m.rotation.set(0, yaw, 0)
    if (rect) m.scale.set(width, 1, length)
    else m.scale.set(radius * 2, 1, radius * 2)
    const item = { kind: 'warn', o: m, pool: this.warnPool, t: 0, windup, life: windup + WARN_BURST }
    this.items.push(item)
    return item
  }

  endWarn(item) {
    if (item && item.t < item.windup) item.t = item.windup
  }

  book(name, o) {
    return this.books.has(name) ? this.books.spawn(name, o) : null
  }

  enemySpawn(x, z, boss) {
    const burst = this.book('magic_burst', { x, y: 0, z, size: boss ? 7.5 : 3.8, palette: 'arcane', billboard: 'up', rot: 0 })
    if (burst) {
      this.book('shockwave', { x, y: 0.06, z, size: boss ? 10 : 4.6, palette: 'arcane', billboard: 'ground' })
      this.spark(x, 0.5, z, 12, 0xb464ff, 4)
    } else {
      this.shock(x, z, 3.2, 0x9a3bff, 0.6)
      this.spark(x, 0.5, z, 18, 0xb464ff, 5)
      this.pillar(x, z, 3.2, 0.7, 0x8a3bff, 0.5)
    }
    if (boss) this.shock(x, z, 12, 0xff4444, 1.1)
  }

  enemyDeath(x, z, boss) {
    const smoke = this.book('smoke_puff', { x, y: 0, z, size: boss ? 6.5 : 3.2, color: 0x7a4a86, billboard: 'up', rot: 0 })
    if (smoke) this.book('magic_burst', { x, y: 0.2, z, size: boss ? 5 : 2.4, palette: 'arcane', billboard: 'up', rot: 0, speed: 1.35 })
    else this.puff(x, 0.7, z, 2.4, 0x5a2a6a, 0.8)
    this.spark(x, 0.8, z, 26, 0xa050ff, 7)
    if (boss) this.shock(x, z, 16, 0xff5050, 1.2)
  }

  dashDust(x, z, dx, dz) {
    const dust = this.book('smoke_puff', { x: x - dx * 0.5, y: 0, z: z - dz * 0.5, size: 2.1, color: 0xd8c8b8, billboard: 'up', rot: 0, speed: 1.6, alpha: 0.75 })
    if (!dust) this.puff(x, 0.35, z, 2.2, 0x9fd0ff, 0.5)
  }

  morphBurst(x, z, color) {
    const wave = this.book('shockwave', { x, y: 0.06, z, size: 18, palette: paletteFor(color), billboard: 'ground' })
    if (wave) this.book('magic_burst', { x, y: 0, z, size: 9, palette: paletteFor(color), billboard: 'up', rot: 0, speed: 0.8 })
    else this.shock(x, z, 22, color, 1.4)
  }

  titanLanding(x, z, color) {
    const wave = this.book('shockwave', { x, y: 0.06, z, size: 24, color: 0xffffff, palette: paletteFor(color), billboard: 'ground' })
    if (wave) {
      this.book('explosion_big', { x, y: 0, z, size: 11, billboard: 'up', rot: 0 })
      this.book('smoke_puff', { x, y: 0, z, size: 9, color: 0x8a7a70, billboard: 'up', rot: 0, speed: 0.7 })
    } else {
      this.shock(x, z, 30, color, 1.0)
    }
  }

  unmorph(x, z, color) {
    const wave = this.book('shockwave', { x, y: 0.06, z, size: 9, palette: paletteFor(color), billboard: 'ground' })
    if (!wave) this.shock(x, z, 10, color, 0.7)
  }

  celebrate(x, y, z) {
    const blast = this.book('magic_burst', { x, y: y - 1, z, size: 5, palette: 'holy', billboard: 'face', rot: 0 })
    if (!blast) this.flash(x, y, z, 5, 0xffe9a8, 0.7)
    this.spark(x, y, z, 40, 0xffd070, 9)
  }

  updateSparks(dt) {
    if (!this.sAwake) {
      this.sparks.visible = false
      return
    }
    const P = this.sPos
    const V = this.sVel
    let alive = 0
    for (let i = 0; i < this.maxSpark; i++) {
      if (this.sLife[i] <= 0) { this.sSize[i] = 0; continue }
      alive++
      this.sLife[i] -= dt
      const k = Math.max(0, this.sLife[i] / this.sMax[i])
      const j = i * 3
      V[j + 1] -= 14 * dt
      P[j] += V[j] * dt
      P[j + 1] += V[j + 1] * dt
      P[j + 2] += V[j + 2] * dt
      if (P[j + 1] < 0.05) {
        P[j + 1] = 0.05
        V[j + 1] *= -0.32
        V[j] *= 0.7
        V[j + 2] *= 0.7
      }
      this.sSize[i] = this.sBase[i] * Math.min(1, k / 0.35)
    }
    this.sparkGeo.attributes.position.needsUpdate = true
    this.sparkGeo.attributes.size.needsUpdate = true
    if (this.sColorDirty) {
      this.sColorDirty = false
      this.sparkGeo.attributes.color.needsUpdate = true
    }
    if (!alive) this.sAwake = false
    this.sparks.visible = this.sAwake
  }

  update(dt, camera, bufferHeight = 720) {
    if (this.warmed) {
      for (const [p, o] of this.warmed) if (p.free.includes(o)) o.visible = false
      this.warmed = null
    }
    if (camera) this.camPos.copy(camera.position)
    this.sparkMat.uniforms.uScale.value = 320 * bufferHeight / 720
    this.updateSparks(dt)
    if (camera) this.books.update(dt, camera, this.scene.fog)

    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.t += dt
      const k = it.t / it.life
      if (k >= 1) {
        it.pool.release(it.o)
        this.items.splice(i, 1)
        continue
      }
      const m = it.o
      const u = m.material.uniforms
      switch (it.kind) {
        case 'decal': {
          u.uAlpha.value = smooth(0, 0.08, k) * Math.pow(1 - k, 1.3)
          m.rotation.y += it.spin * dt
          const s = it.size * (0.9 + 0.15 * (1 - Math.pow(1 - k, 3)))
          m.scale.set(s, 1, s)
          break
        }
        case 'shock':
          u.uT.value = k
          break
        case 'slash':
          u.uHead.value = (1 + u.uTail.value) * Math.pow(k, 0.8)
          u.uAlpha.value = 1 - smooth(0.55, 1, k)
          u.uR.value = it.r * (1 + 0.12 * k)
          break
        case 'flash':
          u.uSize.value = it.size * (0.6 + 1.2 * (1 - Math.pow(1 - k, 2)))
          u.uAlpha.value = smooth(0, 0.06, k) * (1 - k) * (1 - k)
          u.uRot.value += it.spin * dt
          break
        case 'puff':
          u.uSize.value = it.size * (0.7 + 1.5 * (1 - Math.pow(1 - k, 2)))
          u.uAlpha.value = smooth(0, 0.12, k) * (1 - k) * 0.5
          u.uT.value = k
          u.uRot.value += it.spin * dt
          m.position.y += it.vy * dt * (1 - k)
          break
        case 'beam':
          u.uHead.value = smooth(0, 0.28, k)
          u.uThin.value = (0.7 + 0.3 * smooth(0, 0.15, k)) * (1 - 0.65 * smooth(0.45, 1, k))
          u.uAlpha.value = 1 - smooth(0.6, 1, k)
          u.uAge.value += dt
          break
        case 'warn': {
          const w = it.t / it.windup
          if (w < 1) {
            u.uFill.value = 1 - Math.pow(1 - w, 1.6)
            u.uAlpha.value = smooth(0, 0.15, it.t) * (0.75 + 0.25 * Math.sin(it.t * 14))
          } else {
            u.uFill.value = 1.2
            u.uAlpha.value = 1.7 * (1 - smooth(0, WARN_BURST, it.t - it.windup))
          }
          break
        }
        case 'pillar':
          u.uAlpha.value = smooth(0, 0.18, k) * (1 - smooth(0.45, 1, k))
          u.uH.value = it.height * (0.55 + 0.45 * (1 - Math.pow(1 - k, 3)))
          u.uRad.value = it.radius * (1 + 0.3 * k)
          u.uAge.value += dt
          break
      }
    }
  }
}
