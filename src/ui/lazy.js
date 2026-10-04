const LAZY_SRC = /(<img\b[^>]*?)\ssrc=/g
const waiting = []
let released = false

export function deferImages(html) {
  return released ? html : html.replace(LAZY_SRC, '$1 data-src=')
}

export function whenReleased(fn) {
  if (released) fn()
  else waiting.push(fn)
}

export function releaseImages(root) {
  released = true
  for (const img of root.querySelectorAll('img[data-src]')) {
    img.src = img.dataset.src
    img.removeAttribute('data-src')
  }
  for (const fn of waiting.splice(0)) fn()
}
