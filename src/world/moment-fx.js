import * as THREE from 'three'
import { GEAR_SLOTS } from '../core/gear.js'

export const MOMENT_FX = 'moments'

const REF_HEIGHT = 1.9
const SOCKET_RISE = { FX_Bot: 0, FX_Center: 0.55, FX_Head: 0.9, FX_Top: 1.08, FX_Shield: 0.42 }

const SPAWN_SMALL = 'FX_Spawn_Enemy_2_1_Ground_Small'
const SPAWN_BIG = 'FX_Spawn_Enemy_2_2_Ground_Big'
const SPAWN_ELITE_SIZE = 1.5
const SPAWN_LIFE = 2.6
const SPAWN_MUTE = new Set(['PS_Smoke_2_1_A'])

const STAT_FX = {
  atk: 'B_FX_Effect_Increase_ATK',
  atkPct: 'B_FX_Effect_Increase_ATK',
  hp: 'B_FX_Effect_Increase_HP',
  hpPct: 'B_FX_Effect_Increase_HP',
  def: 'B_FX_Effect_Increase_DEF',
  defPct: 'B_FX_Effect_Increase_DEF',
  crit: 'B_FX_Effect_Increase_C_RATE',
  critDmg: 'B_FX_Effect_Increase_C_DMG',
}
const BUFF_GAP = 0.35
const BUFF_MAX = 3
const BUFF_LIFE = 1.6

const WEAK_FX = ['B_FX_Effect_Decrease_DEF', 'B_FX_Effect_Decrease_ATK']
const WEAK_GAP = 0.45

const HEAL_FX = 'B_FX_Effect_Heal_Hit'
const HEAL_MIN = 0.012
const HEAL_GAP = 1.1

const DOT_FX = { fire: 'B_FX_DOT_Burn', bleed: 'B_FX_DOT_Bleeding_Sign' }
const DOT_KINDS = Object.keys(DOT_FX)

const RESCUE_FX = 'B_FX_Effect_Cheat_Death'
const RESCUE_LIFE = 1.8

const SHIELD_UP = 'B_FX_General_Shield_Start'
const SHIELD_HIT = 'B_FX_General_Shield_Hit'
const SHIELD_SCALE = 0.3
const SHIELD_UP_LIFE = 1.3
const SHIELD_HIT_SCALE = 0.16
const SHIELD_BREAK_SCALE = 0.42

const GATE_FX = 'FX_Barrier_Fire'
const GATE_NEAR = 16.5
const GATE_FAR = 21
const GATES = [
  [-19.35, -0.03, -0.23, 1, -1.5708],
  [19.59, -0.03, -0.23, 1, 1.5708],
  [14.55, -0.03, -14.62, 0.76, -0.7854],
  [-14.22, -0.03, 14.08, 0.81, -0.7854],
  [0.27, -0.03, -19.53, 1, 3.1416],
  [0.27, -0.21, 18.56, 1, 3.1416],
  [-14.8, -0.03, -14.57, 0.77, 0.7854],
  [14.88, -0.03, 14.81, 0.78, 0.7854],
]

const _pos = new THREE.Vector3()
const _to = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)

export class MomentFx {
  constructor(vfx, camera) {
    this.vfx = vfx
    this.camera = camera
    this.spawnOpts = { pos: _pos, quat: _quat, scale: 1, lifetime: SPAWN_LIFE, camera, mute: SPAWN_MUTE }
    this.followOpts = { follow: null, pos: _pos, quat: _quat, scale: 1, lifetime: 1, camera }
    this.gateOpts = { pos: _pos, yaw: 0, scale: 1, camera }
    this.worn = {}
    this.queue = []
    this.dots = {}
    this.gates = GATES.map(() => null)
    this.game = null
    this.epoch = -1
  }

  get ready() {
    return !!this.vfx.library(MOMENT_FX)
  }

  warm(hidden) {
    if (!this.ready) return []
    const out = []
    for (const name of Object.keys(this.vfx.library(MOMENT_FX).prefabs)) {
      const inst = this.vfx.spawn(MOMENT_FX, name, { pos: hidden, scale: 0.001, lifetime: 0.1, camera: this.camera })
      if (inst) out.push(inst)
    }
    return out
  }

