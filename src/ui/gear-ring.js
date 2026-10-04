import { BUILD_PIECES, formatStat, GEAR_SLOTS, STAT_LABEL } from '../core/gear.js'
import { POWER_GOAL, SET_NAME } from '../data/builds.js'
import { deferImages } from './lazy.js'
import { TAP } from './tapcue.js'

const RELIC_ART = import.meta.glob('../assets/GENERAL/HUD/loot/relic-*.webp', { eager: true, import: 'default' })
const GEAR_ART = import.meta.glob('../assets/GENERAL/HUD/gear/*.webp', { eager: true, import: 'default' })
const LEFT = ['helmet', 'chestplate', 'belt', 'weapon']
const RIGHT = ['pauldrons', 'gauntlets', 'boots', 'shield']
const SLOT_NAME = { helmet: 'Helmet', chestplate: 'Chestplate', belt: 'Belt', weapon: 'Weapon', pauldrons: 'Pauldrons', gauntlets: 'Gauntlets', boots: 'Boots', shield: 'Shield' }
const SLOT_MIN = 46
const SLOT_MAX = 72
const SLOT_OF_HERO = 0.21
const HERO_HALF = 0.34
const COLUMN_GAP = 12
const ROW_STEP = 1.16
const BULGE = 0.38
const EDGE = 8
const PLATE_W = 4.6
const STACK_GAP = 12
const STRIP_CELL = 0.84
const STRIP_SLOTS = 6
const COUNT_MS = 650
const FLY_MS = 360
const OPEN_MS = 420
const CLOSE_MS = 200
const SPRING = 'cubic-bezier(.18,1.25,.4,1)'
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function art(name) {
  return GEAR_ART[`../assets/GENERAL/HUD/gear/${name}.webp`] || ''
}

function relicArt(item) {
  return RELIC_ART[`../assets/GENERAL/HUD/loot/relic-${item.set}-${item.slot}.webp`] || ''
}

function itemHtml(item, upgrade, build) {
  return `<div class="gi ${item.rarity}${build ? ' build' : ''}" data-id="${item.id}">
    <i class="glow"></i>
    <img class="ic" src="${relicArt(item)}" alt="" draggable="false">
    <i class="grad"></i>
    <i class="border"></i>
    <img class="set" src="${art(`set-${item.set}`)}" alt="" draggable="false">
    <div class="rank">${'<i></i>'.repeat(item.rank)}</div>
    ${upgrade ? `<img class="up" src="${art('arrow-up')}" alt="" draggable="false">` : ''}
  </div>`
}

function slotHtml(slot) {
  return `<div class="slot" data-slot="${slot}"><div class="sk"><i class="dim"></i><i class="sbg"></i><img class="empty" src="${art(`slot-${slot}`)}" alt="" draggable="false"><div class="item"></div><i class="pick"></i><i class="burst"></i></div></div>`
}

export class GearRing {
  constructor(el) {
    this.el = el
    this.gear = null
    this.onClose = null
    this.onChange = null
    this.filter = 'all'
    this.shownPower = 0
    this.seq = 0
    this.spots = {}
    this.center = { x: 0, y: 0 }
    this.build()
  }

