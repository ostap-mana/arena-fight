import { CardBorderFx } from './card-fx.js'
import { HEROES, LOOT } from '../data/heroes.js'
import playNowImg from '../assets/GENERAL/BUTTONS/play-now.webp'
import attackSwordImg from '../assets/GENERAL/HUD/buttons/attack-sword.webp'
import attackSpearImg from '../assets/GENERAL/HUD/buttons/attack-spear.webp'
import attackArcanaImg from '../assets/GENERAL/HUD/buttons/attack-arcana.webp'
import eld037Skill1 from '../assets/GENERAL/HUD/skills/eld037-1.webp'
import eld037Skill2 from '../assets/GENERAL/HUD/skills/eld037-2.webp'
import eld037Ult from '../assets/GENERAL/HUD/skills/eld037-ult.webp'
import mag018Skill1 from '../assets/GENERAL/HUD/skills/mag018-1.webp'
import mag018Skill2 from '../assets/GENERAL/HUD/skills/mag018-2.webp'
import mag018Ult from '../assets/GENERAL/HUD/skills/mag018-ult.webp'
import eld025Skill1 from '../assets/GENERAL/HUD/skills/eld025-1.webp'
import eld025Skill2 from '../assets/GENERAL/HUD/skills/eld025-2.webp'
import eld025Ult from '../assets/GENERAL/HUD/skills/eld025-ult.webp'
import eld037Portrait from '../assets/GENERAL/HUD/heroes/eld037-large.webp'
import mag018Portrait from '../assets/GENERAL/HUD/heroes/mag018-large.webp'
import eld025Portrait from '../assets/GENERAL/HUD/heroes/eld025-large.webp'
import animlts004Skill1 from '../assets/GENERAL/HUD/skills/animlts004-1.webp'
import animlts004Skill2 from '../assets/GENERAL/HUD/skills/animlts004-2.webp'
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
import { deferImages, whenReleased, releaseImages } from './lazy.js'
import { FINGER, TAP } from './tapcue.js'
import powerIconImg from '../assets/GENERAL/HUD/gear/power-icon.webp'
import bossBadgeImg from '../assets/GENERAL/HUD/wave/boss.webp'

const BANNER_ICONS = {
  boss: bossBadgeImg,
}

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

const SKILL_ART = {
  eld037: [eld037Skill1, eld037Skill2, eld037Ult],
  mag018: [mag018Skill1, mag018Skill2, mag018Ult],
  eld025: [eld025Skill1, eld025Skill2, eld025Ult],
  animlts004: [animlts004Skill1, animlts004Skill2],
}

const ATTACK_ART = {
  sword: attackSwordImg,
  spear: attackSpearImg,
  arcana: attackArcanaImg,
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
const APPEAR_FROM = 1.15
const APPEAR_MS = 400
const APPEAR_FADE_MS = 300
const CARD_DELAY_MS = 120
const CARD_STAGGER_MS = 70
const PICK_LAG_MS = 150
const TOUR_DELAY_MS = 800
const TOUR_PRESS_MS = 333
const TOUR_LIFT_MS = 840
const TOUR_TAP_MS = 1400
const TOUR_ORDER = HEROES.map((h, i) => i).concat(HEROES.map((h, i) => i).slice(1, -1).reverse())
const LEAVE_MS = 220
const VEIL_IN_MS = 350
const VEIL_OUT_MS = 450
const LOOT_ROW_MS = 2600
const LOOT_HIDE_MS = 250
const LOOT_ROWS = 2

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
  move: ['DRAG TO MOVE', 'OR TAP THE GROUND'],
  attack: ['TAP TO ATTACK', 'HOLD TO KEEP HITTING'],
  skill: ['TAP TO CAST', ''],
  titan: ['TAP TO TRANSFORM', ''],
}

export function el(html) {
  const d = document.createElement('div')
  d.innerHTML = html.trim()
  return d.firstElementChild
}

