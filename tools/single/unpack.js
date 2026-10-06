import { textToBytes, lzmaDecode } from './codec.js'
import { decodeAnimations, mergeAnimations } from './glbmerge.js'
import { mergeVfxMeshes } from './vfxmesh.js'

export const SIDECARS = ['.anim', '.mesh']

export function decodePack(text, info) {
  const bin = textToBytes(text, info.n)
  const raw = lzmaDecode(bin, info.s, info.u, info.p)
  return { bin, raw }
}

export function readPack(bin, raw) {
  const indexLength = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24)
  const index = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + indexLength)))
  const base = 4 + indexLength
  const files = new Map()
  for (const [name, type, packed, offset, length] of index) {
    const bytes = packed ? raw.subarray(base + offset, base + offset + length) : bin.subarray(offset, offset + length)
    files.set(name, { type, bytes })
  }
  return files
}

export function needsMerge(files, name) {
  return SIDECARS.some(ext => files.has(name + ext))
}

export function merge(files, name) {
  let bytes = files.get(name).bytes
  const anim = files.get(`${name}.anim`)
  if (anim) bytes = mergeAnimations(bytes, decodeAnimations(anim.bytes))
  const mesh = files.get(`${name}.mesh`)
  if (mesh) bytes = mergeVfxMeshes(bytes, mesh.bytes)
  return bytes
}
