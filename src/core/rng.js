const SEED = (() => {
  const given = globalThis.__SEED
  const rolled = (Math.random() * 0x100000000) >>> 0
  const s = (given != null ? Number(given) : rolled) >>> 0
  return s || 1
})()

globalThis.__SEED = SEED

export function seed() {
  return SEED
}

function mix(a, b) {
  let h = (a ^ Math.imul(b ^ (b >>> 15), 0x2545f491)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0 || 1
}

function label(name) {
  let h = 0x811c9dc5
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0
  return h >>> 0
}

export function stream(name) {
  let state = mix(SEED, label(name))
  return function next() {
    state ^= state << 13
    state >>>= 0
    state ^= state >> 17
    state ^= state << 5
    state >>>= 0
    return state / 4294967296
  }
}
