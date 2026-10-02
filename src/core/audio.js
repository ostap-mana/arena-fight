import { Howl, Howler } from 'howler'
import BANK from '../data/sounds.json'

const SFX = {
  ui_braam: 0.65, boss_laugh: 0.7, explosion: 0.8,
  outcome_victory: 0.76, outcome_defeat: 0.6, outcome_victory_vo: 0.86, outcome_defeat_vo: 0.97,
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

const FORMATS = ['m4a', 'mp3']
const PROBE_CLIP = 'assets/audio/outcome_cta'

const GROUP_VOLUME = { enemies: 0.9 }
const BOOT_GROUPS = ['ui', 'lobby']
const PAN_DEPTH = 0.55
const PAN_SPAN = 14
const FAR_GAIN = 0.3
const OMNI_DISTANCE = 100

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

class Audio {
  constructor() {
    this.sfx = {}
    this.music = {}
    this.groups = {}
    this.voices = {}
    this.lastAt = {}
    this.listener = null
    this.current = null
    this.enabled = true
    this.ext = FORMATS[0]
    this.booting = null
    this.ready = false
  }

  init() {
    if (!this.booting) this.booting = playableFormat().then(ext => this.create(ext))
    return this.booting
  }

  create(ext) {
    this.ext = ext
    this.ready = true
    for (const k in SFX) {
      this.sfx[k] = new Howl({ src: [`assets/audio/${k}.${ext}`], volume: SFX[k], preload: true })
    }
    for (const k in MUSIC) {
      this.music[k] = new Howl({
        src: [`assets/audio/${k}.${MUSIC[k].ext || ext}`],
        volume: 0,
        loop: MUSIC[k].loop,
        html5: false,
        preload: k === 'music_lobby',
      })
    }
    this.fetch(BOOT_GROUPS)
  }

  group(name) {
    const g = BANK.groups[name]
    if (!g || !this.ready) return null
    if (!this.groups[name]) this.groups[name] = new Howl({ src: [withFormat(g.src, this.ext)], sprite: g.sprite, preload: false })
    return this.groups[name]
  }

  fetch(names) {
    for (const name of names) {
      const h = this.music[name] || this.group(name)
      if (h && h.state() === 'unloaded') h.load()
    }
  }

  has(key) {
    return !!BANK.sounds[key]
  }

  listen(x, z, yaw) {
    this.listener = { x, z, yaw }
  }

  play(name, opts = {}) {
    if (!this.enabled) return
    if (opts.delay) {
      setTimeout(() => this.play(name, { ...opts, delay: 0 }), opts.delay * 1000)
      return
    }
    if (BANK.sounds[name]) return this.playEvent(name, opts)
    const h = this.sfx[name]
    if (!h) return
    const id = h.play()
    if (opts.rate) h.rate(opts.rate, id)
    if (opts.volume != null) h.volume(SFX[name] * opts.volume, id)
    return id
  }

  playAny(names, opts) {
    this.play(names[(Math.random() * names.length) | 0], opts)
  }

  playEvent(key, opts) {
    const s = BANK.sounds[key]
    const h = this.group(s.g)
    if (!h) return
    if (h.state() !== 'loaded') {
      if (h.state() === 'unloaded') h.load()
      return
    }
    const slot = opts.slot || key
    const now = performance.now() / 1000
    if (opts.gap && now - (this.lastAt[slot] ?? -Infinity) < opts.gap) return
    const live = (this.voices[slot] || []).filter(v => v.h.playing(v.id))
    if (opts.max && live.length >= opts.max) return
    const id = h.play(`${key}#${(Math.random() * s.n) | 0}`)
    live.push({ h, id, key })
    this.voices[slot] = live
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

  track(name, fade = 900) {
    if (!this.enabled) return
    if (this.current === name) return
    const prev = this.music[this.current]
    if (prev) {
      prev.fade(prev.volume(), 0, fade)
      const p = prev
      setTimeout(() => p.stop(), fade + 60)
    }
    this.current = name
    const h = this.music[name]
    if (!h) return
    this.fetch([name])
    h.volume(0)
    h.play()
    h.fade(0, MUSIC[name].vol, fade)
  }

  layer(name, on, fade = 800) {
    const h = this.music[name]
    if (!h) return
    if (on) {
      this.fetch([name])
      if (!h.playing()) { h.volume(0); h.play() }
      h.fade(h.volume(), MUSIC[name].vol, fade)
    } else {
      h.fade(h.volume(), 0, fade)
    }
  }

  duck(v, ms = 400) {
    const h = this.music[this.current]
    if (!h) return
    h.fade(h.volume(), MUSIC[this.current].vol * v, ms)
  }

  stopAll() {
    Howler.stop()
    this.current = null
  }

  mute(v) {
    Howler.mute(v)
  }
}

export const audio = new Audio()
