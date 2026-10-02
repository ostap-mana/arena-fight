import * as THREE from 'three'

const COUNT = 8

export const DYN_LIGHTS = {
  uDynPos: { value: Array.from({ length: COUNT }, () => new THREE.Vector4(0, -100, 0, 0)) },
  uDynCol: { value: Array.from({ length: COUNT }, () => new THREE.Vector3()) },
}

export const DYN_LIGHTS_GLSL = `
  uniform vec4 uDynPos[${COUNT}];
  uniform vec3 uDynCol[${COUNT}];
  vec3 dynLight(vec3 p, vec3 n) {
    vec3 sum = vec3(0.0);
    for (int i = 0; i < ${COUNT}; i++) {
      vec4 l = uDynPos[i];
      if (l.w <= 0.0) continue;
      vec3 d = l.xyz - p;
      float dist = length(d);
      float att = clamp(1.0 - dist / l.w, 0.0, 1.0);
      float wrap = clamp(dot(n, d / max(dist, 0.001)) * 0.7 + 0.3, 0.0, 1.0);
      sum += uDynCol[i] * (att * att * wrap);
    }
    return sum;
  }
`

const _c = new THREE.Color()

export class DynamicLights {
  constructor() {
    this.slots = Array.from({ length: COUNT }, () => ({ t: 0, life: 0, intensity: 0, radius: 0, color: new THREE.Color(), pos: new THREE.Vector3(), follow: null, offset: new THREE.Vector3() }))
    this.aura = this.slots[0]
    this.aura.life = Infinity
  }

  setAura(target, color, intensity = 1.1, radius = 5.5, height = 1.2) {
    const a = this.aura
    a.follow = target
    a.offset.set(0, height, 0)
    a.color.set(color)
    a.intensity = target ? intensity : 0
    a.radius = radius
  }

  flash(pos, color, intensity = 3, radius = 6, life = 0.4, height = 1) {
    let best = null
    for (let i = 1; i < COUNT; i++) {
      const s = this.slots[i]
      if (s.t >= s.life) { best = s; break }
      if (!best || s.life - s.t < best.life - best.t) best = s
    }
    best.t = 0
    best.life = life
    best.intensity = intensity
    best.radius = radius
    best.color.set(color)
    best.pos.set(pos.x, (pos.y || 0) + height, pos.z)
    best.follow = null
  }

  clear() {
    for (let i = 1; i < COUNT; i++) this.slots[i].t = this.slots[i].life = 0
    this.setAura(null, 0)
  }

  update(dt) {
    this.slots.forEach((s, i) => {
      const p = DYN_LIGHTS.uDynPos.value[i]
      const c = DYN_LIGHTS.uDynCol.value[i]
      let k = 0
      if (i === 0) k = s.intensity
      else if (s.t < s.life) {
        s.t += dt
        const x = Math.min(1, s.t / s.life)
        k = s.intensity * Math.min(1, x * 12) * (1 - x) * (1 - x)
      }
      if (s.follow) {
        s.pos.copy(s.follow.pos || s.follow.position).add(s.offset)
      }
      if (k <= 0.001) {
        p.w = 0
        return
      }
      _c.copy(s.color).convertSRGBToLinear()
      p.set(s.pos.x, s.pos.y, s.pos.z, s.radius)
      c.set(_c.r * k, _c.g * k, _c.b * k)
    })
  }
}
