import * as THREE from 'three'
import { stream } from '../core/rng.js'
import { fetchJson } from '../core/fetch.js'

const random = stream('fx')

const BASE = 'assets/fx/eg/'
const loader = new THREE.TextureLoader()
const textures = new Map()
let manifest = null
let manifestReady = null

export const PALETTES = {
  fire: [[0, 0x000000], [0.18, 0x3a0600], [0.4, 0xc22a00], [0.62, 0xff6a10], [0.8, 0xffb347], [1, 0xfff4d6]],
  ember: [[0, 0x000000], [0.3, 0x5a0a00], [0.6, 0xe0400a], [0.85, 0xffa040], [1, 0xffe8b0]],
  arcane: [[0, 0x000000], [0.2, 0x1c0633], [0.45, 0x6a1fd8], [0.7, 0xb46cff], [0.88, 0xe6c8ff], [1, 0xffffff]],
  water: [[0, 0x000000], [0.2, 0x02152e], [0.45, 0x0a64c8], [0.7, 0x3fc2ff], [0.88, 0xbdf0ff], [1, 0xffffff]],
  nature: [[0, 0x000000], [0.22, 0x0e2400], [0.5, 0x4caa12], [0.75, 0xa6ff4a], [1, 0xf4ffd8]],
  holy: [[0, 0x000000], [0.22, 0x3a2400], [0.5, 0xd89a20], [0.75, 0xffd870], [1, 0xfffbe8]],
  blood: [[0, 0x000000], [0.25, 0x300000], [0.55, 0xc40c18], [0.8, 0xff5a4a], [1, 0xffe0d8]],
}
const PALETTE_NAMES = Object.keys(PALETTES)
const RAMP_W = 256

function hexRgb(h) {
  const c = new THREE.Color(h)
  return [c.r, c.g, c.b]
}

function buildRamp() {
  const rows = PALETTE_NAMES.length
  const data = new Uint8Array(RAMP_W * rows * 4)
  PALETTE_NAMES.forEach((name, row) => {
    const stops = PALETTES[name].map(([t, h]) => [t, hexRgb(h)])
    for (let x = 0; x < RAMP_W; x++) {
      const t = x / (RAMP_W - 1)
      let i = 0
      while (i < stops.length - 2 && t > stops[i + 1][0]) i++
      const [t0, c0] = stops[i]
      const [t1, c1] = stops[i + 1]
      const k = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-5, t1 - t0)))
      const o = (row * RAMP_W + x) * 4
      for (let j = 0; j < 3; j++) data[o + j] = Math.round(Math.pow(c0[j] + (c1[j] - c0[j]) * k, 1 / 2.2) * 255)
      data[o + 3] = 255
    }
  })
  const tex = new THREE.DataTexture(data, RAMP_W, rows)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}
const RAMP = buildRamp()

export function paletteRow(name) {
  const i = PALETTE_NAMES.indexOf(name)
  return ((i < 0 ? 0 : i) + 0.5) / PALETTE_NAMES.length
}

export function loadManifest() {
  if (!manifestReady) {
    manifestReady = fetchJson(`${BASE}flipbooks.json`)
      .catch(() => ({}))
      .then(m => (manifest = m))
  }
  return manifestReady
}

function texture(file, srgb) {
  const key = `${file}|${srgb}`
  if (textures.has(key)) return textures.get(key)
  const entry = { tex: null, ready: null }
  entry.ready = new Promise(resolve => {
    loader.load(`${BASE}${file}.webp`, t => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
      t.anisotropy = 4
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.premultiplyAlpha = false
      entry.tex = t
      resolve(t)
    }, undefined, () => resolve(null))
  })
  textures.set(key, entry)
  return entry
}

export async function preloadFlipbooks(names) {
  await loadManifest()
  await Promise.all(names.filter(n => manifest[n]).map(n => {
    const d = manifest[n]
    return Promise.all([texture(d.file, true).ready, d.mv ? texture(d.mv, false).ready : null])
  }))
}

