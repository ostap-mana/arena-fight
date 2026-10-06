export const UNSAFE = [0, 13, 60]

export function textToBytes(text, length) {
  const out = new Uint8Array(length)
  const n = text.length
  let acc = 0
  let bits = 0
  let at = 0
  for (let i = 0; i < n && at < length; i++) {
    const c = text.charCodeAt(i)
    if (c < 128) {
      acc = (acc << 7) | c
      bits += 7
    } else {
      const t = c - 128
      acc = (acc << 16) | (UNSAFE[t >> 9] << 9) | (t & 511)
      bits += 16
    }
    while (bits >= 8 && at < length) {
      bits -= 8
      out[at++] = (acc >> bits) & 255
    }
    acc &= (1 << bits) - 1
  }
  return out
}

export function lzmaDecode(src, at, outSize, props) {
  const lc = props % 9
  const lp = ((props / 9) | 0) % 5
  const pb = (props / 45) | 0
  const out = new Uint8Array(outSize)
  const LIT = 1847
  const probs = new Uint16Array(LIT + (768 << (lc + lp))).fill(1024)
  const IS_MATCH = 0
  const IS_REP = 192
  const IS_REP_G0 = 204
  const IS_REP_G1 = 216
  const IS_REP_G2 = 228
  const IS_REP0_LONG = 240
  const POS_SLOT = 432
  const POS_DEC = 688
  const ALIGN = 803
  const LEN = 819
  const REP_LEN = 1333
  const pbMask = (1 << pb) - 1
  const lpMask = (1 << lp) - 1
  let pos = at + 1
  let range = 0xffffffff
  let code = 0
  for (let i = 0; i < 4; i++) code = ((code << 8) | src[pos++]) >>> 0

  function bit(i) {
    const p = probs[i]
    const bound = (range >>> 11) * p
    let b
    if (code < bound) {
      range = bound
      probs[i] = p + ((2048 - p) >>> 5)
      b = 0
    } else {
      range -= bound
      code -= bound
      probs[i] = p - (p >>> 5)
      b = 1
    }
    if (range < 16777216) {
      range = (range << 8) >>> 0
      code = ((code << 8) | src[pos++]) >>> 0
    }
    return b
  }

  function tree(base, count) {
    let m = 1
    for (let i = 0; i < count; i++) m = (m << 1) | bit(base + m)
    return m - (1 << count)
  }

  function reverse(base, count) {
    let m = 1
    let s = 0
    for (let i = 0; i < count; i++) {
      const b = bit(base + m)
      m = (m << 1) | b
      s |= b << i
    }
    return s
  }

  function direct(count) {
    let s = 0
    for (let i = 0; i < count; i++) {
      range = range >>> 1
      let b = 0
      if (code >= range) {
        code -= range
        b = 1
      }
      s = s * 2 + b
      if (range < 16777216) {
        range = (range << 8) >>> 0
        code = ((code << 8) | src[pos++]) >>> 0
      }
    }
    return s
  }

  function length(base, posState) {
    if (!bit(base)) return tree(base + 2 + (posState << 3), 3)
    if (!bit(base + 1)) return 8 + tree(base + 130 + (posState << 3), 3)
    return 16 + tree(base + 258, 8)
  }

  let state = 0
  let rep0 = 0
  let rep1 = 0
  let rep2 = 0
  let rep3 = 0
  let o = 0
  while (o < outSize) {
    const posState = o & pbMask
    if (!bit(IS_MATCH + (state << 4) + posState)) {
      const prev = o > 0 ? out[o - 1] : 0
      const base = LIT + 768 * (((o & lpMask) << lc) + (prev >>> (8 - lc)))
      let s = 1
      if (state >= 7) {
        let match = out[o - rep0 - 1]
        while (s < 256) {
          const mb = (match >>> 7) & 1
          match <<= 1
          const b = bit(base + ((1 + mb) << 8) + s)
          s = (s << 1) | b
          if (mb !== b) break
        }
      }
      while (s < 256) s = (s << 1) | bit(base + s)
      out[o++] = s & 255
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      continue
    }
    let len
    if (bit(IS_REP + state)) {
      if (!bit(IS_REP_G0 + state)) {
        if (!bit(IS_REP0_LONG + (state << 4) + posState)) {
          state = state < 7 ? 9 : 11
          out[o] = out[o - rep0 - 1]
          o++
          continue
        }
      } else {
        let dist
        if (!bit(IS_REP_G1 + state)) dist = rep1
        else {
          if (!bit(IS_REP_G2 + state)) dist = rep2
          else {
            dist = rep3
            rep3 = rep2
          }
          rep2 = rep1
        }
        rep1 = rep0
        rep0 = dist
      }
      len = length(REP_LEN, posState)
      state = state < 7 ? 8 : 11
    } else {
      rep3 = rep2
      rep2 = rep1
      rep1 = rep0
      len = length(LEN, posState)
      state = state < 7 ? 7 : 10
      const slot = tree(POS_SLOT + ((len > 3 ? 3 : len) << 6), 6)
      if (slot < 4) rep0 = slot
      else {
        const n = (slot >>> 1) - 1
        let dist = (2 | (slot & 1)) * (1 << n)
        if (slot < 14) dist += reverse(POS_DEC + dist - slot, n)
        else dist += direct(n - 4) * 16 + reverse(ALIGN, 4)
        rep0 = dist
      }
      if (rep0 >= o) break
    }
    let from = o - rep0 - 1
    const end = Math.min(o + len + 2, outSize)
    while (o < end) out[o++] = out[from++]
  }
  return out
}
