import * as THREE from 'three'
import { uploadTextures } from '../core/prewarm.js'
import { LOW_TIER } from '../core/tier.js'
import { stream } from '../core/rng.js'
import { fetchJson } from '../core/fetch.js'
import { compileFor } from '../core/compile.js'
import { removeAt } from '../core/list.js'
import { markRange } from './buffer-range.js'

const random = stream('fx')

const BASE = 'assets/vfx/'
const LUT = 48
const STEP_SLOPE = 1e7
const GRAVITY = 9.81
const pending = new Set()
const loader = new THREE.TextureLoader()
const textureCache = new Map()
let maxAnisotropy = 8
const libraries = new Map()
const time = { value: 0 }

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _qa = new THREE.Quaternion()
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()
const _v3 = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _side = new THREE.Vector3()
const _scale = new THREE.Vector3()
const _center = new THREE.Vector3()
const _pivot = new THREE.Vector3()
const _nodePos = new THREE.Vector3()
const _nodeQuat = new THREE.Quaternion()
const _nodeScale = new THREE.Vector3()
const _camPos = new THREE.Vector3()
const _camQuat = new THREE.Quaternion()
const _camQuatInv = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)
const _flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
const _col = [1, 1, 1, 1]
const _col2 = [1, 1, 1, 1]
const _basis = new THREE.Matrix4()
const _euler = new THREE.Euler()
const _trailPos = new THREE.Vector3()
const _birthPos = new THREE.Vector3()
const _follow = { camera: null }
const triggerPool = []
const pointPool = []
const trailPool = []
const WHITE4 = [1, 1, 1, 1]
const EMITTER_FIELDS = [['pos', 3], ['vel', 3], ['age', 1], ['life', 1], ['size', 3], ['rot', 3], ['col', 4], ['rnd', 4], ['frame', 1], ['pid', 1], ['birthAcc', 1]]

const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
WHITE.needsUpdate = true

const STREAM_SIZE = {
  4: 2, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1, 10: 3, 11: 1, 12: 1, 13: 2, 14: 3, 15: 1, 16: 3, 17: 1, 18: 3, 19: 3, 20: 1,
  21: 1, 22: 1, 23: 1, 24: 2, 25: 3, 26: 4, 27: 1, 28: 2, 29: 3, 30: 4, 31: 1, 32: 2, 33: 3, 34: 4, 35: 1, 36: 2,
  37: 3, 38: 4, 39: 1, 40: 2, 41: 3, 42: 1, 43: 2, 44: 3, 45: 1, 46: 1, 47: 2,
}

function hermite(keys, t) {
  const n = keys.length
  if (!n) return 0
  if (t <= keys[0][0]) return keys[0][1]
  if (t >= keys[n - 1][0]) return keys[n - 1][1]
  let i = 1
  while (i < n - 1 && keys[i][0] < t) i++
  const a = keys[i - 1]
  const b = keys[i]
  const dt = b[0] - a[0]
  if (dt <= 1e-6) return b[1]
  if (Math.abs(a[3]) >= STEP_SLOPE || Math.abs(b[2]) >= STEP_SLOPE) return a[1]
  const s = (t - a[0]) / dt
  const s2 = s * s
  const s3 = s2 * s
  return (2 * s3 - 3 * s2 + 1) * a[1] + (s3 - 2 * s2 + s) * dt * a[3] + (-2 * s3 + 3 * s2) * b[1] + (s3 - s2) * dt * b[2]
}

function bake(keys) {
  const out = new Float32Array(LUT + 1)
  for (let i = 0; i <= LUT; i++) out[i] = hermite(keys, i / LUT)
  return out
}

function sampleLut(lut, t) {
  const x = (t < 0 ? 0 : t > 1 ? 1 : t) * LUT
  const i = x | 0
  if (i >= LUT) return lut[LUT]
  return lut[i] + (lut[i + 1] - lut[i]) * (x - i)
}

class Curve {
  constructor(d, fallback = 0) {
    this.m = d ? d.m : 0
    this.s = d ? d.s : fallback
    this.n = d && d.n !== undefined ? d.n : this.s
    this.hi = d && d.c && d.c.length ? bake(d.c) : null
    this.lo = d && d.d && d.d.length ? bake(d.d) : null
  }

  get(t, r) {
    switch (this.m) {
      case 1:
        return this.hi ? sampleLut(this.hi, t) * this.s : this.s
      case 2: {
        const hi = this.hi ? sampleLut(this.hi, t) : 1
        const lo = this.lo ? sampleLut(this.lo, t) : hi
        return (lo + (hi - lo) * r) * this.s
      }
      case 3:
        return this.n + (this.s - this.n) * r
      default:
        return this.s
    }
  }

  peak() {
    const hi = this.hi ? Math.max(...this.hi) : 1
    const lo = this.lo ? Math.max(...this.lo) : 1
    if (this.m === 1) return hi * this.s
    if (this.m === 2) return Math.max(hi, lo) * this.s
    if (this.m === 3) return Math.max(this.n, this.s)
    return this.s
  }
}

function sampleKeys(keys, t, width, out, offset, fixed) {
  const n = keys.length
  if (!n) return
  if (n === 1 || t <= keys[0][0]) {
    for (let k = 0; k < width; k++) out[offset + k] = keys[0][1 + k]
    return
  }
  if (t >= keys[n - 1][0]) {
    for (let k = 0; k < width; k++) out[offset + k] = keys[n - 1][1 + k]
    return
  }
  let i = 1
  while (i < n - 1 && keys[i][0] < t) i++
  const a = keys[i - 1]
  const b = keys[i]
  if (fixed) {
    for (let k = 0; k < width; k++) out[offset + k] = b[1 + k]
    return
  }
  const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0])
  for (let k = 0; k < width; k++) out[offset + k] = a[1 + k] + (b[1 + k] - a[1 + k]) * f
}

class Gradient {
  constructor(g) {
    this.c = g.c || []
    this.a = g.a || []
    this.fixed = g.f === 1
  }

  get(t, out) {
    sampleKeys(this.c, t, 3, out, 0, this.fixed)
    sampleKeys(this.a, t, 1, out, 3, this.fixed)
    return out
  }
}

class ColorSource {
  constructor(d) {
    this.m = d ? d.m : 0
    this.x = d && d.x ? d.x : [1, 1, 1, 1]
    this.n = d && d.n ? d.n : this.x
    this.g = d && d.g ? new Gradient(d.g) : null
    this.h = d && d.h ? new Gradient(d.h) : null
  }

  get(t, r, out) {
    switch (this.m) {
      case 1:
        return this.g ? this.g.get(t, out) : copy4(this.x, out)
      case 2:
        for (let k = 0; k < 4; k++) out[k] = this.n[k] + (this.x[k] - this.n[k]) * r
        return out
      case 3: {
        this.g.get(t, out)
        if (!this.h) return out
        this.h.get(t, _col2)
        for (let k = 0; k < 4; k++) out[k] = _col2[k] + (out[k] - _col2[k]) * r
        return out
      }
      case 4:
        return this.g ? this.g.get(r, out) : copy4(this.x, out)
      default:
        return copy4(this.x, out)
    }
  }
}

function copy4(src, out, at = 0) {
  out[0] = src[at]
  out[1] = src[at + 1]
  out[2] = src[at + 2]
  out[3] = src[at + 3]
  return out
}

function takeTrigger(n) {
  const trig = triggerPool.pop() || { p: new THREE.Vector3(), n: 0 }
  trig.n = n
  return trig
}

function takePoint(p) {
  const pt = pointPool.pop() || { p: new THREE.Vector3(), age: 0 }
  pt.p.copy(p)
  pt.age = 0
  return pt
}

function releasePoints(pts) {
  for (let i = 0; i < pts.length; i++) pointPool.push(pts[i])
  pts.length = 0
}

function takeTrail(id, life) {
  const tr = trailPool.pop() || { id: 0, pts: [], dead: false, life: 0, col: [1, 1, 1, 1], w: 1, seen: 0 }
  tr.id = id
  tr.dead = false
  tr.life = life
  tr.col.fill(1)
  tr.w = 1
  return tr
}

function moveSlot(arr, width, from, to) {
  for (let k = 0; k < width; k++) arr[to * width + k] = arr[from * width + k]
}

function unityEulerQuat(x, y, z, out) {
  const cx = Math.cos(x / 2), sx = Math.sin(x / 2)
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2)
  const cz = Math.cos(z / 2), sz = Math.sin(z / 2)
  const yx = cy * sx, yy = sy * cx, yz = -sy * sx, yw = cy * cx
  const qx = yx * cz + yy * sz
  const qy = yy * cz - yx * sz
  const qz = yw * sz + yz * cz
  const qw = yw * cz - yz * sz
  return out.set(-qx, -qy, qz, qw)
}

const STATIC_MASK_VS = `
  uniform vec4 uPMD;
  uniform vec4 uSMP;
  uniform vec4 uMMP;
  float ss(float x) { return x * x * (3.0 - 2.0 * x); }
  float staticMask(vec2 uv0) {
    float mask = 1.0;
    #if defined(MASK_STATIC_GRADIENT) || defined(MASK_STATIC_GRADIENT_EDGE)
      vec4 q = uv0.xyxy * uPMD.yxxy;
      float e = max(q.y, q.x);
      float c = max(q.w, q.z);
      #ifdef MASK_STATIC_GRADIENT
        float a0 = clamp((0.5 - c) * uSMP.z * 2.8 + uSMP.x + 1.5, 0.0, 1.0);
        float b0 = clamp((c - 0.5) * uSMP.w * 2.8 + uSMP.y + 1.5, 0.0, 1.0);
        float sa = ss(a0);
        float sb = ss(b0);
        mask = min(sa * sa * sb * sb, 1.0);
      #endif
      #ifdef MASK_STATIC_GRADIENT_EDGE
        mask *= min(ss(clamp(e * uMMP.x, 0.0, 1.0)) * ss(clamp((1.0 - e) * uMMP.x, 0.0, 1.0)), 1.0);
      #endif
    #endif
    return mask;
  }
`

