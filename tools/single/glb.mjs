import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer'
import { encodeImages } from './util.mjs'

export const glbReady = Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])

const MESHOPT = 'EXT_meshopt_compression'
const QUANT = 'KHR_mesh_quantization'
const WEBP = 'EXT_texture_webp'
const BYTE = 5120
const UBYTE = 5121
const SHORT = 5122
const USHORT = 5123
const UINT = 5125
const FLOAT = 5126
const ARRAY = { [BYTE]: Int8Array, [UBYTE]: Uint8Array, [SHORT]: Int16Array, [USHORT]: Uint16Array, [UINT]: Uint32Array, [FLOAT]: Float32Array }
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const TYPE = [null, 'SCALAR', 'VEC2', 'VEC3', 'VEC4']
const SCALE = { [BYTE]: 127, [UBYTE]: 255, [SHORT]: 32767, [USHORT]: 65535 }
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963
const TRS = ['rotation', 'translation', 'scale']
const REST = { rotation: [0, 0, 0, 1], translation: [0, 0, 0], scale: [1, 1, 1] }
const align4 = n => (n + 3) & ~3

function bounds(array, width) {
  const min = new Array(width).fill(Infinity)
  const max = new Array(width).fill(-Infinity)
  for (let i = 0; i < array.length; i += width) {
    for (let c = 0; c < width; c++) {
      const v = array[i + c]
      if (v < min[c]) min[c] = v
      if (v > max[c]) max[c] = v
    }
  }
  return { min, max }
}

export function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  let offset = 12
  let json = null
  let bin = Buffer.alloc(0)
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset)
    const type = buffer.readUInt32LE(offset + 4)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'))
    else if (type === 0x004e4942) bin = data
    offset += 8 + length
  }
  return { json, bin }
}

export function packGlb(json, bin) {
  const text = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonLength = align4(text.length)
  const binLength = align4(bin.length)
  const total = 12 + 8 + jsonLength + (binLength ? 8 + binLength : 0)
  const out = Buffer.alloc(total)
  out.writeUInt32LE(0x46546c67, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonLength, 12)
  out.writeUInt32LE(0x4e4f534a, 16)
  text.copy(out, 20)
  out.fill(0x20, 20 + text.length, 20 + jsonLength)
  if (binLength) {
    const at = 20 + jsonLength
    out.writeUInt32LE(binLength, at)
    out.writeUInt32LE(0x004e4942, at + 4)
    Buffer.from(bin.buffer, bin.byteOffset, bin.length).copy(out, at + 8)
  }
  return out
}

class Reader {
  constructor(json, bin) {
    this.json = json
    this.bin = bin
    this.views = new Map()
  }

  view(index) {
    if (this.views.has(index)) return this.views.get(index)
    const view = this.json.bufferViews[index]
    const ext = view.extensions && view.extensions[MESHOPT]
    let bytes
    if (ext) {
      const at = ext.byteOffset || 0
      bytes = new Uint8Array(ext.count * ext.byteStride)
      MeshoptDecoder.decodeGltfBuffer(bytes, ext.count, ext.byteStride, this.bin.subarray(at, at + ext.byteLength), ext.mode, ext.filter || 'NONE')
    } else {
      if ((view.buffer || 0) !== 0) throw new Error('external buffers are not supported')
      const at = view.byteOffset || 0
      bytes = new Uint8Array(this.bin.buffer, this.bin.byteOffset + at, view.byteLength)
    }
    this.views.set(index, bytes)
    return bytes
  }

  accessor(index) {
    const a = this.json.accessors[index]
    if (a.sparse) throw new Error('sparse accessors are not supported')
    const width = WIDTH[a.type]
    const Arr = ARRAY[a.componentType]
    const elem = Arr.BYTES_PER_ELEMENT * width
    const array = new Arr(a.count * width)
    if (a.bufferView != null) {
      const bytes = this.view(a.bufferView)
      const stride = this.json.bufferViews[a.bufferView].byteStride || elem
      const target = new Uint8Array(array.buffer)
      const base = a.byteOffset || 0
      for (let i = 0; i < a.count; i++) target.set(bytes.subarray(base + i * stride, base + i * stride + elem), i * elem)
    }
    return { array, width, count: a.count, componentType: a.componentType, normalized: !!a.normalized }
  }

