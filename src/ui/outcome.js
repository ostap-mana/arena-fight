import gsap from 'gsap'
import logoUrl from '../assets/GENERAL/lose-win/logo-invokers.webp'
import playNowUrl from '../assets/GENERAL/BUTTONS/play-now.webp'
import crownUrl from '../assets/GENERAL/lose-win/victory-crown.webp'
import { whenReleased } from './lazy.js'

const LOGO_ART = { w: 558, h: 131 }
const PLAY_ART = { w: 685, h: 164 }
const CROWN_ART = { w: 720, h: 441 }
const CROWN_W = { portrait: 0.46, landscape: 0.5 }
const CROWN_AIR = 0.06
const CROWN_DROP = { at: 0.34, duration: 0.62, lift: 0.55, scale: 1.18 }
const CROWN_BOB = { rate: 1.4, px: 2.2 }

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
    flash: '#fff4d8',
    bloom: '245, 198, 90',
    lamp: 0.42,
    idle: 0.36,
  },
  defeat: {
    flash: '#ffb5a4',
    bloom: '201, 80, 42',
    lamp: 0.3,
    idle: 0.26,
  },
}

const PLAY_W = { portrait: 0.9, landscape: 0.36 }
const PLAY_H = { portrait: 0.13, landscape: 0.17 }
const LOGO_W = 0.84
const STACK_Y = { portrait: 0.48, landscape: 0.5 }
const STACK_GAP = 0.32
const STACK_EDGE = 4
const PLATE_EDGE_AIR = 6

const PLAY_BEAT = { rate: 1.15, kick: 0.062, attack: 0.12, decay: 6.5 }

const FLASH_HOLD = 0.04
const FLASH_FADE = 0.55
const LOGO_DROP = { at: 0.06, duration: 0.62, lift: 0.4, scale: 1.16 }
const BLOOM_W = 0.62
const BLOOM_H = 1.1
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
    this.brand = root.querySelector('.brand')
    this.logo = root.querySelector('.logo')
    this.crown = root.querySelector('.crown')
    this.crownH = 0
    this.ui = 1
    this.control = root.querySelector('.control')
    this.plate = root.querySelector('.plate')
    this.flash = root.querySelector('.flash')
    this.side = SIDE.victory
    this.defeat = false
    this.armed = false
    this.introducing = false
    this.t = 0
    this.onCta = null
    this.warm = []
    whenReleased(() => {
      this.warm = [logoUrl, playNowUrl, crownUrl].map(warmImage)
      this.logo.src = logoUrl
      this.crown.src = crownUrl
      this.plate.src = playNowUrl
    })
    this.tick = this.tick.bind(this)
    const cta = e => {
      e.stopPropagation()
      if (this.armed) this.onCta?.()
    }
    this.control.addEventListener('click', cta)
    this.brand.addEventListener('click', cta)
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

    const room = ((w / 2 - PLATE_EDGE_AIR * ui) * 2) / (1 + PLAY_BEAT.kick)
    const play = fitArt(PLAY_ART, Math.min(w * PLAY_W[key], room), h * PLAY_H[key])
    const logo = fitArt(LOGO_ART, play.w * LOGO_W, 0)
    const crown = fitArt(CROWN_ART, logo.w * CROWN_W[key], 0)
    const crownRise = crown.h + logo.h * CROWN_AIR
    const gap = play.h * STACK_GAP
    const stack = crownRise + logo.h + gap + play.h
    const top = Math.max(STACK_EDGE * ui, h * STACK_Y[key] - stack / 2) + crownRise

    place(this.crown, cx - crown.w / 2, top - crownRise, crown.w, crown.h)
    this.crownH = crown.h
    this.ui = ui
    place(this.brand, cx - logo.w / 2, top, logo.w, logo.h)

    const bw = Math.max(80, logo.w * BLOOM_W)
    const bh = Math.max(80, logo.w * BLOOM_H)
    place(this.bloom, cx - bw / 2, top + logo.h / 2 - bh / 2, bw, bh)

    place(this.control, cx - play.w / 2, top + logo.h + gap, play.w, play.h)
  }

  show(kind) {
    const side = SIDE[kind]
    this.side = side
    this.defeat = kind === 'defeat'
    this.root.classList.toggle('defeat', this.defeat)
    if (!this.logo.getAttribute('src')) this.logo.src = logoUrl
    if (!this.plate.getAttribute('src')) this.plate.src = playNowUrl
    if (!this.crown.getAttribute('src')) this.crown.src = crownUrl
    this.bloom.style.setProperty('--tint', side.bloom)
    this.flash.style.background = side.flash
    this.root.classList.add('on')
    this.layout()

    const parts = [this.flash, this.brand, this.bloom, this.control, this.crown]
    gsap.killTweensOf(parts)
    this.t = 0
    this.armed = false
    this.introducing = true
    this.control.style.transform = ''

    gsap.set(this.flash, { opacity: 1 })
    gsap.set(this.brand, { opacity: 0, y: -this.brand.offsetHeight * LOGO_DROP.lift, scale: LOGO_DROP.scale })
    gsap.set([this.bloom, this.control], { opacity: 0 })
    gsap.set(this.crown, { opacity: 0, y: -this.crownH * CROWN_DROP.lift, scale: CROWN_DROP.scale })

    gsap.delayedCall(ARM_AFTER, () => { this.armed = true })
    gsap.to(this.flash, { opacity: 0, duration: FLASH_FADE, delay: FLASH_HOLD, ease: 'power2.out' })
    gsap.to(this.brand, { opacity: 1, duration: 0.2, delay: LOGO_DROP.at, ease: 'power1.out' })
    gsap.to(this.brand, { y: 0, scale: 1, duration: LOGO_DROP.duration, delay: LOGO_DROP.at, ease: 'back.out(2.2)' })
    gsap.to(this.crown, { opacity: 1, duration: 0.2, delay: CROWN_DROP.at, ease: 'power1.out' })
    gsap.to(this.crown, { y: 0, scale: 1, duration: CROWN_DROP.duration, delay: CROWN_DROP.at, ease: 'back.out(2.2)' })
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
    gsap.killTweensOf([this.flash, this.brand, this.bloom, this.control, this.crown])
    this.armed = false
    this.introducing = false
    this.root.classList.remove('on', 'defeat')
  }

  tick(time, deltaMs) {
    const dt = deltaMs / 1000
    this.t += dt
    if (this.introducing) return
    this.bloom.style.opacity = this.side.idle + Math.sin(this.t * 1.8) * 0.08
    const sway = Math.max(0, this.t - CROWN_DROP.at - CROWN_DROP.duration)
    gsap.set(this.crown, { y: Math.sin(sway * Math.PI * CROWN_BOB.rate) * CROWN_BOB.px * this.ui })
    const phase = (this.t * PLAY_BEAT.rate) % 1
    const beat = phase < PLAY_BEAT.attack
      ? phase / PLAY_BEAT.attack
      : Math.exp(-(phase - PLAY_BEAT.attack) * PLAY_BEAT.decay)
    this.control.style.transform = `scale(${1 + PLAY_BEAT.kick * beat})`
  }
}
