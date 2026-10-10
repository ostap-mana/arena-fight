export const view = { w: innerWidth, h: innerHeight }

const insets = { t: 0, b: 0, l: 0, r: 0 }
let insetsStale = true

function sync() {
  view.w = innerWidth
  view.h = innerHeight
  insetsStale = true
}

export function safeInsets() {
  if (!insetsStale) return insets
  const style = getComputedStyle(document.documentElement)
  const top = style.getPropertyValue('--safe-t')
  if (!top) return insets
  insets.t = parseFloat(top) || 0
  insets.b = parseFloat(style.getPropertyValue('--safe-b')) || 0
  insets.l = parseFloat(style.getPropertyValue('--safe-l')) || 0
  insets.r = parseFloat(style.getPropertyValue('--safe-r')) || 0
  insetsStale = false
  return insets
}

addEventListener('resize', sync)
addEventListener('orientationchange', sync)
