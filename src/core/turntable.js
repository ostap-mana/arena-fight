const TURNTABLE_SPEED = 0.11 * Math.PI / 180
const TURNTABLE_MOMENTUM = 5
const SWIPE_PRECISION = 2
const REFERENCE_SHORT_SIDE = 1080
const FLICK_WINDOW = 90
const VELOCITY_SMOOTH = 0.35
const MAX_VELOCITY = 4 * Math.PI
const IGNORED = '.card, .pick, button'

export class Turntable {
  constructor(el) {
    this.el = el
    this.enabled = false
    this.pointerId = null
    this.dragging = false
    this.startX = 0
    this.lastX = 0
    this.lastAt = 0
    this.scale = TURNTABLE_SPEED
    this.pending = 0
    this.velocity = 0
    this.bind()
  }

  bind() {
    this.el.addEventListener('pointerdown', e => this.down(e), { passive: true })
    this.el.addEventListener('pointermove', e => this.move(e), { passive: true })
    this.el.addEventListener('pointerup', e => this.up(e), { passive: true })
    this.el.addEventListener('pointercancel', e => this.up(e), { passive: true })
  }

  down(e) {
    if (!this.enabled || this.pointerId !== null) return
    if (e.target.closest && e.target.closest(IGNORED)) return
    const shortSide = Math.min(this.el.clientWidth, this.el.clientHeight) || REFERENCE_SHORT_SIDE
    this.scale = TURNTABLE_SPEED * REFERENCE_SHORT_SIDE / shortSide
    this.pointerId = e.pointerId
    this.dragging = false
    this.startX = this.lastX = e.clientX
    this.lastAt = e.timeStamp
    this.velocity = 0
    this.el.setPointerCapture?.(e.pointerId)
  }

  move(e) {
    if (e.pointerId !== this.pointerId) return
    if (!this.dragging) {
      if (Math.abs(e.clientX - this.startX) * this.scale / TURNTABLE_SPEED < SWIPE_PRECISION) return
      this.dragging = true
    }
    const turn = (e.clientX - this.lastX) * this.scale
    const elapsed = Math.max(1, e.timeStamp - this.lastAt) / 1000
    this.pending += turn
    this.velocity += (turn / elapsed - this.velocity) * VELOCITY_SMOOTH
    this.lastX = e.clientX
    this.lastAt = e.timeStamp
  }

  up(e) {
    if (e.pointerId !== this.pointerId) return
    if (!this.dragging || e.timeStamp - this.lastAt > FLICK_WINDOW) this.velocity = 0
    this.velocity = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, this.velocity))
    this.pointerId = null
    this.dragging = false
  }

  held() {
    return this.pointerId !== null
  }

  take(dt) {
    let turn = this.pending
    this.pending = 0
    if (!this.held() && this.velocity) {
      turn += this.velocity * dt
      this.velocity *= Math.exp(-TURNTABLE_MOMENTUM * dt)
      if (Math.abs(this.velocity) < 0.01) this.velocity = 0
    }
    return turn
  }

  stop() {
    this.pointerId = null
    this.dragging = false
    this.pending = 0
    this.velocity = 0
  }
}
