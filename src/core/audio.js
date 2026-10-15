import { Howl, Howler } from 'howler'
import BANK from '../data/sounds.json'
import { stream } from './rng.js'

const random = stream('audio')

const SFX = {
  ui_braam: 0.65, boss_laugh: 0.7, explosion: 0.8,
  outcome_defeat: 0.6, outcome_victory_vo: 0.86, outcome_defeat_vo: 0.97,
  outcome_card_plate: 0.73, outcome_card_shine: 0.97, outcome_select: 0.27, outcome_cta: 0.49,
}

const MUSIC = {
  music_lobby: { vol: 0.45, loop: true },
  music_battle: { vol: 0.4, loop: true },
  music_titan: { vol: 0.6, loop: false },
  music_victory: { vol: 0.5, loop: true },
  music_endcard: { vol: 0.45, loop: true, ext: 'mp3' },
  amb_battle: { vol: 0.25, loop: true },
}

const APPLE = typeof navigator !== 'undefined' && (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

const FORMATS = ['m4a', 'mp3']
const PROBE_CLIP = 'assets/audio/outcome_cta'

const GROUP_VOLUME = { enemies: 0.9 }
const BOOT_GROUPS = ['ui', 'lobby']
const BOOT_SFX = new Set(['ui_braam'])
const WAKE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']
const PAN_DEPTH = 0.55
const PAN_SPAN = 14
const FAR_GAIN = 0.3
const OMNI_DISTANCE = 100
const STEAL_FADE = 90
const CUE_FADE = 900
const HIDE_FADE = 40
const OPEN_FADE = 50
const WAKE_FADE = 200
const SLEEP_DELAY = 60
const GESTURE_WINDOW = 150
const PENDING_AGE = 500
const PENDING_MAX = 6
const END_SLACK = 0.05
const WATCH_MS = 1000
const STALL_SPAN = 450
const STALL_RATIO = 0.2
const REBUILD_GAP = 2000
const REBUILD_BACKOFF = 3
const RESUME_TIMEOUT = 1500

export const STEPS = BANK.steps || {}

async function decodes(url) {
  try {
    const data = await (await fetch(url)).arrayBuffer()
    await new OfflineAudioContext(1, 1, 44100).decodeAudioData(data)
    return true
  } catch {
    return false
  }
}

async function playableFormat() {
  for (const ext of FORMATS) {
    if (await decodes(`${PROBE_CLIP}.${ext}`)) return ext
  }
  return FORMATS[0]
}

const withFormat = (src, ext) => src.replace(/\.m4a$/, `.${ext}`)

const extOf = src => src.slice(src.lastIndexOf('.') + 1)

const ignore = () => {}

function attempt(task, done = ignore) {
  try {
    Promise.resolve(task()).then(done, ignore)
  } catch {
    ignore()
  }
}

class Audio {
  constructor() {
    this.sfx = {}
    this.music = {}
    this.groups = {}
    this.resolving = new Set()
    this.voices = {}
    this.lastAt = {}
    this.listener = null
    this.current = null
    this.enabled = true
    this.ext = FORMATS[0]
    this.booting = null
    this.ready = false
    this.silencers = new Set()
    this.probing = null
    this.ctx = null
    this.up = false
    this.dozing = false
    this.zombie = false
    this.stale = false
    this.kicked = false
    this.askedAt = 0
    this.held = []
    this.layers = {}
    this.waiting = {}
    this.ducked = 1
    this.pending = Array.from({ length: PENDING_MAX }, () => ({ name: '', opts: null, at: 0 }))
    this.queued = 0
    this.wakeAt = -Infinity
    this.wallAt = 0
    this.clockAt = 0
    this.watcher = 0
    this.sleeper = 0
    this.rebuilds = 0
    this.rebuiltAt = -Infinity
    this.onState = () => this.sync()
    this.onWatch = () => this.check()
    this.onSettle = () => this.settle()
    this.onLoad = () => this.reconcile()
    Howler.autoSuspend = false
    if (typeof document !== 'undefined') this.hook()
  }

  hook() {
    this.dozing = document.hidden
    const seen = () => (document.hidden ? this.doze(false) : this.wake())
    const gone = () => this.doze(true)
    const back = () => this.wake()
    const touch = e => this.wake(e.type)
    document.addEventListener('visibilitychange', seen)
    document.addEventListener('freeze', gone)
    document.addEventListener('resume', back)
    addEventListener('pagehide', gone)
    addEventListener('pageshow', back)
    addEventListener('focus', back)
    for (const type of WAKE_EVENTS) document.addEventListener(type, touch, { capture: true, passive: true })
  }

  silence(reason, on) {
    if (on) this.silencers.add(reason)
    else this.silencers.delete(reason)
    if (!on && this.ctx) this.wake()
    if (this.up) this.ramp(this.level(), OPEN_FADE)
  }

  level() {
    return this.silencers.size ? 0 : 1
  }

  ramp(to, ms) {
    const g = Howler.masterGain && Howler.masterGain.gain
    if (!g) return
    const t = Howler.ctx.currentTime
    const from = g.value
    g.cancelScheduledValues(t)
    if (ms > 0) {
      g.setValueAtTime(from, t)
      g.linearRampToValueAtTime(to, t + ms / 1000)
    } else {
      g.setValueAtTime(to, t)
    }
  }

  live() {
    const c = Howler.ctx
    return !this.dozing && !this.zombie && (c ? c.state === 'running' : !Howler.usingWebAudio)
  }

  awake() {
    const c = Howler.ctx
    return this.up && (!c || c.state === 'running')
  }

  bind() {
    const c = Howler.ctx
    if (!c || c === this.ctx) return
    this.ctx = c
    this.up = false
    c.addEventListener('statechange', this.onState)
    this.ramp(0, 0)
    if (this.dozing) this.settle()
  }

  sync() {
    this.bind()
    if (APPLE && this.up && Howler.ctx && Howler.ctx.state !== 'running') this.rebuild(true)
    const live = this.live()
    if (live && !this.up) this.rise()
    else if (!live && this.up) this.fall(0)
  }

  rise() {
    this.up = true
    this.askedAt = 0
    Howler.state = 'running'
    this.purge()
    this.revive()
    this.reconcile()
    this.ramp(this.level(), this.queued ? 0 : OPEN_FADE)
    this.flush()
    this.watch()
  }

  fall(fade) {
    this.up = false
    Howler.state = 'suspended'
    clearInterval(this.watcher)
    this.ramp(0, fade)
    if (!fade) this.sleep()
  }

  doze(now) {
    const fade = !now && !APPLE && this.awake()
    this.dozing = true
    this.queued = 0
    this.askedAt = 0
    const apple = APPLE && !!Howler.ctx
    if (apple) this.ramp(0, 0)
    if (this.up) this.fall(fade ? HIDE_FADE : 0)
    clearTimeout(this.sleeper)
    if (fade) this.sleeper = setTimeout(this.onSettle, SLEEP_DELAY)
    else this.settle()
    if (apple) {
      this.stale = true
      this.rebuild(true)
    }
  }

  settle() {
    if (!this.dozing) return
    this.sleep()
    const c = Howler.ctx
    if (c && (c.state === 'running' || c.state === 'interrupted')) attempt(() => c.suspend())
  }

  wake(gesture) {
    if (document.hidden) return
    if (this.dozing && Howler.ctx && Howler.ctx.state !== 'running') this.sleep()
    this.dozing = false
    clearTimeout(this.sleeper)
    if (this.stale) {
      this.stale = false
      this.rebuild(true)
    }
    this.bind()
    if (gesture && this.up) this.check()
    if (gesture && gesture !== 'pointerdown') this.stuck()
    if (this.zombie) this.rebuild()
    const c = Howler.ctx
    if (c && c.state !== 'running' && c.state !== 'closed') {
      if (gesture) this.wakeAt = performance.now()
      attempt(() => c.resume(), this.onState)
    }
    this.sync()
  }

  stuck() {
    const c = Howler.ctx
    if (!c || c.state === 'running') return
    const now = performance.now()
    if (!this.askedAt) this.askedAt = now
    if (c.state === 'closed' || now - this.askedAt > RESUME_TIMEOUT) this.rebuild()
  }

  sleep() {
    this.purge()
    for (const k in this.music) this.hold(k)
    for (const k in this.sfx) this.hush(this.sfx[k])
    for (const k in this.groups) this.hush(this.groups[k])
  }

  hold(name) {
    const h = this.music[name]
    for (const s of h._sounds) {
      if (s._paused) continue
      h.pause(s._id)
      if (this.rewind(h, s)) this.held.push(name, s._id)
      else h.stop(s._id)
    }
  }

  rewind(h, s) {
    const len = h._sprite[s._sprite][1] / 1000
    if (s._seek < len - END_SLACK) return true
    s._seek = s._loop ? s._seek % len : 0
    return s._loop && len > 0
  }

  hush(h) {
    for (const s of h._sounds) if (!s._paused) h.stop(s._id)
  }

  revive() {
    const held = this.held
    for (let i = 0; i < held.length; i += 2) {
      const name = held[i]
      const h = this.music[name]
      const s = h._soundById(held[i + 1])
      if (!s || !s._paused || s._ended) continue
      if (!this.wants(name)) {
        h.stop(s._id)
        continue
      }
      const vol = s._volume
      h._volume = vol
      h.volume(0, s._id)
      h.play(s._id)
      if (vol > 0) h.fade(0, vol, WAKE_FADE, s._id)
    }
    held.length = 0
  }

  purge() {
    for (const h of Howler._howls) {
      if (!h._playLock && !h._onresume.length) continue
      h._onresume.length = 0
      h._playLock = false
      h._queue.length = 0
      for (const s of h._sounds) if (s._paused && !s._ended && this.held.indexOf(s._id) < 0) s._ended = true
    }
  }

  check() {
    const c = Howler.ctx
    if (!this.up || !c || c.state !== 'running') return this.rebase(0)
    const wall = performance.now()
    if (!this.wallAt) return this.rebase(wall)
    const span = wall - this.wallAt
    if (span < STALL_SPAN) return
    if ((c.currentTime - this.clockAt) * 1000 < span * STALL_RATIO) return this.stall()
    this.kicked = false
    this.rebase(wall)
  }

  rebase(wall) {
    this.wallAt = wall
    this.clockAt = wall && Howler.ctx ? Howler.ctx.currentTime : 0
  }

  watch() {
    clearInterval(this.watcher)
    this.rebase(performance.now())
    this.watcher = setInterval(this.onWatch, WATCH_MS)
  }

  stall() {
    const c = Howler.ctx
    this.fall(0)
    this.zombie = true
    if (this.kicked) return this.rebuild()
    this.kicked = true
    attempt(() => c.suspend(), () => this.kick(c))
  }

  kick(c) {
    if (Howler.ctx !== c || !this.zombie) return
    this.zombie = false
    if (!document.hidden) attempt(() => c.resume(), this.onState)
  }

  rebuild(fresh = false) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    const now = performance.now()
    if (!Ctx || (!fresh && now - this.rebuiltAt < REBUILD_GAP * 2 ** Math.min(this.rebuilds, REBUILD_BACKOFF))) return
    let ctx
    try {
      ctx = new Ctx()
    } catch {
      return
    }
    this.rebuiltAt = now
    if (!fresh) this.rebuilds++
    this.askedAt = 0
    this.fall(0)
    const old = Howler.ctx
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
    Howler.ctx = ctx
    Howler.masterGain = master
    for (const h of Howler._howls) if (h._webAudio) for (const s of h._sounds) this.renode(s, ctx, master)
    this.zombie = false
    if (old) attempt(() => old.close())
    this.sync()
    if (!this.dozing && ctx.state !== 'running') attempt(() => ctx.resume(), this.onState)
  }

  renode(s, ctx, master) {
    const node = ctx.createGain()
    node.gain.value = s._muted ? 0 : s._volume
    node.connect(master)
    s._node = node
    s._panner = undefined
  }

  probe() {
    if (!this.probing) this.probing = playableFormat()
    return this.probing
  }

  prime() {
    Howler.volume()
    this.sync()
  }

  unlocked() {
    return this.awake()
  }

  init() {
    if (!this.booting) this.booting = this.probe().then(ext => this.create(ext))
    return this.booting
  }

  create(ext) {
    this.ext = ext
    this.ready = true
    for (const k in SFX) {
      this.sfx[k] = new Howl({ src: [`assets/audio/${k}.${ext}`], volume: SFX[k], preload: false })
    }
    for (const k in MUSIC) {
      this.music[k] = new Howl({
        src: [`assets/audio/${k}.${MUSIC[k].ext || ext}`],
        volume: 0,
        loop: MUSIC[k].loop,
        html5: false,
        preload: false,
        onload: this.onLoad,
      })
    }
    this.sync()
    this.reconcile()
  }

  fetchBoot() {
    this.fetch(['music_lobby', ...BOOT_GROUPS, ...BOOT_SFX])
  }

  group(name) {
    const g = BANK.groups[name]
    if (!g || !this.ready) return null
    if (!this.groups[name]) this.groups[name] = new Howl({ src: [withFormat(g.src, this.ext)], sprite: g.sprite, preload: false })
    return this.groups[name]
  }

  load(h) {
    if (h.state() !== 'unloaded' || this.resolving.has(h)) return
    const ready = window.__ASSET_READY
    const src = [].concat(h._src)[0]
    if (!ready || src.startsWith('blob:')) return h.load()
    this.resolving.add(h)
    ready(src).then(url => {
      this.resolving.delete(h)
      h._format = [extOf(src)]
      h._src = [url]
      if (h.state() === 'unloaded') h.load()
    })
  }

  fetch(names) {
    for (const name of names) {
      const h = this.music[name] || this.sfx[name] || this.group(name)
      if (h) this.load(h)
    }
  }

  fetchSfx() {
    this.fetch(Object.keys(SFX))
  }

  has(key) {
    return !!BANK.sounds[key]
  }

  loaded(key) {
    const s = BANK.sounds[key]
    const h = s && this.group(s.g)
    return !!h && h.state() === 'loaded'
  }

  listen(x, z, yaw) {
    const l = this.listener || (this.listener = { x: 0, z: 0, yaw: 0 })
    l.x = x
    l.z = z
    l.yaw = yaw
  }

  play(name, opts = {}) {
    if (!this.enabled) return
    if (opts.delay) {
      setTimeout(() => this.play(name, { ...opts, delay: 0 }), opts.delay * 1000)
      return
    }
    if (!this.awake()) return this.defer(name, opts)
    if (BANK.sounds[name]) return this.playEvent(name, opts)
    const h = this.sfx[name]
    if (!h) return
    if (h.state() !== 'loaded') {
      this.load(h)
      return
    }
    const id = h.play()
    if (opts.rate) h.rate(opts.rate, id)
    if (opts.volume != null) h.volume(SFX[name] * opts.volume, id)
    return id
  }

  defer(name, opts) {
    const now = performance.now()
    if (now - this.wakeAt > GESTURE_WINDOW) return
    if (this.queued && now - this.pending[0].at > PENDING_AGE) this.queued = 0
    if (this.queued >= PENDING_MAX) return
    const p = this.pending[this.queued++]
    p.name = name
    p.opts = opts
    p.at = now
  }

  flush() {
    const count = this.queued
    const now = performance.now()
    this.queued = 0
    this.wakeAt = -Infinity
    for (let i = 0; i < count; i++) {
      const p = this.pending[i]
      if (now - p.at <= PENDING_AGE) this.play(p.name, p.opts)
      p.opts = null
    }
  }

  playAny(names, opts) {
    this.play(names[(random() * names.length) | 0], opts)
  }

  playEvent(key, opts) {
    const s = BANK.sounds[key]
    const h = this.group(s.g)
    if (!h) return
    if (h.state() !== 'loaded') {
      this.load(h)
      return
    }
    const slot = opts.slot || key
    const now = performance.now() / 1000
    if (opts.gap && now - (this.lastAt[slot] ?? -Infinity) < opts.gap) return
    const live = this.voices[slot] || (this.voices[slot] = [])
    let keep = 0
    for (let i = 0; i < live.length; i++) {
      const v = live[i]
      if (v.h.playing(v.id)) live[keep++] = v
    }
    live.length = keep
    if (opts.max && live.length >= opts.max) {
      if (!opts.steal) return
      const old = live.shift()
      old.h.fade(old.h.volume(old.id), 0, STEAL_FADE, old.id)
      setTimeout(() => old.h.stop(old.id), STEAL_FADE + 20)
    }
    const id = h.play(`${key}#${(random() * s.n) | 0}`)
    live.push({ h, id, key })
    this.lastAt[slot] = now
    let vol = (opts.volume ?? 1) * (GROUP_VOLUME[s.g] ?? 1)
    if (opts.at && this.listener) {
      vol *= this.falloff(opts.at, s.dist)
      h.stereo(this.pan(opts.at), id)
    }
    h.volume(vol, id)
    if (opts.rate) h.rate(opts.rate, id)
    return id
  }

  falloff(at, dist) {
    if (!dist || dist[1] >= OMNI_DISTANCE) return 1
    const d = Math.hypot(at.x - this.listener.x, at.z - this.listener.z)
    const k = Math.min(1, Math.max(0, (d - dist[0]) / (dist[1] - dist[0])))
    return 1 - (1 - FAR_GAIN) * k
  }

  pan(at) {
    const { x, z, yaw } = this.listener
    const side = (at.x - x) * Math.cos(yaw) - (at.z - z) * Math.sin(yaw)
    return Math.max(-1, Math.min(1, side / PAN_SPAN)) * PAN_DEPTH
  }

  emit(prefab, at) {
    const key = BANK.emitters && BANK.emitters[prefab]
    if (key) this.play(key, { at })
  }

  stop(key, fade = 0) {
    for (const slot in this.voices) {
      for (const v of this.voices[slot]) {
        if (v.key !== key || !v.h.playing(v.id)) continue
        if (fade) {
          v.h.fade(v.h.volume(v.id), 0, fade, v.id)
          const { h, id } = v
          setTimeout(() => h.stop(id), fade + 30)
        } else {
          v.h.stop(v.id)
        }
      }
    }
  }

  wants(name) {
    return name === this.current || !!this.layers[name]
  }

  target(name) {
    return MUSIC[name].vol * (name === this.current ? this.ducked : 1)
  }

  cue(name, fade) {
    const h = this.music[name]
    if (!h) return
    if (h.state() !== 'loaded' || !this.awake()) {
      this.waiting[name] = fade
      return this.fetch([name])
    }
    delete this.waiting[name]
    if (!h.playing()) {
      h.volume(0)
      h.play()
    }
    h.fade(h.volume(), this.target(name), fade)
  }

  reconcile() {
    if (!this.awake()) return
    for (const k in this.waiting) {
      if (this.wants(k)) this.cue(k, this.waiting[k])
      else delete this.waiting[k]
    }
  }

  retire(name, fade) {
    const h = this.music[name]
    delete this.waiting[name]
    if (!h || h.state() !== 'loaded') return
    if (!this.awake()) {
      h.stop()
      return
    }
    h.fade(h.volume(), 0, fade)
    setTimeout(() => {
      if (!this.wants(name)) h.stop()
    }, fade + 60)
  }

  track(name, fade = CUE_FADE) {
    if (!this.enabled) return
    if (this.current === name) return
    const prev = this.current
    this.current = name
    this.ducked = 1
    if (prev) this.retire(prev, fade)
    this.cue(name, fade)
  }

  layer(name, on, fade = 800) {
    const h = this.music[name]
    if (!h) return
    this.layers[name] = on
    if (on) return this.cue(name, fade)
    delete this.waiting[name]
    if (this.awake()) h.fade(h.volume(), 0, fade)
    else h.volume(0)
  }

  duck(v, ms = 400) {
    const h = this.music[this.current]
    if (!h) return
    this.ducked = v
    if (this.awake()) h.fade(h.volume(), this.target(this.current), ms)
    else h.volume(this.target(this.current))
  }

  stopAll() {
    Howler.stop()
    this.current = null
    this.layers = {}
    this.waiting = {}
    this.held.length = 0
  }

  mute(v) {
    this.silence('pause', v)
  }
}

export const audio = new Audio()