const VS = `
  attribute vec4 iPosRot;
  attribute vec4 iSizeFrame;
  attribute vec4 iTint;
  attribute vec4 iGain;
  attribute vec2 iRamp;
  uniform vec2 uGrid;
  uniform float uFrames;
  uniform float uLoop;
  uniform vec2 uPivot;
  uniform float uFogDensity;
  varying vec2 vUv0;
  varying vec2 vUv1;
  varying vec2 vCell;
  varying float vBlend;
  varying vec4 vTint;
  varying vec4 vGain;
  varying vec2 vRamp;
  varying float vFog;
  varying float vY;
  vec2 cellUv(float f, vec2 uv) {
    float c = mod(f, uGrid.x);
    float r = floor(f / uGrid.x);
    return vec2((c + uv.x) / uGrid.x, 1.0 - (r + 1.0 - uv.y) / uGrid.y);
  }
  void main() {
    vec2 corner = (position.xy - uPivot) * iSizeFrame.xy;
    float cs = cos(iPosRot.w);
    float sn = sin(iPosRot.w);
    corner = vec2(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs);
    vec3 base = iPosRot.xyz;
#if BILLBOARD == 0
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 world = base + right * corner.x + up * corner.y;
#elif BILLBOARD == 1
    vec3 toCam = cameraPosition - base;
    toCam.y = 0.0;
    float l = length(toCam);
    toCam = l > 1e-4 ? toCam / l : vec3(0.0, 0.0, 1.0);
    vec3 right = vec3(toCam.z, 0.0, -toCam.x);
    vec3 world = base + right * corner.x + vec3(0.0, corner.y, 0.0);
#else
    vec3 world = base + vec3(corner.x, 0.0, -corner.y);
#endif
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    float f = iSizeFrame.z;
    float f0 = floor(f);
    float f1 = f0 + 1.0;
    f1 = uLoop > 0.5 ? mod(f1, uFrames) : min(f1, uFrames - 1.0);
    vBlend = f - f0;
    vUv0 = cellUv(f0, uv);
    vUv1 = cellUv(f1, uv);
    vCell = uv;
    vTint = iTint;
    vGain = iGain;
    vRamp = iRamp;
    float d = length(mv.xyz) * uFogDensity;
    vFog = 1.0 - exp(-d * d);
    vY = world.y;
  }`

const FS = `
  uniform sampler2D uMap;
  uniform sampler2D uMV;
  uniform sampler2D uRamp;
  uniform vec2 uMvScale;
  uniform vec3 uFogColor;
  uniform float uGroundY;
  uniform vec3 uSmoke;
  varying vec2 vUv0;
  varying vec2 vUv1;
  varying vec2 vCell;
  varying float vBlend;
  varying vec4 vTint;
  varying vec4 vGain;
  varying vec2 vRamp;
  varying float vFog;
  varying float vY;
  void main() {
    vec2 uv0 = vUv0;
    vec2 uv1 = vUv1;
#ifdef USE_MV
    vec2 m0 = (texture2D(uMV, uv0).rg * 2.0 - 1.0) * uMvScale;
    vec2 m1 = (texture2D(uMV, uv1).rg * 2.0 - 1.0) * uMvScale;
    uv0 -= m0 * vBlend;
    uv1 += m1 * (1.0 - vBlend);
#endif
    vec4 c = mix(texture2D(uMap, uv0), texture2D(uMap, uv1), vBlend);
    vec2 e = smoothstep(vec2(0.0), vec2(0.02), vCell) * smoothstep(vec2(1.0), vec2(0.98), vCell);
    c *= e.x * e.y;
#if COLOR_MODE == 0
    vec3 rgb = c.rgb * vTint.rgb * vGain.x;
    float a = c.a;
#elif COLOR_MODE == 1
    float heat = c.r;
    vec3 ramp = texture2D(uRamp, vec2(clamp(heat * vRamp.y, 0.0, 1.0), vRamp.x)).rgb;
    vec3 rgb = ramp * heat * vGain.x * vTint.rgb + uSmoke * c.g * c.a;
    float a = c.a;
#else
    float lum = max(c.r, max(c.g, c.b));
    vec3 ramp = texture2D(uRamp, vec2(clamp(lum * vRamp.y, 0.0, 1.0), vRamp.x)).rgb;
    vec3 rgb = mix(c.rgb, ramp * lum, 0.85) * vTint.rgb * vGain.x;
    float a = c.a;
#endif
    float k = vTint.a;
    if (vGain.z > 0.0) k *= smoothstep(0.0, vGain.z, vY - uGroundY);
    a *= vGain.y * (1.0 - vGain.w);
    rgb *= k;
    a *= k;
    rgb = rgb * (1.0 - vFog) + uFogColor * a * vFog;
    gl_FragColor = vec4(rgb, a);
  }`

const QUAD = (() => {
  const g = new THREE.InstancedBufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
  g.setIndex([0, 1, 2, 0, 2, 3])
  return g
})()

const BILLBOARDS = { face: 0, up: 1, ground: 2 }
const COLOR_MODES = { premul: 0, heat: 1, tint: 2 }
const _view = new THREE.Vector3()

