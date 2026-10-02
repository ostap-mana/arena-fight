import * as THREE from 'three'
import { loadModelData } from '../core/model.js'
import { characterMaterial } from './character-shader.js'
import { audio } from '../core/audio.js'
import { ARENA_RADIUS } from './arena.js'
import { stream } from '../core/rng.js'

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
const SCATTER = [1.1, 2.5]
const FLANK_DIST = 2.4
const FLANK_SLOTS = [[-1, 0.12], [1, 0.12], [-0.7, 0.72], [0.7, 0.72], [-0.7, -0.72], [0.7, -0.72]]
const REST_HOLD = 0.9
const FLOOR_LIMIT = ARENA_RADIUS - 1.2
const ARC = [1.7, 2.7]
const HOVER_Y = 0.55
const BOB = 0.09
const BOB_SPEED = 2.6
const SPIN = 1.7
const TUMBLE = 7
const PICK_RADIUS = 1.9
const PICK_TIME = 0.42
const PICK_LIFT = 0.8
const PICK_SHRINK = 0.45
const STAGGER = 0.09
const HIT_LIFETIME = 1.2
const _v = new THREE.Vector3()
const _box = new THREE.Box3()
const _size = new THREE.Vector3()
const _center = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()

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

function keepOnFloor(p) {
  const r = Math.hypot(p.x, p.z)
  if (r <= FLOOR_LIMIT) return p
  p.x *= FLOOR_LIMIT / r
  p.z *= FLOOR_LIMIT / r
  return p
}

