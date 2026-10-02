const link = window.__INVOKERS_LINK
const sent = new Set()
let progressTold = 0
let storeLock = false

export function wireBus(impl) {
  link.wire({
    ...impl,
    start() {
      sent.add('displayed').add('started')
      if (impl.start) impl.start()
    },
  })
}

export function busRunning() {
  return link.running()
}

export function busHosted() {
  return link.hosted()
}

export function sayOnce(name, data) {
  if (sent.has(name)) return
  sent.add(name)
  link.emit(name, data)
}

const QUARTERS = [0.25, 0.5, 0.75]

export function sayProgress(value) {
  const step = Math.floor(Math.min(1, Math.max(0, value)) * 20) / 20
  if (step <= progressTold) return
  for (const q of QUARTERS) if (q > progressTold && q < step) link.emit('progress', { value: q })
  progressTold = step
  link.emit('progress', { value: step })
}

export function openStore(source) {
  if (storeLock) return
  storeLock = true
  setTimeout(() => { storeLock = false }, 1200)
  sayOnce('cta', { source })
  try {
    window.__PLAYABLE.openStore()
  } catch {
    storeLock = false
  }
}

export function stepDoor(dt) {
  const tape = globalThis.playdata
  if (tape && typeof tape.step === 'function') return tape.step(dt)
  return dt
}

export function tellState(read) {
  globalThis.__STATE = function () {
    try {
      return read()
    } catch {
      return null
    }
  }
}

export function bootMark(name) {
  const boot = globalThis.__BOOT
  if (boot && boot.marks) boot.marks.push([name, Math.round(performance.now())])
}
