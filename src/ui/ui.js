import { CardBorderFx } from './card-fx.js'
import { HEROES, LOOT } from '../data/heroes.js'
import playNowImg from '../assets/GENERAL/BUTTONS/play-now.webp'
import eld037Portrait from '../assets/GENERAL/HUD/heroes/eld037-large.webp'
import mag018Portrait from '../assets/GENERAL/HUD/heroes/mag018-large.webp'
import eld025Portrait from '../assets/GENERAL/HUD/heroes/eld025-large.webp'
import animlts004Portrait from '../assets/GENERAL/HUD/heroes/animlts004-large.webp'
import elementFireImg from '../assets/GENERAL/HUD/icons/element-fire.webp'
import elementWaterImg from '../assets/GENERAL/HUD/icons/element-water.webp'
import lootWeaponImg from '../assets/GENERAL/HUD/icons/loot-weapon.webp'
import lootGemsImg from '../assets/GENERAL/HUD/icons/loot-gems.webp'
import lootChestImg from '../assets/GENERAL/HUD/icons/loot-chest.webp'
import lootAnimaImg from '../assets/GENERAL/HUD/icons/loot-anima.webp'
import classRangedImg from '../assets/GENERAL/HUD/select/class-ranged.webp'
import classMeleeImg from '../assets/GENERAL/HUD/select/class-melee.webp'
import classTankImg from '../assets/GENERAL/HUD/select/class-tank.webp'
import { Outcome } from './outcome.js'
import { GearRing } from './gear-ring.js'
import { EnemyBars } from './enemy-bars.js'
import { deferImages, whenReleased, releaseImages } from './lazy.js'
import { FINGER, TAP } from './tapcue.js'
import { view, safeInsets } from '../core/viewport.js'
import powerIconImg from '../assets/GENERAL/HUD/gear/power-icon.webp'
import bossBadgeImg from '../assets/GENERAL/HUD/wave/boss.webp'
import eld037Skill1 from '../assets/GENERAL/HUD/skills/mini/eld037-1.webp'
import eld037Skill2 from '../assets/GENERAL/HUD/skills/mini/eld037-2.webp'
import eld037Ult from '../assets/GENERAL/HUD/skills/mini/eld037-ult.webp'
import mag018Skill1 from '../assets/GENERAL/HUD/skills/mini/mag018-1.webp'
import mag018Skill2 from '../assets/GENERAL/HUD/skills/mini/mag018-2.webp'
import mag018Ult from '../assets/GENERAL/HUD/skills/mini/mag018-ult.webp'
import eld025Skill1 from '../assets/GENERAL/HUD/skills/mini/eld025-1.webp'
import eld025Skill3 from '../assets/GENERAL/HUD/skills/mini/eld025-3.webp'
import eld025Ult from '../assets/GENERAL/HUD/skills/mini/eld025-ult.webp'
import animlts004Skill1 from '../assets/GENERAL/HUD/skills/mini/animlts004-1.webp'
import animlts004Skill2 from '../assets/GENERAL/HUD/skills/mini/animlts004-2.webp'


const BANNER_ICONS = {
  boss: bossBadgeImg,
}

const SKILL_ART = {
  eld037: { s1: eld037Skill1, s2: eld037Skill2, ult: eld037Ult },
  mag018: { s1: mag018Skill1, s2: mag018Skill2, ult: mag018Ult },
  eld025: { s1: eld025Skill1, s2: eld025Skill3, ult: eld025Ult },
  animlts004: { s1: animlts004Skill1, s2: animlts004Skill2 },
}
const SKILL_STEPS = 48
const SKILL_CAST_JUMP = 0.5
const ULT_STEPS = 120
const ULT_FILL_MS = 500
const ULT_FLASH_MS = 300
const ULT_FLASH_STEPS = 8
const ULT_MANA = 300
const ULT_MANA_GATHER_MS = 200
const ULT_MANA_SHOW_MS = 1000
const BOSS_BAR_HALF = 140
const BOSS_BAR_HALF_H = 9.17
const BAR_EDGE = 6

export const ELEMENT_ART = {
  fire: elementFireImg,
  water: elementWaterImg,
}

const RELIC_ART = import.meta.glob('../assets/GENERAL/HUD/loot/relic-*.webp', { eager: true, import: 'default' })

const RELIC_NAMES = {
  weapon: 'Weapon',
  shield: 'Shield',
  helmet: 'Helmet',
  pauldrons: 'Pauldrons',
  gauntlets: 'Gauntlets',
  chestplate: 'Chestplate',
  belt: 'Belt',
  boots: 'Boots',
}

const LOOT_ART = {
  weapon: lootWeaponImg,
  gems: lootGemsImg,
  chest: lootChestImg,
  anima: lootAnimaImg,
}

const PORTRAIT_ART = {
  eld037: eld037Portrait,
  mag018: mag018Portrait,
  eld025: eld025Portrait,
  animlts004: animlts004Portrait,
}

const CLASS_ART = {
  ranged: classRangedImg,
  melee: classMeleeImg,
  tank: classTankImg,
}

const RARITY_LABEL = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythic: 'Mythic',
}

const RARITY_STARS = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
}
const EASY = 'cubic-bezier(.45, 0, .55, 1)'
const EASE_IN = 'cubic-bezier(.55, 0, 1, .45)'
const EASE_OUT = 'cubic-bezier(.25, 1, .5, 1)'
const BANNER_IN = 'cubic-bezier(.2, .9, .3, 1)'
const BANNER_HOME = 0.27
const BANNER_SHADE = 0.55
const GEAR_SETTLE_MS = 380
const BANNER_GAP = 8
const BANNER_MIN_FIT = 0.75
const BANNER_MIN_SCALE = 0.55
const BANNER_LEAN_ABOVE = 0.5
const BANNER_LEAN_BELOW = 0.3
const BANNER_CENTRE_BAND = 1 / 6
const APPEAR_FROM = 1.15
const APPEAR_MS = 400
const APPEAR_FADE_MS = 300
const CARD_DELAY_MS = 120
const CARD_STAGGER_MS = 70
const PICK_LAG_MS = 150
const LEAVE_MS = 220
const VEIL_OUT_MS = 450
const LOOT_ROW_MS = 2600
const LOOT_HIDE_MS = 250
const LOOT_ROWS = 2
const BAR_STEPS = 200
const HUD_UNIT = 0.40625
const FEED_PAD = 10
const FEED_RIGHT = 516.4
const FEED_TOP = 268
const FEED_ROWS_AT = 282
const FEED_ROW = 108
const FEED_TAIL = 6
const SKILL_FRAME_PAD = 24