const SHARED_VS = `
  attribute vec4 iCol;
  attribute vec4 iUv;
  attribute vec4 iCust;
  attribute vec4 vcol;
  uniform float uTime;
  uniform vec4 uMainTS;
  uniform vec2 uUvOff;
  uniform vec4 uFMMP;
  uniform vec4 uAMDS;
  varying vec2 vUv;
  varying vec2 vUv0;
  varying vec4 vColor;
  varying vec4 vCustom;
  varying float vFres;
  ${STATIC_MASK_VS}
  void main() {
    vec4 local = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      local = instanceMatrix * local;
    #endif
    vec4 wp = modelMatrix * local;
    vec2 uv0 = uv * iUv.xy + iUv.zw;
    vUv0 = uv0;
    vColor = iCol * vcol;
    vCustom = iCust;
    #ifdef MAINTEX
      vUv = uv0 * uMainTS.xy + uTime * uMainTS.zw + uUvOff;
      vColor.a *= staticMask(uv0);
    #else
      vUv = uv0;
    #endif
    vFres = 0.0;
    #ifdef FRESNEL
      mat3 nm = mat3(modelMatrix);
      #ifdef USE_INSTANCING
        nm = nm * mat3(instanceMatrix);
      #endif
      vec3 n = normalize(nm * normal);
      vec3 v = normalize(cameraPosition - wp.xyz);
      float f = pow(max(1.0 - abs(dot(n, v)), 0.0), max(uFMMP.x, 6.1e-5));
      f = clamp(uAMDS.w * f + uAMDS.z, 0.0, 1.0);
      vFres = mix(f, 1.0 - f, uFMMP.y);
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const MAGIC_FS = `
  uniform sampler2D uMain;
  uniform sampler2D uMask;
  uniform sampler2D uDist;
  uniform sampler2D uDiss;
  uniform sampler2D uDissGrad;
  uniform sampler2D uColGrad;
  uniform sampler2D uMulGrad;
  uniform float uTime;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform float uMixPow;
  uniform float uAlphaPow;
  uniform float uAlphaMult;
  uniform float uUseAlpha;
  uniform float uColGradRange;
  uniform float uMulGradRange;
  uniform vec4 uMainTS;
  uniform vec4 uCDDir;
  uniform vec4 uMainMul;
  uniform vec4 uPMD;
  uniform vec4 uSMP;
  uniform vec4 uEDMP;
  uniform vec4 uDRIP;
  uniform vec4 uGDMP;
  uniform vec4 uDistTS;
  uniform vec4 uMaskTS;
  uniform vec4 uMMP;
  uniform vec4 uDDMP;
  uniform vec4 uDissTS;
  uniform vec4 uDissGradTS;
  uniform vec4 uFresCol;
  uniform vec4 uFMMP;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec4 vCustom;
  varying float vFres;
  float ss(float x) { return x * x * (3.0 - 2.0 * x); }
  void main() {
    vec2 uv = vUv;
    vec2 dOff = vec2(0.0);
    vec2 dissUv = uv;
    #ifdef DISTORTION
      float dn = texture2D(uDist, uv * uDistTS.xy + uTime * uDistTS.zw).x - 0.5;
      #ifdef DISTORTION_CUSTOM_DATA
        float ds = vCustom.y * 2.0;
      #else
        float ds = uDDMP.x * 2.0;
      #endif
      vec2 dv = ds * uGDMP.zw;
      #ifdef DISTORTION_TO_DISSOLVE
        dissUv = dn * dv + uv;
      #endif
      dOff = dv * dn;
    #endif
    float dAmt = 1.0;
    #ifdef DISSOLVE
      float d = texture2D(uDiss, dissUv * uDissTS.xy + uTime * uDissTS.zw).x;
      d = mix(d, 1.0 - d, uDRIP.z);
      #ifdef DISSOLVE_TEX_GRADIENT
        float g = texture2D(uDissGrad, uv * uDissGradTS.xy + uTime * uDissGradTS.zw).x;
        d += clamp(2.0 * (0.45 - g), 0.0, 1.0) - 0.9 * g;
      #endif
      float amt = uDRIP.x * vCustom.z + uDRIP.y * (vColor.a * 3.0 - 2.0);
      dAmt = clamp(pow(max(d + amt, 0.0), max(uEDMP.w, 6.1e-5)) * uEDMP.z, 0.0, 1.0);
    #endif
    vec2 muv = (uv + dOff * uMainMul.x) * uMainTS.xy + vCustom.w * uCDDir.xy + uTime * uMainTS.zw;
    vec4 mt = texture2D(uMain, muv);
    float mv = clamp(uUseAlpha > 0.0 ? mt.a : mt.r, 0.0, 1.0);
    #ifdef EROSION
      mv = mv - (1.0 - clamp(vCustom.z + uEDMP.y, 0.0, 1.0));
    #endif
    float alpha = clamp(pow(max(dAmt * mv, 0.0), max(uAlphaPow, 6.1e-5)) * uAlphaMult, 0.0, 1.0);
    float mask = 1.0;
    #ifdef MASK_TEX
      vec2 kuv = (uv + dOff * uDDMP.y) * uMaskTS.xy + vCustom.x * uMMP.zw + uTime * uMaskTS.zw;
      mask = clamp(texture2D(uMask, kuv).x * uMMP.y, 0.0, 1.0);
    #endif
    #if defined(MASK_STATIC_GRADIENT) || defined(MASK_STATIC_GRADIENT_EDGE)
      vec4 q = uv.xyxy * uPMD.yxxy;
      float e = max(q.y, q.x);
      float c = max(q.w, q.z);
      float sm = 1.0;
      #ifdef MASK_STATIC_GRADIENT
        float a0 = clamp((0.5 - c) * uSMP.z * 2.8 + uSMP.x + 1.5, 0.0, 1.0);
        float b0 = clamp((c - 0.5) * uSMP.w * 2.8 + uSMP.y + 1.5, 0.0, 1.0);
        float sa = ss(a0);
        float sb = ss(b0);
        sm = min(sa * sa * sb * sb, 1.0);
      #endif
      #ifdef MASK_STATIC_GRADIENT_EDGE
        sm *= min(ss(clamp(e * uMMP.x, 0.0, 1.0)) * ss(clamp((1.0 - e) * uMMP.x, 0.0, 1.0)), 1.0);
      #endif
      mask *= sm;
    #endif
    alpha *= mask * vColor.a;
    #ifdef FRESNEL
      alpha *= max(vFres, uFMMP.z);
    #endif
    vec3 col;
    #ifdef COLOR_GRADIENT
      col = texture2D(uColGrad, vec2(pow(max(mt.r, 0.0), max(uMixPow, 6.1e-5)), 0.5)).rgb * uColGradRange;
    #else
      col = uUseAlpha > 0.0 ? mt.rgb * uC0 : mix(uC0, uC1, pow(max(mt.r, 0.0), max(uMixPow, 6.1e-5)));
    #endif
    col *= vColor.rgb;
    #ifdef MULTIPLY_GRADIENT
      col *= texture2D(uMulGrad, vec2(dot(uGDMP.xy, uv), 0.5)).rgb * uMulGradRange;
    #endif
    #ifdef FRESNEL
      col = mix(col, uFresCol.rgb, min(vFres, uFMMP.w));
    #endif
    #ifdef FOCUS
      vec3 hot = 1.0 - exp(-col * alpha);
      if (max(hot.r, max(hot.g, hot.b)) < FOCUS_CUT) discard;
      gl_FragColor = vec4(hot, alpha);
    #else
      gl_FragColor = vec4(col * alpha, alpha);
    #endif
  }
`

const MAINTEX_FS = `
  uniform sampler2D uMain;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform float uAlphaPow;
  uniform float uAlphaMult;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMain, vUv);
    vec3 col;
    float a;
    #if defined(USE_ALPHA) && defined(USE_ALPHA_POW)
      col = t.rgb * vColor.rgb * uC0;
      a = clamp(pow(max(t.a, 0.0), max(uAlphaPow, 6.1e-5)) * uAlphaMult, 0.0, 1.0) * vColor.a;
    #elif defined(USE_ALPHA)
      col = t.rgb * vColor.rgb * uC0;
      a = clamp(t.a * uAlphaMult, 0.0, 1.0) * vColor.a;
    #elif defined(USE_ALPHA_POW)
      col = mix(uC0, uC1, t.r) * vColor.rgb;
      a = clamp(pow(max(t.r, 0.0), max(uAlphaPow, 6.1e-5)) * uAlphaMult, 0.0, 1.0) * vColor.a;
    #else
      col = mix(uC0, uC1, t.r) * vColor.rgb;
      a = clamp(t.r * uAlphaMult, 0.0, 1.0) * vColor.a;
    #endif
    #ifdef FOCUS
      vec3 hot = 1.0 - exp(-col * a);
      if (max(hot.r, max(hot.g, hot.b)) < FOCUS_CUT) discard;
      gl_FragColor = vec4(hot, a);
    #else
      gl_FragColor = vec4(col * a, a);
    #endif
  }
`

const SKINNED_MAINTEX_VS = `
  #include <common>
  #include <skinning_pars_vertex>
  uniform float uTime;
  uniform vec4 uMainTS;
  uniform vec2 uUvOff;
  varying vec2 vUv;
  varying vec4 vColor;
  ${STATIC_MASK_VS}
  void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec2 uv0 = vec2(uv.x, 1.0 - uv.y);
    vColor = vec4(1.0);
    #ifdef USE_COLOR_ALPHA
      vColor = color;
    #endif
    vColor.a *= staticMask(uv0);
    vUv = uv0 * uMainTS.xy + uTime * uMainTS.zw + uUvOff;
    vUv.y = 1.0 - vUv.y;
    #include <project_vertex>
  }
`

const UNLIT_FS = `
  uniform sampler2D uMain;
  uniform vec3 uC0;
  uniform float uAlphaMult;
  varying vec2 vUv;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMain, vUv);
    gl_FragColor = vec4(t.rgb * uC0 * vColor.rgb, t.a * uAlphaMult * vColor.a);
  }
