import gsap from 'gsap'
import victoryBandUrl from '../assets/GENERAL/lose-win/victory-band.webp'
import defeatBandUrl from '../assets/GENERAL/lose-win/defeat-band.webp'
import playNowUrl from '../assets/GENERAL/BUTTONS/play-now.webp'
import retryPlateUrl from '../assets/GENERAL/BUTTONS/retry-plate.webp'
import crownUrl from '../assets/GENERAL/lose-win/victory-crown.webp'
import { whenReleased } from './lazy.js'

const VERDICT_ART = { w: 816, h: 266 }
const CROWN_ART = { w: 720, h: 441 }
const CROWN_W = { portrait: 0.5, landscape: 0.6 }
const CROWN_SEAT = 0.1
const CROWN_DROP = { at: 0.34, duration: 0.62, lift: 0.55, scale: 1.18 }
const CROWN_BOB = { rate: 1.4, px: 2.2 }
const PLAY_ART = { w: 685, h: 164 }
const RETRY_ART = { w: 472, h: 128 }

const SCRIM = {
  portrait: [
    [0.0, 0.88], [0.16, 0.44], [0.34, 0.54], [0.45, 0.87], [0.8, 0.89], [0.9, 0.7], [1.0, 0.84],
  ],
  landscape: [
    [0.0, 0.88], [0.13, 0.5], [0.26, 0.64], [0.44, 0.84], [0.64, 0.87], [0.82, 0.76], [1.0, 0.88],
  ],
}
const SCRIM_TINT = '34, 8, 7'
const SCRIM_DEPTH = 0.62

const SIDE = {
  victory: {
    band: victoryBandUrl,
    plate: playNowUrl,
    flash: '#fff4d8',
    bloom: '245, 198, 90',
    lamp: 0.42,
    idle: 0.36,
  },
  defeat: {
    band: defeatBandUrl,
    plate: retryPlateUrl,
    flash: '#ffb5a4',
    bloom: '201, 80, 42',
    lamp: 0.3,
    idle: 0.26,
  },
}

const VERDICT_W = { portrait: 1.0, landscape: 0.52 }
const VERDICT_H = { portrait: 0.2, landscape: 0.2 }
const STACK_Y = { portrait: 0.48, landscape: 0.5 }
const STACK_GAP = { portrait: 0.4, landscape: 0.3 }
const STACK_EDGE = 4

const RETRY_W = { portrait: 0.68, landscape: 0.34 }
const RETRY_MAX = { portrait: 0.26, landscape: 0.3 }
const PLAY_W = { portrait: 1, landscape: 0.54 }
const PLATE_EDGE_AIR = 6
const RETRY_LABEL_W = 0.6
const RETRY_LABEL_H = 0.4

const PLAY_BEAT = { rate: 1.15, kick: 0.062, attack: 0.12, decay: 6.5 }

const FLASH_HOLD = 0.04
const FLASH_FADE = 0.55
const UNFURL = { slitW: 0.34, slitH: 0.015, widen: 0.34, openAt: 0.12, open: 0.5 }
const BLOOM_FLARE = 1.75
const ARM_AFTER = 0.5
const CONTROL_AT = 0.72

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

function warmImage(url) {
  const img = new Image()
  img.src = url
  return img
}

function scrimGradient(stops) {
  return `linear-gradient(180deg, ${stops.map(([at, a]) => `rgba(${SCRIM_TINT},${(a * SCRIM_DEPTH).toFixed(3)}) ${at * 100}%`).join(', ')})`
}

function fitArt(art, w, maxH) {
  let h = (w * art.h) / art.w
  if (maxH > 0 && h > maxH) {
    h = maxH
    w = (h * art.w) / art.h
  }
  return { w, h }
}

function place(node, x, y, w, h) {
  node.style.left = `${x}px`
  node.style.top = `${y}px`
  node.style.width = `${w}px`
  node.style.height = `${h}px`
}

