const PATHS = ['rotation', 'translation', 'scale']

function sections(blob) {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength)
  const lengths = []
  for (let i = 0; i < 8; i++) lengths.push(view.getUint32(i * 4, true))
  const out = []
  let at = 32
  for (const length of lengths) {
    out.push(blob.subarray(at, at + length))
    at += length
  }
  return out
}

function u16(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Uint16Array(bytes.byteLength >> 1)
  for (let i = 0; i < out.length; i++) out[i] = view.getUint16(i * 2, true)
  return out
}

function f32(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = new Float32Array(bytes.byteLength >> 2)
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true)
  return out
}

export function decodeAnimations(blob) {
  const [metaBytes, nodeBytes, flags, countBytes, rangeBytes, times, lo, hi] = sections(blob)
  const meta = JSON.parse(new TextDecoder().decode(metaBytes))
  const nodes = u16(nodeBytes)
  const counts = u16(countBytes)
  const ranges = f32(rangeBytes)
  const vectorScale = (1 << meta.vbits) - 1
  let track = 0
  let timeAt = 0
  let valueAt = 0
  let rangeAt = 0
  const read = () => {
    const z = lo[valueAt] | (hi[valueAt] << 8)
    valueAt++
    return (z >>> 1) ^ -(z & 1)
  }
  return meta.clips.map(clip => {
    const channels = []
    for (let c = 0; c < clip.n; c++, track++) {
      const flag = flags[track]
      const path = PATHS[flag & 3]
      const cls = (flag >> 2) & 1
      const drop = flag >> 3
      const count = counts[track]
      const fps = clip.fps ? (cls && !meta.full ? clip.fps / 2 : clip.fps) : meta.fps[cls]
      const last = Math.max(1, Math.ceil(clip.duration * fps - 1e-6))
      const input = new Float32Array(count)
      let frame = 0
      for (let k = 0; k < count; k++) {
        if (k) frame += times[timeAt++]
        input[k] = frame >= last ? clip.duration : frame / fps
      }
      const width = path === 'rotation' ? 4 : 3
      const output = new Float32Array(count * width)
      if (path === 'rotation') {
        const scale = (1 << (meta.bits[cls] - 1)) - 1
        const stored = drop === 4 ? [0, 1, 2, 3] : [0, 1, 2, 3].filter(i => i !== drop)
        for (const comp of stored) {
          let v = 0
          for (let k = 0; k < count; k++) {
            v += read()
            output[k * 4 + comp] = v / scale
          }
        }
        for (let k = 0; k < count; k++) {
          const o = k * 4
          if (drop !== 4) {
            let sum = 0
            for (const comp of stored) sum += output[o + comp] * output[o + comp]
            output[o + drop] = Math.sqrt(Math.max(0, 1 - sum))
          }
          const len = Math.hypot(output[o], output[o + 1], output[o + 2], output[o + 3]) || 1
          for (let i = 0; i < 4; i++) output[o + i] /= len
        }
      } else {
        const min = ranges.subarray(rangeAt, rangeAt + 3)
        const max = ranges.subarray(rangeAt + 3, rangeAt + 6)
        rangeAt += 6
        for (let comp = 0; comp < 3; comp++) {
          let v = 0
          const step = (max[comp] - min[comp]) / vectorScale
          for (let k = 0; k < count; k++) {
            v += read()
            output[k * 3 + comp] = min[comp] + v * step
          }
        }
      }
      channels.push({ node: nodes[track], path, input, output })
    }
    return { name: clip.name, extras: clip.extras, channels }
  })
}

export function mergeAnimations(glb, clips) {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength)
  const jsonLength = view.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength)))
  let binLength = 0
  let binStart = 20 + jsonLength
  if (binStart + 8 <= glb.byteLength) {
    binLength = view.getUint32(binStart, true)
    binStart += 8
  }
  let floats = 0
  for (const clip of clips) for (const ch of clip.channels) floats += ch.input.length + ch.output.length
  const base = (binLength + 3) & ~3
  const data = new Float32Array(floats)
  json.buffers = json.buffers || [{ byteLength: 0 }]
  json.bufferViews = json.bufferViews || []
  json.accessors = json.accessors || []
  const bufferView = json.bufferViews.length
  json.bufferViews.push({ buffer: 0, byteOffset: base, byteLength: floats * 4 })
  let at = 0
  const accessor = (array, type) => {
    data.set(array, at)
    const entry = { bufferView, byteOffset: at * 4, componentType: 5126, count: array.length / (type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4), type }
    if (type === 'SCALAR') {
      entry.min = [array[0]]
      entry.max = [array[array.length - 1]]
    }
    at += array.length
    json.accessors.push(entry)
    return json.accessors.length - 1
  }
  json.animations = clips.map(clip => {
    const samplers = []
    const channels = []
    for (const ch of clip.channels) {
      const input = accessor(ch.input, 'SCALAR')
      const output = accessor(ch.output, ch.path === 'rotation' ? 'VEC4' : 'VEC3')
      samplers.push({ input, output, interpolation: 'LINEAR' })
      channels.push({ sampler: samplers.length - 1, target: { node: ch.node, path: ch.path } })
    }
    const anim = { name: clip.name, channels, samplers }
    if (clip.extras) anim.extras = clip.extras
    return anim
  })
  const binTotal = base + floats * 4
  json.buffers[0].byteLength = binTotal
  const text = new TextEncoder().encode(JSON.stringify(json))
  const textLength = (text.length + 3) & ~3
  const total = 12 + 8 + textLength + 8 + binTotal
  const out = new Uint8Array(total)
  const outView = new DataView(out.buffer)
  outView.setUint32(0, 0x46546c67, true)
  outView.setUint32(4, 2, true)
  outView.setUint32(8, total, true)
  outView.setUint32(12, textLength, true)
  outView.setUint32(16, 0x4e4f534a, true)
  out.set(text, 20)
  out.fill(0x20, 20 + text.length, 20 + textLength)
  const binAt = 20 + textLength
  outView.setUint32(binAt, binTotal, true)
  outView.setUint32(binAt + 4, 0x004e4942, true)
  out.set(glb.subarray(binStart, binStart + binLength), binAt + 8)
  out.set(new Uint8Array(data.buffer), binAt + 8 + base)
  return out
}