  floats(index) {
    const acc = this.accessor(index)
    if (acc.componentType === FLOAT) return acc.array
    const out = new Float32Array(acc.array.length)
    const scale = acc.normalized ? SCALE[acc.componentType] : 1
    const signed = acc.componentType === BYTE || acc.componentType === SHORT
    for (let i = 0; i < out.length; i++) out[i] = acc.normalized && signed ? Math.max(acc.array[i] / scale, -1) : acc.array[i] / scale
    return out
  }

  image(index) {
    return Buffer.from(this.view(this.json.images[index].bufferView))
  }
}

class Writer {
  constructor(meshopt) {
    this.meshopt = meshopt
    this.parts = []
    this.length = 0
    this.fallback = 0
    this.views = []
    this.accessors = []
    this.streams = new Map()
    this.packed = false
  }

  push(bytes) {
    const at = align4(this.length)
    if (at > this.length) this.parts.push(new Uint8Array(at - this.length))
    this.parts.push(bytes)
    this.length = at + bytes.length
    return at
  }

  view(bytes, { target, byteStride, mode, filter, filtered, count }) {
    const index = this.views.length
    if (this.meshopt && mode) {
      const stride = bytes.length / count
      const encoded = MeshoptEncoder.encodeGltfBuffer(filtered || bytes, count, stride, mode)
      if (filter || encoded.length < bytes.length * 0.95) {
        const at = this.push(encoded)
        const ext = { buffer: 0, byteOffset: at, byteLength: encoded.length, byteStride: stride, mode, count }
        if (filter) ext.filter = filter
        const view = { buffer: 1, byteOffset: this.fallback, byteLength: bytes.length, extensions: { [MESHOPT]: ext } }
        if (byteStride) view.byteStride = byteStride
        if (target) view.target = target
        this.fallback = align4(this.fallback + bytes.length)
        this.packed = true
        this.views.push(view)
        return index
      }
    }
    const view = { buffer: 0, byteOffset: this.push(bytes), byteLength: bytes.length }
    if (byteStride) view.byteStride = byteStride
    if (target) view.target = target
    this.views.push(view)
    return index
  }

  raw(bytes) {
    this.views.push({ buffer: 0, byteOffset: this.push(bytes), byteLength: bytes.length })
    return this.views.length - 1
  }

  accessor(array, { type, componentType, normalized, minmax, target, mode, filter, filtered, padTo }) {
    const width = WIDTH[type]
    const count = array.length / width
    const elem = array.BYTES_PER_ELEMENT * width
    let bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
    let byteStride
    if (padTo && padTo > elem) {
      const padded = new Uint8Array(count * padTo)
      for (let i = 0; i < count; i++) padded.set(bytes.subarray(i * elem, i * elem + elem), i * padTo)
      bytes = padded
      byteStride = padTo
    }
    const acc = { bufferView: this.view(bytes, { target, byteStride, mode, filter, filtered, count }), componentType, count, type }
    if (normalized) acc.normalized = true
    if (minmax) Object.assign(acc, bounds(array, width))
    this.accessors.push(acc)
    return this.accessors.length - 1
  }

  streamAccessor(key, array, { type, componentType, normalized, minmax, mode, filter, filtered }) {
    if (!this.streams.has(key)) this.streams.set(key, { mode, filter, chunks: [], filtered: [], bytes: 0, count: 0, accessors: [] })
    const stream = this.streams.get(key)
    const width = WIDTH[type]
    const count = array.length / width
    const acc = { bufferView: -1, byteOffset: stream.bytes, componentType, count, type }
    if (normalized) acc.normalized = true
    if (minmax) Object.assign(acc, bounds(array, width))
    stream.chunks.push(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    if (filtered) stream.filtered.push(filtered)
    stream.bytes += array.byteLength
    stream.count += count
    stream.accessors.push(acc)
    this.accessors.push(acc)
    return this.accessors.length - 1
  }

  flush() {
    for (const stream of this.streams.values()) {
      const bytes = Buffer.concat(stream.chunks)
      const filtered = stream.filtered.length ? Buffer.concat(stream.filtered) : null
      const view = this.view(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length), { mode: stream.mode, filter: stream.filter, filtered, count: stream.count })
      for (const acc of stream.accessors) {
        acc.bufferView = view
        if (!acc.byteOffset) delete acc.byteOffset
      }
    }
    this.streams.clear()
  }