export class UI {
  constructor(rootId) {
    this.root = document.getElementById(rootId)
    this.build()
  }

  build() {
    this.root.insertAdjacentHTML('beforeend', deferImages(`
      <div id="select" class="screen">
        <div class="shade"></div>
        <div class="head">
          <div class="plate"><i class="orn top"></i><h1 class="title-ornate">CHOOSE YOUR INVOKER</h1><i class="orn bottom"></i></div>
          <p>The arena is under attack</p>
        </div>
        <div class="cards"></div>
      </div>

      <div id="hud" class="screen">
        <div id="hpbars"></div>
        <div id="topbar">
          <i class="shade"></i>
          <button id="powergoal">
            <div class="nums"><img class="ico" src="${powerIconImg}" alt="" draggable="false"><b class="now">0</b><span class="goal"></span></div>
            <div class="bar"><i class="back"></i><div class="clip"><i class="fill"></i></div></div>
          </button>
          <div id="waveinfo"><b class="label"></b>
            <div class="wavebar"><i class="back"></i><div class="track"><i class="fill"></i><i class="glint"></i></div><div class="stops"></div></div>
          </div>
          <div class="tip"><i class="plate"></i><img class="ico" src="${powerIconImg}" alt="" draggable="false"><span></span></div>
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
        <div id="skills">
          <div class="skill attack" data-k="attack"><img class="art" alt="" draggable="false"><span class="cd"></span><span class="press"></span></div>
          <div class="skill s1" data-k="s1"><img class="icon" alt="" draggable="false"><span class="cd"></span><span class="frame"></span><span class="cdn"></span><span class="press"></span><span class="ready"></span></div>
          <div class="skill s2" data-k="s2"><img class="icon" alt="" draggable="false"><span class="cd"></span><span class="frame"></span><span class="cdn"></span><span class="press"></span><span class="ready"></span></div>
          <div id="ultbtn">
            <span class="aura"></span>
            <img class="icon" alt="" draggable="false">
            <span class="dim"></span>
            <span class="ring"></span>
            <span class="frame"></span>
            <span class="swirl a"></span>
            <span class="swirl b"></span>
            <span class="pct"><b>0</b><i>%</i></span>
            <span class="press"></span>
            <span class="burst"></span>
          </div>
          ${TAP}
        </div>
      </div>

      <div id="lootfeed">
        <div class="big"></div>
      </div>

      <div id="powerpop"><i class="orn"></i><img class="ico" src="${powerIconImg}" alt="" draggable="false"><b>0</b><span>+0</span></div>
      <div id="gearring"></div>

      <div id="banner"><i class="bk"></i><img class="ic" alt="" draggable="false"><div class="t"></div><div class="s"></div></div>
      <div id="veil"></div>

      <div id="fail" class="screen">
        <div class="t">CRITICAL HP!</div>
        <div class="sub">transform and save the fight</div>
        <div class="countdown">3</div>
        <button class="btn-gold" id="rescue">TRANSFORM</button>
      </div>

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
        <div class="band"><img class="verdict" alt="" draggable="false"></div>
        <button class="control"><img class="plate" alt="" draggable="false"><span class="label">RETRY</span></button>
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
    this.heroBar = el(`<div class="fhp"><div class="part"><i class="glow"></i><i class="fill"></i><i class="noise"></i></div></div>`)
    this.enemyLayer.appendChild(this.heroBar)
    this.heroBarState = { k: 1, max: 0, shown: false }
    this.cooldownState = {}
    this.topBar = this.root.querySelector('#topbar')
    this.topTip = this.topBar.querySelector('.tip span')
    this.waveInfo = this.root.querySelector('#waveinfo')
    this.waveLabel = this.waveInfo.querySelector('.label')
    this.waveBar = this.waveInfo.querySelector('.wavebar')
    this.waveStops = []
    this.waveCalled = 0
    this.wavePainted = -1
    this.ultBtn = this.root.querySelector('#ultbtn')
    this.attackBtn = this.root.querySelector('.skill.attack')
    this.attackArt = this.attackBtn.querySelector('.art')
    this.ultIcon = this.ultBtn.querySelector('.icon')
    this.ultPct = this.ultBtn.querySelector('.pct b')
    this.ultReady = false
    this.animaCard = this.root.querySelector('#animacard')
    this.animaIcon = this.animaCard.querySelector('.portrait .icon')
    this.animaHero = this.animaCard.querySelector('.hero img')
    this.animaCooldown = this.animaCard.querySelector('.cooldown b')
    this.animaReady = false
    this.titanTimer = this.root.querySelector('#titantimer')
    this.stick = this.root.querySelector('#stick')
    this.gestureHint = this.root.querySelector('#gesturehint')
    this.heroCue = this.root.querySelector('#herocue')
    this.heroCueTap = this.heroCue.querySelector('.tapcue')
    this.skillsBox = this.root.querySelector('#skills')
    this.skillCue = this.skillsBox.querySelector('.tapcue')
    this.skills = this.root.querySelectorAll('.skill')
    this.skillIcons = ['s1', 's2'].map(k => this.hud.querySelector(`.skill.${k} .icon`))
    whenReleased(() => {
      Object.values(PORTRAIT_ART).forEach(src => { new Image().src = src })
      Object.values(SKILL_ART).flat().forEach(src => { new Image().src = src })
      Object.values(ATTACK_ART).forEach(src => { new Image().src = src })
    })
    this.banner = this.root.querySelector('#banner')
    this.veil = this.root.querySelector('#veil')
    this.end = this.root.querySelector('#end')
    this.fail = this.root.querySelector('#fail')
    this.loot = this.end.querySelector('.loot')
    this.lootFeed = this.root.querySelector('#lootfeed')
    this.lootBig = this.lootFeed.querySelector('.big')
    this.outcome = new Outcome(this.root.querySelector('#outcome'))
    this.gearRing = new GearRing(this.root.querySelector('#gearring'))
    this.powerPop = this.root.querySelector('#powerpop')
    this.powerGoal = this.root.querySelector('#powergoal')
    this.shownGoalPower = -1
    this.fitHud()
    addEventListener('resize', () => this.fitHud())
  }

  showGestureHint(on, mode = 'move') {
    const el = this.gestureHint
    if (!on) {
      if (el.dataset.mode === mode) el.classList.remove('on')
      return
    }
    el.dataset.mode = mode
    for (const m of Object.keys(HINT_TEXT)) el.classList.toggle(m, m === mode)
    const [main, sub] = HINT_TEXT[mode]
    el.querySelector('.g-main').textContent = main
    el.querySelector('.g-sub').textContent = sub
    el.classList.remove('play')
    void el.offsetWidth
    el.classList.add('on', 'play')
  }

  hintShown(mode) {
    return this.gestureHint.classList.contains('on') && this.gestureHint.dataset.mode === mode
  }

  cueSkill(key) {
    const cue = this.skillCue
    this.cuedSkill = key
    if (!key) {
      cue.classList.remove('on')
      return
    }
    const btn = key === 'ult' ? this.ultBtn : this.hud.querySelector(`.skill.${key}`)
    cue.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`
    cue.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`
    const r = btn.getBoundingClientRect()
    cue.classList.toggle('flip', r.left + r.width / 2 > innerWidth * 0.62)
    cue.classList.add('on')
  }

  cueHero(on) {
    this.heroCueTap.classList.toggle('on', on)
  }

  placeHeroCue(x, y, visible) {
    this.heroCue.style.visibility = visible ? 'visible' : 'hidden'
    if (!visible) return
    this.heroCue.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
    this.heroCueTap.classList.toggle('flip', x > innerWidth * 0.62)
  }

  setTip(text) {
    const was = this.topBar.classList.contains('tipped')
    this.topBar.classList.toggle('tipped', !!text)
    if (!text) return
    const fresh = !was || this.topTip.textContent !== text
    this.topTip.textContent = text
    if (fresh) this.replayClass(this.topTip.parentNode, 'pop')
  }

  fitHud() {
    const short = Math.min(innerWidth, innerHeight)
    const long = Math.max(innerWidth, innerHeight)
    const portrait = innerHeight > innerWidth
    this.hudScale = Math.min(1.8, Math.max(portrait ? 0.92 : 0.8, Math.min(short / 410, long / 730)))
    document.documentElement.style.setProperty('--hud-scale', this.hudScale.toFixed(3))
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
    const map = { select: this.select, hud: this.hud, end: this.end, fail: this.fail }
    map[name].classList.toggle('on', on)
  }

  buildCards(onPreview, onPick) {
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
      slot.querySelector('.card').addEventListener('click', () => onPreview(i))
      slot.querySelector('.pick').addEventListener('click', () => onPick(i))
      this.cardEls.push(slot)
      this.cards.appendChild(slot)
    })
    this.tap = el(TAP)
    this.cards.appendChild(this.tap)
  }

  pointAtPick(i, glide) {
    const slot = this.cardEls[i]
    const pick = slot.querySelector('.pick')
    const left = slot.offsetLeft + pick.offsetLeft + pick.offsetWidth * 0.7
    this.tap.classList.toggle('still', !glide)
    this.tap.classList.toggle('flip', left > this.cards.offsetWidth * 0.62)
    this.tap.style.left = `${left}px`
    this.tap.style.top = `${slot.offsetTop + pick.offsetTop + pick.offsetHeight * 0.64}px`
  }

  startTour() {
    this.stopTour()
    this.pointAtPick(TOUR_ORDER[0], false)
    void this.tap.offsetWidth
    this.tap.classList.add('on')
    const start = performance.now()
    const hop = k => {
      const at = start + TOUR_PRESS_MS + TOUR_LIFT_MS + k * TOUR_TAP_MS
      this.tourTimer = setTimeout(() => {
        this.pointAtPick(TOUR_ORDER[(k + 1) % TOUR_ORDER.length], true)
        hop(k + 1)
      }, Math.max(0, at - performance.now()))
    }
    hop(0)
  }

  stopTour() {
    clearTimeout(this.tourTimer)
    clearTimeout(this.tourDelay)
    this.tap.classList.remove('on')
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
    this.stopTour()
    this.tourDelay = setTimeout(() => this.startTour(), TOUR_DELAY_MS)
  }

  leaveSelect(duration) {
    this.stopTour()
    this.select.classList.add('leaving')
    this.cardEls.forEach(slot => {
      const picked = slot.classList.contains('sel')
      const frames = picked
        ? [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.06)', opacity: 1, offset: 0.35 }, { transform: 'translateY(8%)', opacity: 0 }]
        : [{ transform: 'none', opacity: 1 }, { transform: 'translateY(12%)', opacity: 0 }]
      slot.animate(frames, { duration: picked ? LEAVE_MS + 120 : LEAVE_MS, easing: EASE_IN, fill: 'forwards' })
    })
    this.veil.getAnimations().forEach(a => a.cancel())
    this.veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: VEIL_IN_MS, delay: Math.max(0, duration * 1000 - VEIL_IN_MS), easing: EASE_IN, fill: 'forwards' })
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

  setHud(hero) {
    this.attackArt.src = ATTACK_ART[hero.attack] || ATTACK_ART.sword
    const art = SKILL_ART[hero.model] || SKILL_ART.mag018
    this.skillIcons.forEach((img, i) => { img.src = art[i] })
    this.ultIcon.src = art[2]
  }

  setTitanHud(titan) {
    const art = SKILL_ART[titan.model] || []
    this.skillIcons.forEach((img, i) => { if (art[i]) img.src = art[i] })
  }

  setHp(v, max) {
    this.setHeroBar(Math.max(0, Math.min(1, v / max)), max)
  }

  setPower(power, goal, ready) {
    const el = this.powerGoal
    const done = power >= goal
    el.querySelector('.now').textContent = power.toLocaleString('en-US')
    el.querySelector('.goal').textContent = `/ ${goal.toLocaleString('en-US')}`
    el.style.setProperty('--k', Math.min(1, power / goal).toFixed(4))
    el.classList.toggle('done', done)
    el.classList.toggle('ready', !!ready)
    if (this.shownGoalPower >= 0 && power !== this.shownGoalPower) {
      el.querySelector('.nums').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.35 }, { transform: 'scale(1)' }], { duration: 420, easing: 'ease-out' })
      if (done && this.shownGoalPower < goal) el.querySelector('.bar').animate([{ filter: 'brightness(2.4)' }, { filter: 'brightness(1)' }], { duration: 900, easing: 'ease-out' })
    }
    this.shownGoalPower = power
  }

  setShield(on) {
    this.topBar.classList.toggle('danger', on)
    this.waveInfo.classList.toggle('shielded', on)
  }

  setHeroBar(k, max) {
    const bar = this.heroBarState
    const reset = max !== bar.max
    const hit = !reset && k < bar.k
    bar.max = max
    bar.k = k
    this.heroBar.classList.toggle('snap', reset)
    this.heroBar.style.setProperty('--k', k)
    if (hit) this.replayClass(this.heroBar, 'hit')
  }

  placeHeroBar(x, y, visible) {
    const bar = this.heroBarState
    if (bar.shown !== visible) {
      bar.shown = visible
      this.heroBar.style.visibility = visible ? 'visible' : 'hidden'
    }
    if (visible) this.heroBar.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${this.hudScale})`
  }

  tick(dt) {
    if (this.cardFx && this.select.classList.contains('on')) this.cardFx.tick(dt)
  }

  setUlt(k, ready) {
    const v = Math.max(0, Math.min(1, k))
    const was = this.ultReady
    this.ultReady = ready
    this.ultBtn.classList.toggle('on', ready)
    this.ultBtn.style.setProperty('--k', v)
    this.ultPct.textContent = Math.floor(v * 100)
    if (ready && !was) this.replayClass(this.ultBtn, 'charged')
  }

  fireUlt() {
    this.replayClass(this.ultBtn, 'fire')
  }

  setAnima(titan, hero) {
    this.animaIcon.src = PORTRAIT_ART[titan.model] || ''
    this.animaHero.src = PORTRAIT_ART[hero.model] || ''
  }

  setTitan(k, ready, secondsLeft) {
    const v = Math.max(0, Math.min(1, k))
    const card = this.animaCard
    card.style.setProperty('--r', 1 - v)
    const secs = Math.max(0, secondsLeft)
    this.animaCooldown.textContent = secs >= 10 ? Math.ceil(secs) : secs.toFixed(1)
    const was = this.animaReady
    this.animaReady = ready
    card.classList.toggle('ready', ready)
    if (ready && !was) {
      this.replayClass(card, 'appear')
      this.replayClass(card, 'charged')
    }
  }

  pressAnima() {
    this.replayClass(this.animaCard, 'pressed')
  }

  setTitanTimer(k, on) {
    this.titanTimer.classList.toggle('on', on)
    this.hud.classList.toggle('titan', on)
    this.animaCard.classList.toggle('active', on)
    this.animaCard.style.setProperty('--d', Math.max(0, k))
    this.titanTimer.style.setProperty('--k', Math.max(0, k).toFixed(4))
  }

  replayClass(node, cls) {
    node.classList.remove(cls)
    void node.offsetWidth
    node.classList.add(cls)
  }

  trackEnemy(actor, kind) {
    const bar = el(`<div class="ehp ${kind}"><i class="ghost"></i><i class="fill"></i></div>`)
    this.enemyLayer.appendChild(bar)
    this.enemyBars.set(actor, { el: bar, k: 1, shown: false })
  }

  placeEnemyBar(actor, x, y, visible) {
    const bar = this.enemyBars.get(actor)
    if (!bar) return
    if (bar.shown !== visible) {
      bar.shown = visible
      bar.el.style.visibility = visible ? 'visible' : 'hidden'
    }
    if (!visible) return
    bar.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${this.hudScale})`
    const k = actor.dead ? 0 : Math.max(0, actor.hp / actor.maxHp)
    if (k !== bar.k) {
      bar.k = k
      bar.el.style.setProperty('--k', k)
      bar.el.style.setProperty('--g', k)
    }
    if (actor.dead && !bar.el.classList.contains('gone')) bar.el.classList.add('gone')
  }

  pruneEnemyBars(alive) {
    for (const [actor, bar] of this.enemyBars) {
      if (alive.includes(actor)) continue
      bar.el.remove()
      this.enemyBars.delete(actor)
    }
  }

  setWaves(bosses) {
    for (const stop of this.waveStops) stop.remove()
    const row = this.waveBar.querySelector('.stops')
    const last = Math.max(1, bosses.length - 1)
    this.waveStops = bosses.map((boss, i) => {
      const stop = el(boss ? '<i class="stop boss"><i class="gem"></i></i>' : `<i class="stop"><i class="gem"></i><b>${i + 1}</b></i>`)
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
    if (stop) this.replayClass(stop, 'reached')
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

  cooldown(key, k, secs) {
    const s = this.hud.querySelector(`.skill[data-k="${key}"]`)
    if (!s) return
    const prev = this.cooldownState[key] || 0
    this.cooldownState[key] = k
    s.style.setProperty('--k', k)
    const n = s.querySelector('.cdn')
    if (n) {
      if (k > 0.01) { n.style.opacity = '1'; n.textContent = secs >= 1 ? Math.ceil(secs) : secs.toFixed(1) }
      else n.style.opacity = '0'
    }
    if (prev > 0.01 && k <= 0.01 && key !== 'attack') {
      s.classList.remove('charged')
      void s.offsetWidth
      s.classList.add('charged')
    }
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
    if (icon) {
      ic.src = BANNER_ICONS[icon]
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
      [{ opacity: 0 }, { opacity: 1, offset: 0.16 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }],
      { duration: dur * 1000 }
    )
    const enter = Math.min(0.2, 0.32 / dur)
    const leave = 1 - Math.min(0.16, 0.3 / dur)
    t.animate(
      [
        { opacity: 0, transform: 'scale(1.6)', filter: 'blur(8px)', easing: BANNER_IN },
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

  openGear(gear, intro) {
    this.gearRing.open(gear, intro)
    this.hud.classList.add('gearmode')
  }

  closeGear() {
    this.gearRing.close()
    this.hud.classList.remove('gearmode')
  }

  showPowerGain(from, to) {
    const pop = this.powerPop
    pop.querySelector('b').textContent = to.toLocaleString('en-US')
    pop.querySelector('span').textContent = `+${(to - from).toLocaleString('en-US')}`
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

  lootRelic(item) {
    const icon = RELIC_ART[`../assets/GENERAL/HUD/loot/relic-${item.set}-${item.slot}.webp`] || ''
    const stars = RARITY_STARS[item.rarity] || 1
    const row = el(`<div class="lootrow ${item.rarity}">
      <i class="bg"></i>
      <i class="flash"></i>
      <div class="slot"><div class="frame"><img class="icon" src="${icon}" alt="" draggable="false"><div class="rank">${'<i></i>'.repeat(stars)}</div></div></div>
      <span class="name">${RELIC_NAMES[item.slot] || ''}</span>
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
