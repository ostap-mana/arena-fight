import * as THREE from 'three'
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from 'postprocessing'
import { loadModelData, buildModel } from '../src/core/model.js'
import { Actor } from '../src/entities/actor.js'
import { Vfx, vfxTexturesReady } from '../src/world/vfx.js'
import { HeroFx } from '../src/world/hero-fx.js'

const params = new URLSearchParams(location.search)
const heroId = params.get('hero') || 'mag018'
const vfxId = params.get('id') || heroId
const fxList = (params.get('fx') || '').split(',').filter(Boolean)
const period = Number(params.get('every') || 2.5)
const camDist = Number(params.get('dist') || 7)
const camHeight = Number(params.get('h') || 3.2)
const clip = params.get('clip') || 'idle'

const canvas = document.getElementById('c')
const info = document.getElementById('info')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false })
renderer.setPixelRatio(1)
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x10182c)
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200)
camera.position.set(0, camHeight, camDist)
camera.lookAt(0, 1.0, 0)
scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x241a14, 1.2))
const key = new THREE.DirectionalLight(0xffe3b8, 2.5)
key.position.set(6, 10, 5)
scene.add(key)
const floor = new THREE.Mesh(new THREE.CircleGeometry(12, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2a36, roughness: 0.9 }))
scene.add(floor)
const grid = new THREE.GridHelper(20, 20, 0x444466, 0x333344)
grid.position.y = 0.01
scene.add(grid)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 1.45, luminanceThreshold: 0.55, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 })))

const vfx = new Vfx(scene)
const heroFx = new HeroFx(vfx, camera)
let actor = null
let target = null
const lab = { vfx, spawned: [], t: 0, paused: false }
window.lab = lab

async function init() {
  const data = await loadModelData(heroId)
  actor = new Actor(buildModel(data, { castShadow: false }), { targetHeight: 1.9 })
  actor.setPos(-2.2, 0)
  actor.facing = actor.targetFacing = Number(params.get('face') || Math.PI / 2)
  actor.rig.play(clip, { force: true })
  scene.add(actor.root)
  const tdata = await loadModelData(params.get('target') || 'dem013')
  target = new Actor(buildModel(tdata, {}), { targetHeight: 1.78 })
  target.setPos(2.2, 0)
  target.faceTo(-2.2, 0)
  target.facing = target.targetFacing
  scene.add(target.root)
  await vfx.preload([vfxId])
  vfx.warm(renderer, camera)
  await vfxTexturesReady()
  lab.actor = actor
  lab.target = target
  lab.THREE = THREE
  lab.camera = camera
  lab.heroFx = heroFx
  lab.skin = () => heroFx.attachSkin(vfxId, actor)
  lab.ready = true
  lab.lib = vfx.library(vfxId)
  lab.names = lab.lib ? Object.keys(lab.lib.prefabs) : []
  fire()
}

function fire() {
  for (const name of fxList) lab.spawn(name)
}

lab.spawn = (name, opts = {}) => {
  const lib = vfx.library(vfxId)
  if (!lib) return null
  const node = lib.prefabs[name]
  if (!node) return null
  const fx = node[0].fx || {}
  const onTarget = /Hit|AOE/.test(name) && !/Precast/.test(name)
  const who = onTarget ? target : actor
  const socket = vfx.socket(vfxId, who, fx.socket || 'FX_Center')
  const inst = vfx.spawn(vfxId, name, {
    follow: fx.follow ? socket : null,
    pos: socket.getWorldPosition(new THREE.Vector3()),
    quat: onTarget ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), target.facing) : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), actor.facing),
    scale: who.scale,
    lifetime: opts.lifetime || 2.5,
    camera,
  })
  if (inst && /Projectile/.test(name)) {
    const from = inst.root.position.clone()
    const to = target.root.position.clone().setY(1.1)
    inst.fly = { from, to, t: 0, dur: from.distanceTo(to) / 14 }
  }
  lab.spawned.push(name)
  return inst
}

lab.attack = k => {
  actor.faceTo(target.pos.x, target.pos.z)
  actor.facing = actor.targetFacing
  actor.rig.play('attack', { force: true, fade: 0.07, maxImpact: 0.3 })
  const clip = actor.rig.action.getClip().name
  const m = clip.match(/ComboAttack_(\d+)/)
  const idx = k !== undefined ? k : m ? Number(m[1]) : 0
  const res = heroFx.attack(vfxId, idx, actor, target, { impact: actor.rig.impactAt })
  if (res && !res.ranged) heroFx.later(actor.rig.impactAt, () => res.onTarget(target))
  return [clip, idx, res && res.ranged]
}

lab.cast = type => {
  actor.faceTo(target.pos.x, target.pos.z)
  actor.facing = actor.targetFacing
  actor.rig.play(type === 4 ? 'morph' : 'cast', { force: true, fade: 0.1, skill: type === 2 ? 2 : 1 })
  return heroFx.castSkill(vfxId, type, actor, [target], { impact: actor.rig.impactAt })
}

lab.spawnAt = (name, x = 0, y = 1, z = 0, scale = 0.62) => vfx.spawn(vfxId, name, { pos: new THREE.Vector3(x, y, z), scale, lifetime: 2.5, camera })

let last = performance.now()
let acc = 0
function frame(now) {
  requestAnimationFrame(frame)
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  if (lab.paused) return
  step(dt)
  composer.render()
}

function step(dt) {
  lab.t += dt
  if (actor) actor.update(dt, {})
  if (target) target.update(dt, {})
  scene.updateMatrixWorld()
  for (const it of vfx.items) {
    if (it.fly) {
      it.fly.t += dt
      const k = Math.min(1, it.fly.t / it.fly.dur)
      it.root.position.lerpVectors(it.fly.from, it.fly.to, k)
      it.root.lookAt(it.fly.to)
      if (k >= 1) it.stop()
    }
  }
  heroFx.update(dt)
  vfx.update(dt, camera)
  if (lab.ready && fxList.length && period > 0) {
    acc += dt
    if (acc >= period) {
      acc = 0
      fire()
    }
  }
  const alive = vfx.items.reduce((n, it) => n + it.emitters.reduce((m, e) => m + e.count, 0), 0)
  info.textContent = `${vfxId} fx=${fxList.join(',')}\ninstances=${vfx.items.length} particles=${alive}\ncalls=${renderer.info.render.calls}`
}

lab.pose = (name, t) => {
  const clip = actor.model.clips.get(name)
  if (!clip) return null
  actor.rig.mixer.stopAllAction()
  const a = actor.rig.mixer.clipAction(clip)
  a.reset().play()
  a.paused = true
  a.time = Math.min(t * clip.duration, clip.duration - 1e-3)
  actor.rig.mixer.update(0)
  actor.root.updateMatrixWorld(true)
  composer.render()
  return clip.duration
}

lab.advance = (seconds, fps = 30) => {
  const n = Math.round(seconds * fps)
  for (let i = 0; i < n; i++) step(1 / fps)
  composer.render()
}

requestAnimationFrame(frame)
init().catch(e => {
  info.textContent = String(e.stack || e)
  console.error(e)
})