  buffer() {
    const out = Buffer.alloc(align4(this.length))
    let at = 0
    for (const part of this.parts) {
      out.set(part, at)
      at += part.length
    }
    return out
  }
}

function quantizeWeights(w) {
  const count = w.length / 4
  const out = new Uint8Array(w.length)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    const sum = w[o] + w[o + 1] + w[o + 2] + w[o + 3] || 1
    const scaled = [0, 1, 2, 3].map(c => (w[o + c] / sum) * 255)
    const q = scaled.map(Math.floor)
    let rest = 255 - q.reduce((a, b) => a + b, 0)
    const order = [0, 1, 2, 3].sort((a, b) => scaled[b] - q[b] - (scaled[a] - q[a]))
    for (const c of order) {
      if (rest <= 0) break
      q[c]++
      rest--
    }
    out.set(q, o)
  }
  return out
}

function octInput(values, width) {
  const count = values.length / width
  const out = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const x = values[i * width]
    const y = values[i * width + 1]
    const z = values[i * width + 2]
    const len = Math.hypot(x, y, z) || 1
    out[i * 4] = x / len
    out[i * 4 + 1] = y / len
    out[i * 4 + 2] = z / len
    out[i * 4 + 3] = width === 4 ? (values[i * width + 3] < 0 ? -1 : 1) : 0
  }
  return out
}

function roundTo(values, scale, bits) {
  const levels = 2 ** bits - 1
  const step = scale / levels
  const out = new (scale === 65535 ? Uint16Array : Uint8Array)(values.length)
  for (let i = 0; i < values.length; i++) out[i] = Math.round(Math.round(Math.min(1, Math.max(0, values[i])) * levels) * step)
  return out
}

function gather(array, width, keep) {
  if (!keep) return array
  const out = new array.constructor(keep.length * width)
  for (let i = 0; i < keep.length; i++) for (let c = 0; c < width; c++) out[i * width + c] = array[keep[i] * width + c]
  return out
}

function writeAttribute(out, src, name, ai, keep, profile) {
  const a = src.json.accessors[ai]
  const geo = profile.meshopt !== false
  const attribute = { target: ARRAY_BUFFER, mode: 'ATTRIBUTES' }
  if (name === 'NORMAL' || name === 'TANGENT') {
    const width = name === 'NORMAL' ? 3 : 4
    const values = gather(src.floats(ai), WIDTH[a.type], keep)
    const oct = octInput(values, width)
    const ints = new Int8Array(oct.length)
    for (let i = 0; i < oct.length; i++) ints[i] = Math.round(oct[i] * 127)
    const packed = new Int8Array(width === 3 ? (ints.length / 4) * 3 : ints.length)
    if (width === 3) for (let i = 0; i < ints.length / 4; i++) packed.set(ints.subarray(i * 4, i * 4 + 3), i * 3)
    else packed.set(ints)
    if (geo) {
      return out.accessor(packed, { ...attribute, type: TYPE[width], componentType: BYTE, normalized: true, padTo: 4, filter: 'OCTAHEDRAL', filtered: MeshoptEncoder.encodeFilterOct(oct, oct.length / 4, 4, 8) })
    }
    return out.accessor(packed, { ...attribute, type: TYPE[width], componentType: BYTE, normalized: true, padTo: 4 })
  }
  if (name === 'WEIGHTS_0' || name === 'WEIGHTS_1') {
    return out.accessor(quantizeWeights(gather(src.floats(ai), 4, keep)), { ...attribute, type: 'VEC4', componentType: UBYTE, normalized: true })
  }
  if (name.startsWith('JOINTS_')) {
    const joints = gather(src.accessor(ai).array, 4, keep)
    let max = 0
    for (const j of joints) if (j > max) max = j
    const Arr = max < 256 ? Uint8Array : Uint16Array
    return out.accessor(Arr.from(joints), { ...attribute, type: 'VEC4', componentType: max < 256 ? UBYTE : USHORT })
  }
  if (name.startsWith('COLOR_')) {
    const width = WIDTH[a.type]
    const values = gather(src.floats(ai), width, keep)
    const bytes = new Uint8Array(values.length)
    for (let i = 0; i < values.length; i++) bytes[i] = Math.round(Math.min(1, Math.max(0, values[i])) * 255)
    return out.accessor(bytes, { ...attribute, type: a.type, componentType: UBYTE, normalized: true, padTo: 4 })
  }
  if (name.startsWith('TEXCOORD_')) {
    const values = gather(src.floats(ai), 2, keep)
    let inside = true
    for (const v of values) if (v < 0 || v > 1) inside = false
    if (inside) return out.accessor(roundTo(values, 65535, profile.uvBits || 16), { ...attribute, type: 'VEC2', componentType: USHORT, normalized: true })
    return out.accessor(Float32Array.from(values), { ...attribute, type: 'VEC2', componentType: FLOAT })
  }
  const width = WIDTH[a.type]
  const values = Float32Array.from(gather(src.floats(ai), width, keep))
  if (name === 'POSITION' && geo && profile.positionBits) {
    return out.accessor(values, { ...attribute, type: a.type, componentType: FLOAT, minmax: true, filter: 'EXPONENTIAL', filtered: MeshoptEncoder.encodeFilterExp(values, values.length / width, width * 4, profile.positionBits, 'SharedComponent') })
  }
  return out.accessor(values, { ...attribute, type: a.type, componentType: FLOAT, minmax: name === 'POSITION' })
}

