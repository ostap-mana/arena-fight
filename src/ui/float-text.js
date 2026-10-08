export class FloatText {
  constructor(root, limit = 32) {
    this.root = root
    this.limit = limit
    this.free = []
    this.live = []
  }

  take(className) {
    let node = this.free.pop()
    if (!node && this.live.length >= this.limit) {
      node = this.live.shift()
      stop(node)
    }
    if (!node) {
      node = document.createElement('div')
      this.root.appendChild(node)
    }
    node.style.display = ''
    if (node.className !== className) node.className = className
    this.live.push(node)
    return node
  }

  release(node) {
    const i = this.live.indexOf(node)
    if (i < 0) return
    this.live.splice(i, 1)
    node.style.display = 'none'
    this.free.push(node)
  }

  show(className, text, frames, timing, style) {
    const node = this.take(className)
    if (node.textContent !== text) node.textContent = text
    if (style) {
      for (const k in style) if (node.style[k] !== style[k]) node.style[k] = style[k]
    }
    const anim = node.animate(frames, timing)
    anim.onfinish = () => this.release(node)
    anim.oncancel = () => this.release(node)
    return node
  }

  clear() {
    for (const node of this.live) {
      stop(node)
      node.style.display = 'none'
    }
    this.free.push(...this.live)
    this.live.length = 0
  }
}

function stop(node) {
  for (const a of node.getAnimations()) {
    a.onfinish = a.oncancel = null
    a.cancel()
  }
}