export class Outcome {
  constructor(root) {
    this.root = root
    this.scrim = root.querySelector('.scrim')
    this.bloom = root.querySelector('.bloom')
    this.band = root.querySelector('.band')
    this.verdict = root.querySelector('.verdict')
    this.crown = root.querySelector('.crown')
    this.crownH = 0
    this.ui = 1
    this.control = root.querySelector('.control')
    this.plate = root.querySelector('.plate')
    this.label = root.querySelector('.label')
    this.flash = root.querySelector('.flash')
    this.side = SIDE.victory
    this.defeat = false
    this.armed = false
    this.introducing = false
    this.t = 0
    this.onRetry = null
    this.onCta = null
    this.warm = []
    whenReleased(() => {
      this.warm = [...Object.values(SIDE).flatMap(s => [s.band, s.plate]), crownUrl].map(warmImage)
      this.crown.src = crownUrl
    })
    document.fonts?.load('500 20px Hitzone').catch(() => {})
    this.tick = this.tick.bind(this)
    this.control.addEventListener('click', e => {
      e.stopPropagation()
      if (!this.armed) return
      if (this.defeat) this.onRetry?.()
      else this.onCta?.()
    })
    addEventListener('resize', () => {
      if (this.root.classList.contains('on')) this.layout()
    })
  }

  layout() {
    const w = this.root.clientWidth
    const h = this.root.clientHeight
    const portrait = h >= w
    const key = portrait ? 'portrait' : 'landscape'
    const ui = clamp(Math.min(w, h) / 375, 0.72, 3.2)
    const cx = w / 2

    this.scrim.style.background = scrimGradient(SCRIM[key])

    const cap = clamp(h * VERDICT_H[key], 52 * ui, 176 * ui)
    let pw = w * VERDICT_W[key]
    let ph = (pw * VERDICT_ART.h) / VERDICT_ART.w
    if (ph > cap) {
      ph = cap
      pw = (ph * VERDICT_ART.w) / VERDICT_ART.h
    }

    const crownW = pw * CROWN_W[key]
    const crownH = (crownW * CROWN_ART.h) / CROWN_ART.w
    const crownRise = crownH - ph * CROWN_SEAT

    const offer = defeat => Math.min(
      w * (defeat ? RETRY_W[key] : PLAY_W[key]),
      Math.max(44 * ui, pw),
      Math.max(44 * ui, ((w / 2 - PLATE_EDGE_AIR * ui) * 2) / (defeat ? 1 : 1 + PLAY_BEAT.kick)),
    )
    const maxH = clamp(h * RETRY_MAX[key], 40 * ui, 340 * ui)
    const playBox = fitArt(PLAY_ART, offer(false), maxH)
    const box = this.defeat ? fitArt(RETRY_ART, offer(true), maxH) : playBox

    const gap = ph * STACK_GAP[key]
    const stack = crownRise + ph + gap + playBox.h
    const bandTop = Math.max(STACK_EDGE * ui, h * STACK_Y[key] - stack / 2) + crownRise
    const cy = bandTop + ph / 2

    place(this.band, cx - pw / 2, bandTop, pw, ph)
    place(this.crown, cx - crownW / 2, bandTop + ph * CROWN_SEAT - crownH, crownW, crownH)
    this.crownH = crownH
    this.ui = ui

    const bw = Math.max(80, pw * 0.62)
    const bh = Math.max(80, ph * 3.4)
    place(this.bloom, cx - bw / 2, cy - bh / 2, bw, bh)

    const controlMid = bandTop + ph + gap + playBox.h / 2
    place(this.control, cx - box.w / 2, controlMid - box.h / 2, box.w, box.h)

    if (this.defeat) this.fitLabel(box)
  }