  reset(game) {
    this.game = game
    this.epoch = game.epoch
    this.gear = null
    this.gearVersion = -1
    this.queue.length = 0
    this.queueT = 0
    this.weakAt = game.weakWarnAt || 0
    this.immuneAt = game.immuneT || 0
    this.shieldUp = false
    this.rescued = !!game.titanRescued
    this.hpHero = null
    this.hp = 0
    this.healAt = -Infinity
    for (const kind of DOT_KINDS) this.dots[kind] = null
    for (let i = 0; i < this.gates.length; i++) this.gates[i] = null
  }

  spawned(actor) {
    if (!this.ready || !actor || (actor.def && actor.def.boss)) return
    const big = (actor.size || 1) >= SPAWN_ELITE_SIZE
    const o = this.spawnOpts
    _pos.set(actor.pos.x, 0.02, actor.pos.z)
    _quat.setFromAxisAngle(_up, actor.facing || 0)
    o.scale = actor.height / REF_HEIGHT
    this.vfx.spawn(MOMENT_FX, big ? SPAWN_BIG : SPAWN_SMALL, o)
  }

  update(g, dt) {
    if (!this.ready) return
    if (g !== this.game || g.epoch !== this.epoch) this.reset(g)
    const live = g.state === 'battle' || g.state === 'morph'
    this.updateGates(g, live)
    const h = g.hero
    if (!live || !h || h.dead) {
      this.stopDots()
      this.queue.length = 0
      return
    }
    this.watchGear(g)
    this.playQueue(g, dt)
    this.watchWeak(g, h)
    this.watchHeal(g, h)
    this.watchDots(g, h)
    this.watchRescue(g, h)
    this.watchShield(g)
  }

  anchor(actor, name, libId) {
    const lib = libId && this.vfx.library(libId)
    if (lib && lib.sockets[name]) return this.vfx.socket(libId, actor, name)
    const key = `__moment_${name}`
    const byName = actor.model.byName
    let o = byName.get(key)
    if (!o) {
      o = new THREE.Object3D()
      o.name = key
      o.position.y = (SOCKET_RISE[name] ?? SOCKET_RISE.FX_Center) * actor.height / actor.scale + (actor.model.footY || 0)
      actor.root.add(o)
      byName.set(key, o)
    }
    return o
  }

  on(actor, name, libId, scale, lifetime) {
    const lib = this.vfx.library(MOMENT_FX)
    const nodes = lib && lib.prefabs[name]
    if (!nodes) return null
    const w = nodes[0].fx || {}
    const socket = this.anchor(actor, w.socket || 'FX_Center', libId)
    socket.updateWorldMatrix(true, false)
    socket.getWorldPosition(_pos)
    _quat.setFromAxisAngle(_up, actor.facing || 0)
    const o = this.followOpts
    o.follow = w.follow ? socket : null
    o.scale = scale
    o.lifetime = lifetime
    const inst = this.vfx.spawn(MOMENT_FX, name, o)
    o.follow = null
    return inst
  }

  heroScale(g) {
    const h = g.hero
    return h ? h.height / REF_HEIGHT : 1
  }

  heroLib(g) {
    const def = g.activeDef ? g.activeDef() : null
    return def ? def.vfx : null
  }

  watchGear(g) {
    const gear = g.gear
    if (!gear) return
    if (gear !== this.gear) {
      this.gear = gear
      this.gearVersion = gear.version
      for (const slot of GEAR_SLOTS) this.worn[slot] = gear.equipped[slot] || null
      return
    }
    if (gear.version === this.gearVersion) return
    this.gearVersion = gear.version
    let queued = 0
    for (let i = 0; i < GEAR_SLOTS.length; i++) {
      const slot = GEAR_SLOTS[i]
      const it = gear.equipped[slot] || null
      if (it === this.worn[slot]) continue
      this.worn[slot] = it
      const name = it && STAT_FX[it.stat]
      if (!name || queued >= BUFF_MAX || this.queue.includes(name)) continue
      this.queue.push(name)
      queued++
    }
  }

  playQueue(g, dt) {
    if (this.queueT > 0) this.queueT -= dt
    if (!this.queue.length || this.queueT > 0) return
    const name = this.queue.shift()
    this.on(g.hero, name, this.heroLib(g), this.heroScale(g), BUFF_LIFE)
    this.queueT = BUFF_GAP
  }

