const WINDOW = 2
const SLOW_FRAME = 1 / 47
const STEP = 0.25
const MIN_RATIO = 1
const MAX_SAMPLE = 0.1

export class ResolutionGovernor {
  constructor(ratio) {
    this.ratio = ratio
    this.samples = []
    this.elapsed = 0
  }

  reset() {
    this.samples = []
    this.elapsed = 0
  }

  sample(dt) {
    if (dt <= 0 || dt > MAX_SAMPLE) return null
    this.samples.push(dt)
    this.elapsed += dt
    if (this.elapsed < WINDOW) return null
    const sorted = this.samples.sort((a, b) => a - b)
    const median = sorted[sorted.length >> 1]
    this.reset()
    if (median <= SLOW_FRAME || this.ratio <= MIN_RATIO) return null
    this.ratio = Math.max(MIN_RATIO, this.ratio - STEP)
    return this.ratio
  }
}
