import * as THREE from 'three'

const IGNORED = '#animacard, #gearring, button, .card, .store, .replay'
const CONTROLS = '.skill, #ultbtn'
const TAP_TIME = 500
const TAP_SLOP = 14
const FLICK_TIME = 320
const FLICK_DIST = 46
const STICK_RANGE = 100 / 216
const STICK_DEAD = 0.2

export class Input {
  constructor(root) {
    this.root = root
    this.move = new THREE.Vector2()
    this.keys = new Set()
    this.pointerId = null
    this.origin = new THREE.Vector2()
    this.stick = null
    this.knob = null
    this.radius = 56
    this.enabled = false
    this.pressed = { s1: false, s2: false, dash: false, attack: false }
    this.start = new THREE.Vector2()
    this.downAt = 0
    this.travel = 0
    this.onTap = null
    this.onFlick = null
    this.onSteer = null
    this.bind()
  }

  attachStick(el) {
    this.stick = el
    this.knob = el.querySelector('.knob')
  }

  overControls(x, y) {
    const pad = 10
    for (const el of document.querySelectorAll('#skills .skill, #ultbtn')) {
      const r = el.getBoundingClientRect()
      if (!r.width || getComputedStyle(el).opacity === '0') continue
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      if (Math.hypot(x - cx, y - cy) < r.width / 2 + pad) return true
    }
    return false
  }

  stickRadius() {
    return this.stick ? Math.max(40, this.stick.offsetWidth * STICK_RANGE) : this.radius
  }

  placeStick() {
    if (!this.stick) return
    const half = this.stick.offsetWidth / 2
    this.stick.style.left = `${this.origin.x - half}px`
    this.stick.style.bottom = `${innerHeight - this.origin.y - half}px`
  }

  release() {
    this.pointerId = null
    this.move.set(0, 0)
    if (this.knob) this.knob.style.transform = 'translate(0,0)'
    if (this.stick) {
      this.stick.classList.remove('held')
      this.stick.style.left = ''
      this.stick.style.bottom = ''
    }
  }

  bind() {
    addEventListener('keydown', e => {
      this.keys.add(e.code)
      if (e.code === 'Space') e.preventDefault()
    })
    addEventListener('keyup', e => this.keys.delete(e.code))
    addEventListener('blur', () => {
      this.keys.clear()
      this.release()
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.release()
    })

    const down = e => {
      if (!this.enabled) return
      if (this.pointerId !== null && e.pointerId !== this.pointerId) return
      const t = e.target
      if (t.closest && t.closest(IGNORED)) return
      const onControl = !!(t.closest && t.closest(CONTROLS)) || this.overControls(e.clientX, e.clientY)
      this.pointerId = e.pointerId
      this.fromControl = onControl
      this.radius = this.stickRadius()
      this.origin.set(e.clientX, e.clientY)
      this.start.set(e.clientX, e.clientY)
      this.downAt = performance.now()
      this.travel = 0
      this.move.set(0, 0)
      if (this.knob) this.knob.style.transform = 'translate(0,0)'
      if (onControl) return
      this.placeStick()
    }
    const move = e => {
      if (e.pointerId !== this.pointerId) return
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        this.release()
        return
      }
      this.travel = Math.max(this.travel, Math.hypot(e.clientX - this.start.x, e.clientY - this.start.y))
      if (this.fromControl) {
        if (this.travel <= TAP_SLOP) return
        this.fromControl = false
        this.placeStick()
      }
      if (this.travel > TAP_SLOP) {
        if (this.stick) this.stick.classList.add('held')
        if (this.onSteer) this.onSteer()
      }
      let dx = e.clientX - this.origin.x
      let dy = e.clientY - this.origin.y
      const len = Math.hypot(dx, dy)
      if (len > this.radius) {
        const k = this.radius / len
        this.origin.set(e.clientX - dx * k, e.clientY - dy * k)
        dx *= k
        dy *= k
        this.placeStick()
      }
      this.move.set(dx / this.radius, dy / this.radius)
      if (this.knob) this.knob.style.transform = `translate(${dx}px, ${dy}px)`
    }
    const up = e => {
      if (e.pointerId !== this.pointerId) return
      if (this.fromControl) {
        this.fromControl = false
        this.release()
        return
      }
      const held = performance.now() - this.downAt
      const fx = e.clientX - this.start.x
      const fy = e.clientY - this.start.y
      const dist = Math.hypot(fx, fy)
      const tapped = e.type === 'pointerup' && held < TAP_TIME && this.travel < TAP_SLOP
      const flicked = e.type === 'pointerup' && held < FLICK_TIME && dist >= FLICK_DIST
      this.release()
      if (tapped && this.onTap) this.onTap(e.clientX, e.clientY)
      else if (flicked && this.onFlick) this.onFlick(fx / dist, fy / dist)
    }

    addEventListener('pointerdown', down, { passive: true, capture: true })
    addEventListener('pointermove', move, { passive: true })
    addEventListener('pointerup', up, { passive: true })
    addEventListener('pointercancel', up, { passive: true })
  }

  tapOn(pointerId) {
    return this.enabled && this.pointerId === pointerId && this.fromControl
  }

  stickAxis() {
    const len = Math.hypot(this.move.x, this.move.y)
    if (len < STICK_DEAD) return [0, 0]
    return [this.move.x / len, this.move.y / len]
  }

  axis() {
    let [x, y] = this.stickAxis()
    const k = this.keys
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1
    const len = Math.hypot(x, y)
    if (len > 1) { x /= len; y /= len }
    return [x, y]
  }

  consume(name) {
    if (this.pressed[name]) { this.pressed[name] = false; return true }
    return false
  }

  keyOnce(code) {
    if (this.keys.has(code)) { this.keys.delete(code); return true }
    return false
  }
}
