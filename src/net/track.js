import { initTelemetry } from './telemetry.js'

const ENDPOINT = 'https://ostap-kreminets.vercel.app/api/ingest'
const PROJECT = 'invokers'

function buildLabel() {
  const stamp = globalThis.__BUILD || {}
  return [stamp.commit, stamp.buildId].filter(v => v && v !== 'dev' && v !== 'nogit').join('.') || 'dev'
}

function sourceLabel() {
  if (!import.meta.env.DEV) return undefined
  return new URLSearchParams(location.search).get('src') || 'local'
}

const automated = typeof navigator !== 'undefined' && navigator.webdriver === true
const enabled = (import.meta.env.DEV || import.meta.env.MODE === 'telemetry') && !automated
const tm = enabled ? initTelemetry({ endpoint: ENDPOINT, project: PROJECT, build: buildLabel(), src: sourceLabel() }) : null

if (tm) addEventListener('pointerdown', () => tm.firstInput(), { once: true, capture: true })

let booted = false
let phaseStart = 0

function safely(fn) {
  try {
    fn()
  } catch {
    return
  }
}

export function trackBoot(name, at) {
  if (!tm || booted) return
  const start = phaseStart
  phaseStart = at
  safely(() => performance.measure(`boot.${name}`, { start, end: at }))
  if (name !== 'select') return
  booted = true
  safely(() => performance.mark('boot.firstFrame'))
  tm.gameReady()
}

export function trackRenderer(renderer) {
  if (!tm) return
  tm.setRendererInfo(() => renderer.info)
  tm.setGl(renderer.getContext())
}

export function trackPartial(read) {
  if (tm) tm.setPartialProvider(() => ({ stats: read() }))
}

export function trackRunStart() {
  if (tm) tm.runStart()
}

export function trackRunEnd(result, stats) {
  if (tm) tm.runEnd({ result, stats })
}

export function trackRetry() {
  if (tm) tm.retryClicked()
}

export function trackCta() {
  if (tm) tm.ctaClicked()
}