  watchWeak(g, h) {
    const at = g.weakWarnAt || 0
    if (at === this.weakAt) return
    this.weakAt = at
    if (!at) return
    for (let i = 0; i < WEAK_FX.length; i++) if (!this.queue.includes(WEAK_FX[i])) this.queue.push(WEAK_FX[i])
    this.queueT = Math.min(this.queueT, WEAK_GAP)
  }

  watchHeal(g, h) {
    if (h !== this.hpHero) {
      this.hpHero = h
      this.hp = h.hp
      return
    }
    const gain = h.hp - this.hp
    this.hp = h.hp
    if (gain < h.maxHp * HEAL_MIN || g.t - this.healAt < HEAL_GAP) return
    this.healAt = g.t
    this.on(h, HEAL_FX, this.heroLib(g), this.heroScale(g), 1.2)
  }

  watchDots(g, h) {
    const dots = g.dots || []
    for (let k = 0; k < DOT_KINDS.length; k++) {
      const kind = DOT_KINDS[k]
      let on = false
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i]
        if (d && d.hit && d.hit.kind === kind && d.left > 0) {
          on = true
          break
        }
      }
      const cur = this.dots[kind]
      if (on && (!cur || cur.actor !== h)) {
        if (cur) cur.inst.stop()
        const inst = this.on(h, DOT_FX[kind], this.heroLib(g), this.heroScale(g), Infinity)
        this.dots[kind] = inst ? { inst, actor: h } : null
      } else if (!on && cur) {
        cur.inst.stop()
        this.dots[kind] = null
      }
    }
  }

  stopDots() {
    for (const kind of DOT_KINDS) {
      const cur = this.dots[kind]
      if (cur) cur.inst.stop()
      this.dots[kind] = null
    }
  }

  watchRescue(g, h) {
    const rescued = !!g.titanRescued
    if (rescued === this.rescued) return
    this.rescued = rescued
    if (!rescued) return
    const hero = g.titanMode && g.heroBase ? g.heroBase : h
    this.on(hero, RESCUE_FX, this.heroLib(g), this.heroScale(g), RESCUE_LIFE)
  }

  watchShield(g) {
    const b = g.boss
    const up = !!(g.shieldUp && b && !b.dead)
    if (up && !this.shieldUp) this.bossFx(b, SHIELD_UP, SHIELD_SCALE, SHIELD_UP_LIFE, null)
    else if (!up && this.shieldUp && b && !b.dead) this.bossFx(b, SHIELD_HIT, SHIELD_BREAK_SCALE, 1.5, null)
    this.shieldUp = up
    const at = g.immuneT || 0
    if (at === this.immuneAt) return
    this.immuneAt = at
    if (up && at && g.hero) this.bossFx(b, SHIELD_HIT, SHIELD_HIT_SCALE, 1.2, g.hero)
  }

  bossFx(b, name, k, lifetime, toward) {
    const o = this.followOpts
    const socket = this.anchor(b, 'FX_Shield', null)
    socket.updateWorldMatrix(true, false)
    socket.getWorldPosition(_pos)
    if (toward) {
      _to.set(toward.pos.x - b.pos.x, 0, toward.pos.z - b.pos.z)
      const d = _to.length()
      if (d > 0.01) _pos.addScaledVector(_to, Math.min(d, b.radius * 1.2) / d)
    }
    _quat.setFromAxisAngle(_up, b.facing || 0)
    o.follow = toward ? null : socket
    o.scale = b.height / REF_HEIGHT * k
    o.lifetime = lifetime
    this.vfx.spawn(MOMENT_FX, name, o)
    o.follow = null
  }

  updateGates(g, live) {
    const h = g.hero
    for (let i = 0; i < GATES.length; i++) {
      const gate = GATES[i]
      const d = h && live ? Math.hypot(gate[0] - h.pos.x, gate[2] - h.pos.z) : Infinity
      const inst = this.gates[i]
      if (!inst && d < GATE_NEAR) {
        _pos.set(gate[0], gate[1], gate[2])
        const o = this.gateOpts
        o.scale = gate[3]
        o.yaw = gate[4]
        this.gates[i] = this.vfx.spawn(MOMENT_FX, GATE_FX, o)
      } else if (inst && d > GATE_FAR) {
        inst.stop()
        this.gates[i] = null
      }
    }
  }

}