function shownOnScreen(node) {
  for (let n = node; n && n.nodeType === 1; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false
  }
  return true
}

function spring(t) {
  const k = Math.min(1, Math.max(0, t))
  return (Math.sin(k * Math.PI * (0.2 + 2.5 * k * k * k)) * Math.pow(1 - k, 2.2) + k) * (1 + 1.2 * (1 - k))
}

const APPEAR_FRAMES = Array.from({ length: 25 }, (_, n) => {
  const t = n / 24
  return { transform: `scale(${(APPEAR_FROM + (1 - APPEAR_FROM) * spring(t)).toFixed(4)})`, offset: t }
})

const JOYSTICK_TUTORIAL = `<div class="joy"><i class="ring a"></i><i class="ring b"></i><i class="jbase"></i><i class="jknob"></i>${FINGER}</div>`
const HINT_TEXT = {
  move: ['DRAG TO MOVE', ''],
}

export function el(html) {
  const d = document.createElement('div')
  d.innerHTML = html.trim()
  return d.firstElementChild
}

export class UI {
  constructor(rootId) {
    this.root = document.getElementById(rootId)
    this.frame = 0
    this.deferred = []
    this.build()
  }

  build() {
    this.root.insertAdjacentHTML('beforeend', deferImages(`
      <div id="select" class="screen">
        <div class="shade"></div>
        <div class="head">
          <div class="plate"><h1 class="title-ornate">CHOOSE YOUR INVOKER</h1></div>
          <p>The arena is under attack</p>
        </div>
        <div class="cards"></div>
      </div>

      <div id="hud" class="screen">
        <div id="hpbars"></div>
        <div id="topbar">
          <i class="shade"></i>
          <button id="powergoal">
            <div class="nums"><img class="ico" src="${powerIconImg}" alt="" draggable="false"><b class="now">0</b><span class="goal"></span><span class="pips"><i></i><i></i><i></i><i></i></span></div>
            <div class="bar"><i class="back"></i><div class="clip"><i class="fill"></i></div></div>
          </button>
          <div id="waveinfo"><b class="label"></b>
            <div class="wavebar"><i class="back"></i><div class="track"><i class="fill"></i><i class="glint"></i></div><div class="stops"></div></div>
          </div>
          <div class="tip"><i class="plate"></i><img class="ico" src="${powerIconImg}" alt="" draggable="false"><span></span></div>
        </div>
        <div id="skillbar">
          <div class="sk ult cooling"><img class="icon" alt="" draggable="false"><i class="dim"></i><i class="charge"><i class="lead"></i><i class="main"></i><i class="flash"></i></i><i class="frame"></i><b class="pct"><span><em>0</em><small>%</small></span></b><i class="press"></i><i class="burst"><i class="circle"></i><i class="star"></i></i><i class="mana"><i class="glow"></i><b></b></i></div>
          <div class="sk s1"><img class="icon" alt="" draggable="false"><i class="cd"></i><i class="frame"></i><b class="cdn"></b><i class="press"></i><i class="burst"><i class="circle"></i><i class="star"></i></i></div>
          <div class="sk s2"><img class="icon" alt="" draggable="false"><i class="cd"></i><i class="frame"></i><b class="cdn"></b><i class="press"></i><i class="burst"><i class="circle"></i><i class="star"></i></i></div>
        </div>
        <div id="titantimer"><div class="c">TITAN</div><div class="t"><i class="back"></i><i class="fill"></i></div></div>
        <div id="stick">
          <div class="base"></div>
          <i class="decor r"></i><i class="decor l"></i><i class="decor t"></i><i class="decor d"></i>
          <div class="knob"></div>
        </div>
        <div id="animacard">
          <div class="btn">
            <i class="back"></i>
            <div class="portrait"><img class="icon" alt="" draggable="false"></div>
            <i class="duration"></i>
            <div class="cooldown"><i class="fill"></i><b></b></div>
            <div class="appear"><i class="grad"></i><i class="flare"></i></div>
            <div class="active"><i class="hl"></i></div>
            <div class="press"><i class="grad"></i><i class="flare"></i><i class="circle"></i></div>
            <div class="charged"><i class="circle"></i><i class="star"></i></div>
          </div>
          <i class="shadow"></i>
          <div class="hero"><div class="mask"><img alt="" draggable="false"></div></div>
        </div>
        <div id="gesturehint"><div class="g-main"></div><div class="g-sub"></div><div class="g-hand">${JOYSTICK_TUTORIAL}</div></div>
        <div id="herocue">${TAP}</div>
      </div>

      <div id="lootfeed">
        <div class="big"></div>
      </div>

      <div id="powerpop"><i class="orn"></i><img class="ico" src="${powerIconImg}" alt="" draggable="false"><b>0</b><span>+0</span><em></em></div>
      <div id="gearring"></div>

      <div id="banner"><i class="bk"></i><img class="ic" alt="" draggable="false"><div class="t"></div><div class="s"></div></div>
      <div id="veil"></div>
      <canvas id="freeze"></canvas>
      <div id="freezebar"><i></i></div>

      <div id="end" class="screen">
        <div class="logo title-ornate">INVOKERS</div>
        <div class="tag">Unlock 200+ Heroes &amp; Titans</div>
        <div class="loot"></div>
        <button class="btn-img" id="cta"><img src="${playNowImg}" alt="PLAY NOW" draggable="false"></button>
        <div class="stores">
          <div class="store"><span>Download on the<b>App Store</b></span></div>
          <div class="store"><span>GET IT ON<b>Google Play</b></span></div>
        </div>
        <div class="replay">play again</div>
      </div>

      <div id="outcome">
        <div class="dim"></div>
        <div class="scrim"></div>
        <div class="bloom"></div>
        <button class="brand"><img class="logo" alt="INVOKERS" draggable="false"></button>
        <button class="control"><img class="plate" alt="PLAY NOW" draggable="false"></button>
        <div class="flash"></div>
      </div>
    `))

    this.boot = this.root.querySelector('#boot')
    this.bootBar = this.boot.querySelector('.bar > i')
    const ring = this.boot.querySelector('.ring')
    this.ringSpin = (ring.getAnimations && ring.getAnimations()[0]) || null
    this.select = this.root.querySelector('#select')
    this.cards = this.select.querySelector('.cards')
    this.hud = this.root.querySelector('#hud')
    this.enemyLayer = this.hud.querySelector('#hpbars')
    this.enemyBars = new Map()
    this.barCanvas = new EnemyBars(this.enemyLayer)
    this.heroBar = el(`<div class="fhp"><div class="part"><i class="glow"></i><i class="fill"></i><i class="noise"></i></div></div>`)
    this.enemyLayer.appendChild(this.heroBar)
    this.heroBarState = { k: 1, max: 0, shown: false, foot: 0 }
    this.topBar = this.root.querySelector('#topbar')
    this.topBarBottom = 0
    new ResizeObserver(() => { this.topBarBottom = this.topBar.offsetTop + this.topBar.offsetHeight }).observe(this.topBar)
    this.topTip = this.topBar.querySelector('.tip span')
    this.waveInfo = this.root.querySelector('#waveinfo')
    this.waveLabel = this.waveInfo.querySelector('.label')
    this.waveBar = this.waveInfo.querySelector('.wavebar')
    this.waveStops = []
    this.waveCalled = 0
    this.wavePainted = -1
    this.skillbar = this.root.querySelector('#skillbar')
    this.skillSlots = {}
    for (const k of ['s1', 's2', 'ult']) {
      const el = this.skillbar.querySelector(`.sk.${k}`)
      el.addEventListener('pointerdown', () => this.onSkill && this.onSkill(k), { passive: true })
      this.skillSlots[k] = { el, icon: el.querySelector('.icon'), num: el.querySelector('.cdn'), k: 0, step: -1, secs: -1, ready: false }
    }
    this.onSkill = null
    this.ultBar = {
      flash: this.skillbar.querySelector('.ult .flash'), goal: 0, from: 0, shown: 0, since: 0, gainAt: -Infinity, lead: 0, main: 0, glow: 0,
      pctText: this.skillbar.querySelector('.ult .pct em'), pct: 0,
      manaBox: this.skillbar.querySelector('.ult .mana'), manaText: this.skillbar.querySelector('.ult .mana b'), mana: 0, manaShown: -1, manaAt: -Infinity, manaUntil: 0, manaOn: false,
    }
    this.skillModel = null
    this.animaCard = this.root.querySelector('#animacard')
    this.animaIcon = this.animaCard.querySelector('.portrait .icon')
    this.animaHero = this.animaCard.querySelector('.hero img')
    this.animaCooldown = this.animaCard.querySelector('.cooldown b')
    this.animaFill = this.animaCard.querySelector('.cooldown .fill')
    this.animaDuration = this.animaCard.querySelector('.duration')
    this.animaReady = false
    this.titanTimer = this.root.querySelector('#titantimer')
    this.stick = this.root.querySelector('#stick')
    this.gestureHint = this.root.querySelector('#gesturehint')
    this.heroCue = this.root.querySelector('#herocue')
    this.heroCueTap = this.heroCue.querySelector('.tapcue')
    whenReleased(() => {
      Object.values(PORTRAIT_ART).forEach(src => { new Image().src = src })
    })
    this.banner = this.root.querySelector('#banner')
    this.veil = this.root.querySelector('#veil')
    this.freezeEl = this.root.querySelector('#freeze')
    this.freezeBar = this.root.querySelector('#freezebar')
    this.end = this.root.querySelector('#end')
    this.loot = this.end.querySelector('.loot')
    this.lootFeed = this.root.querySelector('#lootfeed')
    this.lootBig = this.lootFeed.querySelector('.big')
    this.outcome = new Outcome(this.root.querySelector('#outcome'))
    this.gearRing = new GearRing(this.root.querySelector('#gearring'))
    this.powerPop = this.root.querySelector('#powerpop')
    this.powerGoal = this.root.querySelector('#powergoal')
    this.shownGoalPower = -1
    this.goalPips = [...this.powerGoal.querySelectorAll('.pips i')]
    this.pipOwn = this.pipOn = -1
    this.fitHud()
    addEventListener('resize', () => this.fitHud())
  }

