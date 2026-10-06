const POSITION_LEVELS = 2047
const UV_LEVELS = 2047

const zigzag = v => ((v << 1) ^ (v >> 31)) >>> 0
const unzig = z => (z >>> 1) ^ -(z & 1)

function bounds(values, width) {
  const min = new Array(width).fill(Infinity)
  const max = new Array(width).fill(-Infinity)
  for (let i = 0; i < values.length; i++) {
    const c = i % width
    if (values[i] < min[c]) min[c] = values[i]
    if (values[i] > max[c]) max[c] = values[i]
  }
  return [min.map(v => (Number.isFinite(v) ? v : 0)), max.map(v => (Number.isFinite(v) ? v : 0))]
}

function octEncode(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1
  let u = x / l
  let v = y / l
  if (z < 0) {
    const pu = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1)
    const pv = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1)
    u = pu
    v = pv
  }
  return [Math.round((u * 0.5 + 0.5) * 255), Math.round((v * 0.5 + 0.5) * 255)]
}

function octDecode(a, b) {
  let u = (a / 255) * 2 - 1
  let v = (b / 255) * 2 - 1
  const z = 1 - Math.abs(u) - Math.abs(v)
  if (z < 0) {
    const pu = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1)
    const pv = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1)
    u = pu
    v = pv
  }
  const l = Math.hypot(u, v, z) || 1
  return [u / l, v / l, z / l]
}

export function encodeVfxMeshes(meshes) {
  const meta = []
  const lo = []
  const hi = []
  const normals = []
  const colors = []
  const push16 = z => {
    lo.push(z & 255)
    hi.push((z >> 8) & 255)
  }
  const quantized = (values, width, min, max, levels) => {
    for (let c = 0; c < width; c++) {
      let prev = 0
      for (let i = c; i < values.length; i += width) {
        const span = max[c] - min[c]
        const q = span > 0 ? Math.round(((values[i] - min[c]) / span) * levels) : 0
        push16(zigzag(q - prev))
        prev = q
      }
    }
  }
  for (const [name, m] of Object.entries(meshes)) {
    const entry = { name, v: m.p.length / 3, i: m.i.length }
    ;[entry.pn, entry.px] = bounds(m.p, 3)
    quantized(m.p, 3, entry.pn, entry.px, POSITION_LEVELS)
    if (m.n) {
      entry.n = 1
      for (let k = 0; k < m.n.length; k += 3) normals.push(...octEncode(m.n[k], m.n[k + 1], m.n[k + 2]))
    }
    for (const key of ['u', 'u2']) {
      if (!m[key]) continue
      const [min, max] = bounds(m[key], 2)
      entry[key] = [min, max]
      quantized(m[key], 2, min, max, UV_LEVELS)
    }
    if (m.c) {
      entry.c = m.c.length
      for (const v of m.c) colors.push(Math.round(Math.min(1, Math.max(0, v)) * 255))
    }
    let prev = 0
    for (const index of m.i) {
      push16(zigzag(index - prev))
      prev = index
    }
    meta.push(entry)
  }
  const metaBytes = Buffer.from(JSON.stringify(meta))
  const sections = [metaBytes, Buffer.from(lo), Buffer.from(hi), Buffer.from(normals), Buffer.from(colors)]
  const head = Buffer.alloc(4 * sections.length)
  sections.forEach((s, i) => head.writeUInt32LE(s.length, i * 4))
  return Buffer.concat([head, ...sections])
}

const round = v => Math.round(v * 1e5) / 1e5

export function decodeVfxMeshes(blob) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const lengths = [0, 1, 2, 3, 4].map(i => view.getUint32(i * 4, true))
  const parts = []
  let at = 20
  for (const length of lengths) {
    parts.push(blob.subarray(at, at + length))
    at += length
  }
  const [metaBytes, lo, hi, normals, colors] = parts
  const meta = JSON.parse(new TextDecoder().decode(metaBytes))
  let cursor = 0
  let normalAt = 0
  let colorAt = 0
  const read = () => {
    const z = lo[cursor] | (hi[cursor] << 8)
    cursor++
    return unzig(z)
  }
  const dequantized = (count, width, min, max, levels) => {
    const out = new Array(count * width)
    for (let c = 0; c < width; c++) {
      let q = 0
      const step = (max[c] - min[c]) / levels
      for (let k = 0; k < count; k++) {
        q += read()
        out[k * width + c] = round(min[c] + q * step)
      }
    }
    return out
  }
  const meshes = {}
  for (const e of meta) {
    const m = {}
    m.p = dequantized(e.v, 3, e.pn, e.px, POSITION_LEVELS)
    if (e.n) {
      m.n = new Array(e.v * 3)
      for (let k = 0; k < e.v; k++) {
        const [x, y, z] = octDecode(normals[normalAt++], normals[normalAt++])
        m.n[k * 3] = round(x)
        m.n[k * 3 + 1] = round(y)
        m.n[k * 3 + 2] = round(z)
      }
    }
    for (const key of ['u', 'u2']) if (e[key]) m[key] = dequantized(e.v, 2, e[key][0], e[key][1], UV_LEVELS)
    if (e.c) {
      m.c = new Array(e.c)
      for (let k = 0; k < e.c; k++) m.c[k] = round(colors[colorAt++] / 255)
    }
    m.i = new Array(e.i)
    let index = 0
    for (let k = 0; k < e.i; k++) {
      index += read()
      m.i[k] = index
    }
    meshes[e.name] = m
  }
  return meshes
}

export function mergeVfxMeshes(jsonBytes, blob) {
  const lib = JSON.parse(new TextDecoder().decode(jsonBytes))
  lib.meshes = decodeVfxMeshes(blob)
  return new TextEncoder().encode(JSON.stringify(lib))
}
