import * as THREE from 'three'
import { Flipbooks, loadManifest, preloadFlipbooks } from '../src/world/flipbook.js'

const params = new URLSearchParams(location.search)
const canvas = document.getElementById('c')
const info = document.getElementById('info')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
const scene = new THREE.Scene()
scene.background = new THREE.Color(params.get('bg') || '#1a0f0c')
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 0.1, 200)
const pitch = THREE.MathUtils.degToRad(Number(params.get('pitch') ?? 20))
const dist = Number(params.get('dist') ?? 14)
camera.position.set(0, Math.sin(pitch) * dist + 1.5, Math.cos(pitch) * dist)
camera.lookAt(0, 1.5, 0)
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2a1a14 }))
scene.add(ground)
const grid = new THREE.GridHelper(60, 30, 0x553322, 0x332016)
grid.position.y = 0.01
scene.add(grid)

const books = new Flipbooks(scene)
const names = (params.get('names') || '').split(',').filter(Boolean)
let list = []
let clock = 0
const spawned = new Map()

function spawnAll() {
  list.forEach((name, i) => {
    const d = books.def(name)
    const x = (i - (list.length - 1) / 2) * Number(params.get('gap') ?? 4)
    const opts = { x, y: d.billboard === 'ground' ? 0.05 : (d.pivot && d.pivot[1] < 0 ? 0 : (d.size || 2) * 0.5), z: 0, rot: 0 }
    if (params.get('palette')) opts.palette = params.get('palette')
    spawned.set(name, books.spawn(name, opts))
  })
}

await loadManifest()
list = names.length ? names : Object.keys(await (await fetch('assets/fx/eg/flipbooks.json')).json())
await preloadFlipbooks(list)
spawnAll()

function step(dt) {
  clock += dt
  for (const name of list) {
    const h = spawned.get(name)
    if (!h || !h.alive) {
      const d = books.def(name)
      if (!d.loop) spawned.set(name, null)
    }
  }
  if ([...spawned.values()].every(h => !h || !h.alive)) spawnAll()
  books.update(dt, camera, scene.fog)
}

window.lab = {
  books,
  list,
  advance(sec, fps = 60) {
    const n = Math.round(sec * fps)
    for (let i = 0; i < n; i++) step(1 / fps)
    renderer.render(scene, camera)
  },
  restart() {
    books.clear()
    spawned.clear()
    spawnAll()
  },
  frame(f) {
    for (const b of books.batches.values()) for (const p of b.items) { p.frame = f; p.t = f / p.fps }
    books.update(0, camera, scene.fog)
    renderer.render(scene, camera)
  },
  ready: true,
}

let last = performance.now()
function loop(now) {
  requestAnimationFrame(loop)
  if (params.has('still')) return
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  step(dt)
  renderer.render(scene, camera)
  info.textContent = list.join('  ')
}
requestAnimationFrame(loop)
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