function simplifyPrimitive(src, prim, indices, simplify) {
  const positions = src.floats(prim.attributes.POSITION)
  const target = Math.max(3, Math.floor((indices.length * simplify.ratio) / 3) * 3)
  const flags = simplify.lockBorder ? ['LockBorder'] : []
  const [result] = MeshoptSimplifier.simplify(Uint32Array.from(indices), positions, 3, target, simplify.error, flags)
  return result
}

function writeIndices(out, indices, triangles) {
  let max = 0
  for (const i of indices) if (i > max) max = i
  const Arr = max < 65535 ? Uint16Array : Uint32Array
  const mode = triangles && indices.length % 3 === 0 ? 'TRIANGLES' : 'INDICES'
  return out.accessor(Arr.from(indices), { type: 'SCALAR', componentType: max < 65535 ? USHORT : UINT, target: ELEMENT_ARRAY_BUFFER, mode })
}

function signature(prim) {
  const targets = JSON.stringify(prim.targets || [])
  return JSON.stringify(Object.entries(prim.attributes).sort()) + targets
}

function writeMeshes(json, src, out, profile, report) {
  const groups = new Map()
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      const key = signature(prim)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(prim)
    }
  }
  for (const prims of groups.values()) {
    const first = prims[0]
    const vertexCount = src.json.accessors[first.attributes.POSITION].count
    const lists = prims.map(prim => {
      const triangles = (prim.mode ?? 4) === 4
      if (prim.indices == null) return { prim, triangles, indices: null }
      let indices = Uint32Array.from(src.accessor(prim.indices).array)
      if (triangles) {
        const before = indices.length / 3
        if (profile.simplify && before > (profile.simplify.minTriangles || 0)) indices = simplifyPrimitive(src, prim, indices, profile.simplify)
        report.triangles[0] += before
        report.triangles[1] += indices.length / 3
      }
      return { prim, triangles, indices }
    })
    let keep = null
    if (lists.every(l => l.indices)) {
      const map = new Int32Array(vertexCount).fill(-1)
      const order = []
      for (const l of lists) {
        const remapped = new Uint32Array(l.indices.length)
        for (let i = 0; i < l.indices.length; i++) {
          const v = l.indices[i]
          if (map[v] < 0) {
            map[v] = order.length
            order.push(v)
          }
          remapped[i] = map[v]
        }
        l.indices = remapped
      }
      keep = Uint32Array.from(order)
    }
    const attributes = {}
    for (const [name, ai] of Object.entries(first.attributes)) {
      if (name === 'TANGENT' && profile.dropTangents) continue
      attributes[name] = writeAttribute(out, src, name, ai, keep, profile)
    }
    const targets = first.targets && first.targets.map(t => Object.fromEntries(Object.entries(t).map(([name, ai]) => {
      const values = Float32Array.from(gather(src.floats(ai), 3, keep))
      return [name, out.accessor(values, { type: 'VEC3', componentType: FLOAT, minmax: true, target: ARRAY_BUFFER, mode: 'ATTRIBUTES' })]
    })))
    for (const l of lists) {
      l.prim.attributes = { ...attributes }
      if (targets) l.prim.targets = targets
      if (l.indices) l.prim.indices = writeIndices(out, l.indices, l.triangles)
    }
  }
}

