import fs from 'node:fs'
import path from 'node:path'
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer'

const EXT = 'EXT_meshopt_compression'
const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
const TRIANGLE_MODES = new Set([undefined, 4])
const MIN_GAIN = 0.92
const MIN_BYTES = 256
const JSON_COST = 120

const align4 = n => (n + 3) & ~3

function readGlb(file) {
  const buf = fs.readFileSync(file)
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error(`${file}: not a GLB`)
  let offset = 12
  let json = null
  let bin = null
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset)
    const type = buf.readUInt32LE(offset + 4)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (type === JSON_CHUNK) json = JSON.parse(data.toString('utf8'))
    else if (type === BIN_CHUNK) bin = data
    offset += 8 + length
  }
  return { json, bin, size: buf.length }
}

function writeGlb(file, json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = align4(jsonBytes.length) - jsonBytes.length
  const binPad = align4(bin.length) - bin.length
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad
  const out = Buffer.alloc(total)
  out.writeUInt32LE(GLB_MAGIC, 0)
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  out.writeUInt32LE(jsonBytes.length + jsonPad, 12)
  out.writeUInt32LE(JSON_CHUNK, 16)
  jsonBytes.copy(out, 20)
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonBytes.length + jsonPad)
  const binAt = 20 + jsonBytes.length + jsonPad
  out.writeUInt32LE(bin.length + binPad, binAt)
  out.writeUInt32LE(BIN_CHUNK, binAt + 4)
  bin.copy(out, binAt + 8)
  fs.writeFileSync(file, out)
  return total
}

function viewUsage(json) {
  const usage = json.bufferViews.map(() => ({ index: false, triangles: true, sizes: new Set(), image: false }))
  const accessors = json.accessors || []
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      if (prim.indices == null) continue
      const acc = accessors[prim.indices]
      if (acc.bufferView == null) continue
      const u = usage[acc.bufferView]
      u.index = true
      if (!TRIANGLE_MODES.has(prim.mode)) u.triangles = false
    }
  }
  for (const acc of accessors) {
    if (acc.bufferView == null) continue
    usage[acc.bufferView].sizes.add(COMPONENT_SIZE[acc.componentType] * TYPE_COUNT[acc.type])
    if (acc.sparse) usage[acc.bufferView].sparse = true
  }
  for (const img of json.images || []) if (img.bufferView != null) usage[img.bufferView].image = true
  return usage
}

function plan(view, u) {
  if (u.image || u.sparse || view.byteLength < MIN_BYTES || view.buffer !== 0) return null
  if (u.index) {
    const [size] = u.sizes
    if (u.sizes.size !== 1 || (size !== 2 && size !== 4) || view.byteStride) return null
    const count = view.byteLength / size
    if (!Number.isInteger(count)) return null
    return { mode: u.triangles && count % 3 === 0 ? 'TRIANGLES' : 'INDICES', stride: size, count }
  }
  let stride = view.byteStride
  if (!stride) stride = u.sizes.size === 1 ? [...u.sizes][0] : 4
  if (!stride || stride % 4 !== 0 || stride > 256) stride = 4
  const count = view.byteLength / stride
  if (!Number.isInteger(count)) return null
  return { mode: 'ATTRIBUTES', stride, count }
}

function encodeView(source, p) {
  const tryMode = mode => {
    const encoded = MeshoptEncoder.encodeGltfBuffer(source, p.count, p.stride, mode)
    const check = new Uint8Array(p.count * p.stride)
    MeshoptDecoder.decodeGltfBuffer(check, p.count, p.stride, encoded, mode)
    return Buffer.compare(Buffer.from(check), Buffer.from(source)) === 0 ? encoded : null
  }
  if (p.mode === 'TRIANGLES') {
    const encoded = tryMode('TRIANGLES')
    if (encoded) return { encoded, mode: 'TRIANGLES' }
    return { encoded: tryMode('INDICES'), mode: 'INDICES' }
  }
  return { encoded: tryMode(p.mode), mode: p.mode }
}