function dress(mesh) {
  mesh.traverse(o => {
    if (!o.isMesh) return
    const src = o.material
    const extras = src.userData && src.userData.character
    o.material = extras ? characterMaterial(src, extras) : src.clone()
    o.castShadow = true
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
    this.drops = []
    this.queue = []
    this.templates = null
    this.config = null
    this.onCollect = null
    this.plan = null
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

  setPlan(items, kills) {
    this.plan = items.slice()
    this.planKills = Math.max(1, kills)
    this.planSeen = 0
    this.planGiven = 0
  }

  dropPlanned(at) {
    this.planSeen++
    const due = Math.min(this.plan.length, Math.round((this.planSeen * this.plan.length) / this.planKills))
    for (let i = 0; this.planGiven < due; i++) {
      this.queue.push({ item: this.plan[this.planGiven++], at, delay: i * STAGGER, spread: 1 })
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
    rest.forEach((item, i) => this.queue.push({ item, at: new THREE.Vector3(at.x, LAUNCH_Y, at.z), delay: i * STAGGER, spread: 0.8, claimed: true }))
  }

  dropFrom(actor, table, boss = false) {
    if (!table || !this.ready) return
    const at = new THREE.Vector3(actor.pos.x, actor.pos.y + Math.min(LAUNCH_Y, actor.height * 0.45), actor.pos.z)
    if (this.plan && !boss) {
      this.dropPlanned(at)
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
      this.queue.push({ item, at, delay: i * STAGGER, spread: boss ? 1.7 : 1 })
    }
  }

  freeFlank() {
    const taken = new Set(this.drops.filter(d => d.phase !== 'pick').map(d => d.flank))
    for (let i = 0; i < FLANK_SLOTS.length; i++) if (!taken.has(i)) return i
    return this.drops.length % FLANK_SLOTS.length
  }

  flankOffset(slot) {
    const e = this.camera.matrixWorld.elements
    _right.set(e[0], 0, e[2]).normalize()
    _up.set(-e[8], 0, -e[10]).normalize()
    const [r, u] = FLANK_SLOTS[slot]
    return new THREE.Vector3().addScaledVector(_right, r * FLANK_DIST).addScaledVector(_up, u * FLANK_DIST)
  }

  besideHero(d, hero) {
    return keepOnFloor(d.to.set(hero.pos.x + d.offset.x, HOVER_Y, hero.pos.z + d.offset.z))
  }

  launch({ item, at, spread, claimed }, hero) {
    const template = this.templates[item.slot]
    if (!template) return
    const mesh = template.clone(true)
    mesh.position.copy(at)
    this.group.add(mesh)
    const flank = hero && this.camera ? this.freeFlank() : -1
    const offset = flank >= 0 ? this.flankOffset(flank) : null
    let to
    if (offset) {
      to = keepOnFloor(new THREE.Vector3(hero.pos.x + offset.x, HOVER_Y, hero.pos.z + offset.z))
    } else {
      const ang = random() * Math.PI * 2
      const dist = between(SCATTER) * spread
      to = new THREE.Vector3(at.x + Math.cos(ang) * dist, HOVER_Y, at.z + Math.sin(ang) * dist)
    }
    const travel = Math.hypot(to.x - at.x, to.z - at.z)
    const look = this.config.rarity[item.rarity] || this.config.rarity.common
    this.drops.push({
      item,
      mesh,
      from: at.clone(),
      to,
      flank,
      offset,
      dur: FLY_TIME + Math.min(FLY_EXTRA_MAX, travel * FLY_PER_UNIT),
      arc: between(ARC),
      phase: 'fly',
      t: 0,
      tumble: new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize(),
      spin: (random() < 0.5 ? -1 : 1) * SPIN,
      look,
      trail: this.vfx.spawn(LIB, look.trail, { follow: mesh }),
      glow: null,
      claimed: !!claimed,
    })
    const rare = RARITIES.indexOf(item.rarity) >= 3
    audio.play(rare ? 'loot_drop_artifact' : 'loot_drop_equip', { at, slot: 'loot_drop', max: 3, gap: 0.05 })
  }

  land(d) {
    d.phase = 'rest'
    d.t = 0
    d.mesh.quaternion.identity()
    if (d.trail) d.trail.stop()
    d.trail = null
    d.glow = this.vfx.spawn(LIB, d.look.highlight, { pos: new THREE.Vector3(d.to.x, 0.02, d.to.z) })
  }

  pick(d) {
    d.phase = 'pick'
    d.t = 0
    d.from.copy(d.mesh.position)
    if (d.glow) d.glow.stop()
    d.glow = null
    d.trail = this.vfx.spawn(LIB, d.look.trail, { follow: d.mesh })
  }

  finish(d, anchor) {
    if (d.trail) d.trail.stop()
    this.group.remove(d.mesh)
    if (this.config.hit && anchor) this.vfx.spawn(LIB, this.config.hit, { follow: anchor, lifetime: HIT_LIFETIME })
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
      q.claimed = true
    }
    for (const d of this.drops) d.claimed = true
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
      if (d.phase === 'fly') {
        const k = Math.min(1, d.t / d.dur)
        if (d.offset && target) this.besideHero(d, target)
        m.position.lerpVectors(d.from, d.to, k)
        m.position.y += 4 * d.arc * k * (1 - k)
        m.rotateOnAxis(d.tumble, TUMBLE * dt)
        if (k >= 1) this.land(d)
      } else if (d.phase === 'rest') {
        m.position.y = HOVER_Y + Math.sin(d.t * BOB_SPEED) * BOB
        m.rotation.y += d.spin * dt
        const near = target && Math.hypot(target.pos.x - m.position.x, target.pos.z - m.position.z) < PICK_RADIUS + target.radius
        if (target && d.t >= REST_HOLD && (near || d.claimed)) this.pick(d)
      } else {
        const k = Math.min(1, d.t / PICK_TIME)
        if (target) _v.set(target.pos.x, target.pos.y + target.height * 0.55, target.pos.z)
        else _v.copy(d.from)
        const e = k * k
        m.position.lerpVectors(d.from, _v, e)
        m.position.y += Math.sin(Math.PI * k) * PICK_LIFT
        m.scale.setScalar(1 - PICK_SHRINK * e)
        m.rotation.y += d.spin * 3 * dt
        if (k >= 1) {
          this.drops.splice(i, 1)
          this.finish(d, anchor)
        }
      }
    }
  }

  clear() {
    for (const d of this.drops) {
      for (const fx of [d.trail, d.glow]) if (fx) fx.stop()
      this.group.remove(d.mesh)
    }
    this.drops.length = 0
    this.queue.length = 0
  }
}
