import * as THREE from 'three'
import { loadModelData, buildModel } from '../core/model.js'
import { Rig } from '../core/rig.js'

const _v = new THREE.Vector3()

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
    this.stagger = 0
    this.radius = opts.radius || 0.7
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
    for (const s of this.model.skins) {
      const ch = s.material.userData && s.material.userData.character
      if (ch && s.material.userData.hitRim) {
        ch.uVfxParams.value.w = k * 1.2
        continue
      }
      if (!s.material.emissive) continue
      if (!s.userData.baseEmissive) s.userData.baseEmissive = s.material.emissive.clone()
      if (ch) s.material.emissive.setRGB(k * 0.22, k * 0.22, k * 0.22).add(s.userData.baseEmissive)
      else s.material.emissive.setRGB(k, k * 0.25, k * 0.25).add(s.userData.baseEmissive)
    }
  }

  update(dt) {
    if (this.flash > 0) {
      this.flash -= dt
      this.tint(Math.max(0, this.flash / 0.16) * 0.85)
    } else if (this.flash > -1) {
      this.flash = -1
      this.tint(0)
    }
    if (this.dead) this.dying += dt

    let df = this.targetFacing - this.facing
    while (df > Math.PI) df -= Math.PI * 2
    while (df < -Math.PI) df += Math.PI * 2
    this.facing += df * Math.min(1, dt * 14)

    this.rig.update(dt)
    this.root.position.x = this.pos.x
    this.root.position.z = this.pos.z
    this.root.position.y = this.baseY + this.pos.y + this.rig.rootOffset.y * this.scale
    this.root.rotation.y = this.facing + Math.PI
    this.root.rotation.x = this.rig.rootTilt
  }

  dispose(scene) {
    scene.remove(this.root)
  }
}

export async function makeActor(id, opts) {
  const data = await loadModelData(id)
  const model = buildModel(data, opts)
  return new Actor(model, opts)
}
