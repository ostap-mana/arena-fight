import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { UNSAFE } from './codec.js'
import { CACHE, hash, python } from './util.mjs'

export function bytesToText(bytes) {
  const parts = []
  let chunk = ''
  let acc = 0
  let bits = 0
  let i = 0
  const n = bytes.length
  const take = width => {
    while (bits < width && i < n) {
      acc = (acc << 8) | bytes[i++]
      bits += 8
    }
    if (bits === 0) return -1
    if (bits < width) {
      acc <<= width - bits
      bits = width
    }
    bits -= width
    const v = (acc >> bits) & ((1 << width) - 1)
    acc &= (1 << bits) - 1
    return v
  }
  for (;;) {
    const v = take(7)
    if (v < 0) break
    const unsafe = UNSAFE.indexOf(v)
    if (unsafe < 0) chunk += String.fromCharCode(v)
    else {
      const w = take(9)
      chunk += String.fromCharCode(128 + unsafe * 512 + (w < 0 ? 0 : w))
    }
    if (chunk.length > 65536) {
      parts.push(chunk)
      chunk = ''
    }
  }
  parts.push(chunk)
  return parts.join('')
}

export function lzma(data, { lc = 3, lp = 0, pb = 0 } = {}) {
  const key = hash('lzma2', data, [lc, lp, pb])
  const out = path.join(CACHE, `${key}.lzma`)
  if (!fs.existsSync(out)) {
    const src = path.join(CACHE, `${key}.raw`)
    fs.writeFileSync(src, data)
    execFileSync(python(), [path.join(import.meta.dirname, 'lzma_pack.py'), src, out, String(lc), String(lp), String(pb)], { stdio: 'inherit' })
    fs.rmSync(src)
  }
  return { data: fs.readFileSync(out), props: (pb * 5 + lp) * 9 + lc }
}