`

const MAGIC_KEYWORDS = new Set([
  'DISSOLVE', 'DISSOLVE_TEX_GRADIENT', 'DISTORTION', 'DISTORTION_CUSTOM_DATA', 'DISTORTION_TO_DISSOLVE', 'MASK_STATIC_GRADIENT',
  'MASK_STATIC_GRADIENT_EDGE', 'MASK_TEX', 'COLOR_GRADIENT', 'MULTIPLY_GRADIENT', 'EROSION', 'FRESNEL',
])
const MAINTEX_KEYWORDS = new Set(['USE_ALPHA', 'USE_ALPHA_POW', 'MASK_STATIC_GRADIENT', 'MASK_STATIC_GRADIENT_EDGE'])

function vec4(m, key, fallback) {
  const v = m.v[key] || fallback
  return new THREE.Vector4(v[0], v[1], v[2], v[3])
}

function vec3(m, key, fallback) {
  const v = m.v[key] || fallback
  return new THREE.Vector3(v[0], v[1], v[2])
}

function num(m, key, fallback) {
  return m.f[key] !== undefined ? m.f[key] : fallback
}

class Library {
  constructor(data) {
    this.data = data
    this.id = data.id
    this.prefabs = data.prefabs
    this.skills = data.skills || {}
    this.sockets = data.sockets || {}
    this.lobbySockets = data.lobbySockets || null
    this.geometries = new Map()
    this.materials = new Map()
    this.compiled = new Map()
  }

  has(name) {
    return !!this.prefabs[name]
  }

  texture(name) {
    const t = this.data.textures[name]
    if (!t) return WHITE
    const key = t.f
    if (!textureCache.has(key)) {
      const tex = loader.load(BASE + t.f, () => pending.delete(key), undefined, () => pending.delete(key))
      pending.add(key)
      tex.colorSpace = t.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      const wrap = w => (w === 0 ? THREE.RepeatWrapping : w === 2 ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping)
      tex.wrapS = wrap(t.wrap ? t.wrap[0] : 0)
      tex.wrapT = wrap(t.wrap ? t.wrap[1] : 0)
      tex.anisotropy = maxAnisotropy
      tex.generateMipmaps = t.mips !== 0
      tex.minFilter = t.mips !== 0 ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      textureCache.set(key, tex)
    }
    return textureCache.get(key)
  }

  tex(m, key) {
    const e = m.t[key]
    return e ? this.texture(e[0]) : WHITE
  }

  geometry(name) {
    if (!name) return quadGeometry()
    if (this.geometries.has(name)) return this.geometries.get(name)
    const d = this.data.meshes[name]
    if (!d) return quadGeometry()
    const g = new THREE.BufferGeometry()
    const n = d.p.length / 3
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.p, 3))
    g.setAttribute('normal', d.n ? new THREE.Float32BufferAttribute(d.n, 3) : new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(0), 3))
    g.setAttribute('uv', d.u ? new THREE.Float32BufferAttribute(d.u, 2) : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
    const c = new Float32Array(n * 4).fill(1)
    if (d.c) c.set(d.c.slice(0, n * 4))
    g.setAttribute('vcol', new THREE.Float32BufferAttribute(c, 4))
    g.setIndex(d.i)
    this.geometries.set(name, g)
    return g
  }

  material(name) {
    if (!name) return null
    if (this.materials.has(name)) return this.materials.get(name)
    const m = this.data.materials[name]
    const mat = m ? buildMaterial(this, m) : null
    this.materials.set(name, mat)
    return mat
  }

  prefab(name) {
    if (!this.compiled.has(name)) this.compiled.set(name, compilePrefab(this, this.prefabs[name] || []))
    return this.compiled.get(name)
  }

  materialsInUse() {
    return [...this.materials.values()].filter(Boolean)
  }
}

let _quad = null
function quadGeometry() {
  if (_quad) return _quad
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  g.setAttribute('vcol', new THREE.Float32BufferAttribute(new Float32Array(16).fill(1), 4))
  g.setIndex([0, 1, 2, 0, 2, 3])
  _quad = g
  return g
}

function stretchGeometry() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([1, 0, 0, 0, 0, 1, 1, 1], 2))
  g.setAttribute('vcol', new THREE.Float32BufferAttribute(new Float32Array(16).fill(1), 4))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
}
const STRETCH_GEO = stretchGeometry()

function buildMaterial(lib, m) {
  const sh = m.sh || ''
  const defines = {}
  let fs
  let blend
  if (sh === 'VFX/VFX_Magic' || sh === 'VFX/VFX_AGM') {
    for (const k of m.kw) if (MAGIC_KEYWORDS.has(k)) defines[k] = ''
    fs = MAGIC_FS
    blend = 'premultiplied'
  } else if (sh === 'VFX/VFX_Magic_MainTexture') {
    for (const k of m.kw) if (MAINTEX_KEYWORDS.has(k)) defines[k] = ''
    defines.MAINTEX = ''
    fs = MAINTEX_FS
    blend = 'premultiplied'
  } else if (/Particles\/Unlit|Unlit/.test(sh)) {
    fs = UNLIT_FS
    blend = 'alpha'
  } else {
    return null
  }
  const uniforms = {
    uTime: time,
    uMain: { value: lib.tex(m, '_MainTex') },
    uMask: { value: lib.tex(m, '_MaskTex') },
    uDist: { value: lib.tex(m, '_DistortionTex') },
    uDiss: { value: lib.tex(m, '_DissolveTex') },
    uDissGrad: { value: lib.tex(m, '_DissolveTexGradient') },
    uColGrad: { value: lib.tex(m, '_ColorGradientTex') },
    uMulGrad: { value: lib.tex(m, '_MultiplyGradientTex') },
    uC0: { value: vec3(m, '_MainColor0', m.v._BaseColor || [1, 1, 1, 1]) },
    uC1: { value: vec3(m, '_MainColor1', [1, 1, 1, 1]) },
    uMixPow: { value: num(m, '_MainColorMixPower', 1) },
    uAlphaPow: { value: num(m, '_MainAlphaPower', 1) },
    uAlphaMult: { value: num(m, '_MainAlphaMult', 1) },
    uUseAlpha: { value: num(m, '_ToggleUseAlpha', 0) },
    uColGradRange: { value: num(m, '_ColorGradTexRange', 1) },
    uMulGradRange: { value: num(m, '_MultiplyGradTexRange', 1) },
    uMainTS: { value: vec4(m, '_MainTexTilingSpeed', [1, 1, 0, 0]) },
    uUvOff: { value: new THREE.Vector2(...(m.v._DistortionDepthMixedParams || [0, 0]).slice(0, 2)) },
    uCDDir: { value: vec4(m, '_CustomData1Directions', [0, 1, 0, 1]) },
    uMainMul: { value: vec4(m, '_MainTexMultipliers', [1, 1, 1, 1]) },
    uPMD: { value: vec4(m, '_ProceduralMasksDirections', [0, 1, 0, 1]) },
    uSMP: { value: vec4(m, '_StaticMaskParams', [0, 0, 1, 1]) },
    uEDMP: { value: vec4(m, '_ErosionDissolveMixedParams', [1, 1, 1, 1]) },
    uDRIP: { value: vec4(m, '_DissolveRemapInvertParams', [0, 0, 0, 0]) },
    uGDMP: { value: vec4(m, '_GradientDistortionMixedParams', [0, 1, 1, 1]) },
    uDistTS: { value: vec4(m, '_DistortionTileSpeed', [1, 1, 0, 0]) },
    uMaskTS: { value: vec4(m, '_MaskTexTilingSpeed', [1, 1, 0, 0]) },
    uMMP: { value: vec4(m, '_MaskMixedParams', [22, 3, 0, 1]) },
    uDDMP: { value: vec4(m, '_DistortionDepthMixedParams', [0.11, 0, 0.5, 1]) },
    uDissTS: { value: vec4(m, '_DissolveTexTilingSpeed', [1, 1, 0, 0]) },
    uDissGradTS: { value: vec4(m, '_DissolveTexGradTilingSpeed', [1, 1, 0, 0]) },
    uFresCol: { value: vec4(m, '_FresnelCol', [1, 1, 1, 1]) },
    uFMMP: { value: vec4(m, '_FresnelModeMixedParams', [1, 0, 1, 0]) },
    uAMDS: { value: vec4(m, '_AnimMaskDoubleSideMixedParams', [1, 0, 0, 1]) },
  }
  if (defines.MAINTEX !== undefined) uniforms.uUvOff.value.set(...(m.v._DistortionDepthMixedParams || [0, 0]).slice(0, 2))
  else uniforms.uUvOff.value.set(0, 0)
  const cull = num(m, '_Cull', 0)
  const mat = new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: SHARED_VS,
    fragmentShader: fs,
    transparent: true,
    depthWrite: false,
    depthTest: !(num(m, '_ZTestAlwaysToggle', 0) > 0.5 || num(m, '_ZTest', 4) === 8),
    side: cull === 0 ? THREE.DoubleSide : cull === 1 ? THREE.BackSide : THREE.FrontSide,
    fog: false,
  })
  if (blend === 'premultiplied') {
    premultiply(mat)
  } else {
    mat.blending = THREE.CustomBlending
    mat.blendSrc = THREE.SrcAlphaFactor
    mat.blendDst = THREE.OneMinusSrcAlphaFactor
    mat.blendSrcAlpha = THREE.OneFactor
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  }
  mat.name = m.sh
  return mat
}

function premultiply(mat) {
  mat.blending = THREE.CustomBlending
  mat.blendSrc = THREE.OneFactor
  mat.blendDst = THREE.OneMinusSrcAlphaFactor
  mat.blendSrcAlpha = THREE.OneFactor
  mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
}

const FOCUS_CUT = 0.03
const focusMaterials = new WeakMap()

function focusMaterial(mat) {
  if (!mat || !mat.fragmentShader || !mat.fragmentShader.includes('FOCUS')) return mat
  let focused = focusMaterials.get(mat)
  if (!focused) {
    focused = mat.clone()
    focused.uniforms = mat.uniforms
    focused.defines = { ...mat.defines, FOCUS: '', FOCUS_CUT: FOCUS_CUT.toFixed(3) }
    focused.depthWrite = true
    focusMaterials.set(mat, focused)
  }
  return focused
}

export function meshVfxMaterial(m, map) {
  if (m.sh !== 'VFX/VFX_Magic_MainTexture' || !map) return null
  const defines = {}
  for (const k of m.kw) if (MAINTEX_KEYWORDS.has(k)) defines[k] = ''
  map.colorSpace = m.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  map.needsUpdate = true
  const cull = num(m, '_Cull', 2)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uMain: { value: map },
      uC0: { value: vec3(m, '_MainColor0', m.v._BaseColor || [1, 1, 1, 1]) },
      uC1: { value: vec3(m, '_MainColor1', [1, 1, 1, 1]) },
      uAlphaPow: { value: num(m, '_MainAlphaPower', 1) },
      uAlphaMult: { value: num(m, '_MainAlphaMult', 1) },
      uMainTS: { value: vec4(m, '_MainTexTilingSpeed', [1, 1, 0, 0]) },
      uUvOff: { value: new THREE.Vector2(...(m.v._DistortionDepthMixedParams || [0, 0]).slice(0, 2)) },
      uPMD: { value: vec4(m, '_ProceduralMasksDirections', [0, 1, 0, 1]) },
      uSMP: { value: vec4(m, '_StaticMaskParams', [0, 0, 1, 1]) },
      uMMP: { value: vec4(m, '_MaskMixedParams', [22, 3, 0, 1]) },
    },
    defines,
    vertexShader: SKINNED_MAINTEX_VS,
    fragmentShader: MAINTEX_FS,
    transparent: true,
    depthWrite: false,
    vertexColors: true,
    side: cull === 0 ? THREE.DoubleSide : cull === 1 ? THREE.BackSide : THREE.FrontSide,
    fog: false,
  })
  premultiply(mat)
  mat.name = m.sh
  mat.userData.fx = 'vfx'
  return mat
}

function streamSlots(streams) {
  const slots = []
  let pos = 0
  for (const s of streams) {
    if (s <= 3) continue
    const n = STREAM_SIZE[s] || 1
    for (let k = 0; k < n; k++) {
      if (pos >= 4 && pos < 8) slots[pos - 4] = [s, k]
      pos++
    }
  }
  for (let i = 0; i < 4; i++) if (!slots[i]) slots[i] = null
  return slots
}

class SystemDef {
  constructor(lib, ps) {
    this.lib = lib
    this.dur = Math.max(0.01, ps.dur || 1)
    this.loop = !!ps.loop
    this.prewarm = !!ps.prewarm
    this.delay = new Curve(ps.delay)
    this.simSpeed = ps.speed || 1
    this.world = ps.space === 1
    this.scaling = ps.scaling === undefined ? 1 : ps.scaling
    this.life = new Curve(ps.life, 1)
    this.spd = new Curve(ps.spd, 5)
    this.size = ps.size3 ? ps.size3.map(c => new Curve(c, 1)) : [new Curve(ps.size, 1)]
    this.rot = ps.rot3 ? ps.rot3.map(c => new Curve(c)) : [null, null, new Curve(ps.rot)]
    this.rot3d = !!ps.rot3
    this.flipRot = ps.flipRot || 0
    this.col = new ColorSource(ps.col)
    this.grav = new Curve(ps.grav)
    this.hasGrav = !(ps.grav && ps.grav.m === 0 && ps.grav.s === 0)
    this.rate = ps.rate ? new Curve(ps.rate) : null
    this.rateDist = ps.rateDist && !(ps.rateDist.m === 0 && ps.rateDist.s === 0) ? new Curve(ps.rateDist) : null
    this.bursts = (ps.bursts || []).map(b => ({ t: b.t, n: new Curve(b.n), cyc: b.cyc, rep: Math.max(0.01, b.rep || 0.01), p: b.p === undefined ? 1 : b.p }))
    this.shape = ps.shape || null
    if (this.shape) {
      const s = this.shape
      this.shapeQuat = new THREE.Quaternion(s.rot[0], s.rot[1], s.rot[2], s.rot[3])
      this.shapePos = new THREE.Vector3(s.pos[0], s.pos[1], s.pos[2])
      this.shapeScale = new THREE.Vector3(s.scale[0], s.scale[1], s.scale[2])
      if (s.mesh) this.shapeMesh = lib.data.meshes[s.mesh] || null
    }
    const v = ps.vel
    if (v) {
      this.vel = {
        x: new Curve(v.x), y: new Curve(v.y), z: new Curve(v.z), world: !!v.world,
        ox: v.orbitalX ? new Curve(v.orbitalX) : null, oy: v.orbitalY ? new Curve(v.orbitalY) : null, oz: v.orbitalZ ? new Curve(v.orbitalZ) : null,
        radial: v.radial ? new Curve(v.radial) : null,
        mod: new Curve(v.mod, 1),
      }
    }
    if (ps.limit) this.limit = { mag: new Curve(ps.limit.mag, 1), damp: ps.limit.damp, drag: new Curve(ps.limit.drag) }
    if (ps.force) this.force = { x: new Curve(ps.force.x), y: new Curve(ps.force.y), z: new Curve(ps.force.z), world: !!ps.force.world }
    this.colLife = ps.colLife ? new ColorSource(ps.colLife) : null
    this.sizeLife = ps.sizeLife ? ps.sizeLife.map(c => new Curve(c, 1)) : null
    this.rotLife = ps.rotLife ? ps.rotLife.map(c => new Curve(c)) : null
    if (ps.sheet) {
      const s = ps.sheet
      this.sheet = { x: Math.max(1, s.x), y: Math.max(1, s.y), type: s.type, row: s.row, rowMode: s.rowMode, frame: new Curve(s.frame), start: new Curve(s.start), cyc: s.cyc || 1 }
    }
    if (ps.noise) this.noise = { str: new Curve(ps.noise.str), freq: ps.noise.freq || 1, scroll: new Curve(ps.noise.scroll), pos: new Curve(ps.noise.pos, 1) }
    if (ps.custom) {
      this.custom = ps.custom.map(c => {
        if (c.mode === 1) return { mode: 1, v: c.v.map(x => new Curve(x)) }
        if (c.mode === 2) return { mode: 2, col: new ColorSource(c.col) }
        return { mode: 0 }
      })
    }
    this.subs = ps.subs || null
    this.birthSubs = this.subs ? this.subs.filter(x => x.type === 0) : []
    this.deathSubs = this.subs ? this.subs.filter(x => x.type === 2) : []
    if (ps.trail) {
      const t = ps.trail
      this.trail = {
        life: new Curve(t.life, 1),
        minDist: t.minDist || 0.2,
        die: !!t.die,
        sizeW: !!t.sizeW,
        inheritCol: !!t.inheritCol,
        colLife: new ColorSource(t.colLife),
        width: new Curve(t.width, 1),
        colTrail: new ColorSource(t.colTrail),
        tex: t.tex || 0,
        world: !!t.world,
      }
    }
    const r = ps.r || { mode: 0, align: 0, len: 2, vel: 0, order: 0, streams: [0, 1, 3, 4], on: 1 }
    this.render = r
    this.mode = r.mode
    this.align = r.align || 0
    this.lenScale = r.len === undefined ? 2 : r.len
    this.velScale = r.vel || 0
    this.order = r.order || 0
    this.pivot = r.pivot ? new THREE.Vector3(r.pivot[0], r.pivot[1], r.pivot[2]) : null
    if (this.pivot && this.pivot.lengthSq() === 0) this.pivot = null
    this.flip = r.flip || [0, 0, 0]
    this.slots = streamSlots(r.streams || [0, 1, 3, 4])
    this.material = r.on === 0 || r.mode === 5 ? null : lib.material(r.mat)
    this.trailMaterial = this.trail ? lib.material(r.trailMat || r.mat) : null
    if (this.material && !(this.material.defines.MAINTEX !== undefined) && !(lib.data.materials[r.mat] || { kw: [] }).kw.includes('ENABLE_CUSTOMDATA')) this.slots = [null, null, null, null]
    this.geometry = this.mode === 1 ? STRETCH_GEO : this.mode === 4 ? lib.geometry((r.meshes || [])[0]) : quadGeometry()
    this.capacity = this.estimateCapacity(ps.max || 100)
  }

  estimateCapacity(max) {
    const life = this.life.peak()
    let n = 0
    if (this.rate) n += this.rate.peak() * Math.min(life, this.loop ? life : this.dur + life) * 1.25
    if (this.rateDist) n += this.rateDist.peak() * life * 12
    for (const b of this.bursts) {
      const cycles = b.cyc === 0 ? Math.ceil(life / b.rep) + 1 : Math.min(b.cyc, Math.ceil(life / b.rep) + 1)
      n += b.n.peak() * cycles
    }
    return Math.max(1, Math.min(max, Math.ceil(n) + 2))
  }
}

function compilePrefab(lib, nodes) {
  const out = nodes.map(n => ({ n, def: null }))
  const off = new Array(nodes.length).fill(false)
  nodes.forEach((n, i) => {
    off[i] = !!n.off || (n.p >= 0 && off[n.p])
  })
  const subNodes = new Set()
  nodes.forEach(n => {
    if (n.ps && n.ps.subs) for (const s of n.ps.subs) if (s.node >= 0) subNodes.add(s.node)
  })
  nodes.forEach((n, i) => {
    out[i].off = off[i]
    out[i].sub = subNodes.has(i)
    if (n.ps && !off[i]) out[i].def = new SystemDef(lib, n.ps)
  })
  return out
}

function sampleShape(def, pos, dir) {
  const s = def.shape
  if (!s) {
    pos.set(0, 0, 0)
    dir.set(0, 0, 1)
    finishShape(def, pos, dir, true)
    return
  }
  const R = s.radius
  const thick = s.thick
  const radial = () => R * (1 - thick * random())
  const arc = THREE.MathUtils.degToRad(s.arc || 360)
  switch (s.type) {
    case 0:
    case 1:
    case 2:
    case 3: {
      randomUnit(dir)
      if (s.type === 2 || s.type === 3) dir.z = -Math.abs(dir.z)
      const r = s.type === 1 || s.type === 3 ? R : R * (1 - thick * (1 - Math.cbrt(random())))
      pos.copy(dir).multiplyScalar(r)
      if (s.type === 2 || s.type === 3) dir.z = Math.abs(dir.z)
      break
    }
    case 4:
    case 7:
    case 8:
    case 9: {
      const a = arcAngle(s, arc)
      const rr = s.type === 7 || s.type === 9 ? R : R * Math.sqrt(1 - thick * random())
      const cx = Math.cos(a)
      const cy = Math.sin(a)
      pos.set(cx * rr, cy * rr, 0)
      const ang = THREE.MathUtils.degToRad(Math.min(s.angle, 89.9))
      const spread = R > 1e-5 ? rr / R : random()
      const t = Math.tan(ang) * spread
      dir.set(cx * t, cy * t, 1).normalize()
      if (s.type === 8 || s.type === 9) {
        const l = s.length * random()
        pos.addScaledVector(dir, l / Math.max(dir.z, 1e-3))
      }
      break
    }
    case 5:
    case 15:
    case 16: {
      pos.set(random() - 0.5, random() - 0.5, random() - 0.5)
      if (s.type === 15) {
        const ax = Math.floor(random() * 3)
        pos.setComponent(ax, random() < 0.5 ? -0.5 : 0.5)
      } else if (s.type === 16) {
        const ax = Math.floor(random() * 3)
        const bx = (ax + 1 + Math.floor(random() * 2)) % 3
        pos.setComponent(ax, random() < 0.5 ? -0.5 : 0.5)
        pos.setComponent(bx, random() < 0.5 ? -0.5 : 0.5)
      }
      dir.set(0, 0, 1)
      break
    }
    case 10:
    case 11: {
      const a = arcAngle(s, arc)
      const rr = s.type === 11 ? R : radial()
      pos.set(Math.cos(a) * rr, Math.sin(a) * rr, 0)
      dir.set(Math.cos(a), Math.sin(a), 0)
      break
    }
    case 12: {
      const x = (random() - 0.5) * 2 * R
      pos.set(x, 0, 0)
      dir.set(0, 1, 0)
      break
    }
    case 17: {
      const a = arcAngle(s, arc)
      const b = random() * Math.PI * 2
      const rr = s.donut * (1 - thick * random())
      const cx = Math.cos(a), cy = Math.sin(a)
      const ox = Math.cos(b) * rr, oz = Math.sin(b) * rr
      pos.set(cx * (R + ox), cy * (R + ox), oz)
      dir.set(cx * Math.cos(b), cy * Math.cos(b), Math.sin(b))
      break
    }
    case 18: {
      pos.set(random() - 0.5, random() - 0.5, 0)
      dir.set(0, 0, 1)
      break
    }
    case 6:
    case 13:
    case 14: {
      const m = def.shapeMesh
      if (m && m.p.length >= 3) {
        const vi = Math.floor(random() * (m.p.length / 3))
        pos.set(m.p[vi * 3], m.p[vi * 3 + 1], -m.p[vi * 3 + 2])
        if (m.n) dir.set(m.n[vi * 3], m.n[vi * 3 + 1], -m.n[vi * 3 + 2]).normalize()
        else dir.copy(pos).normalize()
      } else {
        pos.set(0, 0, 0)
        randomUnit(dir)
      }
      break
    }
    default:
      pos.set(0, 0, 0)
      dir.set(0, 0, 1)
  }
  if (s.rndPos > 0) pos.add(_v3.set(random() - 0.5, random() - 0.5, random() - 0.5).multiplyScalar(s.rndPos * 2))
  if (s.sphDir > 0) {
    _v3.copy(pos)
    if (_v3.lengthSq() > 1e-8) dir.lerp(_v3.normalize(), s.sphDir).normalize()
  }
  if (s.rndDir > 0) {
    randomUnit(_v3)
    dir.lerp(_v3, s.rndDir).normalize()
  }
  finishShape(def, pos, dir, false)
}

function finishShape(def, pos, dir, bare) {
  pos.z = -pos.z
  dir.z = -dir.z
  if (bare || !def.shape) return
  pos.multiply(def.shapeScale).applyQuaternion(def.shapeQuat).add(def.shapePos)
  dir.applyQuaternion(def.shapeQuat)
}

function arcAngle(s, arc) {
  if (s.arcMode === 0 || !s.arcMode) {
    if (s.arcSpread > 0) {
      const steps = Math.max(1, Math.round(1 / s.arcSpread))
      return Math.floor(random() * steps) / steps * arc
    }
    return random() * arc
  }
  return random() * arc
}

function randomUnit(out) {
  const z = random() * 2 - 1
  const a = random() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return out.set(r * Math.cos(a), r * Math.sin(a), z)
}

function noise3(x, y, z, t) {
  return Math.sin(x * 1.7 + t * 1.3 + Math.cos(y * 2.1 - t)) * 0.5 + Math.sin(z * 2.3 - t * 0.7 + Math.sin(x * 1.1)) * 0.5
}

class Emitter {
  constructor(inst, node, def, index) {
    this.inst = inst
    this.node = node
    this.def = def
    this.index = index
    const n = def.capacity
    this.cap = n
    this.count = 0
    this.spare = takeSpare(def)
    const store = this.spare ? this.spare.store : makeStore(n)
    this.store = store
    this.pos = store.pos
    this.vel = store.vel
    this.age = store.age
    this.life = store.life
    this.size = store.size
    this.rot = store.rot
    this.col = store.col
    this.rnd = store.rnd
    this.frame = store.frame
    this.pid = store.pid
    this.birthAcc = store.birthAcc
    this.curCol = store.curCol
    this.curSize = store.curSize
    this.nextId = 1
    this.t = -def.delay.get(0, random())
    this.emitting = true
    this.acc = 0
    this.distAcc = 0
    this.loopIndex = 0
    this.burstFired = def.bursts.map(() => 0)
    this.lastWorld = new THREE.Vector3()
    this.hasLast = false
    this.sysRnd = random()
    this.subTriggers = []
    this.mesh = null
    this.trails = null
    if (def.material) this.build()
    if (def.trail && def.trailMaterial) this.trails = new ParticleTrails(this)
    if (def.prewarm && def.loop) this.prewarm()
  }

  build() {
    const def = this.def
    const n = this.cap
    const spare = this.spare && this.spare.mesh ? this.spare : null
    if (spare) {
      const mesh = spare.mesh
      this.aCol = spare.aCol
      this.aUv = spare.aUv
      this.aCust = spare.aCust
      mesh.material = def.material
      mesh.count = 0
      mesh.visible = false
      mesh.renderOrder = def.order
      this.mesh = mesh
      this.inst.world.add(mesh)
      return
    }
    const mesh = new THREE.InstancedMesh(def.geometry, def.material, n)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.aCust = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    mesh.geometry = def.geometry.clone()
    mesh.geometry.setAttribute('iCol', this.aCol)
    mesh.geometry.setAttribute('iUv', this.aUv)
    mesh.geometry.setAttribute('iCust', this.aCust)
    mesh.count = 0
    mesh.visible = false
    mesh.frustumCulled = false
    mesh.renderOrder = def.order
    mesh.matrixAutoUpdate = false
    this.mesh = mesh
    this.inst.world.add(mesh)
  }

  prewarm() {
    const steps = Math.ceil(this.def.dur / 0.05)
    for (let i = 0; i < steps; i++) this.step(0.05, null, true)
  }

  get alive() {
    return this.count > 0 || (this.emitting && !this.def.subOnly)
  }

  stop() {
    this.emitting = false
  }

  nodeMatrix() {
    return this.node.matrixWorld
  }

  step(dt, camera, silent) {
    const def = this.def
    const sdt = dt * def.simSpeed
    const node = this.node
    node.matrixWorld.decompose(_nodePos, _nodeQuat, _nodeScale)
    if (this.emitting && !this.isSub) {
      if (this.t < 0) {
        this.t += sdt
        if (this.t >= 0) this.hasLast = false
      } else {
        const prev = this.t
        this.t += sdt
        let norm = (this.t % def.dur) / def.dur
        if (def.loop) {
          const li = Math.floor(this.t / def.dur)
          if (li !== this.loopIndex) {
            this.loopIndex = li
            this.burstFired.fill(0)
          }
        } else if (this.t >= def.dur) {
          norm = 1
        }
        const local = def.loop ? this.t - this.loopIndex * def.dur : Math.min(this.t, def.dur)
        if (def.rate) {
          this.acc += def.rate.get(norm, this.sysRnd) * sdt
          const k = Math.floor(this.acc)
          if (k > 0) {
            this.acc -= k
            this.emit(k, norm)
          }
        }
        if (def.rateDist) {
          if (this.hasLast) {
            const d = _nodePos.distanceTo(this.lastWorld) / Math.max(1e-4, this.inst.scale)
            this.distAcc += d * def.rateDist.get(norm, this.sysRnd)
            const k = Math.floor(this.distAcc)
            if (k > 0) {
              this.distAcc -= k
              this.emit(Math.min(k, 40), norm)
            }
          }
          this.lastWorld.copy(_nodePos)
          this.hasLast = true
        }
        for (let i = 0; i < def.bursts.length; i++) {
          const b = def.bursts[i]
          const maxCycles = b.cyc === 0 ? Infinity : b.cyc
          while (this.burstFired[i] < maxCycles) {
            const at = b.t + this.burstFired[i] * b.rep
            if (local < at || at > def.dur + 1e-4) break
            this.burstFired[i]++
            if (random() <= b.p) this.emit(Math.round(b.n.get(norm, random())), norm)
          }
        }
        if (!def.loop && this.t >= def.dur && prev < def.dur + 1) this.emitting = false
      }
    }
    const subs = this.subTriggers
    for (let k = 0; k < subs.length; k++) this.emitAt(subs[k])
    for (let k = 0; k < subs.length; k++) triggerPool.push(subs[k])
    subs.length = 0
    this.simulate(sdt)
    if (!silent && this.mesh) this.upload(camera)
    if (!silent && this.trails) this.trails.update(sdt)
  }

  emit(k, norm) {
    for (let i = 0; i < k; i++) {
      if (this.count >= this.cap) return
      this.spawn(norm, null)
    }
  }

  emitAt(trig) {
    const def = this.def
    let k = trig.n
    if (k === undefined || k < 0) {
      k = 0
      for (const b of def.bursts) k += Math.round(b.n.get(0, random()))
      if (!def.bursts.length && def.rate) k = Math.max(1, Math.round(def.rate.get(0, 0.5) * 0.05))
    }
    for (let i = 0; i < k; i++) {
      if (this.count >= this.cap) return
      this.spawn(0, trig.p)
    }
  }

  subRate(target) {
    const d = target.def
    return d.rate ? d.rate.get(0, 0.5) : 0
  }

  spawn(norm, at) {
    const def = this.def
    const i = this.count++
    const r0 = random()
    this.age[i] = 0
    this.life[i] = Math.max(0.01, def.life.get(norm, random()))
    const speed = def.spd.get(norm, random())
    const sr = random()
    if (def.size.length === 3) {
      this.size[i * 3] = def.size[0].get(norm, sr)
      this.size[i * 3 + 1] = def.size[1].get(norm, sr)
      this.size[i * 3 + 2] = def.size[2].get(norm, sr)
    } else {
      const s = def.size[0].get(norm, sr)
      this.size[i * 3] = s
      this.size[i * 3 + 1] = s
      this.size[i * 3 + 2] = s
    }
    const flip = def.flipRot > 0 && random() < def.flipRot * 0.5 ? -1 : 1
    this.rot[i * 3] = def.rot[0] ? def.rot[0].get(norm, random()) * flip : 0
    this.rot[i * 3 + 1] = def.rot[1] ? def.rot[1].get(norm, random()) * flip : 0
    this.rot[i * 3 + 2] = def.rot[2] ? def.rot[2].get(norm, random()) * flip : 0
    def.col.get(norm, random(), _col)
    this.col.set(_col, i * 4)
    this.rnd[i * 4] = r0
    this.rnd[i * 4 + 1] = random()
    this.rnd[i * 4 + 2] = random()
    this.rnd[i * 4 + 3] = random()
    if (def.sheet) {
      const sh = def.sheet
      const frames = sh.type === 1 ? sh.x : sh.x * sh.y
      this.frame[i] = def.sheet.start.get(0, random()) + (sh.type === 1 && sh.rowMode === 0 ? Math.floor(random() * sh.y) * 1000 : 0)
      if (frames <= 0) this.frame[i] = 0
    }
    sampleShape(def, _v, _dir)
    _dir.multiplyScalar(speed)
    if (at) {
      if (def.world) {
        _v.applyQuaternion(_nodeQuat).multiplyScalar(_nodeScale.x).add(at)
        _dir.applyQuaternion(_nodeQuat)
      } else {
        _v2.copy(at)
        this.node.worldToLocal(_v2)
        _v.add(_v2)
      }
    } else if (def.world) {
      _v.applyMatrix4(this.node.matrixWorld)
      _dir.applyQuaternion(_nodeQuat).multiplyScalar(_nodeScale.x)
    }
    this.pos[i * 3] = _v.x
    this.pos[i * 3 + 1] = _v.y
    this.pos[i * 3 + 2] = _v.z
    this.pid[i] = this.nextId++
    this.birthAcc[i] = 0
    if (def.birthSubs.length) {
      _birthPos.copy(_v)
      if (!def.world) _birthPos.applyMatrix4(this.node.matrixWorld)
      for (let k = 0; k < def.birthSubs.length; k++) {
        const target = this.inst.emitterByNode.get(def.birthSubs[k].node)
        if (!target || !target.def.bursts.length) continue
        const trig = takeTrigger(-1)
        trig.p.copy(_birthPos)
        target.subTriggers.push(trig)
      }
    }
    this.vel[i * 3] = _dir.x
    this.vel[i * 3 + 1] = _dir.y
    this.vel[i * 3 + 2] = _dir.z
  }

  kill(i) {
    const last = --this.count
    if (this.def.deathSubs.length) this.fireSubs(i, 2)
    if (i === last) return
    for (let f = 0; f < EMITTER_FIELDS.length; f++) {
      const field = EMITTER_FIELDS[f]
      moveSlot(this[field[0]], field[1], last, i)
    }
  }

  worldPosOf(i, out) {
    out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2])
    if (!this.def.world) out.applyMatrix4(this.node.matrixWorld)
    return out
  }

  fireSubs(i, type) {
    const subs = this.def.subs
    for (let k = 0; k < subs.length; k++) {
      const s = subs[k]
      if (s.type !== type) continue
      const target = this.inst.emitterByNode.get(s.node)
      if (!target || random() > (s.p === undefined ? 1 : s.p)) continue
      const trig = takeTrigger(-1)
      this.worldPosOf(i, trig.p)
      target.subTriggers.push(trig)
    }
  }

  simulate(dt) {
    const def = this.def
    const P = this.pos
    const V = this.vel
    const localGrav = !def.world && def.hasGrav
    if (localGrav) _qa.copy(_nodeQuat).invert()
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt
      if (this.age[i] >= this.life[i]) {
        this.kill(i)
        continue
      }
      const t = this.age[i] / this.life[i]
      const r = this.rnd[i * 4 + 1]
      const j = i * 3
      if (def.hasGrav) {
        const g = def.grav.get(t, r) * GRAVITY * dt / Math.max(1e-4, this.inst.scale)
        if (localGrav) {
          _v.set(0, -g, 0).applyQuaternion(_qa)
          V[j] += _v.x
          V[j + 1] += _v.y
          V[j + 2] += _v.z
        } else {
          V[j + 1] -= g
        }
      }
      if (def.force) {
        const f = def.force
        V[j] += f.x.get(t, r) * dt
        V[j + 1] += f.y.get(t, r) * dt
        V[j + 2] += f.z.get(t, r) * dt
      }
      let vx = V[j], vy = V[j + 1], vz = V[j + 2]
      let mod = 1
      if (def.vel) {
        const v = def.vel
        vx += v.x.get(t, r)
        vy += v.y.get(t, r)
        vz += v.z.get(t, r)
        mod = v.mod.get(t, r)
      }
      if (def.limit) {
        const lim = def.limit.mag.get(t, r)
        const sp = Math.hypot(vx, vy, vz)
        if (sp > lim && sp > 1e-5) {
          const k = 1 - def.limit.damp * (1 - lim / sp) * Math.min(1, dt * 30)
          V[j] *= k
          V[j + 1] *= k
          V[j + 2] *= k
          vx *= k
          vy *= k
          vz *= k
        }
        const drag = def.limit.drag.get(t, r)
        if (drag > 0) {
          const k = Math.max(0, 1 - drag * dt)
          V[j] *= k
          V[j + 1] *= k
          V[j + 2] *= k
        }
      }
      P[j] += vx * dt * mod
      P[j + 1] += vy * dt * mod
      P[j + 2] += vz * dt * mod
      if (def.vel && (def.vel.ox || def.vel.oy || def.vel.oz || def.vel.radial)) {
        const v = def.vel
        const ox = v.ox ? v.ox.get(t, r) * dt : 0
        const oy = v.oy ? v.oy.get(t, r) * dt : 0
        const oz = v.oz ? v.oz.get(t, r) * dt : 0
        _v.set(P[j], P[j + 1], P[j + 2])
        if (ox || oy || oz) {
          _q.setFromEuler(_euler.set(ox, oy, oz))
          _v.applyQuaternion(_q)
        }
        if (v.radial) {
          const rd = v.radial.get(t, r) * dt
          const l = _v.length()
          if (l > 1e-5) _v.multiplyScalar((l + rd) / l)
        }
        P[j] = _v.x
        P[j + 1] = _v.y
        P[j + 2] = _v.z
      }
      if (def.noise) {
        const n = def.noise
        const s = n.str.get(t, r) * n.pos.get(t, r) * dt
        if (s) {
          const f = n.freq
          const tt = time.value * (n.scroll.get(t, r) + 0.5)
          const x = P[j] * f, y = P[j + 1] * f, z = P[j + 2] * f
          P[j] += noise3(y, z, x, tt + i) * s
          P[j + 1] += noise3(z, x, y, tt + 7 + i) * s
          P[j + 2] += noise3(x, y, z, tt + 13 + i) * s
        }
      }
      if (def.birthSubs.length) {
        for (let b = 0; b < def.birthSubs.length; b++) {
          const target = this.inst.emitterByNode.get(def.birthSubs[b].node)
          if (!target) continue
          const rate = this.subRate(target)
          if (rate <= 0) continue
          this.birthAcc[i] += rate * dt
          if (this.birthAcc[i] >= 1) {
            const k = Math.floor(this.birthAcc[i])
            this.birthAcc[i] -= k
            const trig = takeTrigger(Math.min(k, 4))
            this.worldPosOf(i, trig.p)
            target.subTriggers.push(trig)
          }
        }
      }
      if (def.rotLife) {
        const rl = def.rotLife
        if (rl.length === 3) {
          this.rot[j] += rl[0].get(t, r) * dt
          this.rot[j + 1] += rl[1].get(t, r) * dt
          this.rot[j + 2] += rl[2].get(t, r) * dt
        } else {
          this.rot[j + 2] += rl[0].get(t, r) * dt
        }
      }
    }
  }

  upload(camera) {
    const def = this.def
    const mesh = this.mesh
    const n = this.count
    mesh.count = n
    mesh.visible = n > 0
    if (!n) return
    const im = mesh.instanceMatrix.array
    const C = this.aCol.array
    const U = this.aUv.array
    const X = this.aCust.array
    const ws = def.scaling === 2 ? this.inst.scale : _nodeScale.x
    const sheet = def.sheet
    for (let i = 0; i < n; i++) {
      const t = this.age[i] / this.life[i]
      const r = this.rnd[i * 4 + 1]
      const j = i * 3
      _center.set(this.pos[j], this.pos[j + 1], this.pos[j + 2])
      if (!def.world) _center.applyMatrix4(this.node.matrixWorld)
      let sx = this.size[j], sy = this.size[j + 1], sz = this.size[j + 2]
      if (def.sizeLife) {
        const sl = def.sizeLife
        if (sl.length === 3) {
          sx *= sl[0].get(t, r)
          sy *= sl[1].get(t, r)
          sz *= sl[2].get(t, r)
        } else {
          const k = sl[0].get(t, r)
          sx *= k
          sy *= k
          sz *= k
        }
      }
      sx *= ws
      sy *= ws
      sz *= ws
      if (def.flip[0] > 0 && this.rnd[i * 4 + 2] < def.flip[0]) sx = -sx
      if (def.flip[1] > 0 && this.rnd[i * 4 + 3] < def.flip[1]) sy = -sy
      this.orient(i, camera, _q, sx, sy, sz)
      if (this.inst.stretch !== 1 && !def.world && !this.stretchBasis) {
        this.stretchedMatrix(i, sx / ws, sy / ws, sz / ws)
      } else {
        if (def.pivot) _center.add(this.stretchBasis ? _pivot : _pivot.set(def.pivot.x * sx, def.pivot.y * sy, -def.pivot.z * sz).applyQuaternion(_q))
        _m.compose(_center, _q, _scale)
        if (this.stretchBasis) {
          _m.copy(_basis)
          _m.setPosition(_center)
        }
      }
      _m.toArray(im, i * 16)
      copy4(this.col, _col, i * 4)
      if (def.colLife) {
        def.colLife.get(t, r, _col2)
        _col[0] *= _col2[0]
        _col[1] *= _col2[1]
        _col[2] *= _col2[2]
        _col[3] *= _col2[3]
      }
      C[i * 4] = _col[0]
      C[i * 4 + 1] = _col[1]
      C[i * 4 + 2] = _col[2]
      C[i * 4 + 3] = _col[3]
      if (this.trails) {
        this.curCol.set(_col, i * 4)
        this.curSize[i] = Math.abs(sx)
      }
      if (sheet) this.sheetUv(i, t, r, U)
      else {
        U[i * 4] = 1
        U[i * 4 + 1] = 1
        U[i * 4 + 2] = 0
        U[i * 4 + 3] = 0
      }
      this.customOf(i, t, r, X)
    }
    markRange(mesh.instanceMatrix, n * 16)
    markRange(this.aCol, n * 4)
    markRange(this.aUv, n * 4)
    markRange(this.aCust, n * 4)
  }

  stretchedMatrix(i, sx, sy, sz) {
    const def = this.def
    const j = i * 3
    _qa.copy(_nodeQuat).invert().multiply(_q)
    _center.set(this.pos[j], this.pos[j + 1], this.pos[j + 2])
    if (def.pivot) _center.add(_pivot.set(def.pivot.x * sx, def.pivot.y * sy, -def.pivot.z * sz).applyQuaternion(_qa))
    _m.compose(_center, _qa, _scale.set(sx, sy, sz))
    _m.premultiply(this.node.matrixWorld)
  }

  orient(i, camera, q, sx, sy, sz) {
    const def = this.def
    const j = i * 3
    this.stretchBasis = false
    _scale.set(sx, sy, sz)
    if (def.mode === 1) {
      _dir.set(this.vel[j], this.vel[j + 1], this.vel[j + 2])
      if (!def.world) _dir.applyQuaternion(_nodeQuat)
      const sp = _dir.length()
      if (sp > 1e-5) _dir.multiplyScalar(1 / sp)
      else _dir.set(0, 1, 0)
      _v2.copy(_camPos).sub(_center).normalize()
      _side.crossVectors(_dir, _v2)
      if (_side.lengthSq() < 1e-8) _side.set(1, 0, 0)
      _side.normalize()
      const len = sy * def.lenScale + sp * def.velScale
      _v3.crossVectors(_dir, _side)
      if (def.pivot) _pivot.copy(_dir).multiplyScalar(-def.pivot.y * sy * Math.sign(len)).addScaledVector(_side, def.pivot.x * sx)
      _basis.makeBasis(_dir.multiplyScalar(len), _side.multiplyScalar(sx), _v3)
      this.stretchBasis = true
      return
    }
    const rz = this.rot[j + 2]
    if (def.rot3d || def.mode === 4) unityEulerQuat(this.rot[j], this.rot[j + 1], rz, _q2)
    else _q2.set(0, 0, Math.sin(rz / 2), Math.cos(rz / 2))
    if (def.mode === 2) {
      q.setFromAxisAngle(_up, -rz).multiply(_flat)
      return
    }
    if (def.mode === 3) {
      _v2.copy(_camPos).sub(_center)
      q.setFromAxisAngle(_up, Math.atan2(_v2.x, _v2.z)).multiply(_q2)
      return
    }
    switch (def.align) {
      case 1:
        q.copy(_q2)
        break
      case 2:
        q.copy(_nodeQuat).multiply(_q2)
        break
      case 3:
        _v2.copy(_camPos).sub(_center).normalize()
        _m.lookAt(_center, _camPos, _up)
        q.setFromRotationMatrix(_m).multiply(_q2)
        break
      case 4:
        _dir.set(this.vel[j], this.vel[j + 1], this.vel[j + 2])
        if (!def.world) _dir.applyQuaternion(_nodeQuat)
        if (_dir.lengthSq() < 1e-10) {
          q.copy(_camQuat).multiply(_q2)
          break
        }
        _v2.copy(_center).sub(_dir)
        _m.lookAt(_center, _v2, _up)
        q.setFromRotationMatrix(_m).multiply(_q2)
        break
      default:
        q.copy(_camQuat).multiply(_q2)
    }
  }

  sheetUv(i, t, r, U) {
    const sh = this.def.sheet
    const cols = sh.x
    const rows = sh.y
    let frame
    let row = 0
    if (sh.type === 1) {
      const n = cols
      frame = Math.floor(sh.frame.get(t, r) * n * sh.cyc + (this.frame[i] % 1000)) % n
      row = sh.rowMode === 0 ? Math.floor(this.frame[i] / 1000) : sh.row
    } else {
      const n = cols * rows
      frame = Math.floor(sh.frame.get(t, r) * n * sh.cyc + this.frame[i]) % n
      row = Math.floor(frame / cols)
      frame = frame % cols
    }
    U[i * 4] = 1 / cols
    U[i * 4 + 1] = 1 / rows
    U[i * 4 + 2] = frame / cols
    U[i * 4 + 3] = (rows - 1 - row) / rows
  }

  customOf(i, t, r, X) {
    const def = this.def
    for (let k = 0; k < 4; k++) {
      const slot = def.slots[k]
      let v = 0
      if (slot) {
        const s = slot[0]
        const c = slot[1]
        if (s >= 31 && s <= 38) {
          const ci = s <= 34 ? 0 : 1
          const cd = def.custom && def.custom[ci]
          if (cd && cd.mode === 1) v = cd.v[c] ? cd.v[c].get(t, this.rnd[i * 4 + c % 4]) : 0
          else if (cd && cd.mode === 2) {
            cd.col.get(t, r, _col2)
            v = _col2[c]
          }
        } else if (s === 21) v = t
        else if (s >= 23 && s <= 26) v = this.rnd[i * 4 + c]
        else if (s >= 27 && s <= 30) v = random()
        else if (s === 22) v = 1 / this.life[i]
        else if (s === 12 || s === 13 || s === 14) v = this.size[i * 3 + c]
        else if (s === 15 || s === 16) v = this.rot[i * 3 + (s === 15 ? 2 : c)]
        else if (s === 20) v = Math.hypot(this.vel[i * 3], this.vel[i * 3 + 1], this.vel[i * 3 + 2])
        else if (s === 19) v = this.vel[i * 3 + c]
        else if (s === 9) v = this.frame[i]
      }
      X[i * 4 + k] = v
    }
  }

  dispose() {
    if (this.trails) this.trails.dispose()
    const mesh = this.mesh
    if (mesh) this.inst.world.remove(mesh)
    this.mesh = null
    const kept = giveSpare(this.def, { store: this.store, mesh, aCol: this.aCol, aUv: this.aUv, aCust: this.aCust })
    if (!kept && mesh) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
  }
}

const SPARES_PER_DEF = 6

function makeStore(n) {
  return {
    pos: new Float32Array(n * 3),
    vel: new Float32Array(n * 3),
    age: new Float32Array(n),
    life: new Float32Array(n),
    size: new Float32Array(n * 3),
    rot: new Float32Array(n * 3),
    col: new Float32Array(n * 4),
    rnd: new Float32Array(n * 4),
    frame: new Float32Array(n),
    pid: new Uint32Array(n),
    birthAcc: new Float32Array(n),
    curCol: new Float32Array(n * 4),
    curSize: new Float32Array(n),
  }
}

function takeSpare(def) {
  return def.spares && def.spares.length ? def.spares.pop() : null
}

function giveSpare(def, spare) {
  const list = def.spares || (def.spares = [])
  if (list.length >= SPARES_PER_DEF) return false
  list.push(spare)
  return true
}

class ParticleTrails {
  constructor(em) {
    this.em = em
    this.d = em.def.trail
    this.map = new Map()
    this.list = []
    this.stamp = 0
    this.perTrail = 14
    this.maxPts = Math.min(1600, em.cap * this.perTrail)
    const def = em.def
    const spare = def.trailSpares && def.trailSpares.pop()
    if (spare) {
      this.aPos = spare.aPos
      this.aUvs = spare.aUvs
      this.aCol = spare.aCol
      this.idx = spare.idx
      this.mesh = spare.mesh
      this.mesh.material = def.trailMaterial
      this.mesh.renderOrder = def.order
      this.mesh.visible = false
      this.mesh.geometry.setDrawRange(0, 0)
      em.inst.world.add(this.mesh)
      return
    }
    const n = this.maxPts * 2
    const g = new THREE.BufferGeometry()
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.aUvs = new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage)
    this.aCol = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.idx = new THREE.BufferAttribute(new Uint16Array(this.maxPts * 6), 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.aPos)
    g.setAttribute('uv', this.aUvs)
    g.setAttribute('iCol', this.aCol)
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('iUv', new THREE.BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 < 2 ? 1 : 0)), 4))
    g.setAttribute('iCust', new THREE.BufferAttribute(new Float32Array(n * 4), 4))
    g.setAttribute('vcol', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4))
    g.setIndex(this.idx)
    g.setDrawRange(0, 0)
    this.mesh = new THREE.Mesh(g, em.def.trailMaterial)
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.mesh.renderOrder = em.def.order
    em.inst.world.add(this.mesh)
  }

  update(dt) {
    const em = this.em
    const d = this.d
    const scale = em.inst.scale
    const stamp = ++this.stamp
    for (let i = 0; i < em.count; i++) {
      const id = em.pid[i]
      let tr = this.map.get(id)
      const t = em.age[i] / em.life[i]
      if (!tr) {
        tr = takeTrail(id, Math.max(0.02, d.life.get(t, em.rnd[i * 4]) * em.life[i]))
        this.map.set(id, tr)
        this.list.push(tr)
      }
      tr.seen = stamp
      const p = em.worldPosOf(i, _trailPos)
      const pts = tr.pts
      const last = pts[pts.length - 1]
      if (!last || last.p.distanceTo(p) >= d.minDist * scale) {
        if (pts.length >= this.perTrail) {
          const recycled = pts.shift()
          recycled.p.copy(p)
          recycled.age = 0
          pts.push(recycled)
        } else pts.push(takePoint(p))
      } else {
        last.p.copy(p)
      }
      const base = d.inheritCol ? em.curCol : WHITE4
      const at = d.inheritCol ? i * 4 : 0
      d.colLife.get(t, em.rnd[i * 4 + 1], _col2)
      for (let c = 0; c < 4; c++) tr.col[c] = base[at + c] * _col2[c]
      tr.w = d.sizeW ? em.curSize[i] : scale
    }
    const list = this.list
    for (let k = list.length - 1; k >= 0; k--) {
      const tr = list[k]
      if (tr.seen !== stamp) {
        if (d.die) {
          this.drop(k)
          continue
        }
        tr.dead = true
      }
      const pts = tr.pts
      for (let j = 0; j < pts.length; j++) pts[j].age += dt
      while (pts.length && pts[0].age > tr.life) pointPool.push(pts.shift())
      if (tr.dead && pts.length < 2) this.drop(k)
    }
    this.build()
  }

  drop(k) {
    const tr = this.list[k]
    releasePoints(tr.pts)
    this.map.delete(tr.id)
    removeAt(this.list, k)
    trailPool.push(tr)
  }

  build() {
    const P = this.aPos.array
    const UV = this.aUvs.array
    const C = this.aCol.array
    const I = this.idx.array
    let v = 0
    let ii = 0
    const list = this.list
    for (let q = 0; q < list.length; q++) {
      const tr = list[q]
      const n = tr.pts.length
      if (n < 2) continue
      if (v + n > this.maxPts) break
      for (let k = 0; k < n; k++) {
        const pt = tr.pts[n - 1 - k]
        const u = k / (n - 1)
        const prev = tr.pts[Math.max(0, n - 2 - k)].p
        const next = tr.pts[Math.min(n - 1, n - k)].p
        _dir.copy(prev).sub(next)
        if (_dir.lengthSq() < 1e-10) _dir.set(0, 1, 0)
        _v2.copy(_camPos).sub(pt.p)
        _side.crossVectors(_dir, _v2).normalize()
        const w = tr.w * this.d.width.get(u, 0.5) * 0.5
        const vi = (v + k) * 2
        P[vi * 3] = pt.p.x + _side.x * w
        P[vi * 3 + 1] = pt.p.y + _side.y * w
        P[vi * 3 + 2] = pt.p.z + _side.z * w
        P[vi * 3 + 3] = pt.p.x - _side.x * w
        P[vi * 3 + 4] = pt.p.y - _side.y * w
        P[vi * 3 + 5] = pt.p.z - _side.z * w
        UV[vi * 2] = u
        UV[vi * 2 + 1] = 0
        UV[vi * 2 + 2] = u
        UV[vi * 2 + 3] = 1
        this.d.colTrail.get(u, 0.5, _col)
        for (let c = 0; c < 4; c++) {
          const val = tr.col[c] * _col[c]
          C[vi * 4 + c] = val
          C[vi * 4 + 4 + c] = val
        }
        if (k > 0) {
          const a = (v + k - 1) * 2
          I[ii++] = a
          I[ii++] = a + 1
          I[ii++] = a + 2
          I[ii++] = a + 1
          I[ii++] = a + 3
          I[ii++] = a + 2
        }
      }
      v += n
    }
    this.mesh.visible = ii > 0
    this.mesh.geometry.setDrawRange(0, ii)
    if (!ii) return
    markRange(this.aPos, v * 6)
    markRange(this.aUvs, v * 4)
    markRange(this.aCol, v * 8)
    markRange(this.idx, ii)
  }

  get alive() {
    return this.map.size > 0
  }

  dispose() {
    for (let k = this.list.length - 1; k >= 0; k--) this.drop(k)
    this.em.inst.world.remove(this.mesh)
    const def = this.em.def
    const list = def.trailSpares || (def.trailSpares = [])
    if (list.length < SPARES_PER_DEF) list.push({ aPos: this.aPos, aUvs: this.aUvs, aCol: this.aCol, idx: this.idx, mesh: this.mesh })
    else this.mesh.geometry.dispose()
  }
}

const ribbonSpares = []
const RIBBON_SPARES = 24

class Ribbon {
  constructor(inst, node, d) {
    this.inst = inst
    this.node = node
    this.d = d
    this.time = Math.max(0.05, d.time)
    this.cap = 48
    this.points = []
    this.emitting = !!d.emit
    this.thickLen = d.thickLen && d.thickLen.length ? bake(d.thickLen) : null
    this.thickTime = d.thickTime && d.thickTime.length ? bake(d.thickTime) : null
    this.colLen = new Gradient(d.colLen)
    this.colTime = new Gradient(d.colTime)
    this.material = inst.lib.material(d.mat)
    this.mesh = null
    if (this.material) this.build()
  }

  build() {
    const spare = ribbonSpares.pop()
    if (spare) {
      this.aPos = spare.aPos
      this.aUvs = spare.aUvs
      this.aCol = spare.aCol
      this.mesh = spare.mesh
      this.mesh.material = this.material
      this.mesh.visible = false
      this.mesh.geometry.setDrawRange(0, 0)
      this.inst.world.add(this.mesh)
      return
    }
    const n = this.cap * 2
    const g = new THREE.BufferGeometry()
    this.aPos = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.aUvs = new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage)
    this.aCol = new THREE.BufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.aPos)
    g.setAttribute('uv', this.aUvs)
    g.setAttribute('iCol', this.aCol)
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3))
    g.setAttribute('iUv', new THREE.BufferAttribute(new Float32Array(n * 4).map((_, k) => (k % 4 < 2 ? 1 : 0)), 4))
    g.setAttribute('iCust', new THREE.BufferAttribute(new Float32Array(n * 4), 4))
    g.setAttribute('vcol', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 4))
    const idx = []
    for (let i = 0; i < this.cap - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    g.setIndex(idx)
    g.setDrawRange(0, 0)
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.frustumCulled = false
    this.mesh.matrixAutoUpdate = false
    this.inst.world.add(this.mesh)
  }

  get alive() {
    return this.points.length > 0 || this.emitting
  }

  stop() {
    this.emitting = false
  }

  step(dt) {
    const pts = this.points
    for (let i = 0; i < pts.length; i++) pts[i].age += dt
    while (pts.length && pts[0].age >= this.time) pointPool.push(pts.shift())
    if (this.emitting) {
      this.node.getWorldPosition(_v)
      const last = pts[pts.length - 1]
      const minD = this.d.minDist * this.inst.scale
      if (!last || last.p.distanceTo(_v) >= minD) {
        if (pts.length >= this.cap) {
          const recycled = pts.shift()
          recycled.p.copy(_v)
          recycled.age = 0
          pts.push(recycled)
        } else pts.push(takePoint(_v))
      } else {
        last.p.copy(_v)
      }
    }
    if (!this.mesh) return
    const n = pts.length
    this.mesh.visible = n >= 2
    if (n < 2) {
      this.mesh.geometry.setDrawRange(0, 0)
      return
    }
    const P = this.aPos.array
    const UV = this.aUvs.array
    const C = this.aCol.array
    const thick = this.d.thick * this.inst.scale
    let total = 0
    for (let i = 1; i < n; i++) total += pts[i].p.distanceTo(pts[i - 1].p)
    let acc = 0
    for (let i = 0; i < n; i++) {
      const p = pts[i].p
      if (i > 0) acc += p.distanceTo(pts[i - 1].p)
      const u = n > 1 ? i / (n - 1) : 1
      const age = pts[i].age / this.time
      const prev = pts[Math.max(0, i - 1)].p
      const next = pts[Math.min(n - 1, i + 1)].p
      _dir.copy(next).sub(prev)
      if (_dir.lengthSq() < 1e-10) _dir.set(0, 1, 0)
      _v2.copy(_camPos).sub(p)
      _side.crossVectors(_dir, _v2).normalize()
      let w = thick
      if (this.thickLen) w *= sampleLut(this.thickLen, u)
      if (this.thickTime) w *= sampleLut(this.thickTime, age)
      w *= 0.5
      const k = i * 2
      P[k * 3] = p.x + _side.x * w
      P[k * 3 + 1] = p.y + _side.y * w
      P[k * 3 + 2] = p.z + _side.z * w
      P[k * 3 + 3] = p.x - _side.x * w
      P[k * 3 + 4] = p.y - _side.y * w
      P[k * 3 + 5] = p.z - _side.z * w
      const tu = this.d.texMode === 0 ? 1 - u : ((total - acc) / Math.max(1e-4, this.inst.scale)) * (this.d.uv || 1)
      UV[k * 2] = tu
      UV[k * 2 + 1] = 0
      UV[k * 2 + 2] = tu
      UV[k * 2 + 3] = 1
      this.colLen.get(u, _col)
      this.colTime.get(age, _col2)
      for (let c = 0; c < 4; c++) {
        const v = _col[c] * _col2[c]
        C[k * 4 + c] = v
        C[k * 4 + 4 + c] = v
      }
    }
    markRange(this.aPos, n * 6)
    markRange(this.aUvs, n * 4)
    markRange(this.aCol, n * 8)
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6)
  }

  dispose() {
    releasePoints(this.points)
    if (!this.mesh) return
    this.inst.world.remove(this.mesh)
    if (ribbonSpares.length < RIBBON_SPARES) ribbonSpares.push({ aPos: this.aPos, aUvs: this.aUvs, aCol: this.aCol, mesh: this.mesh })
    else this.mesh.geometry.dispose()
    this.mesh = null
  }
}

class Instance {
  constructor(vfx, lib, name, opts) {
    this.vfx = vfx
    this.lib = lib
    this.name = name
    this.world = vfx.group
    this.scale = opts.scale || 1
    this.stretch = opts.stretch || 1
    this.follow = opts.follow || null
    this.copyRot = opts.copyRot
    this.offset = opts.offset ? opts.offset.clone() : null
    this.lifetime = opts.lifetime === undefined ? Infinity : opts.lifetime
    this.age = 0
    this.stopped = false
    this.stopAge = 0
    this.dying = 1
    this.onDone = opts.onDone || null
    this.mute = opts.mute || null
    this.focus = opts.focus || null
    this.root = new THREE.Object3D()
    vfx.group.add(this.root)
    const compiled = lib.prefab(name)
    const nodes = []
    this.emitters = []
    this.ribbons = []
    this.emitterByNode = new Map()
    compiled.forEach((c, i) => {
      const n = c.n
      const o = new THREE.Object3D()
      o.position.set(n.t[0], n.t[1], n.t[2])
      o.quaternion.set(n.r[0], n.r[1], n.r[2], n.r[3])
      o.scale.set(n.s[0], n.s[1], n.s[2])
      if (i === 0) {
        o.position.set(0, 0, 0)
        o.quaternion.identity()
        if (n.fx) {
          this.dying = n.fx.dying || 1
          if (this.copyRot === undefined) this.copyRot = !!n.fx.copyRot
          this.camOffset = n.fx.camOffset || 0
        }
      }
      ;(n.p >= 0 ? nodes[n.p] : this.root).add(o)
      nodes.push(o)
    })
    this.nodes = nodes
    this.place(opts)
    this.root.updateMatrixWorld(true)
    compiled.forEach((c, i) => {
      if (c.off || (this.mute && this.mute.has(c.n.n))) return
      if (c.def && c.def.material !== undefined) {
        const e = new Emitter(this, nodes[i], c.def, i)
        if (e.mesh && this.focus && this.focus.has(c.n.n)) e.mesh.material = focusMaterial(e.mesh.material)
        e.isSub = c.sub
        if (c.sub) e.emitting = false
        this.emitters.push(e)
        this.emitterByNode.set(i, e)
      }
      if (c.n.ara) this.ribbons.push(new Ribbon(this, nodes[i], c.n.ara))
    })
  }

  place(opts) {
    const r = this.root
    if (this.follow) {
      this.follow.updateWorldMatrix(true, false)
      this.follow.matrixWorld.decompose(r.position, _q, _v)
      if (this.copyRot) r.quaternion.copy(_q)
      else if (opts.quat) r.quaternion.copy(opts.quat)
    } else {
      if (opts.pos) r.position.copy(opts.pos)
      if (opts.quat) r.quaternion.copy(opts.quat)
      else if (opts.yaw !== undefined) r.quaternion.setFromAxisAngle(_up, opts.yaw)
    }
    if (this.offset) r.position.add(this.offset)
    if (this.camOffset && opts.camera) {
      _v.copy(opts.camera.position).sub(r.position).normalize().multiplyScalar(this.camOffset * this.scale)
      r.position.add(_v)
    }
    r.scale.set(this.scale, this.scale, this.scale * this.stretch)
  }

  moveTo(pos, quat) {
    this.root.position.copy(pos)
    if (quat) this.root.quaternion.copy(quat)
  }

  span(pos, quat, stretch) {
    this.moveTo(pos, quat)
    this.stretch = stretch
    this.root.scale.set(this.scale, this.scale, this.scale * stretch)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.stopAge = 0
    for (const e of this.emitters) e.stop()
    for (const r of this.ribbons) r.stop()
  }

  get done() {
    if (this.stopped && this.stopAge >= Math.max(this.dying, 0.05) + 1.5) return true
    if (this.age < 0.05 || (this.hosting && !this.stopped)) return false
    const emitters = this.emitters
    for (let i = 0; i < emitters.length; i++) {
      const e = emitters[i]
      if ((e.mesh || e.trails) && (e.count > 0 || (e.emitting && !e.isSub) || (e.trails && e.trails.alive))) return false
    }
    const ribbons = this.ribbons
    for (let i = 0; i < ribbons.length; i++) if (ribbons[i].alive) return false
    return true
  }

  update(dt, camera) {
    this.age += dt
    if (this.stopped) this.stopAge += dt
    if (!this.stopped && this.age >= this.lifetime) this.stop()
    if (this.follow && !this.detached) {
      _follow.camera = camera
      this.place(_follow)
    }
    this.root.updateMatrixWorld(true)
    const emitters = this.emitters
    for (let i = 0; i < emitters.length; i++) emitters[i].step(dt, camera, false)
    const ribbons = this.ribbons
    for (let i = 0; i < ribbons.length; i++) ribbons[i].step(dt)
  }

  dispose() {
    for (const e of this.emitters) e.dispose()
    for (const r of this.ribbons) r.dispose()
    this.vfx.group.remove(this.root)
    if (this.onDone) this.onDone(this)
  }
}

export function vfxTexturesReady() {
  if (!pending.size) return Promise.resolve()
  return new Promise(resolve => {
    const check = () => (pending.size ? setTimeout(check, 50) : resolve())
    check()
  })
}

function prefabMaterials(lib, name) {
  const out = []
  for (const c of lib.prefab(name)) {
    if (!c.def) continue
    if (c.def.material) out.push(c.def.material)
    if (c.def.trailMaterial) out.push(c.def.trailMaterial)
  }
  for (const n of lib.prefabs[name]) if (n.ara) out.push(lib.material(n.ara.mat))
  return out.filter(Boolean)
}

const WARM_SLICE_MS = 6
const WARM_BATCH = 24

function uploadMaterialTextures(renderer, materials) {
  const textures = new Set()
  for (const m of materials) {
    for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture && u.value !== WHITE) textures.add(u.value)
  }
  if (textures.size) uploadTextures(renderer, textures)
}

export function loadVfx(id) {
  if (!libraries.has(id)) {
    libraries.set(id, fetchJson(`${BASE}${id}.json`)
      .then(d => (d ? new Library(d) : null))
      .catch(() => null))
  }
  return libraries.get(id)
}

export class Vfx {
  constructor(scene) {
    this.scene = scene
    this.group = new THREE.Group()
    this.group.name = 'vfx'
    scene.add(this.group)
    this.items = []
    this.libs = new Map()
  }

  async preload(ids) {
    const libs = await Promise.all(ids.map(id => loadVfx(id)))
    ids.forEach((id, i) => {
      if (libs[i]) this.libs.set(id, libs[i])
    })
    return libs.filter(Boolean)
  }

  library(id) {
    return this.libs.get(id) || null
  }

  textures(ids) {
    const out = new Set()
    for (const id of ids) {
      const lib = this.libs.get(id)
      if (!lib) continue
      for (const m of lib.materialsInUse()) {
        for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture && u.value !== WHITE) out.add(u.value)
      }
    }
    return out
  }

  has(id, name) {
    const lib = this.libs.get(id)
    return !!(lib && lib.has(name))
  }

  skill(id, type) {
    const lib = this.libs.get(id)
    return lib ? lib.skills[String(type)] || null : null
  }

  socket(id, actor, name, lobby = false) {
    const lib = this.libs.get(id)
    if (!actor || !name) return actor ? actor.root : null
    const sockets = lib ? (lobby && lib.lobbySockets) || lib.sockets : {}
    const key = `__vfx_${lobby ? 'lob_' : ''}${name}`
    const byName = actor.model.byName
    if (byName.has(key)) return byName.get(key)
    const s = sockets[name]
    if (!s) return byName.get(name) || actor.root
    const bone = s.bone && !byName.has(s.bone) && !sockets[s.bone] ? s.bone.replace(/-/g, '_') : s.bone
    const chained = bone && bone !== name && !byName.has(bone) && sockets[bone] ? this.socket(id, actor, bone, lobby) : null
    const parent = (bone && byName.get(bone)) || chained || actor.root
    const o = new THREE.Object3D()
    o.name = key
    o.position.set(s.t[0], s.t[1], s.t[2])
    o.quaternion.set(s.r[0], s.r[1], s.r[2], s.r[3])
    parent.add(o)
    byName.set(key, o)
    return o
  }

  spawn(id, name, opts = {}) {
    const lib = this.libs.get(id)
    if (!lib || !lib.has(name)) return null
    const inst = new Instance(this, lib, name, opts)
    this.items.push(inst)
    return inst
  }

  async warm(renderer, camera, { names = [], target = null, onlyNamed = false, libs = null, pause = null } = {}) {
    maxAnisotropy = Math.min(LOW_TIER ? 4 : 16, renderer.capabilities.getMaxAnisotropy() || 1)
    for (const tex of textureCache.values()) {
      if (tex.anisotropy === maxAnisotropy) continue
      tex.anisotropy = maxAnisotropy
      if (tex.image) tex.needsUpdate = true
    }
    const wanted = new Set(names)
    const mats = new Set()
    const upload = new Set()
    let sliceStart = performance.now()
    const breathe = pause || (() => new Promise(r => requestAnimationFrame(r)))
    for (const [id, lib] of this.libs) {
      if (libs && !libs.includes(id)) continue
      for (const name of Object.keys(lib.prefabs)) {
        const named = wanted.has(name)
        if (!named && (onlyNamed || !/^B_FX_/.test(name))) continue
        for (const m of prefabMaterials(lib, name)) {
          mats.add(m)
          if (named || pause) upload.add(m)
        }
        if (performance.now() - sliceStart > WARM_SLICE_MS) {
          await breathe()
          sliceStart = performance.now()
        }
      }
      if (!onlyNamed) for (const m of lib.materialsInUse()) mats.add(m)
    }
    uploadMaterialTextures(renderer, upload)
    const geo = quadGeometry()
    const list = [...mats]
    for (let i = 0; i < list.length; i += WARM_BATCH) {
      if (pause && i) await pause()
      const probe = new THREE.Group()
      for (const m of list.slice(i, i + WARM_BATCH)) {
        const mesh = new THREE.Mesh(geo, m)
        mesh.frustumCulled = false
        probe.add(mesh)
        const inst = new THREE.InstancedMesh(geo, m, 1)
        inst.frustumCulled = false
        inst.geometry = geo.clone()
        inst.geometry.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(4), 4))
        inst.geometry.setAttribute('iUv', new THREE.InstancedBufferAttribute(new Float32Array(4), 4))
        inst.geometry.setAttribute('iCust', new THREE.InstancedBufferAttribute(new Float32Array(4), 4))
        probe.add(inst)
      }
      const stage = new THREE.Scene()
      stage.fog = this.scene.fog
      stage.add(probe)
      await compileFor(renderer, stage, camera, target)
      stage.remove(probe)
      probe.traverse(o => {
        if (o.isInstancedMesh) {
          o.geometry.dispose()
          o.dispose()
        }
      })
    }
  }

  update(dt, camera) {
    time.value += dt
    if (camera) {
      camera.updateMatrixWorld()
      camera.matrixWorld.decompose(_camPos, _camQuat, _v)
      _camQuatInv.copy(_camQuat).invert()
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.update(dt, camera)
      if (it.done) {
        it.dispose()
        this.items.splice(i, 1)
      }
    }
  }

  kill(inst) {
    const i = this.items.indexOf(inst)
    if (i < 0) return
    this.items.splice(i, 1)
    inst.dispose()
  }

  clear() {
    for (const it of this.items) it.dispose()
    this.items.length = 0
  }
}