function sampleTrack(times, values, width, interpolation, grid, quat) {
  const n = times.length
  const cubic = interpolation === 'CUBICSPLINE'
  const key = (k, c) => (cubic ? values[(k * 3 + 1) * width + c] : values[k * width + c])
  const tangent = (k, side, c) => values[(k * 3 + side) * width + c]
  const out = new Float32Array(grid.length * width)
  let k = 0
  for (let f = 0; f < grid.length; f++) {
    const t = grid[f]
    while (k < n - 2 && times[k + 1] <= t) k++
    const o = f * width
    if (n === 1 || t <= times[0]) {
      for (let c = 0; c < width; c++) out[o + c] = key(0, c)
    } else if (t >= times[n - 1]) {
      for (let c = 0; c < width; c++) out[o + c] = key(n - 1, c)
    } else {
      const dt = times[k + 1] - times[k]
      const s = dt > 0 ? (t - times[k]) / dt : 0
      if (interpolation === 'STEP') {
        for (let c = 0; c < width; c++) out[o + c] = key(k, c)
      } else if (cubic) {
        const s2 = s * s
        const s3 = s2 * s
        for (let c = 0; c < width; c++) {
          out[o + c] = (2 * s3 - 3 * s2 + 1) * key(k, c) + (s3 - 2 * s2 + s) * dt * tangent(k, 2, c) + (-2 * s3 + 3 * s2) * key(k + 1, c) + (s3 - s2) * dt * tangent(k + 1, 0, c)
        }
      } else if (quat) {
        let dot = 0
        for (let c = 0; c < 4; c++) dot += key(k, c) * key(k + 1, c)
        const sign = dot < 0 ? -1 : 1
        dot = Math.min(1, Math.abs(dot))
        const theta = Math.acos(dot)
        const sin = Math.sin(theta)
        const wa = sin > 1e-6 ? Math.sin((1 - s) * theta) / sin : 1 - s
        const wb = sin > 1e-6 ? Math.sin(s * theta) / sin : s
        for (let c = 0; c < 4; c++) out[o + c] = wa * key(k, c) + wb * sign * key(k + 1, c)
      } else {
        for (let c = 0; c < width; c++) out[o + c] = key(k, c) + (key(k + 1, c) - key(k, c)) * s
      }
    }
  }
  if (quat) {
    for (let f = 0; f < grid.length; f++) {
      const o = f * 4
      const len = Math.hypot(out[o], out[o + 1], out[o + 2], out[o + 3]) || 1
      let sign = 1 / len
      if (f > 0) {
        let dot = 0
        for (let c = 0; c < 4; c++) dot += out[o + c] * out[o - 4 + c]
        if (dot < 0) sign = -sign
      }
      for (let c = 0; c < 4; c++) out[o + c] *= sign
    }
  }
  return out
}

function quatAngle(a, ao, b, bo) {
  let dot = 0
  for (let c = 0; c < 4; c++) dot += a[ao + c] * b[bo + c]
  return 2 * Math.acos(Math.min(1, Math.abs(dot)))
}

function deviation(values, width, path, ref, refOffset) {
  let worst = 0
  for (let o = 0; o < values.length; o += width) {
    if (path === 'rotation') worst = Math.max(worst, quatAngle(values, o, ref, refOffset))
    else for (let c = 0; c < width; c++) worst = Math.max(worst, Math.abs(values[o + c] - ref[refOffset + c]) / Math.max(1, Math.abs(ref[refOffset + c])))
  }
  return worst
}

