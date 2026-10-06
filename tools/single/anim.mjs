import { sampleTrack } from './glb.mjs'

const PATHS = ['rotation', 'translation', 'scale']
const REST = { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] }
const MAX_GAP = 255

function keepClip(name, profile) {
  if (profile.dropClips && profile.dropClips.test(name)) return false
  return !profile.keepClips || profile.keepClips.test(name)
}

function slerpError(v, i, j, k) {
  const s = (k - i) / (j - i)
  let d = 0
  for (let c = 0; c < 4; c++) d += v[i * 4 + c] * v[j * 4 + c]
  const sign = d < 0 ? -1 : 1
  d = Math.min(1, Math.abs(d))
  const theta = Math.acos(d)
  const sin = Math.sin(theta)
  const wa = sin > 1e-6 ? Math.sin((1 - s) * theta) / sin : 1 - s
  const wb = sin > 1e-6 ? Math.sin(s * theta) / sin : s
  let len = 0
  const q = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    q[c] = wa * v[i * 4 + c] + wb * sign * v[j * 4 + c]
    len += q[c] * q[c]
  }
  len = Math.sqrt(len) || 1
  let dot = 0
  for (let c = 0; c < 4; c++) dot += (q[c] / len) * v[k * 4 + c]
  return 2 * Math.acos(Math.min(1, Math.abs(dot)))
}

function linearFits(v, width, i, j, tolerance) {
  for (let k = i + 1; k < j; k++) {
    const s = (k - i) / (j - i)
    for (let c = 0; c < width; c++) {
      if (Math.abs(v[i * width + c] + (v[j * width + c] - v[i * width + c]) * s - v[k * width + c]) > tolerance) return false
    }
  }
  return true
}

function rotationFits(v, i, j, tolerance) {
  for (let k = i + 1; k < j; k++) if (slerpError(v, i, j, k) > tolerance) return false
  return true
}

function reduce(v, width, rotation, tolerance) {
  const n = v.length / width
  const keep = [0]
  let i = 0
  while (i < n - 1) {
    let j = i + 1
    while (j + 1 < n && j + 1 - i <= MAX_GAP) {
      const fits = rotation ? rotationFits(v, i, j + 1, tolerance) : linearFits(v, width, i, j + 1, tolerance)
      if (!fits) break
      j++
    }
    keep.push(j)
    i = j
  }
  return keep
}

function spread(v, width, rotation) {
  let worst = 0
  for (let k = 1; k < v.length / width; k++) {
    if (rotation) {
      let d = 0
      for (let c = 0; c < 4; c++) d += v[c] * v[k * 4 + c]
      worst = Math.max(worst, 2 * Math.acos(Math.min(1, Math.abs(d))))
    } else {
      for (let c = 0; c < width; c++) worst = Math.max(worst, Math.abs(v[k * width + c] - v[c]))
    }
  }
  return worst
}

function distance(a, b, rotation) {
  if (rotation) {
    let d = 0
    for (let c = 0; c < 4; c++) d += a[c] * b[c]
    return 2 * Math.acos(Math.min(1, Math.abs(d)))
  }
  let worst = 0
  for (let c = 0; c < a.length; c++) worst = Math.max(worst, Math.abs(a[c] - b[c]))
  return worst
}

class Bytes {
  constructor() {
    this.parts = []
    this.chunk = []
  }

  push(...values) {
    for (const v of values) this.chunk.push(v)
    if (this.chunk.length > 65536) this.flush()
  }

  flush() {
    if (this.chunk.length) this.parts.push(Buffer.from(this.chunk))
    this.chunk = []
  }

  buffer() {
    this.flush()
    return Buffer.concat(this.parts)
  }
}

const zigzag = v => ((v << 1) ^ (v >> 31)) >>> 0

function sourceRate(tracks, fallback) {
  for (const fps of [30, 24, 25, 20, 60, 48, 50]) {
    if (tracks.every(t => t.times.every(time => Math.abs(time * fps - Math.round(time * fps)) < 0.02))) return fps
  }
  return fallback
}

