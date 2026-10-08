const WINDOW = 1.5
const SLOW_FRAME = 1 / 50
const HEALTHY_FRAME = 1 / 57
const CPU_BOUND = 0.5
const DOWN = 0.85
const UP = 1.12
const RAISE_WAIT = 4
const RAISE_WAIT_MAX = 60
const MAX_SAMPLE = 0.1
const SETTLE = 2.5

let longTasks = 0

try {
  new PerformanceObserver(list => { longTasks += list.getEntries().length }).observe({ type: 'longtask', buffered: false })
} catch {}

export class ResolutionGovernor {
  constructor({ start, min, max }) {
    this.ratio = start
    this.min = min
    this.max = max
    this.raiseWait = RAISE_WAIT
    this.calm = 0
    this.settle = SETTLE
    this.reset()
  }

  reset() {
    this.samples = []
    this.work = []
    this.elapsed = 0
    this.longTasks = longTasks
  }

  hold() {
    this.reset()
    this.settle = SETTLE
  }

  sample(dt, workMs) {
    if (this.settle > 0) {
      this.settle -= dt
      if (this.settle <= 0) this.reset()
      return null
    }
    if (dt <= 0 || dt > MAX_SAMPLE) return null
    this.samples.push(dt)
    this.work.push(workMs)
    this.elapsed += dt
    if (this.elapsed < WINDOW) return null
    const frame = median(this.samples)
    const busy = median(this.work) / 1000 / frame
    const stalled = longTasks !== this.longTasks
    this.reset()
    if (stalled) return null
    if (frame > SLOW_FRAME) {
      this.calm = 0
      if (busy >= CPU_BOUND || this.ratio <= this.min) return null
      this.raiseWait = Math.min(RAISE_WAIT_MAX, this.raiseWait * 2)
      return this.set(Math.max(this.min, this.ratio * DOWN))
    }
    this.calm = frame <= HEALTHY_FRAME ? this.calm + WINDOW : 0
    if (this.ratio >= this.max || this.calm < this.raiseWait) return null
    this.calm = 0
    return this.set(Math.min(this.max, this.ratio * UP))
  }

  set(ratio) {
    const rounded = Math.round(ratio * 100) / 100
    if (rounded === this.ratio) return null
    this.ratio = rounded
    return rounded
  }
}

function median(list) {
  const sorted = list.slice().sort((a, b) => a - b)
  return sorted[sorted.length >> 1]
}
