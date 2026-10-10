import * as THREE from 'three'
import { compileFor } from './compile.js'

const BUDGET_MS = 3
const RETRY_FRAMES = 30
const queue = []
const seen = new WeakSet()
let pumping = false
let renderer = null

const frame = () => new Promise(resolve => requestAnimationFrame(resolve))

export function texturesOf(root) {
  const out = new Set()
  const add = m => collectTextures(m, out)
  if (root.isMaterial) add(root)
  else root.traverse(o => {
    if (!o.material) return
    if (Array.isArray(o.material)) o.material.forEach(add)
    else add(o.material)
  })
  return out
}

function collectTextures(m, out) {
  for (const k in m) {
    const v = m[k]
    if (v && v.isTexture) out.add(v)
  }
  for (const bag of [m.uniforms, m.userData && m.userData.character]) {
    if (!bag) continue
    for (const k in bag) {
      const v = bag[k] && bag[k].value
      if (v && v.isTexture) out.add(v)
    }
  }
}

function loaded(t) {
  if (t.isRenderTargetTexture || t.isDepthTexture) return true
  if (t.isCubeTexture) return Array.isArray(t.image) && t.image.length === 6 && t.image.every(Boolean) && t.version > 0
  return !!t.image && t.version > 0
}

export function uploadTextures(target, textures) {
  renderer = target
  for (const t of textures) {
    if (!t || seen.has(t) || t.isRenderTargetTexture || t.isDepthTexture) continue
    seen.add(t)
    queue.push({ t, wait: 0 })
  }
  pump()
}

export function uploadTexturesNow(target, textures) {
  renderer = target
  const later = []
  for (const t of textures) {
    if (!t || t.isRenderTargetTexture || t.isDepthTexture) continue
    if (loaded(t)) {
      seen.add(t)
      target.initTexture(t)
    } else later.push(t)
  }
  if (later.length) uploadTextures(target, later)
}

async function pump() {
  if (pumping) return
  pumping = true
  while (queue.length) {
    await frame()
    const start = performance.now()
    let spins = queue.length
    while (queue.length && spins-- > 0 && performance.now() - start < BUDGET_MS) {
      const job = queue.shift()
      if (!loaded(job.t)) {
        if (++job.wait < RETRY_FRAMES * 20) queue.push(job)
        continue
      }
      renderer.initTexture(job.t)
    }
  }
  pumping = false
}

export async function prewarmObject(target, object, camera, scene, renderTarget = null, pause = null) {
  const stage = new THREE.Group()
  const parent = object.parent
  stage.add(object)
  if (pause) await compileEach(target, object, camera, renderTarget, scene, pause)
  else await compileFor(target, stage, camera, renderTarget, scene)
  stage.remove(object)
  if (parent) parent.add(object)
  uploadTextures(target, texturesOf(object))
}

async function compileEach(target, object, camera, renderTarget, scene, pause) {
  const drawables = []
  object.traverse(o => {
    if (o.isMesh || o.isPoints || o.isLine || o.isSprite) drawables.push(o)
  })
  for (const o of drawables) {
    await pause()
    await compileFor(target, o, camera, renderTarget, scene)
  }
}