export function encodeAnimations(json, src, profile, report) {
  const a = profile.anim
  const secondary = a.secondary
  const meta = { fps: [a.fps, a.secondaryFps], bits: [a.bits, a.secondaryBits], vbits: a.vectorBits, full: a.secondaryFull ? 1 : 0, clips: [] }
  const nodes = []
  const flags = []
  const counts = []
  const times = new Bytes()
  const lo = new Bytes()
  const hi = new Bytes()
  const ranges = []
  for (const anim of json.animations || []) {
    if (!keepClip(anim.name || '', profile)) continue
    const tracks = anim.channels.map(ch => {
      const sampler = anim.samplers[ch.sampler]
      return { ch, sampler, times: src.floats(sampler.input) }
    })
    if (tracks.some(t => !PATHS.includes(t.ch.target.path))) throw new Error(`clip ${anim.name} animates ${tracks.map(t => t.ch.target.path).join(',')}`)
    const posed = !!(profile.poseClips && profile.poseClips.test(anim.name || ''))
    const duration = posed ? 0 : tracks.reduce((d, t) => Math.max(d, t.times[t.times.length - 1] || 0), 0)
    const base = sourceRate(tracks, a.fps)
    const rates = [base, a.secondaryFull ? base : base / 2]
    const clip = { name: anim.name, duration, n: 0, fps: base }
    if (anim.extras) clip.extras = anim.extras
    for (const { ch, sampler, times: input } of tracks) {
      const path = ch.target.path
      const rotation = path === 'rotation'
      const width = rotation ? 4 : 3
      const node = json.nodes[ch.target.node]
      const cls = secondary && secondary.test(node.name || '') ? 1 : 0
      const fps = rates[cls]
      const frames = Math.max(2, Math.ceil(duration * fps - 1e-6) + 1)
      const grid = new Float32Array(frames)
      for (let i = 0; i < frames; i++) grid[i] = Math.min(duration, i / fps)
      grid[frames - 1] = duration
      const values = sampleTrack(input, src.floats(sampler.output), width, sampler.interpolation || 'LINEAR', grid, rotation)
      report.keys[0] += input.length
      let scale = 0
      for (const v of values) scale = Math.max(scale, Math.abs(v))
      scale = Math.max(scale, 0.01)
      const still = rotation ? a.still : a.still * scale
      const constant = spread(values, width, rotation) <= still
      if (constant && !node.matrix && distance(values.subarray(0, width), node[path] || REST[path], rotation) <= still) {
        report.droppedTracks++
        continue
      }
      const tolerance = rotation ? (cls ? a.secondaryTolerance : a.tolerance) : a.vectorTolerance * scale * (cls ? 3 : 1)
      const keys = constant ? [0] : reduce(values, width, rotation, tolerance)
      report.keys[1] += keys.length
      clip.n++
      nodes.push(ch.target.node)
      counts.push(keys.length)
      for (let k = 1; k < keys.length; k++) times.push(keys[k] - keys[k - 1])
      let comps
      let drop = 4
      const q = keys.map(k => Array.from(values.subarray(k * width, k * width + width)))
      if (rotation) {
        const S = (1 << (meta.bits[cls] - 1)) - 1
        let bestMin = -1
        for (let c = 0; c < 4; c++) {
          let m = Infinity
          for (const key of q) m = Math.min(m, Math.abs(key[c]))
          if (m > bestMin) {
            bestMin = m
            drop = c
          }
        }
        if (bestMin < a.dropFloor) drop = 4
        else for (const key of q) if (key[drop] < 0) for (let c = 0; c < 4; c++) key[c] = -key[c]
        comps = [0, 1, 2, 3].filter(c => c !== drop).map(c => q.map(key => Math.round(Math.max(-1, Math.min(1, key[c])) * S)))
      } else {
        const Q = (1 << meta.vbits) - 1
        const min = [0, 1, 2].map(c => Math.min(...q.map(key => key[c])))
        const max = [0, 1, 2].map(c => Math.max(...q.map(key => key[c])))
        ranges.push(...min, ...max)
        comps = [0, 1, 2].map(c => q.map(key => (max[c] > min[c] ? Math.round(((key[c] - min[c]) / (max[c] - min[c])) * Q) : 0)))
      }
      flags.push(PATHS.indexOf(path) | (cls << 2) | (drop << 3))
      for (const comp of comps) {
        let prev = 0
        for (const v of comp) {
          const z = zigzag(v - prev)
          prev = v
          lo.push(z & 255)
          hi.push((z >> 8) & 255)
        }
      }
    }
    meta.clips.push(clip)
  }
  if (!meta.clips.length) return null
  const metaBytes = Buffer.from(JSON.stringify(meta))
  const nodeBytes = Buffer.alloc(nodes.length * 2)
  nodes.forEach((n, i) => nodeBytes.writeUInt16LE(n, i * 2))
  const countBytes = Buffer.alloc(counts.length * 2)
  counts.forEach((n, i) => countBytes.writeUInt16LE(n, i * 2))
  const rangeBytes = Buffer.from(new Float32Array(ranges).buffer)
  const sections = [metaBytes, nodeBytes, Buffer.from(flags), countBytes, rangeBytes, times.buffer(), lo.buffer(), hi.buffer()]
  const head = Buffer.alloc(4 * sections.length)
  sections.forEach((s, i) => head.writeUInt32LE(s.length, i * 4))
  return Buffer.concat([head, ...sections])
}
