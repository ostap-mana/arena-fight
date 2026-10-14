import * as THREE from 'three'
import { loadModelData } from '../core/model.js'
import { characterMaterial } from './character-shader.js'
import { audio } from '../core/audio.js'
import { ARENA_RADIUS } from './arena.js'
import { stream } from '../core/rng.js'
import { LootAura } from './loot-aura.js'

const random = stream('sim')

const LIB = 'loot'
const MODELS = 'loot'
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']
const SLOTS = ['weapon', 'shield', 'helmet', 'pauldrons', 'gauntlets', 'chestplate', 'belt', 'boots']
const SETS = ['attack', 'lifesteal', 'criticaldamage']
const RELIC_SIZE = 0.78
const LAUNCH_Y = 1.1
const FLY_TIME = 0.62
const FLY_PER_UNIT = 0.025
const FLY_EXTRA_MAX = 0.3
const BESIDE = [0.35, 1]
const BEHIND_FAN = 2.2
const FLOOR_LIMIT = ARENA_RADIUS - 1.2
const ARC = [1.7, 2.7]
const HOVER_Y = 0.55
const BOB = 0.09
const BOB_SPEED = 2.6
const SPIN = 1.7
const TUMBLE = 7
const EMERGE_TIME = 0.3
const EMERGE_RISE = 0.5
const EMERGE_SCALE = 0.2
const EMERGE_SPIN = 14
const HOP_TIME = [0.26, 0.16]
const HOP_HEIGHT = [0.45, 0.14]
const REST_HOLD = HOP_TIME[0] + HOP_TIME[1]
const PICK_RADIUS = 3.2
const MAGNET_FEEL = 2.2
const MAGNET_LEAN = 0.55
const MAGNET_BOB_SPEED = 9
const STAGGER = 0.09
const HIT_LIFETIME = 1.2
const HIGHLIGHT_MUTE = new Set(['PS_Beam_3_1', 'PS_Beam_4_1', 'PS_Beam_5_1'])
const TAKE_MUTE = new Set(['PS_G_Glow_1_2_Fade', 'PS_Star_1_1_ReUse', 'PS_Star_1_1_ReUse '])
const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _center = new THREE.Vector3()

function pickWeighted(weights) {
  const entries = Object.entries(weights || { common: 1 })
  let r = random() * entries.reduce((a, [, w]) => a + w, 0)
  for (const [k, w] of entries) {
    r -= w
    if (r <= 0) return k
  }
  return entries[entries.length - 1][0]
}

function between([a, b]) {
  return a + random() * (b - a)
}

function easeOutBack(k) {
  const c = 1.70158
  const u = k - 1
  return 1 + (c + 1) * u * u * u + c * u * u
}

function hopHeight(t) {
  for (let i = 0; i < HOP_TIME.length; i++) {
    if (t < HOP_TIME[i]) {
      const u = t / HOP_TIME[i]
      return 4 * HOP_HEIGHT[i] * u * (1 - u)
    }
    t -= HOP_TIME[i]
  }
  return 0
}

function keepOnFloor(p) {
  const r = Math.hypot(p.x, p.z)
  if (r <= FLOOR_LIMIT) return p
  p.x *= FLOOR_LIMIT / r
  p.z *= FLOOR_LIMIT / r
  return p
}

function awayFrom(pos, angle, dist) {
  return keepOnFloor(new THREE.Vector3(pos.x + Math.sin(angle) * dist, HOVER_Y, pos.z + Math.cos(angle) * dist))
}

function besideCorpse(at, body, spread, hero) {
  const ang = hero ? Math.atan2(at.x - hero.pos.x, at.z - hero.pos.z) + (random() - 0.5) * BEHIND_FAN : random() * Math.PI * 2
  return awayFrom(at, ang, body + between(BESIDE) * spread)
}

function rankOf(item) {
  return RARITIES.indexOf(item.rarity)
}

function bestRank(table) {
  let best = 0
  for (const rarity in (table && table.rarity) || {}) best = Math.max(best, RARITIES.indexOf(rarity))
  return best
}

function dress(mesh) {
  mesh.traverse(o => {
    if (!o.isMesh) return
    const src = o.material
    const extras = src.userData && src.userData.character
    o.material = extras ? characterMaterial(src, extras) : src.clone()
    o.castShadow = false
    o.receiveShadow = false
    o.frustumCulled = false
  })
  return mesh
}

function normalized(node, size) {
  const holder = new THREE.Group()
  const body = dress(node.clone(true))
  body.position.set(0, 0, 0)
  body.quaternion.identity()
  body.scale.set(1, 1, 1)
  body.updateMatrixWorld(true)
  _box.setFromObject(body)
  _box.getSize(_size)
  _box.getCenter(_center)
  const k = size / Math.max(_size.x, _size.y, _size.z, 1e-3)
  body.scale.setScalar(k)
  body.position.copy(_center).multiplyScalar(-k)
  holder.add(body)
  return holder
}

