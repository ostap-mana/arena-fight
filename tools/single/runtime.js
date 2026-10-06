import { decodePack, readPack, needsMerge, merge } from './unpack.js'

const CSS_TOKEN = /__ASSET__\/([^)'"\s]+)/g

const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}

const first = document.getElementById('pack0')
const tierCount = first ? +first.dataset.tiers || 1 : 0
const tiers = Array.from({ length: tierCount }, () => ({ ...deferred(), loaded: false, fed: false, text: null, info: null }))
const files = new Map()
let worker = null

function keyOf(url) {
  if (typeof url !== 'string') url = url && url.url ? url.url : String(url)
  if (/^(blob|data):/i.test(url)) return null
  const clean = url.split(/[?#]/)[0]
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) && clean.indexOf(location.origin + '/') !== 0) return null
  const at = clean.indexOf('assets/')
  return at < 0 ? null : decodeURIComponent(clean.slice(at))
}

function resolveName(key) {
  if (files.has(key)) return key
  const lobby = key.replace(/_lob_m\.glb$/, '_lob.glb')
  if (files.has(lobby)) return lobby
  const mp3 = key.replace(/\.m4a$/, '.mp3')
  return files.has(mp3) ? mp3 : null
}

const pendingTier = () => tiers.find(t => !t.loaded)

function addTier(tier, bin, raw) {
  const t = tiers[tier]
  if (t.loaded) return
  const add = readPack(bin, raw)
  for (const [name, f] of add) {
    if (files.has(name)) continue
    const merged = !needsMerge(add, name)
    files.set(name, { type: f.type, bytes: f.bytes, url: '', merged, sidecars: add, wait: merged || !worker ? null : deferred() })
  }
  t.loaded = true
  t.text = null
  t.resolve()
}

function mergedIn(name, bytes) {
  const entry = files.get(name)
  if (!entry || entry.merged) return
  entry.bytes = bytes
  entry.merged = true
  if (entry.wait) entry.wait.resolve()
}

function now(key) {
  const real = key && resolveName(key)
  if (!real) return null
  const entry = files.get(real)
  if (!entry.merged) {
    entry.bytes = merge(entry.sidecars, real)
    entry.merged = true
    if (entry.wait) entry.wait.resolve()
  }
  return entry
}

async function later(key) {
  for (;;) {
    const real = resolveName(key)
    if (real) {
      const entry = files.get(real)
      if (!entry.merged && entry.wait) await entry.wait.promise
      return now(key)
    }
    const pending = pendingTier()
    if (!pending) return null
    await pending.promise
  }
}

const waiting = key => !resolveName(key) && !!pendingTier()

function decodeHere(tier) {
  const t = tiers[tier]
  if (t.loaded || t.text === null) return
  const { bin, raw } = decodePack(t.text, t.info)
  addTier(tier, bin, raw)
}

function fallback(reason) {
  if (!worker) return
  console.warn('single: worker fallback', reason)
  worker.terminate()
  worker = null
  for (const entry of files.values()) if (entry.wait) entry.wait.resolve()
  tiers.forEach((t, tier) => { if (t.fed) setTimeout(() => decodeHere(tier), 0) })
}

function startWorker() {
  const source = document.getElementById('lzw')
  if (!source || typeof Worker === 'undefined') return null
  try {
    const url = URL.createObjectURL(new Blob([source.textContent], { type: 'text/javascript' }))
    source.textContent = ''
    const w = new Worker(url)
    w.onmessage = event => {
      const d = event.data
      if (d.error) fallback(d.error)
      else if (d.raw) addTier(d.tier, d.bin, d.raw)
      else if (d.name) mergedIn(d.name, d.bytes)
    }
    w.onerror = event => {
      event.preventDefault()
      fallback(event.message || 'error')
    }
    return w
  } catch (error) {
    return null
  }
}

function feed(tier) {
  const t = tiers[tier]
  const node = document.getElementById(`pack${tier}`)
  if (!t || t.fed || !node) return
  t.fed = true
  const d = node.dataset
  t.info = { n: +d.n, s: +d.s, u: +d.u, p: +d.p }
  t.text = node.textContent
  node.textContent = ''
  if (worker) worker.postMessage({ tier, text: t.text, info: t.info })
  else if (tier === 0) {
    let done = false
    const go = () => {
      if (done) return
      done = true
      decodeHere(0)
    }
    requestAnimationFrame(() => setTimeout(go, 0))
    setTimeout(go, 250)
  } else setTimeout(() => decodeHere(tier), 0)
}

function install() {
  const urlOf = file => {
    if (!file.url) file.url = URL.createObjectURL(new Blob([file.bytes], { type: file.type }))
    return file.url
  }
  const missing = key => {
    console.warn('single: missing', key)
    return URL.createObjectURL(new Blob([], { type: 'application/octet-stream' }))
  }
  const swap = url => {
    const key = keyOf(url)
    if (!key) return url
    const file = now(key)
    return file ? urlOf(file) : missing(key)
  }

  window.__ASSET = name => {
    const file = now(name)
    return file ? urlOf(file) : missing(name)
  }

  const nativeFetch = window.fetch
  window.fetch = function (input, init) {
    const key = keyOf(input)
    if (!key) return nativeFetch.apply(this, arguments)
    return later(key).then(file => {
      if (file) return new Response(file.bytes, { status: 200, headers: { 'Content-Type': file.type } })
      console.warn('single: missing', key)
      return new Response('', { status: 404, statusText: 'Not Found' })
    })
  }

  const held = new WeakMap()
  const open = XMLHttpRequest.prototype.open
  const send = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    const args = Array.prototype.slice.call(arguments)
    const key = keyOf(url)
    if (key && waiting(key)) {
      held.set(this, { args, key })
      return
    }
    held.delete(this)
    args[1] = swap(url)
    return open.apply(this, args)
  }
  XMLHttpRequest.prototype.send = function () {
    const hold = held.get(this)
    if (!hold) return send.apply(this, arguments)
    const body = arguments
    later(hold.key).then(() => {
      if (held.get(this) !== hold) return
      held.delete(this)
      hold.args[1] = swap(hold.args[1])
      open.apply(this, hold.args)
      send.apply(this, body)
    })
  }

  const image = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
  const latest = new WeakMap()
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: image.enumerable,
    get() {
      return image.get.call(this)
    },
    set(value) {
      const url = String(value)
      const key = keyOf(url)
      latest.set(this, url)
      if (key && waiting(key)) {
        later(key).then(() => { if (latest.get(this) === url) image.set.call(this, swap(url)) })
        return
      }
      image.set.call(this, swap(url))
    },
  })
}

function start() {
  const css = now('app.css')
  if (css) {
    const style = document.createElement('style')
    style.textContent = new TextDecoder().decode(css.bytes).replace(CSS_TOKEN, (match, name) => window.__ASSET(name))
    document.head.appendChild(style)
  }
  const app = now('app.js')
  const script = document.createElement('script')
  script.type = 'module'
  script.src = URL.createObjectURL(new Blob([app.bytes], { type: 'text/javascript' }))
  document.body.appendChild(script)
}

if (tierCount) {
  worker = startWorker()
  install()
  window.__SINGLE_FEED = feed
  tiers[0].promise.then(start)
  feed(0)
}