  fitLabel(box) {
    const ideal = Math.max(12, box.h * RETRY_LABEL_H)
    const label = this.label
    label.style.fontSize = `${ideal}px`
    const width = label.scrollWidth
    const limit = box.w * RETRY_LABEL_W
    if (width > limit) label.style.fontSize = `${Math.max(8, (ideal * limit) / width)}px`
  }

  show(kind) {
    const side = SIDE[kind]
    this.side = side
    this.defeat = kind === 'defeat'
    this.root.classList.toggle('defeat', this.defeat)
    this.verdict.src = side.band
    this.plate.src = side.plate
    this.bloom.style.setProperty('--tint', side.bloom)
    this.flash.style.background = side.flash
    this.root.classList.add('on')
    this.layout()

    if (!this.crown.getAttribute('src')) this.crown.src = crownUrl
    const parts = [this.flash, this.band, this.bloom, this.control, this.crown]
    gsap.killTweensOf(parts)
    this.t = 0
    this.armed = false
    this.introducing = true
    this.control.style.transform = ''

    gsap.set(this.flash, { opacity: 1 })
    gsap.set(this.band, { opacity: 0, scaleX: UNFURL.slitW, scaleY: UNFURL.slitH })
    gsap.set([this.bloom, this.control], { opacity: 0 })
    gsap.set(this.crown, { opacity: 0, y: -this.crownH * CROWN_DROP.lift, scale: CROWN_DROP.scale })
    if (!this.defeat) {
      gsap.to(this.crown, { opacity: 1, duration: 0.2, delay: CROWN_DROP.at, ease: 'power1.out' })
      gsap.to(this.crown, { y: 0, scale: 1, duration: CROWN_DROP.duration, delay: CROWN_DROP.at, ease: 'back.out(2.2)' })
    }

    gsap.delayedCall(ARM_AFTER, () => { this.armed = true })
    gsap.to(this.flash, { opacity: 0, duration: FLASH_FADE, delay: FLASH_HOLD, ease: 'power2.out' })
    gsap.to(this.band, { opacity: 1, duration: 0.16, delay: 0.06, ease: 'power1.out' })
    gsap.to(this.band, { scaleX: 1, duration: UNFURL.widen, ease: 'expo.out' })
    gsap.to(this.band, { scaleY: 1, duration: UNFURL.open, delay: UNFURL.openAt, ease: 'back.out(1.70158)' })
    gsap.timeline()
      .to(this.bloom, { opacity: side.lamp * BLOOM_FLARE, duration: 0.18, ease: 'expo.out' })
      .to(this.bloom, { opacity: side.lamp, duration: 0.42, ease: 'power2.out' })
    gsap.to(this.control, {
      opacity: 1, duration: 0.3, delay: CONTROL_AT, ease: 'power1.out',
      onComplete: () => { this.introducing = false },
    })

    gsap.ticker.remove(this.tick)
    gsap.ticker.add(this.tick)
  }

  hide() {
    gsap.ticker.remove(this.tick)
    gsap.killTweensOf([this.flash, this.band, this.bloom, this.control, this.crown])
    this.armed = false
    this.introducing = false
    this.root.classList.remove('on', 'defeat')
  }

  tick(time, deltaMs) {
    const dt = deltaMs / 1000
    this.t += dt
    if (this.introducing) return
    this.bloom.style.opacity = this.side.idle + Math.sin(this.t * 1.8) * 0.08
    if (this.defeat) return
    const sway = Math.max(0, this.t - CROWN_DROP.at - CROWN_DROP.duration)
    gsap.set(this.crown, { y: Math.sin(sway * Math.PI * CROWN_BOB.rate) * CROWN_BOB.px * this.ui })
    const phase = (this.t * PLAY_BEAT.rate) % 1
    const beat = phase < PLAY_BEAT.attack
      ? phase / PLAY_BEAT.attack
      : Math.exp(-(phase - PLAY_BEAT.attack) * PLAY_BEAT.decay)
    this.control.style.transform = `scale(${1 + PLAY_BEAT.kick * beat})`
  }
}
