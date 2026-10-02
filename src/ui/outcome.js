import gsap from 'gsap'
import victoryBandUrl from '../assets/GENERAL/lose-win/victory-band.webp'
import defeatBandUrl from '../assets/GENERAL/lose-win/defeat-band.webp'
import victoryFigureUrl from '../assets/GENERAL/lose-win/victory-figure.webp'
import defeatFigureUrl from '../assets/GENERAL/lose-win/defeat-figure.webp'
import ricklowVictoryFigureUrl from '../assets/GENERAL/lose-win/ricklow-victory.webp'
import ricklowDefeatFigureUrl from '../assets/GENERAL/lose-win/ricklow-defeat.webp'
import ardellVictoryFigureUrl from '../assets/GENERAL/lose-win/ardell-victory.webp'
import ardellDefeatFigureUrl from '../assets/GENERAL/lose-win/ardell-defeat.webp'
import confarVictoryFigureUrl from '../assets/GENERAL/lose-win/confar-victory.webp'
import confarDefeatFigureUrl from '../assets/GENERAL/lose-win/confar-defeat.webp'
import playNowUrl from '../assets/GENERAL/BUTTONS/play-now.webp'
import retryPlateUrl from '../assets/GENERAL/BUTTONS/retry-plate.webp'

const VERDICT_ART = { w: 816, h: 266 }
const PLAY_ART = { w: 640, h: 164 }
const RETRY_ART = { w: 472, h: 128 }

const SCRIM = {
  portrait: [
    [0.0, 0.88], [0.16, 0.44], [0.34, 0.54], [0.45, 0.87], [0.8, 0.89], [0.9, 0.7], [1.0, 0.84],
  ],
  landscape: [
    [0.0, 0.88], [0.13, 0.5], [0.26, 0.64], [0.44, 0.84], [0.64, 0.87], [0.82, 0.76], [1.0, 0.88],
  ],
}

const SIDE = {
  victory: {
    band: victoryBandUrl,
    plate: playNowUrl,
    flash: '#fff4d8',
    bloom: '245, 198, 90',
    lamp: 0.42,
    idle: 0.36,
    bury: 0.21,
    rise: { portrait: 0.035, landscape: 0.03 },
    drop: { portrait: 0.82, landscape: 0.62 },
  },
  defeat: {
    band: defeatBandUrl,
    plate: retryPlateUrl,
    flash: '#ffb5a4',
    bloom: '201, 80, 42',
    lamp: 0.3,
    idle: 0.26,
    bury: 0.14,
    rise: { portrait: 0.045, landscape: 0.04 },
    drop: { portrait: 0.12, landscape: 0.12 },
  },
}

const DEFAULT_FIGURES = {
  victory: { figure: victoryFigureUrl },
  defeat: { figure: defeatFigureUrl },
}

const HERO_FIGURES = {
  ricklow: {
    victory: { figure: ricklowVictoryFigureUrl, wide: 576 / 512 },
    defeat: { figure: ricklowDefeatFigureUrl, wide: 576 / 512 },
  },
  confar: {
    victory: { figure: confarVictoryFigureUrl, wide: 1120 / 512 },
    defeat: { figure: confarDefeatFigureUrl, wide: 832 / 512 },
  },
  ardell: {
    victory: { figure: ardellVictoryFigureUrl, wide: 1088 / 512 },
    defeat: { figure: ardellDefeatFigureUrl, wide: 912 / 512 },
  },
}

const VERDICT_W = { portrait: 1.0, landscape: 0.52 }
const VERDICT_H = { portrait: 0.2, landscape: 0.2 }
const VERDICT_MIN = { portrait: 0.12, landscape: 0.15 }
const PLATE_Y = { portrait: 0.47, landscape: 0.42 }
const FIGURE_H = { portrait: 0.48, landscape: 0.37 }
const FIGURE_W = { portrait: 0.92, landscape: 0.46 }
const FIGURE_WANT = { portrait: 0, landscape: 0.26 }
const PLATE_GIVE = 3
const FIGURE_AIR = 10