function writeOutput(out, values, path, profile, constant) {
  if (path === 'rotation') {
    const ints = new Int16Array(values.length)
    for (let i = 0; i < values.length; i++) ints[i] = Math.round(Math.max(-1, Math.min(1, values[i])) * 32767)
    if (constant || profile.meshopt === false) return out.streamAccessor('rotation-constant', ints, { type: 'VEC4', componentType: SHORT, normalized: true })
    return out.streamAccessor('rotation', ints, { type: 'VEC4', componentType: SHORT, normalized: true, mode: 'ATTRIBUTES', filter: 'QUATERNION', filtered: MeshoptEncoder.encodeFilterQuat(values, values.length / 4, 8, profile.rotationBits || 12) })
  }
  if (constant || profile.meshopt === false) return out.streamAccessor('vector-constant', values, { type: 'VEC3', componentType: FLOAT })
  return out.streamAccessor('vector', values, { type: 'VEC3', componentType: FLOAT, mode: 'ATTRIBUTES', filter: 'EXPONENTIAL', filtered: MeshoptEncoder.encodeFilterExp(values, values.length / 3, 12, profile.translationBits || 16, 'Separate') })
}

function keepClip(name, profile) {
  if (profile.dropClips && profile.dropClips.test(name)) return false
  return !profile.keepClips || profile.keepClips.test(name)
}

function writeAnimations(json, src, out, profile, report) {
  const animations = []
  for (const anim of json.animations || []) {
    if (!keepClip(anim.name || '', profile)) {
      report.droppedClips.push(anim.name)
      continue
    }
    const tracks = anim.channels.map(ch => {
      const sampler = anim.samplers[ch.sampler]
      return { ch, sampler, times: src.floats(sampler.input) }
    })
    const duration = tracks.reduce((d, t) => Math.max(d, t.times[t.times.length - 1] || 0), 0)
    const grids = new Map()
    const gridFor = fps => {
      if (!grids.has(fps)) {
        const frames = Math.max(2, Math.ceil(duration * fps - 1e-6) + 1)
        const grid = new Float32Array(frames)
        for (let i = 0; i < frames; i++) grid[i] = Math.min(duration, i / fps)
        grid[frames - 1] = duration
        grids.set(fps, { grid, input: null })
      }
      return grids.get(fps)
    }
    let spanInput = null
    const channels = []
    const samplers = []
    for (const { ch, sampler, times } of tracks) {
      const path = ch.target.path
      report.keys[0] += times.length
      if (!TRS.includes(path)) {
        const input = out.streamAccessor('time-other', Float32Array.from(times), { type: 'SCALAR', componentType: FLOAT, minmax: true })
        const output = out.streamAccessor('weights', Float32Array.from(src.floats(sampler.output)), { type: 'SCALAR', componentType: FLOAT })
        samplers.push({ input, output, interpolation: sampler.interpolation || 'LINEAR' })
        channels.push({ sampler: samplers.length - 1, target: ch.target })
        report.keys[1] += times.length
        continue
      }
      const width = path === 'rotation' ? 4 : 3
      const node = json.nodes[ch.target.node]
      const secondary = profile.secondary && profile.secondary.pattern.test(node.name || '')
      const timeline = gridFor(secondary ? profile.secondary.fps : profile.fps)
      const sampled = sampleTrack(times, src.floats(sampler.output), width, sampler.interpolation || 'LINEAR', timeline.grid, path === 'rotation')
      const tolerance = path === 'rotation' ? profile.constantRotation : profile.constantValue
      const constant = deviation(sampled, width, path, sampled, 0) <= tolerance
      if (constant && profile.dropRest && !node.matrix) {
        const rest = node[path] || REST[path]
        if (deviation(sampled.subarray(0, width), width, path, rest, 0) <= tolerance) {
          report.droppedTracks++
          continue
        }
      }
      let input
      let values
      if (constant) {
        spanInput ??= out.streamAccessor('span', Float32Array.of(0, duration), { type: 'SCALAR', componentType: FLOAT, minmax: true })
        input = spanInput
        values = new Float32Array(width * 2)
        values.set(sampled.subarray(0, width), 0)
        values.set(sampled.subarray(0, width), width)
      } else {
        timeline.input ??= out.streamAccessor('time', timeline.grid, { type: 'SCALAR', componentType: FLOAT, minmax: true, mode: 'ATTRIBUTES' })
        input = timeline.input
        values = sampled
      }
      report.keys[1] += values.length / width
      samplers.push({ input, output: writeOutput(out, values, path, profile, constant) })
      channels.push({ sampler: samplers.length - 1, target: ch.target })
    }
    if (!channels.length) {
      spanInput ??= out.streamAccessor('span', Float32Array.of(0, duration), { type: 'SCALAR', componentType: FLOAT, minmax: true })
      const { ch } = tracks[0]
      const node = json.nodes[ch.target.node]
      const rest = Float32Array.from(node[ch.target.path] || REST[ch.target.path])
      const values = new Float32Array(rest.length * 2)
      values.set(rest, 0)
      values.set(rest, rest.length)
      samplers.push({ input: spanInput, output: writeOutput(out, values, ch.target.path, profile, true) })
      channels.push({ sampler: 0, target: ch.target })
    }
    const next = { name: anim.name, channels, samplers }
    if (anim.extras) next.extras = anim.extras
    animations.push(next)
  }
  if (animations.length) json.animations = animations
  else delete json.animations
}

