import { stream } from './rng.js'
import { POWER_GOAL } from '../data/builds.js'

const random = stream('sim')

export const GEAR_SLOTS = ['helmet', 'chestplate', 'belt', 'weapon', 'pauldrons', 'gauntlets', 'boots', 'shield']
export const BUILD_PIECES = 4

const MAIN_STAT = {
  weapon: { stat: 'atk', base: 50 },
  helmet: { stat: 'hp', base: 1500 },
  shield: { stat: 'def', base: 45 },
  pauldrons: { stat: 'atkPct', base: 3 },
  gauntlets: { stat: 'crit', base: 5 },
  chestplate: { stat: 'hpPct', base: 7 },
  belt: { stat: 'defPct', base: 8 },
  boots: { stat: 'critDmg', base: 15 },
}

const RARITY_MULT = { common: 1, uncommon: 1.6, rare: 2.6, epic: 4.2, legendary: 6.8 }
const RARITY_RANK = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }
const RARITY_MIGHT = { common: 7, uncommon: 9, rare: 11, epic: 14, legendary: 18 }
const WEAPON_MIGHT = 2.2
const BUILD_RESONANCE = 1.3
const SET_POWER = 1.35
const GATE_MARGIN = 0.01
const BASE_DEF = 450
const BASE_CRIT = 15
const BASE_CRIT_DMG = 50
export const ATK_PER_DMG = 30
const POWER = { hp: 0.24, atk: 2.1, def: 1.7, crit: 38, critDmg: 11 }
const FLAT = ['hp', 'atk', 'def']
const gates = new WeakMap()

export function planDrops(build) {
  return build ? build.plan.map(p => ({ ...p, roll: (p.roll || 1) * (build.scale || 1) })) : []
}

export class Gear {
  constructor(hero, build) {
    this.hero = hero
    this.build = build || null
    this.items = []
    this.equipped = {}
    this.unseen = 0
    this.nextId = 1
    this.version = 0
    this.best = null
    this.shown = { version: -1, power: 0 }
    this.startShown = null
  }

  add(drop) {
    const main = MAIN_STAT[drop.slot]
    const rank = RARITY_RANK[drop.rarity] || 1
    const roll = drop.roll || 0.9 + random() * 0.2
    const value = main.base * (RARITY_MULT[drop.rarity] || 1) * roll
    const item = {
      id: this.nextId++,
      slot: drop.slot,
      rarity: drop.rarity,
      set: drop.set,
      rank,
      stat: main.stat,
      value: FLAT.includes(main.stat) ? Math.round(value) : Math.round(value * 10) / 10,
      might: (RARITY_MIGHT[drop.rarity] || RARITY_MIGHT.common) * (drop.slot === 'weapon' ? WEAPON_MIGHT : 1),
    }
    this.items.push(item)
    this.unseen++
    this.touch()
    return item
  }

  touch() {
    this.version++
    this.best = null
  }

  isBuild(item) {
    return !!this.build && !!item && item.set === this.build.set
  }

  buildCount(equipped = this.equipped) {
    return GEAR_SLOTS.filter(s => this.isBuild(equipped[s])).length
  }

  base() {
    const h = this.hero
    return { hp: h.hp * 100, atk: h.atkDmg * ATK_PER_DMG, def: BASE_DEF, crit: BASE_CRIT, critDmg: BASE_CRIT_DMG, full: false }
  }

  stats(equipped = this.equipped) {
    const b = this.base()
    const add = { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, defPct: 0, crit: 0, critDmg: 0 }
    let might = 1
    for (const slot of GEAR_SLOTS) {
      const it = equipped[slot]
      if (!it) continue
      add[it.stat] += it.value * (this.isBuild(it) ? BUILD_RESONANCE : 1)
      might *= 1 + (it.might || 0) / 100
    }
    const full = !!this.build && this.buildCount(equipped) >= BUILD_PIECES
    if (full) {
      for (const [k, v] of Object.entries(this.build.bonus)) add[k] += v
    }
    return {
      hp: Math.round((b.hp + add.hp) * (1 + add.hpPct / 100)),
      atk: Math.round((b.atk + add.atk) * (1 + add.atkPct / 100) * might),
      def: Math.round((b.def + add.def) * (1 + add.defPct / 100)),
      crit: Math.min(100, Math.round((b.crit + add.crit) * 10) / 10),
      critDmg: Math.round((b.critDmg + add.critDmg) * 10) / 10,
      full,
    }
  }

