import { compileFor, primePrograms } from './compile.js'
import { texturesOf, uploadTexturesNow, forgetUploads } from './prewarm.js'

const WAKE_GAP_MS = 400
const WAKE_STEP = 1 / 60
const SNAP_KEEP_MS = 3000
const SNAP_FRESH_MS = 1000
const SETTLE_FRAMES = 3

const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
const warn = e => console.warn('context restore warm-up', e)

export class Lifecycle {
  constructor(game) {
    this.game = game
    this.frozen = false
    this.holding = false
    this.thawOwed = false
    this.freezeOwed = false
    this.epoch = 0
    this.snap = null
    this.snapOk = false
    this.snapAt = 0
    this.dropTimer = 0
    game.canvas.addEventListener('webglcontextlost', () => this.lost())
    game.canvas.addEventListener('webglcontextrestored', () => this.restored())
    document.addEventListener('visibilitychange', () => (document.hidden ? this.hide() : this.show()))
    addEventListener('blur', () => this.blur())
  }

  elapsed(ms) {
    if (ms < WAKE_GAP_MS) return ms / 1000
    this.wake()
    return WAKE_STEP
  }

  wake() {
    if (this.game.governor) this.game.governor.wake()
  }

  blur() {
    if (document.hidden) return
    this.snapshot()
    this.dropLater()
  }

  hide() {
    clearTimeout(this.dropTimer)
    if (!this.snapOk || performance.now() - this.snapAt > SNAP_FRESH_MS) this.snapshot()
  }

  show() {
    this.wake()
    if (this.freezeOwed) this.freeze()
    this.dropLater()
  }

  snapshot() {
    this.snapOk = this.capture()
    this.snapAt = performance.now()
  }

  dropLater() {
    clearTimeout(this.dropTimer)
    this.dropTimer = setTimeout(() => this.dropSnap(), SNAP_KEEP_MS)
  }

  uiFrozen() {
    return this.game.ui.root.classList.contains('frozen')
  }

  capture() {
    const g = this.game
    if (g.contextLost || g.renderHold || !g.composer || this.uiFrozen()) return false
    try {
      const src = g.renderer.domElement
      const snap = this.snap || (this.snap = document.createElement('canvas'))
      if (snap.width !== src.width || snap.height !== src.height) {
        snap.width = src.width
        snap.height = src.height
      }
      const ctx = snap.getContext('2d', { willReadFrequently: true })
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(src, 0, 0)
      if (ctx.getImageData(snap.width >> 1, snap.height >> 1, 1, 1).data[3]) return true
      g.render()
      ctx.drawImage(src, 0, 0)
      return true
    } catch {
      return false
    }
  }

  dropSnap() {
    if (document.hidden || this.freezeOwed || !this.snap) return
    this.snapOk = false
    this.snap.width = 0
    this.snap.height = 0
  }

  freeze() {
    this.freezeOwed = false
    if (!this.snapOk || this.thawOwed || this.uiFrozen()) return
    this.game.ui.freeze(this.snap)
    this.thawOwed = true
  }

  hold(on) {
    if (this.holding === on) return
    this.holding = on
    this.game.renderHold += on ? 1 : -1
  }

  lost() {
    this.game.contextLost = true
    this.epoch++
    this.frozen = true
    if (document.hidden) this.freezeOwed = this.snapOk
    else this.freeze()
  }

  restored() {
    const g = this.game
    g.contextLost = false
    this.hold(true)
    if (g.composer) g.skipShadowWalk()
    forgetUploads()
    this.rewarm(this.epoch)
  }

  async rewarm(epoch) {
    const g = this.game
    try {
      await nextFrame()
      const scene = this.compile(g.scene)
      const rest = this.warmRest().catch(warn)
      await scene
      if (epoch !== this.epoch) return
      this.firstFrame()
      await rest
    } catch (e) {
      warn(e)
    }
    if (epoch !== this.epoch) return
    this.hold(false)
    g.render()
    primePrograms(g.renderer)
    for (let i = 0; i < SETTLE_FRAMES; i++) await nextFrame()
    if (epoch !== this.epoch) return
    this.frozen = false
    this.wake()
    if (!this.thawOwed) return
    this.thawOwed = false
    g.ui.thaw()
  }

  compile(root) {
    const g = this.game
    return compileFor(g.renderer, root, g.camera, g.composer.inputBuffer, g.scene)
  }

  firstFrame() {
    this.hold(false)
    if (this.thawOwed) this.game.render()
    else {
      this.snapshot()
      this.freeze()
    }
    this.hold(true)
  }

  warmRest() {
    const g = this.game
    const roots = []
    for (const list of g.modelSpares.values()) for (const m of list) roots.push(m.root)
    const probe = g.loot && g.loot.ready ? g.loot.warmProbe(g.camera.position, 0.001) : null
    if (probe) roots.push(probe)
    const jobs = roots.map(root => this.compile(root))
    if (probe) probe.removeFromParent()
    const libs = g.vfx ? [...g.fxWarms.keys()] : []
    const target = g.composer.inputBuffer
    if (libs.length) jobs.push(g.vfx.warm(g.renderer, g.camera, { names: g.loot.fxNames(), target, libs }))
    if (g.vfx && g.state === 'select') jobs.push(g.vfx.warm(g.renderer, g.camera, { names: g.lobbyFxNames(), target, onlyNamed: true }))
    return Promise.all(jobs).then(() => {
      const textures = texturesOf(g.scene)
      for (const root of roots) for (const t of texturesOf(root)) textures.add(t)
      if (libs.length) for (const t of g.vfx.textures(libs)) textures.add(t)
      uploadTexturesNow(g.renderer, textures)
    })
  }
}
