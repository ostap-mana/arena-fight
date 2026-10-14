import * as THREE from 'three'
import { Rig } from '../core/rig.js'
import { useOwnLook, useSharedLook } from '../core/model.js'

const _v = new THREE.Vector3()
const TURN_GAIN = 5
const FREEZE_RATE = 0.06

export class Actor {
  constructor(model, opts = {}) {
    this.model = model
    this.rig = new Rig(model)
    this.root = model.root
    this.height = opts.targetHeight || 1.85
    this.scale = this.height / model.height
    this.root.scale.setScalar(this.scale)
    this.baseY = -model.footY * this.scale
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector3()
    this.facing = 0
    this.targetFacing = 0
    this.hp = opts.hp || 100
    this.maxHp = this.hp
    this.dead = false
    this.dying = 0
    this.flash = 0
    this.frozen = 0
    this.stagger = 0
    this.radius = opts.radius || 0.7
    this.turnRate = 0
    this.turnAccel = 0
    this.turnVel = 0
    this.root.rotation.order = 'YXZ'
  }

  get body() { return this.model.body }

  setPos(x, z) {
    this.pos.set(x, 0, z)
    this.root.position.set(x, this.baseY, z)
  }

  faceTo(x, z) {
    this.targetFacing = Math.atan2(x - this.pos.x, z - this.pos.z)
  }

  hit(dmg) {
    if (this.dead) return 0
    const d = Math.min(this.hp, dmg)
    this.hp -= d
    this.flash = 0.16
    if (this.hp <= 0) {
      this.dead = true
      this.dying = 0
      this.rig.play('death', { fade: 0.1 })
    }
    return d
  }

  tint(k) {
    const c = k > 0 ? this.flashColor : null
    for (const s of this.model.skins) {
      const ch = s.material.userData && s.material.userData.character
      if (ch && s.material.userData.hitRim) {
        const rim = ch.uHitRimColor.value
        if (!s.material.userData.baseHitRim) s.material.userData.baseHitRim = rim.clone()
        if (c) rim.set(c[0], c[1], c[2], rim.w)
        else rim.copy(s.material.userData.baseHitRim)
        ch.uVfxParams.value.w = k * 1.2
        continue
      }
      if (!s.material.emissive) continue
      if (!s.userData.baseEmissive) s.userData.baseEmissive = s.material.emissive.clone()
      if (ch && c) s.material.emissive.setRGB(k * 0.22 * c[0], k * 0.22 * c[1], k * 0.22 * c[2]).add(s.userData.baseEmissive)
      else if (ch) s.material.emissive.setRGB(k * 0.22, k * 0.22, k * 0.22).add(s.userData.baseEmissive)
      else s.material.emissive.setRGB(k, k * 0.25, k * 0.25).add(s.userData.baseEmissive)
    }
  }

  freeze(time) {
    this.frozen = Math.max(this.frozen, time)
  }

  update(dt) {
    let animDt = dt
    if (this.frozen > 0) {
      this.frozen -= dt
      animDt = dt * FREEZE_RATE
    }
    if (this.flash > 0) {
      this.flash -= dt
      useOwnLook(this.model)
      this.tint(Math.max(0, this.flash / 0.16) * 0.85)
    } else if (this.flash > -1) {
      this.flash = -1
      this.tint(0)
      if (!this.dead) useSharedLook(this.model)
    }
    if (this.dead) this.dying += dt

    let df = this.targetFacing - this.facing
    while (df > Math.PI) df -= Math.PI * 2
    while (df < -Math.PI) df += Math.PI * 2
    if (this.turnAccel) this.steer(df, dt)
    else {
      const turn = df * Math.min(1, dt * 14)
      const cap = this.turnRate * dt
      this.facing += cap ? Math.max(-cap, Math.min(cap, turn)) : turn
    }

    this.rig.update(animDt)
    this.root.position.x = this.pos.x
    this.root.position.z = this.pos.z
    this.root.position.y = this.baseY + this.pos.y + this.rig.rootOffset.y * this.scale
    this.root.rotation.y = this.facing + Math.PI
    this.root.rotation.x = this.rig.rootTilt
  }

  steer(df, dt) {
    const want = Math.max(-this.turnRate, Math.min(this.turnRate, df * TURN_GAIN))
    const dv = this.turnAccel * dt
    this.turnVel += Math.max(-dv, Math.min(dv, want - this.turnVel))
    this.facing += this.turnVel * dt
  }

  dispose(scene) {
    scene.remove(this.root)
  }
}