  showGestureHint(on, mode = 'move') {
    const el = this.gestureHint
    if (!on) {
      if (el.dataset.mode !== mode) return
      el.classList.remove('on')
      this.hud.classList.remove('hinting')
      return
    }
    this.hud.classList.toggle('hinting', mode === 'move')
    el.dataset.mode = mode
    for (const m of Object.keys(HINT_TEXT)) el.classList.toggle(m, m === mode)
    const [main, sub] = HINT_TEXT[mode]
    el.querySelector('.g-main').textContent = main
    el.querySelector('.g-sub').textContent = sub
    el.classList.remove('play')
    void el.offsetWidth
    el.classList.add('on', 'play')
  }

  cueHero(on) {
    this.heroCueTap.classList.toggle('on', on)
  }

  placeHeroCue(x, y, visible) {
    if (visible !== this.heroCueShown) {
      this.heroCueShown = visible
      this.heroCue.style.visibility = visible ? 'visible' : 'hidden'
    }
    if (!visible) return
    const qx = Math.round(x * 10)
    const qy = Math.round(y * 10)
    if (qx !== this.heroCueX || qy !== this.heroCueY) {
      this.heroCueX = qx
      this.heroCueY = qy
      this.heroCue.style.transform = `translate3d(${qx / 10}px, ${qy / 10}px, 0)`
    }
    const flip = x > view.w * 0.62
    if (flip !== this.heroCueFlip) {
      this.heroCueFlip = flip
      this.heroCueTap.classList.toggle('flip', flip)
    }
  }

  setTip(text) {
    const was = this.topBar.classList.contains('tipped')
    this.topBar.classList.toggle('tipped', !!text)
    if (!text) return
    const fresh = !was || this.topTip.textContent !== text
    this.topTip.textContent = text
    if (fresh) this.deferClass(this.topTip.parentNode, 'pop')
  }

  fitHud() {
    const short = Math.min(view.w, view.h)
    const long = Math.max(view.w, view.h)
    const portrait = view.h > view.w
    this.hudScale = Math.max(portrait ? 0.92 : 0.8, Math.min(short / 410, long / 730))
    document.documentElement.style.setProperty('--hud-scale', this.hudScale.toFixed(3))
    this.gearRing.scale = this.hudScale
  }

  progress(p) {
    this.bootBar.style.transform = `scaleX(${p})`
  }

  release() {
    this.root.classList.remove('booting')
  }

  releaseImages() {
    releaseImages(this.root)
  }

  hideBoot() {
    this.boot.style.opacity = '0'
    setTimeout(() => {
      this.boot.classList.add('hidden')
      if (this.ringSpin) this.ringSpin.cancel()
    }, 520)
  }

