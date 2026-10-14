import * as THREE from 'three'
import { safeFragment } from './safe-shader.js'
import { LOW_TIER } from '../core/tier.js'

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
      float ang = r > 1e-4 ? atan(abs(p.x), -p.y) : 0.0;
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
    fragmentShader: safeFragment(fragmentShader),
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

    const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    this.warnPool = new Pool(() => {
      const m = new THREE.Mesh(flatGeo, glowMaterial(FLAT_VS, WARN_FS, {
        uColor: { value: new THREE.Color() },
        uFill: { value: 0 },
        uAlpha: { value: 0 },
        uArc: { value: Math.PI + 0.1 },
        uRect: { value: 0 },
        uSize: { value: new THREE.Vector2(1, 1) },
        uThick: { value: 0.2 },
      }))
      m.frustumCulled = false
      m.visible = false
      m.renderOrder = 2
      this.group.add(m)
      return m
    })
    this.warmed = [this.warnPool, this.warnPool.warm()]
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

  dropWarn(item) {
    if (item) item.t = item.life
  }

  update(dt) {
    if (this.warmed) {
      const [p, o] = this.warmed
      if (p.free.includes(o)) o.visible = false
      this.warmed = null
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      it.t += dt
      if (it.t >= it.life) {
        it.pool.release(it.o)
        this.items.splice(i, 1)
        continue
      }
      const u = it.o.material.uniforms
      const w = it.t / it.windup
      if (w < 1) {
        u.uFill.value = 1 - Math.pow(1 - w, 1.6)
        u.uAlpha.value = smooth(0, 0.15, it.t) * (0.75 + 0.25 * Math.sin(it.t * 14))
      } else {
        u.uFill.value = 1.2
        u.uAlpha.value = 1.7 * (1 - smooth(0, WARN_BURST, it.t - it.windup))
      }
    }
  }
}
