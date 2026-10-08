export const view = { w: innerWidth, h: innerHeight }

function sync() {
  view.w = innerWidth
  view.h = innerHeight
}

addEventListener('resize', sync)
addEventListener('orientationchange', sync)