export class Loot {
  constructor(scene, vfx, camera) {
    this.scene = scene
    this.vfx = vfx
    this.camera = camera
    this.group = new THREE.Group()
    this.group.name = 'loot'
    scene.add(this.group)
    this.auras = new LootAura(this.group)
    this.drops = []
    this.queue = []
    this.templates = null
    this.config = null
    this.onCollect = null
    this.plan = null
    this.lastDropAt = null
  }

  async load() {
    const [data] = await Promise.all([loadModelData(MODELS), this.vfx.preload([LIB])])
    const lib = this.vfx.library(LIB)
    this.config = lib ? lib.data.loot : null
    if (!this.config) return
    const byName = new Map()
    data.scene.traverse(o => { if (o.name && !byName.has(o.name)) byName.set(o.name, o) })
    const templates = {}
    for (const slot of SLOTS) {
      const node = byName.get(this.config.relics[slot])
      if (node) templates[slot] = normalized(node, RELIC_SIZE)
    }
    this.templates = templates
  }

  get ready() {
    return !!this.templates
  }

  warmProbe(at, scale) {
    const probe = new THREE.Group()
    for (const t of Object.values(this.templates || {})) probe.add(t.clone(true))
    probe.add(this.auras.probe())
    probe.position.copy(at)
    probe.scale.setScalar(scale)
    this.group.add(probe)
    return probe
  }

  get busy() {
    return this.drops.length > 0 || this.queue.length > 0
  }

  fxNames() {
    const cfg = this.config
    if (!cfg) return []
    return [...Object.values(cfg.rarity).flatMap(r => [r.highlight, r.trail]), cfg.hit].filter(Boolean)
  }

  setPlan(items, roster) {
    this.plan = items.slice()
    this.planLeft = new Map()
    for (const { table, count } of roster) this.planLeft.set(table, (this.planLeft.get(table) || 0) + count)
    this.planKills = Math.max(1, roster.reduce((n, p) => n + p.count, 0))
    this.planSeen = 0
    this.planGiven = 0
  }

  laterCarries(rank) {
    for (const [table, left] of this.planLeft) if (left > 0 && bestRank(table) >= rank) return true
    return false
  }

  dropPlanned(at, table, body) {
    this.planSeen++
    const left = this.planLeft.get(table)
    if (left > 0) this.planLeft.set(table, left - 1)
    const plan = this.plan
    const cap = bestRank(table)
    let upto = Math.min(plan.length, Math.round((this.planSeen * plan.length) / this.planKills))
    for (let j = plan.length - 1; j >= upto; j--) {
      const rank = rankOf(plan[j])
      if (rank <= cap && !this.laterCarries(rank)) {
        upto = j + 1
        break
      }
    }
    for (let i = 0; this.planGiven < upto && rankOf(plan[this.planGiven]) <= cap; i++) {
      this.queue.push({ item: plan[this.planGiven++], at, body, delay: i * STAGGER, spread: 1 })
    }
  }

  flushPlan(at) {
    if (!this.plan) return
    const rest = this.plan.slice(this.planGiven)
    this.planGiven = this.plan.length
    if (!this.ready) {
      for (const item of rest) if (this.onCollect) this.onCollect(item)
      return
    }
    const from = this.lastDropAt || new THREE.Vector3(at.x, LAUNCH_Y, at.z)
    rest.forEach((item, i) => this.queue.push({ item, at: from, body: 0, delay: i * STAGGER, spread: 0.8 }))
  }

  dropFrom(actor, table, boss = false) {
    if (!table || !this.ready) return
    const at = new THREE.Vector3(actor.pos.x, actor.pos.y + Math.min(LAUNCH_Y, actor.height * 0.45), actor.pos.z)
    this.lastDropAt = at
    const body = actor.radius || 0
    if (this.plan && !boss) {
      this.dropPlanned(at, table, body)
      return
    }
    let count = table.relics || 0
    if (random() < (table.chance || 0)) count++
    for (let i = 0; i < count; i++) {
      const item = {
        slot: SLOTS[Math.floor(random() * SLOTS.length)],
        rarity: pickWeighted(table.rarity),
        set: table.set || SETS[Math.floor(random() * SETS.length)],
      }
      this.queue.push({ item, at, body, delay: i * STAGGER, spread: boss ? 1.7 : 1 })
    }
  }

  launch({ item, at, body, spread }, hero) {
    const template = this.templates[item.slot]
    if (!template) return
    const mesh = template.clone(true)
    mesh.position.copy(at)
    mesh.scale.setScalar(EMERGE_SCALE)
    this.group.add(mesh)
    const to = besideCorpse(at, body || 0, spread, hero)
    const travel = Math.hypot(to.x - at.x, to.z - at.z)
    const look = this.config.rarity[item.rarity] || this.config.rarity.common
    this.drops.push({
      item,
      mesh,
      from: at.clone(),
      to,
      dur: FLY_TIME + Math.min(FLY_EXTRA_MAX, travel * FLY_PER_UNIT),
      arc: between(ARC),
      phase: 'emerge',
      t: 0,
      tumble: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      spin: (random() < 0.5 ? -1 : 1) * SPIN,
      look,
      trail: null,
      glow: null,
      aura: null,
    })
    if (this.config.hit) this.vfx.spawn(LIB, this.config.hit, { pos: at, camera: this.camera, lifetime: HIT_LIFETIME, mute: TAKE_MUTE })
    const rare = RARITIES.indexOf(item.rarity) >= 3
    audio.play(rare ? 'loot_drop_artifact' : 'loot_drop_equip', { at, slot: 'loot_drop', max: 3, gap: 0.05 })
  }

