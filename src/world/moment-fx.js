import * as THREE from 'three'
import { ARENA_GATES, DEFAULT_LOCATION } from '../data/locations.js'

export const MOMENT_FX = 'moments'

const REF_HEIGHT = 1.9
const SOCKET_RISE = { FX_Bot: 0, FX_Center: 0.55, FX_Head: 0.9, FX_Top: 1.08, FX_Shield: 0.42 }

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
const GATE_OPEN = 3.5
const GATES = ARENA_GATES[DEFAULT_LOCATION] || []

const _pos = new THREE.Vector3()
const _to = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _up = new THREE.Vector3(0, 1, 0)

export class MomentFx {
  constructor(vfx, camera) {
    this.vfx = vfx
    this.camera = camera
    this.followOpts = { follow: null, pos: _pos, quat: _quat, scale: 1, lifetime: 1, camera }
    this.gateOpts = { pos: _pos, yaw: 0, scale: 1, camera }
    this.dots = {}
    this.gates = GATES.map(() => null)
    this.openUntil = GATES.map(() => -Infinity)
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
    this.immuneAt = game.immuneT || 0
    this.shieldUp = false
    this.rescued = !!game.titanRescued
    this.hpHero = null
    this.hp = 0
    this.healAt = -Infinity
    for (const kind of DOT_KINDS) this.dots[kind] = null
    for (let i = 0; i < this.gates.length; i++) {
      this.gates[i] = null
      this.openUntil[i] = -Infinity
    }
  }

  opened(index, t) {
    if (index >= 0 && index < this.openUntil.length) this.openUntil[index] = Math.max(this.openUntil[index], t + GATE_OPEN)
  }

  update(g, dt) {
    if (!this.ready) return
    if (g !== this.game || g.epoch !== this.epoch) this.reset(g)
    const live = g.state === 'battle' || g.state === 'morph'
    this.updateGates(g, live)
    const h = g.hero
    if (!live || !h || h.dead) {
      this.stopDots()
      return
    }
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
      const open = live && g.t < this.openUntil[i]
      const d = open ? 0 : h && live ? Math.hypot(gate.x - h.pos.x, gate.z - h.pos.z) : Infinity
      const inst = this.gates[i]
      if (!inst && d < GATE_NEAR) {
        _pos.set(gate.x, gate.y, gate.z)
        const o = this.gateOpts
        o.scale = gate.scale
        o.yaw = gate.yaw
        this.gates[i] = this.vfx.spawn(MOMENT_FX, GATE_FX, o)
      } else if (inst && d > GATE_FAR) {
        inst.stop()
        this.gates[i] = null
      }
    }
  }

}
