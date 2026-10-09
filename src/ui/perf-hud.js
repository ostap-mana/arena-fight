const REFRESH_MS = 500

export class PerfHud {
  constructor(game) {
    this.game = game
    this.el = document.createElement('div')
    this.el.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99999;padding:4px 6px;font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,.65);pointer-events:none;white-space:pre'
    document.body.appendChild(this.el)
    this.frames = []
    this.work = []
    this.last = performance.now()
  }

  sample(elapsed, work) {
    this.frames.push(elapsed * 1000)
    this.work.push(work)
    const now = performance.now()
    if (now - this.last < REFRESH_MS) return
    const span = now - this.last
    this.last = now
    const frames = this.frames.splice(0).sort((a, b) => a - b)
    const cpu = this.work.splice(0).sort((a, b) => a - b)
    const g = this.game
    const canvas = g.renderer.domElement
    this.el.textContent = [
      `${((frames.length * 1000) / span).toFixed(0)} fps  worst ${frames[frames.length - 1].toFixed(0)} ms`,
      `cpu ${cpu[cpu.length >> 1].toFixed(1)} ms  ${g.quality}`,
      `${canvas.width}x${canvas.height} @${g.renderer.getPixelRatio().toFixed(2)}`,
      g.gpuName.replace(/^ANGLE \(|\)$/g, '').slice(0, 48),
    ].join('\n')
  }
}