  show(name, on) {
    const map = { select: this.select, hud: this.hud, end: this.end }
    map[name].classList.toggle('on', on)
  }

  buildCards(onCard, onPick) {
    this.cards.innerHTML = ''
    this.cardEls = []
    HEROES.forEach((h, i) => {
      const slot = el(`
        <div class="slot" data-i="${i}">
          <div class="card ${h.rarity}">
            <div class="face">
              <img class="art" src="${PORTRAIT_ART[h.model]}" alt="" draggable="false">
              <i class="fade"></i>
              <i class="glare"></i>
            </div>
            <div class="data">
              <img src="${ELEMENT_ART[h.element]}" alt="" draggable="false">
              <img src="${CLASS_ART[h.role]}" alt="" draggable="false">
            </div>
            <i class="glow"></i>
            <i class="ring"></i>
            <div class="rank">${'<i></i>'.repeat(RARITY_STARS[h.rarity])}</div>
            <div class="nm">${h.short || h.name}</div>
            <div class="badge ${h.rarity}"><i></i><span>${RARITY_LABEL[h.rarity]}</span></div>
          </div>
          <button class="pick"><i class="halo"></i><i class="plate"></i><i class="sweep"><i></i></i><span>Select</span></button>
        </div>`)
      slot.querySelector('.card').addEventListener('click', () => onCard(i))
      slot.querySelector('.pick').addEventListener('click', () => onPick(i))
      this.cardEls.push(slot)
      this.cards.appendChild(slot)
    })
  }

  selectCard(i) {
    this.cardEls.forEach((c, k) => c.classList.toggle('sel', k === i))
    this.cardFx = this.cardFx || new CardBorderFx()
    this.cardFx.attach(this.cardEls[i], HEROES[i].rarity)
  }