const RETRY_W = { portrait: 0.68, landscape: 0.34 }
const RETRY_MAX = { portrait: 0.26, landscape: 0.3 }
const PLAY_W = { portrait: 1, landscape: 0.54 }
const CONTROL_SILL = { portrait: 0.83, landscape: 0.9 }
const PLATE_EDGE_AIR = 6
const RETRY_AIR = 12
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
  return `linear-gradient(180deg, ${stops.map(([at, a]) => `rgba(8,8,9,${a}) ${at * 100}%`).join(', ')})`
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

function spread(node, wide = 1) {
  node.style.left = `${((1 - wide) / 2) * 100}%`
  node.style.width = `${wide * 100}%`
}

export class Outcome {
  constructor(root) {
    this.root = root
    this.scrim = root.querySelector('.scrim')
    this.bloom = root.querySelector('.bloom')
    this.figure = root.querySelector('.figure')
    this.still = root.querySelector('.still')
    this.band = root.querySelector('.band')
    this.verdict = root.querySelector('.verdict')
    this.control = root.querySelector('.control')
    this.plate = root.querySelector('.plate')
    this.label = root.querySelector('.label')
    this.flash = root.querySelector('.flash')
    this.why = root.querySelector('.why')
    this.reason = false
    this.side = SIDE.victory
    this.defeat = false
    this.armed = false
    this.introducing = false
    this.t = 0
    this.onRetry = null
    this.onCta = null
    this.warm = Object.values(SIDE).flatMap(s => [s.band, s.plate]).map(warmImage)
    document.fonts?.load('500 20px Hitzone').catch(() => {})
    this.figures = null
    this.useFigures(DEFAULT_FIGURES)
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

  setHero(id) {
    this.useFigures(HERO_FIGURES[id] || DEFAULT_FIGURES)
  }

  setReason(title, text) {
    this.reason = !!title
    this.why.querySelector('b').textContent = title || ''
    this.why.querySelector('span').textContent = text || ''
  }

  useFigures(figures) {
    if (figures === this.figures) return
    this.figures = figures
    for (const f of Object.values(figures)) this.warm.push(warmImage(f.figure))
  }

  layout() {
    const w = this.root.clientWidth
    const h = this.root.clientHeight
    const portrait = h >= w
    const key = portrait ? 'portrait' : 'landscape'
    const ui = clamp(Math.min(w, h) / 375, 0.72, 3.2)
    const side = this.side
    const cx = w / 2
    const cy = h * PLATE_Y[key]

    this.scrim.style.background = scrimGradient(SCRIM[key])

    const cap = clamp(h * VERDICT_H[key], 52 * ui, 176 * ui)
    let pw = w * VERDICT_W[key]
    let ph = (pw * VERDICT_ART.h) / VERDICT_ART.w
    if (ph > cap) {
      ph = cap
      pw = (ph * VERDICT_ART.w) / VERDICT_ART.h
    }

    const ceiling = FIGURE_AIR * ui - h * side.rise[key]
    const capH = h * FIGURE_H[key]
    const capW = w * FIGURE_W[key]
    const standing = top => Math.min(capH, capW, Math.max(0, top - ceiling) / (1 - side.bury))

    const want = h * FIGURE_WANT[key]
    let span = standing(cy - ph / 2)
    for (let pass = 0; pass < PLATE_GIVE && span < want; pass++) {
      const give = 2 * (cy - ceiling - want * (1 - side.bury))
      const next = clamp(give, h * VERDICT_MIN[key], ph)
      if (next >= ph - 0.5) break
      ph = next
      pw = (ph * VERDICT_ART.w) / VERDICT_ART.h
      span = standing(cy - ph / 2)
    }

    place(this.band, cx - pw / 2, cy - ph / 2, pw, ph)

    const foot = cy - ph / 2 + span * side.bury
    place(this.figure, cx - span / 2, foot - span, span, span)

    const bw = Math.max(80, pw * 0.62)
    const bh = Math.max(80, ph * 3.4)
    place(this.bloom, cx - bw / 2, cy - bh / 2, bw, bh)

    const air = RETRY_AIR * ui
    const roof = cy + ph / 2 + air
    const beating = this.defeat ? 1 : 1 + PLAY_BEAT.kick
    const offered = Math.min(
      w * (this.defeat ? RETRY_W[key] : PLAY_W[key]),
      Math.max(44 * ui, pw),
      Math.max(44 * ui, ((w / 2 - PLATE_EDGE_AIR * ui) * 2) / beating),
    )
    const sill = h * CONTROL_SILL[key] - air
    const room = Math.max(44 * ui, sill - roof)
    const maxH = Math.min(clamp(h * RETRY_MAX[key], 40 * ui, 340 * ui), room)
    const box = fitArt(this.defeat ? RETRY_ART : PLAY_ART, offered, maxH)
    const y = clamp(
      roof + (sill - roof) * side.drop[key],
      roof + box.h / 2,
      Math.max(roof + box.h / 2, sill - box.h / 2),
    )
    place(this.control, cx - box.w / 2, y - box.h / 2, box.w, box.h)
    this.placeWhy(w, h, ui, cx, y + box.h / 2, cy - ph / 2)

    if (this.defeat) this.fitLabel(box)
  }

  placeWhy(w, h, ui, cx, below, above) {
    const shown = this.defeat && this.reason
    this.why.style.display = shown ? '' : 'none'
    if (!shown) return
    const ww = Math.min(w * 0.92, 460 * ui)
    this.why.style.width = `${ww}px`
    this.why.style.left = `${cx - ww / 2}px`
    this.why.style.setProperty('--wu', `${ui}px`)
    const tall = 44 * ui
    const gap = 10 * ui
    this.why.style.top = `${h - below - gap >= tall ? below + gap : Math.max(gap, above - gap - tall)}px`
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
    this.still.src = this.figures[kind].figure
    spread(this.still, this.figures[kind].wide)
    this.verdict.src = side.band
    this.plate.src = side.plate
    this.bloom.style.setProperty('--tint', side.bloom)
    this.flash.style.background = side.flash
    this.root.classList.add('on')
    this.layout()

    const parts = [this.flash, this.band, this.bloom, this.figure, this.control, this.why]
    gsap.killTweensOf(parts)
    gsap.set(this.why, { opacity: 0 })
    gsap.to(this.why, { opacity: 1, duration: 0.35, delay: CONTROL_AT + 0.2, ease: 'power1.out' })
    this.t = 0
    this.armed = false
    this.introducing = true
    this.control.style.transform = ''

    gsap.set(this.flash, { opacity: 1 })
    gsap.set(this.band, { opacity: 0, scaleX: UNFURL.slitW, scaleY: UNFURL.slitH })
    gsap.set([this.bloom, this.figure, this.control], { opacity: 0 })

    gsap.delayedCall(ARM_AFTER, () => { this.armed = true })
    gsap.to(this.flash, { opacity: 0, duration: FLASH_FADE, delay: FLASH_HOLD, ease: 'power2.out' })
    gsap.to(this.band, { opacity: 1, duration: 0.16, delay: 0.06, ease: 'power1.out' })
    gsap.to(this.band, { scaleX: 1, duration: UNFURL.widen, ease: 'expo.out' })
    gsap.to(this.band, { scaleY: 1, duration: UNFURL.open, delay: UNFURL.openAt, ease: 'back.out(1.70158)' })
    gsap.timeline()
      .to(this.bloom, { opacity: side.lamp * BLOOM_FLARE, duration: 0.18, ease: 'expo.out' })
      .to(this.bloom, { opacity: side.lamp, duration: 0.42, ease: 'power2.out' })
    gsap.to(this.figure, { opacity: 1, duration: 0.4, delay: 0.1, ease: 'power1.out' })
    gsap.to(this.control, {
      opacity: 1, duration: 0.3, delay: CONTROL_AT, ease: 'power1.out',
      onComplete: () => { this.introducing = false },
    })

    gsap.ticker.remove(this.tick)
    gsap.ticker.add(this.tick)
  }

  tick(time, deltaMs) {
    const dt = deltaMs / 1000
    this.t += dt
    if (this.introducing) return
    this.bloom.style.opacity = this.side.idle + Math.sin(this.t * 1.8) * 0.08
    if (this.defeat) return
    const phase = (this.t * PLAY_BEAT.rate) % 1
    const beat = phase < PLAY_BEAT.attack
      ? phase / PLAY_BEAT.attack
      : Math.exp(-(phase - PLAY_BEAT.attack) * PLAY_BEAT.decay)
    this.control.style.transform = `scale(${1 + PLAY_BEAT.kick * beat})`
  }
}
