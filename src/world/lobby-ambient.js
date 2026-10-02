import { Flipbooks, loadManifest } from './flipbook.js'

const BACKDROP = [
  { book: 'smoke_plume', x: -13, y: 1.5, z: -24, size: 16, color: 0x8a5a48, alpha: 0.9 },
  { book: 'smoke_plume', x: 11, y: 1, z: -27, size: 19, color: 0x7a4c3c, alpha: 0.85 },
  { book: 'smoke_plume', x: 1.5, y: 3, z: -34, size: 24, color: 0x6a3e32, alpha: 0.7 },
  { book: 'fire_loop', x: -12, y: 0.5, z: -21, size: 7.5, color: 0xffffff, alpha: 1 },
  { book: 'fire_loop', x: 10.5, y: 0.2, z: -23, size: 8.5, color: 0xffffff, alpha: 1 },
  { book: 'fire_loop', x: 17, y: 0.2, z: -12, size: 5.5, color: 0xffffff, alpha: 0.9 },
  { book: 'fire_loop', x: -17, y: 0.2, z: -10, size: 5, color: 0xffffff, alpha: 0.9 },
]

const HAZE_BOOK = 'haze_roll'
const HAZE_LANES = [
  { z: -8, y: -0.2, size: 5.5, alpha: 0.55 },
  { z: -12, y: -0.2, size: 7, alpha: 0.6 },
  { z: -17, y: 0, size: 9, alpha: 0.65 },
  { z: 4.5, y: -0.6, size: 3.2, alpha: 0.4, edge: 5.5 },
]
const HAZE_SPAN = 17
const HAZE_LIFE = [16, 24]
const HAZE_FADE = 4
const HAZE_DRIFT = [0.18, 0.4]
const HAZE_PER_LANE = 3

const BLASTS = [[-9, 3.5, -26], [8, 4, -28], [-2, 5, -32], [14, 3, -20], [-15, 3, -18]]

const rand = (a, b) => a + Math.random() * (b - a)

export class LobbyAmbient {
  constructor(parent, { tint = 0x6a3a2a, arena = 'fire', lights = null } = {}) {
    this.books = new Flipbooks(parent)
    this.tint = tint
    this.lights = lights
    this.arena = arena
    this.loops = []
    this.haze = []
    this.wind = Math.random() < 0.5 ? -1 : 1
    this.nextBlast = 2.5
    this.disposed = false
    loadManifest().then(() => { if (!this.disposed) this.start() })
  }

  start() {
    if (this.arena === 'fire') {
      for (const b of BACKDROP) {
        if (!this.books.has(b.book)) continue
        this.loops.push({ h: this.books.spawn(b.book, { x: b.x, y: b.y, z: b.z, size: b.size, color: b.color, alpha: b.alpha, rot: 0, fadeIn: 2.2, billboard: 'up' }), alpha: b.alpha })
      }
    }
    if (!this.books.has(HAZE_BOOK)) return
    HAZE_LANES.forEach(lane => {
      for (let k = 0; k < HAZE_PER_LANE; k++) this.puff(lane, (k + Math.random() * 0.6) / HAZE_PER_LANE, true)
    })
  }

  puff(lane, along, warm) {
    const span = HAZE_SPAN
    const x = lane.edge ? (Math.random() < 0.5 ? -1 : 1) * rand(lane.edge, lane.edge + 4) : (along * 2 - 1) * span
    const life = rand(...HAZE_LIFE)
    const h = this.books.spawn(HAZE_BOOK, {
      x,
      y: lane.y,
      z: lane.z + rand(-1.2, 1.2),
      vx: this.wind * rand(...HAZE_DRIFT),
      size: lane.size * rand(0.85, 1.2),
      color: this.tint,
      rot: 0,
      billboard: 'up',
      life,
      fadeIn: warm ? 2.5 : HAZE_FADE,
      fadeOut: HAZE_FADE,
    })
    if (!h) return
    if (warm) h.p.t = rand(0, life * 0.5)
    this.haze.push({ h, lane, alpha: lane.alpha })
  }

  blast() {
    if (!this.books.has('explosion_big')) return
    const [x, y, z] = BLASTS[(Math.random() * BLASTS.length) | 0]
    const jx = x + (Math.random() - 0.5) * 3
    this.books.spawn('explosion_big', { x: jx, y, z, size: 9 + Math.random() * 4, rot: 0, billboard: 'up' })
    if (this.lights) this.lights.flash({ x: jx, y: y + 2, z }, 0xff7a30, 3.2, 26, 0.9, 1)
  }

  update(dt, camera, fade = 1) {
    for (const l of this.loops) if (l.h) l.h.alpha = l.alpha * fade
    for (let i = this.haze.length - 1; i >= 0; i--) {
      const z = this.haze[i]
      if (z.h.alive) {
        z.h.alpha = z.alpha * fade
        continue
      }
      this.haze.splice(i, 1)
      this.puff(z.lane, this.wind > 0 ? Math.random() * 0.35 : 0.65 + Math.random() * 0.35, false)
    }
    if (this.arena === 'fire') {
      this.nextBlast -= dt
      if (this.nextBlast <= 0) {
        this.blast()
        this.nextBlast = 5 + Math.random() * 6
      }
    }
    if (camera) this.books.update(dt, camera, null)
  }

  dispose() {
    this.disposed = true
    this.books.dispose()
  }
}
