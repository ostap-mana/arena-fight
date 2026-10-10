import * as THREE from 'three'
import { safeFragment } from './safe-shader.js'

const WIDTH = 0.92
const ARROW_LEN = WIDTH * 2
const SPACING = 2.35
const SPEED = 2.4
const LIFT = 0.07
const START_GAP = 0.85
const MIN_LENGTH = 1.2
const FADE_IN = 3.2
const FADE_OUT = 5
const FOLLOW = 9
const GREEN = new THREE.Color(0.0118, 0.8524, 0.0417).multiplyScalar(1.55)

const VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const FS = `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uLength;
uniform float uTime;
uniform float uArrow;
uniform float uSpacing;
uniform float uSpeed;
varying vec2 vUv;
void main() {
  float d = vUv.y * uLength;
  float run = (d - uTime * uSpeed) / uArrow;
  float cell = uSpacing / uArrow;
  float u = mod(run, cell);
  vec2 grad = vec2(run, vUv.x);
  vec4 t = textureGrad(uMap, vec2(u, vUv.x), dFdx(grad), dFdy(grad));
  float shape = t.a * max(t.r, max(t.g, t.b)) * step(u, 1.0);
  float ends = smoothstep(0.0, 1.1, d) * smoothstep(0.0, 1.5, uLength - d);
  float a = shape * ends * uAlpha;
  gl_FragColor = vec4(uColor * a, 1.0);
}`

function stripGeometry() {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, -0.5, 0, 1, 0.5, 0, 1], 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2))
  g.setIndex([0, 2, 1, 1, 2, 3])
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0.5), 0.75)
  return g
}

export class GuideLine {
  constructor(scene) {
    this.uniforms = {
      uMap: { value: null },
      uColor: { value: GREEN.clone() },
      uAlpha: { value: 0 },
      uLength: { value: 1 },
      uTime: { value: 0 },
      uArrow: { value: ARROW_LEN },
      uSpacing: { value: SPACING },
      uSpeed: { value: SPEED },
    }
    this.mesh = new THREE.Mesh(stripGeometry(), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VS,
      fragmentShader: safeFragment(FS),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }))
    this.mesh.name = 'guide-line'
    this.mesh.renderOrder = 2
    this.mesh.visible = false
    scene.add(this.mesh)
    this.end = new THREE.Vector3()
    this.alpha = 0
    this.time = 0
    this.warming = false
  }

  setMap(texture) {
    this.uniforms.uMap.value = texture
  }

  get ready() {
    return !!this.uniforms.uMap.value
  }

  warm(on) {
    this.warming = on && this.ready
    this.mesh.visible = this.warming
    if (on) this.mesh.position.set(0, -40, 0)
  }

  update(dt, from, to, gap) {
    if (this.warming) return
    const showing = !!to && this.ready
    if (showing) {
      if (this.alpha <= 0.001) this.end.set(to.x, 0, to.z)
      else {
        const k = Math.min(1, dt * FOLLOW)
        this.end.x += (to.x - this.end.x) * k
        this.end.z += (to.z - this.end.z) * k
      }
    }
    const dx = this.end.x - (from ? from.x : 0)
    const dz = this.end.z - (from ? from.z : 0)
    const dist = Math.hypot(dx, dz)
    const length = dist - START_GAP - (gap || 0)
    const wanted = showing && from && length > MIN_LENGTH ? 1 : 0
    this.alpha = wanted > this.alpha ? Math.min(1, this.alpha + dt * FADE_IN) : Math.max(0, this.alpha - dt * FADE_OUT)
    this.time += dt
    this.mesh.visible = this.alpha > 0.001 && !!from && length > 0.05
    if (!this.mesh.visible) return
    const nx = dx / dist
    const nz = dz / dist
    this.mesh.position.set(from.x + nx * START_GAP, from.y + LIFT, from.z + nz * START_GAP)
    this.mesh.rotation.set(0, Math.atan2(nx, nz), 0)
    this.mesh.scale.set(WIDTH, 1, length)
    this.uniforms.uLength.value = length
    this.uniforms.uTime.value = this.time
    this.uniforms.uAlpha.value = this.alpha * this.alpha * (3 - 2 * this.alpha)
  }

  clear() {
    this.alpha = 0
    this.mesh.visible = false
  }
}