  build() {
    this.el.innerHTML = deferImages(`
      <i class="halo"></i>
      <div class="plate"><div class="pk">
        <i class="pshadow"></i>
        <span class="plabel">Invoker power</span>
        <div class="pv"><i class="picon"></i><b class="pvalue">0</b><span class="pgoal">/ ${POWER_GOAL.toLocaleString('en-US')}</span></div>
        <div class="gbar"><i class="gfill"></i></div>
        <i class="orn"></i>
        <span class="pdelta"></span>
        <button class="buildchip"><img class="bset" alt="" draggable="false"><span class="bname"></span><span class="pips">${'<i></i>'.repeat(BUILD_PIECES)}</span></button>
        <button class="x" aria-label="Close"><i></i></button>
      </div></div>
      ${[...LEFT, ...RIGHT].map(slotHtml).join('')}
      <div class="strip"><div class="tk">
        <div class="slabel"><b></b><span></span></div>
        <div class="row">
          <button class="auto"><i class="sweep"></i><span>AUTO</span></button>
          <div class="items"></div>
          ${TAP}
        </div>
      </div></div>`)
    this.plate = this.el.querySelector('.plate')
    this.strip = this.el.querySelector('.strip')
    this.items = this.el.querySelector('.items')
    this.halo = this.el.querySelector('.halo')
    this.powerValue = this.el.querySelector('.pvalue')
    this.powerDelta = this.el.querySelector('.pdelta')
    this.autoBtn = this.el.querySelector('.auto')
    this.autoCue = this.el.querySelector('.row > .tapcue')
    this.wantsAutoCue = false
    this.buildChip = this.el.querySelector('.buildchip')
    this.slots = Object.fromEntries([...this.el.querySelectorAll('.slot')].map(s => [s.dataset.slot, s]))
    this.el.querySelector('.x').addEventListener('click', () => this.onClose && this.onClose())
    this.autoBtn.addEventListener('click', () => this.autoEquip())
    this.buildChip.addEventListener('click', () => this.setFilter(this.filter === 'build' ? 'all' : 'build'))
    this.items.addEventListener('click', e => {
      const cell = e.target.closest('.gi')
      if (!cell) return
      const item = this.gear.items.find(it => it.id === Number(cell.dataset.id))
      if (item) this.equipFrom(item, cell)
    })
    for (const [type, slot] of Object.entries(this.slots)) {
      slot.addEventListener('click', () => {
        if (this.filter === type && this.gear.equipped[type]) {
          this.change(() => this.gear.unequip(type), 'unequip')
          this.pop(type, false)
        } else this.setFilter(this.filter === type ? 'all' : type)
      })
    }
  }

  get isOpen() {
    return this.el.classList.contains('on')
  }

  open(gear, hero) {
    const token = ++this.seq
    this.gear = gear
    gear.unseen = 0
    this.filter = GEAR_SLOTS.find(s => gear.items.some(it => it.slot === s && gear.isUpgrade(it))) || 'all'
    this.shownPower = gear.power()
    this.powerValue.textContent = this.shownPower.toLocaleString('en-US')
    this.shownPieces = undefined
    this.el.classList.add('on')
    this.render()
    this.paintGoal(this.shownPower)
    this.reveal()
    return token
  }