  gate() {
    const build = this.build
    if (!build) return POWER_GOAL
    let g = gates.get(build)
    if (g === undefined) {
      g = gateOf(this.hero, build)
      gates.set(build, g)
    }
    return g
  }

  power(stats) {
    if (stats) return this.display(rawPower(stats))
    if (this.shown.version !== this.version) {
      this.shown.version = this.version
      this.shown.power = this.display(rawPower(this.stats()))
    }
    return this.shown.power
  }

  startPower() {
    if (this.startShown === null) this.startShown = this.display(rawPower(this.base()))
    return this.startShown
  }

  display(raw) {
    const start = this.build && this.build.start
    if (!start) return Math.round(raw)
    const from = rawPower(this.base())
    const gate = this.gate()
    return Math.round(POWER_GOAL + (raw - gate) * (POWER_GOAL - start) / Math.max(1, gate - from))
  }

  candidates(slot) {
    const pool = this.items.filter(it => it.slot === slot)
    if (this.equipped[slot]) pool.push(this.equipped[slot])
    const top = cat => pool.filter(it => this.isBuild(it) === cat).sort((a, b) => b.value - a.value || b.might - a.might)[0]
    return [top(true), top(false)].filter(Boolean)
  }

  bestBuild() {
    if (this.best && this.best.version === this.version) return this.best.equipped
    const options = GEAR_SLOTS.map(s => this.candidates(s))
    let bestRaw = -1
    let bestSet = {}
    const pick = {}
    const walk = i => {
      if (i === GEAR_SLOTS.length) {
        const r = rawPower(this.stats(pick))
        if (r > bestRaw) {
          bestRaw = r
          bestSet = { ...pick }
        }
        return
      }
      const slot = GEAR_SLOTS[i]
      if (!options[i].length) {
        delete pick[slot]
        walk(i + 1)
        return
      }
      for (const it of options[i]) {
        pick[slot] = it
        walk(i + 1)
      }
      delete pick[slot]
    }
    walk(0)
    this.best = { version: this.version, equipped: bestSet, power: this.power(this.stats(bestSet)) }
    return bestSet
  }

  bestPower() {
    this.bestBuild()
    return this.best.power
  }

  isUpgrade(item) {
    const best = this.bestBuild()
    return best[item.slot] === item && this.equipped[item.slot] !== item
  }

  hasUpgrade() {
    return this.items.some(it => this.isUpgrade(it))
  }

  equip(item) {
    const i = this.items.indexOf(item)
    if (i < 0) return
    this.items.splice(i, 1)
    const old = this.equipped[item.slot]
    if (old) this.items.push(old)
    this.equipped[item.slot] = item
    this.touch()
  }

  unequip(slot) {
    const it = this.equipped[slot]
    if (!it) return
    delete this.equipped[slot]
    this.items.push(it)
    this.touch()
  }

  autoEquip() {
    const best = this.bestBuild()
    let changed = false
    for (const slot of GEAR_SLOTS) {
      const it = best[slot]
      if (it && this.equipped[slot] !== it) {
        this.equip(it)
        changed = true
      }
    }
    return changed
  }

  modifiers() {
    const b = this.base()
    const s = this.stats()
    return {
      hp: s.hp / b.hp,
      atk: s.atk / b.atk,
      taken: b.def / s.def,
      crit: s.crit / 100,
      critMult: 1 + s.critDmg / 100,
    }
  }
}

function rawPower(stats) {
  const sum = stats.hp * POWER.hp + stats.atk * POWER.atk + stats.def * POWER.def + stats.crit * POWER.crit + stats.critDmg * POWER.critDmg
  return stats.full ? sum * SET_POWER : sum
}

function gateOf(hero, build) {
  const probe = new Gear(hero, null)
  probe.build = build
  probe.gate = () => POWER_GOAL
  for (const drop of planDrops(build)) {
    probe.add(drop)
    const best = probe.bestBuild()
    if (probe.buildCount(best) >= BUILD_PIECES) return rawPower(probe.stats(best)) * (1 - GATE_MARGIN)
  }
  return rawPower(probe.stats(probe.bestBuild()))
}

export function formatStat(stat, value) {
  if (stat === 'crit' || stat === 'critDmg' || stat.endsWith('Pct')) return `${value}%`
  return value.toLocaleString('en-US')
}

export const STAT_LABEL = { hp: 'HP', atk: 'ATK', def: 'DEF', crit: 'CRIT RATE', critDmg: 'CRIT DMG', hpPct: 'HP', atkPct: 'ATK', defPct: 'DEF' }