class Batch {
  constructor(def, billboard, capacity) {
    this.def = def
    this.capacity = capacity
    this.items = []
    const g = new THREE.InstancedBufferGeometry()
    g.index = QUAD.index
    g.setAttribute('position', QUAD.getAttribute('position'))
    g.setAttribute('uv', QUAD.getAttribute('uv'))
    const attr = (name, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size)
      a.setUsage(THREE.DynamicDrawUsage)
      g.setAttribute(name, a)
      return a
    }
    this.aPos = attr('iPosRot', 4)
    this.aSize = attr('iSizeFrame', 4)
    this.aTint = attr('iTint', 4)
    this.aGain = attr('iGain', 4)
    this.aRamp = attr('iRamp', 2)
    g.instanceCount = 0
    this.geo = g
    const color = texture(def.file, true)
    const mv = def.mv ? texture(def.mv, false) : null
    const defines = { BILLBOARD: BILLBOARDS[billboard] ?? 0, COLOR_MODE: COLOR_MODES[def.color] ?? 0 }
    if (mv) defines.USE_MV = ''
    const [cols, rows] = def.grid
    const mvs = def.mvStrength ?? 0
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: color.tex },
        uMV: { value: mv ? mv.tex : null },
        uRamp: { value: RAMP },
        uMvScale: { value: new THREE.Vector2(mvs / cols, mvs / rows) },
        uGrid: { value: new THREE.Vector2(cols, rows) },
        uFrames: { value: def.frames },
        uLoop: { value: def.loop ? 1 : 0 },
        uPivot: { value: new THREE.Vector2(...(def.pivot || [0, 0])) },
        uFogDensity: { value: 0 },
        uFogColor: { value: new THREE.Color() },
        uGroundY: { value: 0 },
        uSmoke: { value: new THREE.Color(...(def.smoke || [0.05, 0.04, 0.05])) },
      },
      defines,
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      fog: false,
    })
    this.mesh = new THREE.Mesh(g, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = def.renderOrder ?? 6
    this.mesh.visible = false
    this.ready = Promise.all([color.ready, mv ? mv.ready : null]).then(([c, m]) => {
      this.mat.uniforms.uMap.value = c
      if (mv) this.mat.uniforms.uMV.value = m
      return !!c
    })
    this.loaded = false
    this.ready.then(ok => { this.loaded = ok })
  }

  add(p) {
    if (this.items.length >= this.capacity) {
      const old = this.items.shift()
      old.alive = false
    }
    this.items.push(p)
  }

  upload(camera, fog) {
    const items = this.items
    const n = items.length
    const visible = this.loaded && n > 0
    this.mesh.visible = visible
    if (!visible) return
    for (const p of items) p.depth = _view.set(p.x, p.y, p.z).applyMatrix4(camera.matrixWorldInverse).z
    items.sort((a, b) => a.depth - b.depth)
    const P = this.aPos.array
    const S = this.aSize.array
    const T = this.aTint.array
    const G = this.aGain.array
    const R = this.aRamp.array
    for (let i = 0; i < n; i++) {
      const p = items[i]
      const o = i * 4
      P[o] = p.x; P[o + 1] = p.y; P[o + 2] = p.z; P[o + 3] = p.rot
      S[o] = p.w; S[o + 1] = p.h; S[o + 2] = p.frame; S[o + 3] = 0
      T[o] = p.r; T[o + 1] = p.g; T[o + 2] = p.b; T[o + 3] = p.alpha
      G[o] = p.emissive; G[o + 1] = p.opacity; G[o + 2] = p.soft; G[o + 3] = p.additive
      R[i * 2] = p.ramp; R[i * 2 + 1] = p.rampScale
    }
    for (const a of [this.aPos, this.aSize, this.aTint, this.aGain, this.aRamp]) {
      a.clearUpdateRanges()
      a.addUpdateRange(0, n * a.itemSize)
      a.needsUpdate = true
    }
    this.geo.instanceCount = n
    const u = this.mat.uniforms
    if (fog && fog.isFogExp2) {
      u.uFogDensity.value = fog.density * (this.def.fog ?? 1)
      u.uFogColor.value.copy(fog.color)
    } else {
      u.uFogDensity.value = 0
    }
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

const _c = new THREE.Color()

function ease(k, a, b) {
  const t = Math.min(1, Math.max(0, (k - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export class Flipbooks {
  constructor(parent) {
    this.group = new THREE.Group()
    parent.add(this.group)
    this.batches = new Map()
    this.ready = loadManifest()
    this.time = 0
  }

  has(name) {
    return !!(manifest && manifest[name])
  }

  def(name) {
    return manifest ? manifest[name] : null
  }

  batch(name, billboard) {
    const key = `${name}|${billboard}`
    let b = this.batches.get(key)
    if (!b) {
      const def = manifest[name]
      b = new Batch(def, billboard, def.capacity || 48)
      this.batches.set(key, b)
      this.group.add(b.mesh)
    }
    return b
  }

  spawn(name, o = {}) {
    if (!this.has(name)) return null
    const def = manifest[name]
    const billboard = o.billboard || def.billboard || 'face'
    const b = this.batch(name, billboard)
    const aspect = def.aspect || 1
    const size = o.size ?? def.size ?? 2
    _c.set(o.color ?? 0xffffff)
    const fps = (o.fps ?? def.fps ?? 30) * (o.speed ?? 1)
    const loop = o.loop ?? !!def.loop
    const frames = def.frames
    const p = {
      alive: true,
      x: o.x || 0, y: o.y || 0, z: o.z || 0,
      vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0,
      drag: o.drag ?? 0,
      rot: o.rot ?? (def.randomRot === false ? 0 : random() * Math.PI * 2),
      spin: o.spin ?? 0,
      w: size * aspect, h: size,
      size0: size, grow: o.grow ?? 0,
      frame: o.frame ?? (loop ? random() * frames : 0),
      fps, loop, frames,
      t: 0,
      life: o.life ?? (loop ? Infinity : frames / fps),
      fadeIn: o.fadeIn ?? (loop ? 0.6 : 0),
      fadeOut: o.fadeOut ?? (loop ? 0.8 : 0.12),
      stopT: -1,
      r: _c.r, g: _c.g, b: _c.b,
      intensity: o.alpha ?? 1,
      alpha: 0,
      emissive: o.emissive ?? def.emissive ?? 1,
      opacity: o.opacity ?? def.opacity ?? 1,
      soft: o.soft ?? def.soft ?? 0,
      additive: o.additive ?? def.additive ?? 0,
      ramp: paletteRow(o.palette || def.palette || 'fire'),
      rampScale: o.rampScale ?? 1,
      follow: o.follow || null,
      offset: o.follow ? [o.x || 0, o.y || 0, o.z || 0] : null,
      aspect,
    }
    b.add(p)
    return {
      p,
      stop(fade) {
        if (!p.alive || p.stopT >= 0) return
        if (fade !== undefined) p.fadeOut = fade
        p.stopT = p.t
      },
      move(x, y, z) { p.x = x; p.y = y; p.z = z },
      get alive() { return p.alive },
      set alpha(v) { p.intensity = v },
    }
  }

  update(dt, camera, fog) {
    this.time += dt
    for (const b of this.batches.values()) {
      const items = b.items
      for (let i = items.length - 1; i >= 0; i--) {
        const p = items[i]
        p.t += dt
        let fade
        if (p.stopT >= 0) {
          const k = (p.t - p.stopT) / Math.max(1e-3, p.fadeOut)
          if (k >= 1) p.alive = false
          fade = 1 - ease(k, 0, 1)
        } else if (p.t >= p.life) {
          p.alive = false
        } else {
          fade = 1
          if (p.fadeIn > 0) fade *= ease(p.t, 0, p.fadeIn)
          if (p.life !== Infinity && p.fadeOut > 0) fade *= 1 - ease(p.t, p.life - p.fadeOut, p.life)
        }
        if (!p.alive) {
          items.splice(i, 1)
          continue
        }
        p.alpha = fade * p.intensity
        p.frame = p.loop ? (p.frame + p.fps * dt) % p.frames : Math.min(p.frames - 1.001, p.frame + p.fps * dt)
        if (p.drag) {
          const d = Math.exp(-p.drag * dt)
          p.vx *= d; p.vy *= d; p.vz *= d
        }
        if (p.follow) {
          p.x = p.follow.x + p.offset[0]
          p.y = p.follow.y + p.offset[1]
          p.z = p.follow.z + p.offset[2]
        } else {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
        }
        p.rot += p.spin * dt
        if (p.grow) {
          const s = p.size0 * (1 + p.grow * p.t)
          p.w = s * p.aspect
          p.h = s
        }
      }
      b.upload(camera, fog)
    }
  }

  clear() {
    for (const b of this.batches.values()) {
      for (const p of b.items) p.alive = false
      b.items.length = 0
    }
  }

  dispose() {
    for (const b of this.batches.values()) b.dispose()
    this.batches.clear()
    this.group.parent?.remove(this.group)
  }
}