  emerge(d, dt) {
    const m = d.mesh
    const k = Math.min(1, d.t / EMERGE_TIME)
    m.position.set(d.from.x, d.from.y + EMERGE_RISE * (1 - (1 - k) * (1 - k)), d.from.z)
    m.scale.setScalar(EMERGE_SCALE + (1 - EMERGE_SCALE) * easeOutBack(k))
    m.rotation.y += EMERGE_SPIN * dt
    if (k < 1) return
    m.scale.setScalar(1)
    d.from.y += EMERGE_RISE
    d.phase = 'fly'
    d.t = 0
    d.trail = this.vfx.spawn(LIB, d.look.trail, { follow: m })
  }

  land(d) {
    d.phase = 'rest'
    d.t = 0
    d.mesh.quaternion.identity()
    if (d.trail) d.trail.stop()
    d.glow = this.vfx.spawn(LIB, d.look.highlight, { pos: new THREE.Vector3(d.to.x, 0.02, d.to.z), mute: HIGHLIGHT_MUTE })
    d.aura = this.auras.take(d.item.rarity, d.to.x, d.to.z)
  }

  rest(d, target, dt) {
    const m = d.mesh
    let lean = 0
    let dist = Infinity
    if (target) {
      dist = Math.hypot(target.pos.x - d.to.x, target.pos.z - d.to.z)
      const reach = PICK_RADIUS + target.radius
      lean = Math.min(1, Math.max(0, (reach + MAGNET_FEEL - dist) / MAGNET_FEEL))
      if (dist < reach && d.t >= REST_HOLD) return true
    }
    const pull = lean * lean * MAGNET_LEAN / Math.max(dist, 1e-3)
    m.position.x = d.to.x + (target ? (target.pos.x - d.to.x) * pull : 0)
    m.position.z = d.to.z + (target ? (target.pos.z - d.to.z) * pull : 0)
    m.position.y = HOVER_Y + hopHeight(d.t) + Math.sin(d.t * (BOB_SPEED + (MAGNET_BOB_SPEED - BOB_SPEED) * lean)) * BOB * (1 + lean)
    m.rotation.y += d.spin * (1 + 2 * lean) * dt
    this.auras.follow(d.aura, m.position.x, m.position.z)
    return false
  }

  finish(d, anchor) {
    if (d.trail) this.vfx.kill(d.trail)
    if (d.glow) this.vfx.kill(d.glow)
    this.auras.release(d.aura)
    d.trail = null
    d.glow = null
    d.aura = null
    this.group.remove(d.mesh)
    if (this.config.hit && anchor) this.vfx.spawn(LIB, this.config.hit, { follow: anchor, lifetime: HIT_LIFETIME, mute: TAKE_MUTE })
    audio.play('loot_take', { slot: 'loot_take', max: 2, gap: 0.06 })
    if (this.onCollect) this.onCollect(d.item)
  }

  nearest(pos) {
    let best = null
    let bd = Infinity
    for (const d of this.drops) {
      if (d.phase !== 'rest') continue
      const dist = Math.hypot(d.mesh.position.x - pos.x, d.mesh.position.z - pos.z)
      if (dist < bd) {
        bd = dist
        best = d
      }
    }
    return best ? { drop: best, d: bd } : null
  }

  collectAll() {
    for (const q of this.queue) {
      q.delay = 0
    }
  }

  update(dt, hero, anchor) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i]
      q.delay -= dt
      if (q.delay > 0) continue
      this.queue.splice(i, 1)
      this.launch(q, hero && !hero.dead ? hero : null)
    }
    const target = hero && !hero.dead ? hero : null
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]
      d.t += dt
      const m = d.mesh
      if (d.phase === 'emerge') this.emerge(d, dt)
      else if (d.phase === 'fly') {
        const k = Math.min(1, d.t / d.dur)
        m.position.lerpVectors(d.from, d.to, k)
        m.position.y += 4 * d.arc * k * (1 - k)
        m.rotateOnAxis(d.tumble, TUMBLE * dt)
        if (k >= 1) this.land(d)
      } else if (this.rest(d, target, dt)) {
        this.drops.splice(i, 1)
        this.finish(d, anchor)
      }
    }
    this.auras.update(dt)
  }

  clear() {
    for (const d of this.drops) {
      for (const fx of [d.trail, d.glow]) if (fx) fx.stop()
      this.group.remove(d.mesh)
    }
    this.auras.clear()
    this.drops.length = 0
    this.queue.length = 0
    this.lastDropAt = null
  }
}