  appear(node, delay) {
    node.animate(APPEAR_FRAMES, { duration: APPEAR_MS, delay, fill: 'backwards' })
    node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: APPEAR_FADE_MS, delay, easing: EASY, fill: 'backwards' })
  }

  playSelectIntro() {
    this.introAt = performance.now()
    this.select.classList.remove('leaving', 'intro')
    void this.select.offsetWidth
    this.select.classList.add('intro')
    this.cardEls.forEach((slot, i) => {
      this.appear(slot, CARD_DELAY_MS + i * CARD_STAGGER_MS)
      this.appear(slot.querySelector('.pick'), CARD_DELAY_MS + i * CARD_STAGGER_MS + PICK_LAG_MS)
    })
  }

  leaveSelect() {
    this.select.classList.add('leaving')
    this.cardEls.forEach(slot => {
      const picked = slot.classList.contains('sel')
      const frames = picked
        ? [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.35 }, { transform: 'translateY(8%)', opacity: 0 }]
        : [{ transform: 'none', opacity: 1 }, { transform: 'translateY(12%)', opacity: 0 }]
      slot.animate(frames, { duration: picked ? LEAVE_MS + 120 : LEAVE_MS, easing: EASE_IN, fill: 'forwards' })
    })
  }

  freeze(source) {
    const c = this.freezeEl
    if (c.width !== source.width || c.height !== source.height) {
      c.width = source.width
      c.height = source.height
    }
    c.getContext('2d').drawImage(source, 0, 0)
    for (const n of [c, this.freezeBar]) n.getAnimations().forEach(a => a.cancel())
    this.root.classList.add('frozen')
  }

  thaw() {
    if (!this.root.classList.contains('frozen')) return
    const fades = [this.freezeEl, this.freezeBar].map(n => n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: VEIL_OUT_MS, easing: EASE_OUT, fill: 'forwards' }))
    fades[0].onfinish = () => {
      this.root.classList.remove('frozen')
      fades.forEach(a => a.cancel())
    }
  }

  veilHold() {
    this.veil.getAnimations().forEach(a => a.cancel())
    this.veil.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 1, fill: 'forwards' })
  }

  veilOut() {
    const from = Number(getComputedStyle(this.veil).opacity) || 0
    this.veil.getAnimations().forEach(a => a.cancel())
    if (from <= 0) return
    this.veil.animate([{ opacity: from }, { opacity: 0 }], { duration: VEIL_OUT_MS, easing: EASE_OUT, fill: 'forwards' })
  }

  setHp(v, max) {
    this.setHeroBar(Math.max(0, Math.min(1, v / max)), max)
  }

  updateSkillbar(def, titan, cooldowns, ult, ultReady) {
    if (def.model !== this.skillModel) {
      this.skillModel = def.model
      const art = SKILL_ART[def.model] || {}
      for (const k in art) this.skillSlots[k].icon.src = art[k]
      this.skillbar.classList.toggle('titan', titan)
    }
    for (let i = 0; i < def.skills.length; i++) {
      const skill = def.skills[i]
      const secs = Math.max(0, cooldowns[skill.key] || 0)
      this.paintSkill(this.skillSlots[skill.key], skill.cd > 0 ? Math.min(1, secs / skill.cd) : 0, secs)
    }
    if (!titan) this.paintUlt(this.skillSlots.ult, ult, ultReady)
  }

  paintSkill(s, k, secs) {
    if (k - s.k > SKILL_CAST_JUMP) this.deferClass(s.el, 'pressed')
    else if (k === 0 && s.k > 0) this.deferClass(s.el, 'charged')
    s.k = k
    this.paintSweep(s, Math.ceil(k * SKILL_STEPS))
    const whole = s.step > 0 ? Math.ceil(secs) : 0
    if (whole !== s.secs) {
      s.secs = whole
      s.num.textContent = whole ? String(whole) : ''
    }
  }

  paintUlt(s, k, ready) {
    const bar = this.ultBar
    if (ready !== s.ready) {
      this.deferClass(s.el, ready ? 'charged' : 'pressed')
      s.ready = ready
      s.el.classList.toggle('ready', ready)
      s.el.classList.toggle('cooling', !ready)
      this.dropUltMana(bar)
    }
    const now = performance.now()
    const goal = Math.min(1, k)
    if (goal !== bar.goal) {
      if (goal > bar.goal) {
        bar.gainAt = now
        if (!ready) this.gainUltMana(bar, (goal - bar.goal) * ULT_MANA, now)
      }
      bar.from = goal > bar.goal ? bar.shown : goal
      bar.goal = goal
      bar.since = now
      bar.lead = this.paintArc(s.el, '--l', goal, bar.lead)
    }
    bar.shown = bar.from + (goal - bar.from) * Math.min(1, (now - bar.since) / ULT_FILL_MS)
    bar.main = this.paintArc(s.el, '--m', bar.shown, bar.main)
    const t = (now - bar.gainAt) / ULT_FLASH_MS
    const glow = t < 1 ? Math.round((1 - Math.abs(2 * t - 1)) * ULT_FLASH_STEPS) : 0
    if (glow !== bar.glow) {
      bar.glow = glow
      bar.flash.style.opacity = String(glow / ULT_FLASH_STEPS)
    }
    const pct = Math.floor(goal * 100)
    if (pct !== bar.pct) {
      bar.pct = pct
      bar.pctText.textContent = String(pct)
    }
    if (bar.manaOn && now >= bar.manaUntil) {
      bar.manaOn = false
      bar.manaBox.classList.remove('show')
      bar.manaBox.classList.add('hide')
    }
  }

  dropUltMana(bar) {
    bar.manaOn = false
    bar.manaAt = -Infinity
    this.cancelDeferred(bar.manaBox, 'show')
    bar.manaBox.classList.remove('show', 'hide')
  }

  gainUltMana(bar, gain, now) {
    if (now - bar.manaAt > ULT_MANA_GATHER_MS) {
      bar.mana = 0
      bar.manaAt = now
      bar.manaBox.classList.remove('hide')
      this.deferClass(bar.manaBox, 'show')
    }
    bar.mana += gain
    bar.manaUntil = now + ULT_MANA_SHOW_MS
    bar.manaOn = true
    const whole = Math.max(1, Math.round(bar.mana))
    if (whole !== bar.manaShown) {
      bar.manaShown = whole
      bar.manaText.textContent = String(whole)
    }
  }

  paintArc(el, prop, v, step) {
    const next = Math.round(v * ULT_STEPS)
    if (next !== step) el.style.setProperty(prop, String(next / ULT_STEPS))
    return next
  }

  paintSweep(s, step) {
    if (step === s.step) return
    s.step = step
    s.el.style.setProperty('--k', String(step / SKILL_STEPS))
    s.el.classList.toggle('cooling', step > 0)
  }

  setPower(power, goal, ready, owned = 0, worn = 0) {
    const el = this.powerGoal
    this.setPips(owned, worn)
    const done = power >= goal
    el.querySelector('.now').textContent = power.toLocaleString('en-US')
    el.querySelector('.goal').textContent = `/ ${goal.toLocaleString('en-US')}`
    el.style.setProperty('--k', Math.min(1, power / goal).toFixed(4))
    el.classList.toggle('done', done)
    el.classList.toggle('ready', !!ready)
    if (this.shownGoalPower >= 0 && power !== this.shownGoalPower) {
      el.querySelector('.nums').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' })
      if (done && this.shownGoalPower < goal) this.flashGoal()
    }
    this.shownGoalPower = power
  }

  setPips(owned, worn) {
    const own = Math.min(this.goalPips.length, owned)
    const on = Math.min(this.goalPips.length, worn)
    if (own === this.pipOwn && on === this.pipOn) return
    this.goalPips.forEach((p, i) => {
      p.classList.toggle('own', i < own)
      p.classList.toggle('on', i < on)
    })
    if (this.pipOn >= 0 && on > this.pipOn) this.goalPips[on - 1].animate([{ scale: '1.9' }, { scale: '1' }], { duration: 380, easing: 'cubic-bezier(.2,.7,.3,1)' })
    this.pipOwn = own
    this.pipOn = on
  }

  flashGoal() {
    this.powerGoal.querySelector('.bar').animate([{ filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }], { duration: 900, easing: 'ease-out' })
  }

  setShield(on, fragile = false) {
    this.topBar.classList.toggle('danger', on && !fragile)
    this.waveInfo.classList.toggle('shielded', on)
  }

  setHeroBar(k, max) {
    const bar = this.heroBarState
    const reset = max !== bar.max
    const grew = reset && bar.max > 0 && max > bar.max
    const hit = !reset && k < bar.k
    bar.max = max
    bar.k = k
    this.heroBar.classList.toggle('snap', reset && !grew)
    this.heroBar.style.setProperty('--k', k)
    if (hit) this.deferClass(this.heroBar, 'hit')
  }

  placeHeroBar(x, y, visible, foot = y) {
    const bar = this.heroBarState
    if (bar.shown !== visible) {
      bar.shown = visible
      this.heroBar.style.visibility = visible ? 'visible' : 'hidden'
    }
    if (!visible) return
    bar.foot = foot
    this.placeBar(this.heroBar, bar, x, y)
  }

  placeBar(node, bar, x, y) {
    const qx = Math.round(x * 10)
    const qy = Math.round(y * 10)
    if (qx === bar.qx && qy === bar.qy && this.hudScale === bar.scale) return
    bar.qx = qx
    bar.qy = qy
    bar.scale = this.hudScale
    node.style.transform = `translate3d(${qx / 10}px, ${qy / 10}px, 0) scale(${this.hudScale})`
  }

  tick(dt) {
    this.frame++
    this.flushDeferred()
    if (this.cardFx && this.select.classList.contains('on')) this.cardFx.tick(dt)
  }

  setAnima(titan, hero) {
    this.animaIcon.src = PORTRAIT_ART[titan.model] || ''
    this.animaHero.src = PORTRAIT_ART[hero.model] || ''
  }

  setTitan(k, ready, secondsLeft) {
    const v = Math.max(0, Math.min(1, k))
    const card = this.animaCard
    const r = Math.round((1 - v) * BAR_STEPS)
    if (r !== this.animaShownR) {
      this.animaShownR = r
      this.animaFill.style.setProperty('--r', String(r / BAR_STEPS))
    }
    const secs = secondsLeft === null ? -1 : Math.max(0, secondsLeft)
    const tenths = secs < 0 ? -1 : secs >= 10 ? Math.ceil(secs) * 10 : Math.round(secs * 10)
    if (tenths !== this.animaShownTenths) {
      this.animaShownTenths = tenths
      this.animaCooldown.textContent = secs < 0 ? '' : secs >= 10 ? String(tenths / 10) : (tenths / 10).toFixed(1)
    }
    const was = this.animaReady
    this.animaReady = ready
    if (ready !== was) card.classList.toggle('ready', ready)
    if (ready && !was) {
      this.deferClass(card, 'appear')
      this.deferClass(card, 'charged')
    }
  }

  pressAnima() {
    this.replayClass(this.animaCard, 'pressed')
  }

  setTitanTimer(k, on) {
    if (on !== this.titanTimerOn) {
      this.titanTimerOn = on
      this.titanTimer.classList.toggle('on', on)
      this.hud.classList.toggle('titan', on)
      this.animaCard.classList.toggle('active', on)
    }
    const q = Math.round(Math.max(0, k) * BAR_STEPS)
    if (q === this.titanTimerShown) return
    this.titanTimerShown = q
    const d = String(q / BAR_STEPS)
    this.animaDuration.style.setProperty('--d', d)
    this.titanTimer.style.setProperty('--k', d)
  }

  replayClass(node, cls) {
    node.classList.remove(cls)
    void node.offsetWidth
    node.classList.add(cls)
  }

  deferClass(node, cls) {
    node.classList.remove(cls)
    this.deferred.push({ node, cls, at: this.frame })
  }

  flushDeferred() {
    const list = this.deferred
    if (!list.length) return
    let keep = 0
    for (let i = 0; i < list.length; i++) {
      const d = list[i]
      if (this.frame - d.at >= 2) d.node.classList.add(d.cls)
      else list[keep++] = d
    }
    list.length = keep
  }

  cancelDeferred(node, cls) {
    const list = this.deferred
    let keep = 0
    for (let i = 0; i < list.length; i++) {
      const d = list[i]
      if (d.node !== node || d.cls !== cls) list[keep++] = d
    }
    list.length = keep
  }

  clearLootFeed(left, y, halfH) {
    const rows = this.lootBig.childElementCount
    if (!rows) return y
    const insets = safeInsets()
    const u = HUD_UNIT * this.hudScale
    if (left >= insets.l + FEED_RIGHT * u) return y
    const top = insets.t + FEED_PAD + FEED_TOP * u
    const bottom = insets.t + FEED_PAD + (FEED_ROWS_AT + rows * FEED_ROW + FEED_TAIL) * u
    if (y + halfH <= top || y - halfH >= bottom) return y
    return bottom + halfH
  }

  trackEnemy(actor, kind) {
    if (kind === 'regular') {
      this.enemyBars.set(actor, { el: null, paint: this.barCanvas.add(), half: 0 })
      return
    }
    const boss = kind === 'boss'
    const bar = el(`<div class="ehp ${kind}"><i class="ghost"></i><i class="fill"></i>${boss ? '<b class="pct">100%</b>' : ''}</div>`)
    this.enemyLayer.appendChild(bar)
    this.enemyBars.set(actor, { el: bar, k: 1, shown: false, pct: boss ? bar.querySelector('.pct') : null, pctN: 100, half: boss ? BOSS_BAR_HALF : 0 })
  }

  setBarPct(bar, k) {
    const n = k >= 1 ? 100 : Math.max(k > 0 ? 1 : 0, Math.floor(k * 100))
    if (n === bar.pctN) return
    bar.pctN = n
    bar.pct.textContent = n + '%'
  }

  placeEnemyBar(actor, x, y, visible) {
    const bar = this.enemyBars.get(actor)
    if (!bar) return
    if (bar.paint) {
      this.barCanvas.place(bar.paint, x, y, visible, actor.dead ? 0 : Math.max(0, actor.hp / actor.maxHp), actor.dead)
      return
    }
    if (bar.shown !== visible) {
      bar.shown = visible
      bar.el.style.visibility = visible ? 'visible' : 'hidden'
    }
    if (!visible) return
    if (bar.half) {
      const insets = safeInsets()
      const half = bar.half * this.hudScale + BAR_EDGE
      x = Math.min(Math.max(x, insets.l + half), view.w - insets.r - half)
      y = Math.max(y, this.topBarBottom + BOSS_BAR_HALF_H * this.hudScale + BAR_EDGE)
      const halfH = BOSS_BAR_HALF_H * this.hudScale + BAR_EDGE
      y = this.clearBanner(x, half, this.clearLootFeed(x - half, y, halfH), halfH)
    }
    this.placeBar(bar.el, bar, x, y)
    const k = actor.dead ? 0 : Math.max(0, actor.hp / actor.maxHp)
    if (k !== bar.k) {
      bar.k = k
      bar.el.style.setProperty('--k', k)
      bar.el.style.setProperty('--g', k)
      if (bar.pct) this.setBarPct(bar, k)
    }
    if (actor.dead && !bar.gone) {
      bar.gone = true
      bar.el.classList.add('gone')
    }
  }

  pruneEnemyBars(alive) {
    if (this.enemyBars.size <= alive.length) {
      let missing = false
      for (const actor of this.enemyBars.keys()) if (!alive.includes(actor)) { missing = true; break }
      if (!missing) return
    }
    for (const [actor, bar] of this.enemyBars) {
      if (alive.includes(actor)) continue
      if (bar.paint) this.barCanvas.remove(bar.paint)
      else bar.el.remove()
      this.enemyBars.delete(actor)
    }
  }

  drawEnemyBars() {
    this.barCanvas.draw(this.hudScale)
  }

  setWaves(bosses) {
    for (const stop of this.waveStops) stop.remove()
    const row = this.waveBar.querySelector('.stops')
    const last = Math.max(1, bosses.length - 1)
    this.waveStops = bosses.map((boss, i) => {
      const stop = el(boss ? '<i class="stop boss"><i class="crest"><i class="gem"></i><i class="hot"></i><i class="shine"></i></i><b>Boss</b></i>' : `<i class="stop"><i class="gem"></i><b>${i + 1}</b></i>`)
      stop.style.setProperty('--at', (i / last).toFixed(4))
      row.appendChild(stop)
      return stop
    })
    this.paintWave(0, true)
  }

  setWave(index) {
    const stop = this.waveStops[index]
    this.waveLabel.textContent = `Wave ${index + 1}/${this.waveStops.length}`
    this.waveStops.forEach((s, i) => {
      s.classList.toggle('done', i < index)
      s.classList.toggle('now', i === index)
    })
    if (stop) this.deferClass(stop, 'reached')
    this.waveInfo.classList.toggle('bosswave', !!stop && stop.classList.contains('boss'))
  }

  callBossStop(secs) {
    const boss = this.waveStops.find(s => s.classList.contains('boss'))
    if (!boss) return
    clearTimeout(this.waveCalled)
    boss.classList.add('call')
    this.waveCalled = setTimeout(() => boss.classList.remove('call'), secs * 1000)
  }

  setWaveProgress(k) {
    this.paintWave(Math.max(0, Math.min(1, k)), false)
  }

  paintWave(k, snap) {
    if (k === this.wavePainted && !snap) return
    this.waveBar.classList.toggle('snap', snap)
    this.waveBar.style.setProperty('--k', k.toFixed(4))
    this.wavePainted = k
  }

  showBanner(title, sub, dur = 1.6, icon = null) {
    const t = this.banner.querySelector('.t')
    const s = this.banner.querySelector('.s')
    const bk = this.banner.querySelector('.bk')
    const ic = this.banner.querySelector('.ic')
    for (const node of [t, s, bk, ic]) node.getAnimations().forEach(a => a.cancel())
    t.textContent = title
    s.textContent = sub || ''
    this.banner.classList.toggle('subbed', !!sub)
    this.banner.classList.toggle('iconed', !!icon)
    if (icon) ic.src = BANNER_ICONS[icon]
    this.bannerBox = null
    this.bannerIcon = icon
    this.bannerUntil = performance.now() + dur * 1000
    this.placeBanner()
    if (icon) {
      ic.animate(
        [
          { opacity: 0, transform: 'scale(2.2)', easing: BANNER_IN },
          { opacity: 1, transform: 'scale(1)', offset: Math.min(0.24, 0.4 / dur) },
          { opacity: 1, transform: 'scale(1.04)', offset: 1 - Math.min(0.16, 0.3 / dur), easing: EASE_IN },
          { opacity: 0, transform: 'scale(1.12)' },
        ],
        { duration: dur * 1000 }
      )
    }
    bk.animate(
      [{ opacity: 0 }, { opacity: BANNER_SHADE, offset: 0.16 }, { opacity: BANNER_SHADE, offset: 0.82 }, { opacity: 0 }],
      { duration: dur * 1000 }
    )
    const enter = Math.min(0.2, 0.32 / dur)
    const leave = 1 - Math.min(0.16, 0.3 / dur)
    t.animate(
      [
        { opacity: 0, transform: 'scale(1.3)', filter: 'blur(6px)', easing: BANNER_IN },
        { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)', offset: enter },
        { opacity: 1, transform: 'scale(1.02)', filter: 'blur(0px)', offset: leave, easing: EASE_IN },
        { opacity: 0, transform: 'scale(1.1)', filter: 'blur(0px)' },
      ],
      { duration: dur * 1000 }
    )
    s.animate(
      [{ opacity: 0 }, { opacity: 1, offset: enter + 0.06 }, { opacity: 1, offset: leave }, { opacity: 0 }],
      { duration: dur * 1000 }
    )
  }

  placeBanner() {
    const b = this.banner
    b.classList.remove('tight')
    if (!this.heroBarState.shown) {
      this.setBannerWidth(this.bannerRoom([], 0, 0))
      return this.setBannerSpot(view.h * BANNER_HOME, 1)
    }
    if (this.fitBanner() || !b.classList.contains('iconed')) return
    b.classList.add('tight')
    this.fitBanner()
  }

  fitBanner() {
    const blocks = this.bannerBlocks()
    const ceil = this.topBar.getBoundingClientRect().bottom + BANNER_GAP
    const heroTop = this.heroBar.getBoundingClientRect().top - BANNER_GAP
    const heroFoot = this.heroBarState.foot + BANNER_GAP
    const floor = view.h - safeInsets().b - BANNER_GAP
    const above = this.bannerTry(blocks, ceil, heroTop, BANNER_LEAN_ABOVE)
    const below = above.ok ? null : this.bannerTry(blocks, heroFoot, floor, BANNER_LEAN_BELOW)
    const pick = !below || (!below.ok && above.k >= below.k) ? above : below
    this.setBannerWidth(pick.width)
    this.setBannerSpot(pick.y, pick.k)
    this.bannerBox = { left: (view.w - pick.w) / 2, right: (view.w + pick.w) / 2, top: pick.y, bottom: pick.y + pick.h }
    return pick.ok
  }

  bannerTry(blocks, lo, hi, lean) {
    for (const r of blocks) {
      if (!r.stacked || r.bottom <= lo || r.top >= hi) continue
      if ((r.top + r.bottom) / 2 < (lo + hi) / 2) lo = Math.max(lo, r.bottom + BANNER_GAP)
      else hi = Math.min(hi, r.top - BANNER_GAP)
    }
    const width = this.bannerRoom(blocks, lo, hi)
    const spot = this.bannerMeasure(width, lo, hi, lean)
    const snug = this.bannerRoom(blocks, spot.y, spot.y + spot.h)
    if (snug <= width) return spot
    const wide = this.bannerMeasure(snug, lo, hi, lean)
    if (this.bannerRoom(blocks, wide.y, wide.y + wide.h) >= snug) return wide
    return this.bannerMeasure(width, lo, hi, lean)
  }

  bannerMeasure(width, lo, hi, lean) {
    this.setBannerWidth(width)
    this.banner.style.scale = ''
    const need = this.banner.offsetHeight || 1
    const span = this.bannerSpan()
    const wide = Math.max(1, span.right - span.left)
    const k = Math.min(1, (hi - lo) / need, width / wide)
    const y = lo + Math.max(0, hi - lo - need * k) * lean
    const shown = Math.max(k, BANNER_MIN_SCALE)
    return { y, k, h: need * shown, w: wide * shown, width, ok: k >= BANNER_MIN_FIT }
  }

  bannerRoom(blocks, top, bottom) {
    const insets = safeInsets()
    let margin = Math.max(insets.l, insets.r) + BANNER_GAP
    for (const r of blocks) {
      if (r.stacked || r.bottom <= top || r.top >= bottom) continue
      margin = Math.max(margin, (r.left + r.right) / 2 < view.w / 2 ? r.right + BANNER_GAP : view.w - r.left + BANNER_GAP)
    }
    return Math.max(0, view.w - 2 * margin)
  }

  bannerBlocks() {
    const blocks = []
    const add = (node, stacked, pad = 0) => {
      if (!node || !shownOnScreen(node)) return
      const r = node.getBoundingClientRect()
      if (!r.width || !r.height) return
      const centred = Math.abs((r.left + r.right) / 2 - view.w / 2) < view.w * BANNER_CENTRE_BAND
      blocks.push({ left: r.left - pad, right: r.right + pad, top: r.top - pad, bottom: r.bottom + pad, stacked: stacked || centred })
    }
    if (this.lootBig.childElementCount) add(this.lootBig, true)
    add(this.stick, false)
    add(this.animaCard, false)
    add(this.skillbar, false, SKILL_FRAME_PAD * HUD_UNIT * this.hudScale)
    const bossStop = this.waveStops.find(s => s.classList.contains('boss'))
    add(bossStop, false)
    add(bossStop && bossStop.querySelector('b'), false)
    let boss = this.bannerIcon === 'boss'
    for (const bar of this.enemyBars.values()) {
      if (!bar.half || bar.gone) continue
      if (bar.shown) add(bar.el, true)
      boss = true
    }
    if (boss) {
      const half = BOSS_BAR_HALF * this.hudScale + BAR_EDGE
      const tall = 2 * (BOSS_BAR_HALF_H * this.hudScale + BAR_EDGE)
      blocks.push({ left: view.w / 2 - half, right: view.w / 2 + half, top: this.topBarBottom, bottom: this.topBarBottom + tall, stacked: true })
    }
    return blocks
  }

  clearBanner(x, half, y, halfH) {
    const b = this.bannerBox
    if (!b || performance.now() > this.bannerUntil) return y
    if (x + half <= b.left || x - half >= b.right || y + halfH <= b.top || y - halfH >= b.bottom) return y
    const up = b.top - halfH
    if (y < (b.top + b.bottom) / 2 && up - halfH >= this.topBarBottom) return up
    return b.bottom + halfH
  }

  bannerSpan() {
    const range = this.bannerRange || (this.bannerRange = document.createRange())
    let left = view.w
    let right = 0
    for (const node of this.banner.querySelectorAll('.ic, .t, .s')) {
      range.selectNodeContents(node)
      const r = node.tagName === 'IMG' ? node.getBoundingClientRect() : range.getBoundingClientRect()
      if (!r.width) continue
      left = Math.min(left, r.left)
      right = Math.max(right, r.right)
    }
    return right > left ? { left, right } : { left: view.w / 2, right: view.w / 2 }
  }

  setBannerSpot(y, k) {
    this.banner.style.top = `${Math.round(y)}px`
    this.banner.style.scale = k < 1 ? Math.max(k, BANNER_MIN_SCALE).toFixed(3) : ''
    this.banner.style.translate = ''
  }

  setBannerWidth(width) {
    this.banner.style.setProperty('--bw', `${Math.floor(width)}px`)
  }

  openGear(gear, intro) {
    clearTimeout(this.settleTimer)
    this.root.classList.remove('settling')
    this.gearRing.open(gear, intro)
    this.hud.classList.add('gearmode')
    this.root.classList.add('gearing')
  }

  closeGear() {
    this.gearRing.close()
    this.hud.classList.remove('gearmode')
    this.root.classList.remove('gearing')
    this.root.classList.add('settling')
    clearTimeout(this.settleTimer)
    this.settleTimer = setTimeout(() => {
      this.root.classList.remove('settling')
      if (this.banner.querySelector('.t').getAnimations().length) this.placeBanner()
    }, GEAR_SETTLE_MS)
  }

  showPowerGain(from, to, gains = '') {
    const pop = this.powerPop
    pop.querySelector('b').textContent = to.toLocaleString('en-US')
    pop.querySelector('span').textContent = `+${(to - from).toLocaleString('en-US')}`
    pop.querySelector('em').textContent = gains
    pop.getAnimations().forEach(a => a.cancel())
    pop.animate([
      { opacity: 0, transform: 'translateX(-50%) scale(.6)' },
      { opacity: 1, transform: 'translateX(-50%) scale(1.08)', offset: 0.12 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.2 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.82 },
      { opacity: 0, transform: 'translateX(-50%) translateY(-30%) scale(1)' },
    ], { duration: 2400, easing: 'ease-out' })
    pop.querySelector('span').animate([
      { transform: 'scale(.4)', opacity: 0 },
      { transform: 'scale(1.3)', opacity: 1, offset: 0.25 },
      { transform: 'scale(1)', opacity: 1 },
    ], { duration: 700, delay: 250, fill: 'backwards', easing: 'ease-out' })
  }

  lootRelic(item, tag = '') {
    const icon = RELIC_ART[`../assets/GENERAL/HUD/loot/relic-${item.set}-${item.slot}.webp`] || ''
    const stars = RARITY_STARS[item.rarity] || 1
    const row = el(`<div class="lootrow ${item.rarity}">
      <i class="bg"></i>
      <i class="flash"></i>
      <div class="slot"><div class="frame"><img class="icon" src="${icon}" alt="" draggable="false"><div class="rank">${'<i></i>'.repeat(stars)}</div></div></div>
      <span class="name">${RELIC_NAMES[item.slot] || ''}${tag ? `<b class="tag">${tag}</b>` : ''}</span>
    </div>`)
    this.lootBig.prepend(row)
    const ms = { fill: 'both' }
    row.animate([{ opacity: 0 }, { opacity: 1 }], { ...ms, duration: 370 })
    row.querySelector('.name').animate([{ opacity: 0, offset: 0 }, { opacity: 0, offset: 0.486 }, { opacity: 1 }], { ...ms, duration: 370 })
    row.querySelector('.slot').animate([
      { opacity: 0, transform: 'scale(.5)', offset: 0 },
      { opacity: 0, offset: 0.4286 },
      { opacity: 1, transform: 'scale(1)', offset: 0.7143 },
      { opacity: 1, transform: 'scale(.9)' },
    ], { ...ms, duration: 420 })
    row.querySelector('.flash').animate([
      { opacity: 0, transform: 'translateX(calc(344.58 * var(--u)))', offset: 0 },
      { opacity: 1, offset: 0.4286 },
      { opacity: 0, offset: 0.9524 },
      { opacity: 0, transform: 'translateX(calc(-193 * var(--u)))' },
    ], { ...ms, duration: 420 })
    const rows = [...this.lootBig.children]
    rows.slice(LOOT_ROWS).forEach(r => r.remove())
    setTimeout(() => this.hideLootRow(row), LOOT_ROW_MS)
  }

  hideLootRow(row) {
    if (!row.isConnected) return
    row.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LOOT_HIDE_MS, fill: 'forwards' }).onfinish = () => row.remove()
  }

  buildLoot() {
    this.loot.innerHTML = ''
    LOOT.forEach((l, i) => {
      const c = el(`<div class="lootcell ${l.cls}"><img src="${LOOT_ART[l.icon]}" alt="" draggable="false"><b>${l.label}</b></div>`)
      this.loot.appendChild(c)
      c.animate(
        [
          { opacity: 0, transform: 'scale(.4) rotate(-14deg)' },
          { opacity: 1, transform: 'scale(1.18) rotate(4deg)', offset: 0.6 },
          { opacity: 1, transform: 'scale(1) rotate(0)' },
        ],
        { duration: 520, delay: 280 + i * 130, fill: 'forwards', easing: 'cubic-bezier(.2,1.4,.4,1)' }
      )
    })
  }
}