function textureRoles(json) {
  const roles = new Map()
  const mark = (info, role) => {
    if (!info) return
    const tex = json.textures[info.index]
    const source = tex.extensions?.[WEBP]?.source ?? tex.source
    if (source != null && !roles.has(source)) roles.set(source, role)
  }
  for (const m of json.materials || []) {
    mark(m.normalTexture, 'normal')
    mark(m.pbrMetallicRoughness?.baseColorTexture, 'color')
    mark(m.emissiveTexture, 'color')
    mark(m.occlusionTexture, 'data')
    mark(m.pbrMetallicRoughness?.metallicRoughnessTexture, 'data')
  }
  return roles
}

export function imageJob(data, role, profile) {
  if (role === 'normal') {
    if (!profile.normalMax) return { data, flat_normal: true, max: 4, quality: 90 }
    return { data, max: profile.normalMax, quality: profile.normalQuality ?? profile.quality }
  }
  return { data, max: role === 'data' ? profile.dataMax || profile.texMax : profile.texMax, quality: profile.quality, alpha_quality: profile.alphaQuality ?? 80 }
}

function writeImages(json, src, out, profile, report) {
  if (!json.images || !json.images.length) return
  const roles = textureRoles(json)
  const jobs = json.images.map((im, i) => imageJob(src.image(i), roles.get(i) || 'color', profile))
  const encoded = encodeImages(jobs)
  json.images.forEach((im, i) => {
    report.images[0] += src.json.bufferViews[im.bufferView].byteLength
    report.images[1] += encoded[i].length
    im.bufferView = out.raw(encoded[i])
    im.mimeType = 'image/webp'
    delete im.uri
  })
  for (const tex of json.textures || []) {
    const source = tex.extensions?.[WEBP]?.source ?? tex.source
    delete tex.source
    tex.extensions = { ...(tex.extensions || {}), [WEBP]: { source } }
  }
}

function requireExtension(json, name) {
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    const list = (json[key] ||= [])
    if (!list.includes(name)) list.push(name)
  }
}

function unrequire(json, name) {
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (json[key]) json[key] = json[key].filter(n => n !== name)
  }
}

export function shrinkGlb(buffer, profile) {
  const { json, bin } = parseGlb(buffer)
  const src = new Reader(structuredClone(json), bin)
  const out = new Writer(profile.meshopt !== false)
  const report = { before: buffer.length, after: 0, triangles: [0, 0], keys: [0, 0], droppedTracks: 0, droppedClips: [], images: [0, 0] }
  writeMeshes(json, src, out, profile, report)
  for (const skin of json.skins || []) {
    if (skin.inverseBindMatrices != null) {
      skin.inverseBindMatrices = out.accessor(Float32Array.from(src.floats(skin.inverseBindMatrices)), { type: 'MAT4', componentType: FLOAT, mode: 'ATTRIBUTES' })
    }
  }
  writeAnimations(json, src, out, profile, report)
  out.flush()
  writeImages(json, src, out, profile, report)
  json.accessors = out.accessors
  json.bufferViews = out.views
  json.buffers = [{ byteLength: align4(out.length) }]
  unrequire(json, MESHOPT)
  if (out.packed) {
    json.buffers.push({ byteLength: out.fallback, extensions: { [MESHOPT]: { fallback: true } } })
    requireExtension(json, MESHOPT)
  }
  if (json.meshes && json.meshes.length) requireExtension(json, QUANT)
  if (json.images && json.images.length) requireExtension(json, WEBP)
  if (json.asset) delete json.asset.generator
  const result = packGlb(json, out.buffer())
  report.after = result.length
  return { buffer: result, report }
}