function compress(file, outFile = file) {
  const { json, bin, size } = readGlb(file)
  if ((json.extensionsUsed || []).includes(EXT)) return { file, skipped: 'already compressed', before: size, after: size }
  if (!bin || (json.buffers || []).length !== 1) return { file, skipped: 'not a single-buffer GLB', before: size, after: size }
  const usage = viewUsage(json)
  const parts = []
  let binLength = 0
  let fallbackLength = 0
  let packed = 0
  const place = bytes => {
    const at = binLength
    parts.push({ at, bytes })
    binLength = align4(at + bytes.length)
    return at
  }
  json.bufferViews.forEach((view, i) => {
    const source = new Uint8Array(bin.buffer, bin.byteOffset + (view.byteOffset || 0), view.byteLength)
    const p = plan(view, usage[i])
    const result = p ? encodeView(source, p) : null
    if (result && result.encoded && result.encoded.length + JSON_COST < view.byteLength * MIN_GAIN) {
      const at = place(result.encoded)
      const ext = { buffer: 0, byteOffset: at, byteLength: result.encoded.length, byteStride: p.stride, mode: result.mode, count: p.count }
      view.buffer = 1
      view.byteOffset = fallbackLength
      fallbackLength = align4(fallbackLength + view.byteLength)
      view.extensions = { ...(view.extensions || {}), [EXT]: ext }
      packed++
      return
    }
    view.byteOffset = place(source)
  })
  if (!packed) return { file, skipped: 'nothing worth packing', before: size, after: size }
  const out = Buffer.alloc(binLength)
  for (const { at, bytes } of parts) Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).copy(out, at)
  json.buffers = [{ byteLength: binLength }, { byteLength: fallbackLength, extensions: { [EXT]: { fallback: true } } }]
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), EXT])]
  json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), EXT])]
  const after = writeGlb(outFile, json, out)
  return { file, before: size, after, packed }
}

function decompress(file, outFile) {
  const { json, bin } = readGlb(file)
  if (!(json.extensionsUsed || []).includes(EXT)) {
    fs.copyFileSync(file, outFile)
    return
  }
  const parts = []
  let length = 0
  for (const view of json.bufferViews) {
    const ext = view.extensions && view.extensions[EXT]
    let bytes
    if (ext) {
      bytes = new Uint8Array(ext.count * ext.byteStride)
      MeshoptDecoder.decodeGltfBuffer(bytes, ext.count, ext.byteStride, new Uint8Array(bin.buffer, bin.byteOffset + (ext.byteOffset || 0), ext.byteLength), ext.mode, ext.filter)
      bytes = bytes.subarray(0, view.byteLength)
      delete view.extensions[EXT]
      if (!Object.keys(view.extensions).length) delete view.extensions
    } else {
      bytes = new Uint8Array(bin.buffer, bin.byteOffset + (view.byteOffset || 0), view.byteLength)
    }
    view.buffer = 0
    view.byteOffset = length
    parts.push({ at: length, bytes })
    length = align4(length + bytes.length)
  }
  const out = Buffer.alloc(length)
  for (const { at, bytes } of parts) Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).copy(out, at)
  json.buffers = [{ byteLength: length }]
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (!json[key]) continue
    json[key] = json[key].filter(name => name !== EXT)
    if (!json[key].length) delete json[key]
  }
  writeGlb(outFile, json, out)
}

function collect(target) {
  const stat = fs.statSync(target)
  if (stat.isFile()) return target.endsWith('.glb') ? [target] : []
  return fs.readdirSync(target).flatMap(name => collect(path.join(target, name)))
}

await MeshoptEncoder.ready
await MeshoptDecoder.ready
const args = process.argv.slice(2)
if (args[0] === '--decode') {
  if (args.length !== 3) {
    console.log('usage: node tools/meshopt_glb.mjs --decode <in.glb> <out.glb>')
    process.exit(1)
  }
  decompress(args[1], args[2])
  process.exit(0)
}
const targets = args
if (!targets.length) {
  console.log('usage: node tools/meshopt_glb.mjs <file.glb|dir> [...]')
  process.exit(1)
}
let before = 0
let after = 0
for (const file of targets.flatMap(collect)) {
  const r = compress(file)
  before += r.before
  after += r.after
  const note = r.skipped ? `skipped (${r.skipped})` : `${r.packed} views packed`
  console.log(`${path.relative(process.cwd(), file)}: ${(r.before / 1048576).toFixed(2)} MB -> ${(r.after / 1048576).toFixed(2)} MB, ${note}`)
}
console.log(`total: ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB`)