  reveal() {
    const c = this.center
    for (const [type, slot] of Object.entries(this.slots)) {
      const spot = this.spots[type]
      const sk = slot.firstElementChild
      sk.getAnimations().forEach(a => a.cancel())
      const dx = spot ? c.x - spot.x : 0
      const dy = spot ? c.y - spot.y : 0
      const i = [...LEFT, ...RIGHT].indexOf(type) % 4
      sk.animate([
        { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0 },
        { transform: 'none', opacity: 1 },
      ], { duration: OPEN_MS, delay: 40 + i * 45, easing: SPRING, fill: 'backwards' })
    }
    this.plate.firstElementChild.animate([{ transform: 'translateY(30%) scale(.7)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: OPEN_MS, easing: SPRING })
    this.strip.firstElementChild.animate([{ transform: 'translateY(-30%) scale(.8)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: OPEN_MS, delay: 120, easing: SPRING, fill: 'backwards' })
    this.halo.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(.3)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], { duration: OPEN_MS, easing: 'ease-out' })
    this.revealItems(200)
  }

  close() {
    this.cueAuto(false)
    const token = this.seq
    const c = this.center
    for (const [type, slot] of Object.entries(this.slots)) {
      const spot = this.spots[type]
      const dx = spot ? c.x - spot.x : 0
      const dy = spot ? c.y - spot.y : 0
      slot.firstElementChild.animate([
        { transform: 'none', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(.2)`, opacity: 0 },
      ], { duration: CLOSE_MS, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' })
    }
    for (const part of [this.plate.firstElementChild, this.strip.firstElementChild, this.halo]) {
      part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, fill: 'forwards' })
    }
    setTimeout(() => {
      if (token !== this.seq) return
      this.el.classList.remove('on')
      this.el.querySelectorAll('*').forEach(n => n.getAnimations().forEach(a => a.cancel()))
    }, CLOSE_MS)
  }

  place(cx, top, bottom) {
    const W = innerWidth
    const H = innerHeight
    const heroH = Math.max(40, bottom - top)
    const s = clamp(heroH * SLOT_OF_HERO, SLOT_MIN, SLOT_MAX)
    this.el.style.setProperty('--s', `${s.toFixed(1)}px`)
    const bulge = s * BULGE
    let off = heroH * HERO_HALF + s * 0.5 + COLUMN_GAP
    const room = Math.min(cx, W - cx) - EDGE - s / 2 - bulge
    if (off > room) off = Math.max(s * 0.6, room)
    const x = clamp(cx, off + bulge + s / 2 + EDGE, W - off - bulge - s / 2 - EDGE)
    const step = Math.max(s * ROW_STEP, (heroH - s) / 3)
    const cy = (top + bottom) / 2
    const half = step * 1.5 + s / 2
    this.center = { x, y: cy }
    const put = (type, side, i) => {
      const t = (i - 1.5) / 1.5
      const sx = x + side * (off + bulge * (1 - t * t))
      const sy = cy + t * step * 1.5
      this.spots[type] = { x: sx, y: sy }
      this.slots[type].style.transform = `translate3d(${(sx - s / 2).toFixed(1)}px, ${(sy - s / 2).toFixed(1)}px, 0)`
    }
    LEFT.forEach((type, i) => put(type, -1, i))
    RIGHT.forEach((type, i) => put(type, 1, i))
    const plateW = Math.min(W - EDGE * 2, s * PLATE_W)
    const plateY = Math.min(top, cy - half) - STACK_GAP - this.plate.offsetHeight
    this.plate.style.width = `${plateW.toFixed(1)}px`
    this.plate.style.transform = `translate3d(${clamp(x - plateW / 2, EDGE, W - plateW - EDGE).toFixed(1)}px, ${Math.max(EDGE, plateY).toFixed(1)}px, 0)`
    const stripW = Math.min(W - EDGE * 2, s * STRIP_CELL * (STRIP_SLOTS + 1.3) + s * 0.6)
    const stripY = Math.max(bottom, cy + half) + STACK_GAP
    this.strip.style.width = `${stripW.toFixed(1)}px`
    this.strip.style.transform = `translate3d(${clamp(x - stripW / 2, EDGE, W - stripW - EDGE).toFixed(1)}px, ${Math.min(H - this.strip.offsetHeight - EDGE, stripY).toFixed(1)}px, 0)`
    this.halo.style.left = `${x.toFixed(1)}px`
    this.halo.style.top = `${bottom.toFixed(1)}px`
    this.halo.style.width = `${(off * 2 + s * 1.6).toFixed(1)}px`
  }

  setFilter(filter) {
    if (filter === this.filter) return
    this.filter = filter
    this.render()
    this.items.scrollLeft = 0
    this.revealItems(0)
    if (this.onChange) this.onChange('filter')
  }

  revealItems(delay) {
    this.items.querySelectorAll('.gi').forEach((cell, i) => {
      if (i > 10) return
      cell.animate([{ opacity: 0, transform: 'translateY(30%) scale(.7)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: delay + i * 30, easing: SPRING, fill: 'backwards' })
    })
  }

  refresh(fresh) {
    if (!this.gear) return
    this.gear.unseen = 0
    this.render()
    if (!fresh) return
    const cell = this.items.querySelector(`.gi[data-id="${fresh.id}"]`)
    if (cell) cell.animate([{ opacity: 0, transform: 'scale(.3) rotate(-10deg)' }, { opacity: 1, transform: 'scale(1.2)', offset: 0.6 }, { opacity: 1, transform: 'none' }], { duration: 520, easing: 'ease-out' })
    this.pop(fresh.slot, false)
  }

  equipFrom(item, cell) {
    const icon = cell.querySelector('.ic')
    const from = icon.getBoundingClientRect()
    const src = icon.src
    this.change(() => this.gear.equip(item), 'equip')
    this.fly(src, from, item)
  }

  fly(src, from, item) {
    const slot = this.slots[item.slot]
    const holder = slot.querySelector('.item')
    if (!from.width) return this.landed(item)
    const to = holder.getBoundingClientRect()
    const ghost = document.createElement('img')
    ghost.className = `fly ${item.rarity}`
    ghost.src = src
    ghost.draggable = false
    Object.assign(ghost.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` })
    this.el.appendChild(ghost)
    holder.style.opacity = '0'
    const dx = from.left + from.width / 2 - (to.left + to.width / 2)
    const dy = from.top + from.height / 2 - (to.top + to.height / 2)
    const k = from.width / Math.max(1, to.width)
    const lift = Math.min(90, Math.abs(dx) * 0.25 + 30)
    ghost.animate([
      { transform: `translate(${dx}px, ${dy}px) scale(${k})` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - lift}px) scale(${k * 1.25})`, offset: 0.45 },
      { transform: 'translate(0, 0) scale(1)' },
    ], { duration: FLY_MS, easing: 'cubic-bezier(.45,.05,.35,1)' }).onfinish = () => {
      ghost.remove()
      holder.style.opacity = ''
      this.landed(item)
    }
  }

  landed(item) {
    this.pop(item.slot, true, item.rarity)
    this.floatText(item.slot, `+${formatStat(item.stat, item.value)} ${STAT_LABEL[item.stat]}`)
  }

  floatText(type, text) {
    const spot = this.spots[type]
    if (!spot) return
    const tag = document.createElement('div')
    tag.className = 'gainfx'
    tag.textContent = text
    tag.style.left = `${spot.x}px`
    tag.style.top = `${spot.y}px`
    this.el.appendChild(tag)
    tag.animate([
      { opacity: 0, transform: 'translate(-50%, -20%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -110%) scale(1.1)', offset: 0.22 },
      { opacity: 1, transform: 'translate(-50%, -150%) scale(1)', offset: 0.7 },
      { opacity: 0, transform: 'translate(-50%, -220%) scale(1)' },
    ], { duration: 1200, easing: 'ease-out' }).onfinish = () => tag.remove()
  }

  pop(type, gained, rarity) {
    const sk = this.slots[type] && this.slots[type].firstElementChild
    if (!sk) return
    sk.animate(gained
      ? [{ transform: 'scale(1.3)' }, { transform: 'scale(.94)', offset: 0.55 }, { transform: 'scale(1)' }]
      : [{ transform: 'scale(.84)' }, { transform: 'scale(1)' }], { duration: gained ? 400 : 240, easing: 'ease-out' })
    if (!gained) return
    const burst = sk.querySelector('.burst')
    burst.className = `burst ${rarity || ''}`
    burst.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1.15)', offset: 0.3 }, { opacity: 0, transform: 'scale(1.8)' }], { duration: 560, easing: 'ease-out' })
  }

  cueAuto(on) {
    this.wantsAutoCue = on
    this.autoCue.classList.toggle('on', on && this.autoBtn.classList.contains('ready'))
  }

  autoEquip() {
    this.wantsAutoCue = false
    const before = { ...this.gear.equipped }
    this.change(() => this.gear.autoEquip(), 'auto')
    const changed = GEAR_SLOTS.filter(s => this.gear.equipped[s] && this.gear.equipped[s] !== before[s])
    changed.forEach((type, i) => setTimeout(() => this.pop(type, true, this.gear.equipped[type].rarity), i * 90))
    this.autoBtn.animate([{ transform: 'scale(.88)' }, { transform: 'scale(1)' }], { duration: 240, easing: SPRING })
  }

  change(action, kind) {
    const power = this.gear.power()
    if (action() === false) return
    this.render()
    this.countPower(power, this.gear.power())
    if (this.onChange) this.onChange(kind)
  }

  render() {
    const g = this.gear
    for (const [type, slot] of Object.entries(this.slots)) {
      const it = g.equipped[type]
      slot.classList.toggle('filled', !!it)
      slot.classList.toggle('picked', this.filter === type)
      slot.classList.toggle('up', g.items.some(x => x.slot === type && g.isUpgrade(x)))
      slot.querySelector('.item').innerHTML = it ? itemHtml(it, false, g.isBuild(it)) : ''
    }
    this.paintBuild()
    const upgrades = g.items.some(it => g.isUpgrade(it))
    this.autoBtn.classList.toggle('ready', upgrades)
    this.autoCue.classList.toggle('on', this.wantsAutoCue && upgrades)
    const shown = it => this.filter === 'all' || it.slot === this.filter || (this.filter === 'build' && g.isBuild(it))
    const list = g.items.filter(shown).sort((a, b) => Number(g.isUpgrade(b)) - Number(g.isUpgrade(a)) || b.rank - a.rank || b.value - a.value)
    this.items.innerHTML = list.length
      ? list.map(it => itemHtml(it, g.isUpgrade(it), g.isBuild(it))).join('')
      : `<div class="none">${g.items.length ? 'No gear for this slot yet' : 'Defeat monsters to collect gear'}</div>`
    const label = this.el.querySelector('.slabel')
    label.querySelector('b').textContent = this.filter === 'all' ? 'All gear' : this.filter === 'build' && g.build ? `${SET_NAME[g.build.set]} set` : SLOT_NAME[this.filter] || ''
    const eq = g.equipped[this.filter]
    label.querySelector('span').textContent = eq ? `equipped ${formatStat(eq.stat, eq.value)} ${STAT_LABEL[eq.stat]} · tap slot to remove` : `${list.length} item${list.length === 1 ? '' : 's'}`
  }

  paintBuild() {
    const g = this.gear
    const build = g.build
    this.buildChip.style.display = build ? '' : 'none'
    if (!build) return
    const count = g.buildCount()
    const full = count >= BUILD_PIECES
    this.buildChip.querySelector('.bset').src = art(`set-${build.set}`)
    this.buildChip.querySelector('.bname').textContent = full ? `${SET_NAME[build.set]} · ${build.bonusText}` : `${SET_NAME[build.set]} set`
    this.buildChip.classList.toggle('on', full)
    this.buildChip.classList.toggle('picked', this.filter === 'build')
    const pips = this.buildChip.querySelectorAll('.pips i')
    pips.forEach((pip, i) => pip.classList.toggle('on', i < count))
    const was = this.shownPieces === undefined ? count : this.shownPieces
    if (count > was && pips[Math.min(BUILD_PIECES, count) - 1]) {
      pips[Math.min(BUILD_PIECES, count) - 1].animate([{ transform: 'rotate(45deg) scale(2.2)' }, { transform: 'rotate(45deg) scale(1)' }], { duration: 400, easing: SPRING })
      if (full && was < BUILD_PIECES) this.buildChip.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: 560, easing: 'ease-out' })
    }
    this.shownPieces = count
  }

  paintGoal(power) {
    this.el.querySelector('.gfill').style.transform = `scaleX(${Math.min(1, power / POWER_GOAL)})`
    this.plate.classList.toggle('done', power >= POWER_GOAL)
  }

  countPower(from, to) {
    if (to === from) return
    const start = performance.now()
    const tick = now => {
      const k = Math.min(1, (now - start) / COUNT_MS)
      const e = 1 - Math.pow(1 - k, 3)
      this.shownPower = Math.round(from + (to - from) * e)
      this.powerValue.textContent = this.shownPower.toLocaleString('en-US')
      this.paintGoal(this.shownPower)
      if (k < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    const d = to - from
    this.powerDelta.textContent = `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('en-US')}`
    this.powerDelta.getAnimations().forEach(a => a.cancel())
    this.powerDelta.animate([
      { opacity: 0, transform: 'translate(-50%, 40%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1.25)', offset: 0.18 },
      { opacity: 1, transform: 'translate(-50%, 0) scale(1)', offset: 0.75 },
      { opacity: 0, transform: 'translate(-50%, -80%) scale(1)' },
    ], { duration: 1400, easing: 'ease-out' })
    this.powerValue.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.3 }, { transform: 'scale(1)' }], { duration: COUNT_MS })
    this.el.querySelector('.picon').animate([{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(200deg) scale(1.25)', offset: 0.5 }, { transform: 'rotate(360deg) scale(1)' }], { duration: COUNT_MS, easing: 'ease-out' })
  }
}
