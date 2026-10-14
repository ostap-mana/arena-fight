import frameUrl from '../assets/GENERAL/HUD/bars/enemy-regular.webp'
import noiseUrl from '../assets/GENERAL/HUD/bars/fill-noise.webp'
import { view } from '../core/viewport.js'
import { removeAt } from '../core/list.js'

const BAR_W = 58
const BAR_H = 6.4
const INSET_X = 0.034
const INSET_Y = 0.125
const PAD = 4
const GHOST_COLOR = '#eb403b'
const FILL_COLOR = '#e6400f'
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.7)'
const SHADOW_Y = 1
const SHADOW_BLUR = 2
const FILL_TIME = 0.12
const GHOST_TIME = 0.45
const GHOST_DELAY = 0.22
const FADE_TIME = 0.35
const MAX_DPR = 2
const CURVE_STEPS = 64

function bezierCurve(x1, y1, x2, y2) {
  const table = new Float32Array(CURVE_STEPS + 1)
  const axis = (t, a, b) => 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t
  for (let i = 0; i <= CURVE_STEPS; i++) {
    const x = i / CURVE_STEPS
    let lo = 0
    let hi = 1
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2
      if (axis(mid, x1, x2) < x) lo = mid
      else hi = mid
    }
    table[i] = axis((lo + hi) / 2, y1, y2)
  }
  return p => {
    const x = Math.min(1, Math.max(0, p)) * CURVE_STEPS
    const i = Math.min(CURVE_STEPS - 1, Math.floor(x))
    return table[i] + (table[i + 1] - table[i]) * (x - i)
  }
}

const EASE = bezierCurve(0.25, 0.1, 0.25, 1)
const EASE_OUT = bezierCurve(0, 0, 0.58, 1)

function tween(value, time, delay, curve) {
  return { from: value, to: value, t: Infinity, time, delay, curve }
}

function tweenValue(tw) {
  if (tw.t <= tw.delay) return tw.from
  const p = (tw.t - tw.delay) / tw.time
  return p >= 1 ? tw.to : tw.from + (tw.to - tw.from) * tw.curve(p)
}

function retarget(tw, value) {
  if (value === tw.to) return
  tw.from = tweenValue(tw)
  tw.to = value
  tw.t = 0
}

function loadImage(url) {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  return img
}

export class EnemyBars {
  constructor(layer) {
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'ebars'
    layer.prepend(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.frame = loadImage(frameUrl)
    this.noise = loadImage(noiseUrl)
    this.bars = []
    this.sprite = document.createElement('canvas')
    this.spriteScale = 0
    this.painted = false
    this.last = 0
    this.dpr = 1
  }

  add() {
    const bar = {
      x: 0,
      y: 0,
      shown: false,
      k: 1,
      gone: false,
      fill: tween(1, FILL_TIME, 0, EASE_OUT),
      ghost: tween(1, GHOST_TIME, GHOST_DELAY, EASE),
      fade: tween(1, FADE_TIME, 0, EASE),
    }
    this.bars.push(bar)
    return bar
  }

  remove(bar) {
    const i = this.bars.indexOf(bar)
    if (i >= 0) removeAt(this.bars, i)
  }

  place(bar, x, y, visible, k, dead) {
    bar.x = x
    bar.y = y
    bar.shown = visible
    if (k !== bar.k) {
      bar.k = k
      retarget(bar.fill, k)
      retarget(bar.ghost, k)
    }
    if (dead && !bar.gone) {
      bar.gone = true
      retarget(bar.fade, 0)
    }
  }

  fit() {
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    const w = Math.max(1, Math.round(view.w * dpr))
    const h = Math.max(1, Math.round(view.h * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
      this.painted = true
    }
    this.dpr = dpr
  }

  bakeSprite(unit) {
    if (unit === this.spriteScale || !this.frame.complete || !this.frame.naturalWidth) return
    this.spriteScale = unit
    const s = this.sprite
    s.width = Math.ceil((BAR_W + PAD * 2) * unit)
    s.height = Math.ceil((BAR_H + PAD * 2) * unit)
    const c = s.getContext('2d')
    c.setTransform(unit, 0, 0, unit, 0, 0)
    c.clearRect(0, 0, BAR_W + PAD * 2, BAR_H + PAD * 2)
    c.shadowColor = SHADOW_COLOR
    c.shadowBlur = SHADOW_BLUR * unit
    c.shadowOffsetY = SHADOW_Y * unit
    c.drawImage(this.frame, PAD, PAD, BAR_W, BAR_H)
  }

  draw(scale) {
    const now = performance.now()
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0
    this.last = now
    const bars = this.bars
    let any = false
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]
      bar.fill.t += dt
      bar.ghost.t += dt
      bar.fade.t += dt
      if (bar.shown && tweenValue(bar.fade) > 0) any = true
    }
    if (!any && !this.painted) return
    this.fit()
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.painted = any
    if (!any) return
    const unit = this.dpr * scale
    this.bakeSprite(unit)
    const noise = this.noise.complete && this.noise.naturalWidth ? this.noise : null
    const ix = -BAR_W / 2 + BAR_W * INSET_X
    const iy = -BAR_H / 2 + BAR_H * INSET_Y
    const iw = BAR_W * (1 - INSET_X * 2)
    const ih = BAR_H * (1 - INSET_Y * 2)
    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]
      if (!bar.shown) continue
      const alpha = tweenValue(bar.fade)
      if (alpha <= 0) continue
      ctx.globalAlpha = alpha
      ctx.setTransform(unit, 0, 0, unit, bar.x * this.dpr, bar.y * this.dpr)
      if (this.spriteScale) ctx.drawImage(this.sprite, -BAR_W / 2 - PAD, -BAR_H / 2 - PAD, BAR_W + PAD * 2, BAR_H + PAD * 2)
      const g = tweenValue(bar.ghost)
      if (g > 0) {
        ctx.fillStyle = GHOST_COLOR
        ctx.fillRect(ix, iy, iw * g, ih)
      }
      const f = tweenValue(bar.fill)
      if (f > 0) {
        ctx.fillStyle = FILL_COLOR
        ctx.fillRect(ix, iy, iw * f, ih)
        if (noise) ctx.drawImage(noise, ix, iy, iw * f, ih)
      }
    }
    ctx.globalAlpha = 1
  }
}
