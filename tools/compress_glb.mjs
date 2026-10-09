import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { shrinkGlb, parseGlb, packGlb, glbReady, Reader } from './single/glb.mjs'
import { python } from './single/util.mjs'

const MARK = 'compress_glb/1'
const FRAME_RATES = [15, 24, 25, 30, 48, 50, 60]
const FALLBACK_FPS = 60
const ON_FRAME = 0.02
const WEBP = 'EXT_texture_webp'
const TEXTURE_TOOL = path.join(import.meta.dirname, 'glb_textures.py')
const align4 = n => (n + 3) & ~3

const ANIM = { rotationBits: 14, translationBits: 16, constantRotation: 0.0004, constantValue: 0.0002, dropRest: true }
const MESH = { positionBits: 16, uvBits: 16, dropTangents: false }
const CHARACTER = { ...ANIM, ...MESH, pruneJoints: true }
const BATTLE_MAPS = { normal: { max: 512, bits: 6 } }

const PROFILES = [
  [/_lob(_m)?\.glb$/, { ...CHARACTER, rotationBits: 16, keepClips: /^(Idle|IdleLOB|IntroLOB|IdleBreakLOB_\d+)$/ }],
  [/^(eld037|mag018|eld025)\.glb$/, { ...CHARACTER, ...BATTLE_MAPS, dropClips: /^(Shock|Freeze|Walk|Skill_3_PreCast|Skill_3_EndCast)$/ }],
  [/^anim\w+\.glb$/, { ...CHARACTER, ...BATTLE_MAPS, dropClips: /LOB$|^Girl_anim$|^FX_A_/ }],
  [/^dem\d+\.glb$/, { ...CHARACTER, ...BATTLE_MAPS, rotationBits: 12, color: { max: 512, quality: 90 }, keepClips: /^(Idle|Run|ComboAttack_\d+|Flinch|Death(_\d+)?)$/ }],
  [/^sakiel\.glb$/, { ...CHARACTER, ...BATTLE_MAPS, dropClips: /LOB$|^IdleBreak|^IdleIn$|^Walk$/ }],
  [/^sakiel_wings\.glb$/, { ...CHARACTER, ...BATTLE_MAPS, pruneJoints: false, dropRest: false }],
  [/^fx_\w+\.glb$/, { ...CHARACTER }],
  [/^loot\.glb$/, { ...MESH, ...BATTLE_MAPS }],
  [/^spire_\w+\.glb$/, { ...MESH }],
]

function profileFor(file) {
  const hit = PROFILES.find(([pattern]) => pattern.test(path.basename(file)))
  return hit ? hit[1] : null
}

function clipRate(anim, src) {
  const times = anim.samplers.flatMap(sampler => Array.from(src.floats(sampler.input)))
  return FRAME_RATES.find(fps => times.every(t => Math.abs(t * fps - Math.round(t * fps)) < ON_FRAME)) || FALLBACK_FPS
}

function clipAware(profile, json, src) {
  const rates = new Map((json.animations || []).map(anim => [anim.name || '', clipRate(anim, src)]))
  const drop = profile.dropClips
  let current = ''
  const watch = {
    test(name) {
      current = name
      return drop ? drop.test(name) : false
    },
  }
  return {
    ...profile,
    dropClips: watch,
    get fps() {
      return rates.get(current) || FALLBACK_FPS
    },
    rates,
  }
}

function imageRoles(json) {
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
  }
  return roles
}

function textureJob(role, profile) {
  if (role === 'normal' && profile.normal) return { normal: true, ...profile.normal }
  if (role === 'color' && profile.color) return { ...profile.color }
  return null
}

function takeImages(json, bin, profile) {
  const src = new Reader(json, bin)
  const roles = imageRoles(json)
  const images = (json.images || []).map((image, i) => ({ image, bytes: src.image(i), job: textureJob(roles.get(i), profile) }))
  json.images = []
  const pending = images.filter(entry => entry.job)
  if (pending.length) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glbtex-'))
    const jobs = pending.map((entry, i) => {
      const src = path.join(dir, `${i}.in`)
      fs.writeFileSync(src, entry.bytes)
      return { ...entry.job, src, out: path.join(dir, `${i}.out`) }
    })
    const run = spawnSync(python(), [TEXTURE_TOOL], { input: JSON.stringify(jobs), encoding: 'utf8' })
    if (run.status !== 0) throw new Error(`glb_textures.py failed: ${run.stderr}`)
    pending.forEach((entry, i) => (entry.bytes = fs.readFileSync(jobs[i].out)))
    fs.rmSync(dir, { recursive: true, force: true })
  }
  return images
}

function putImages(buffer, images) {
  if (!images.length) return buffer
  const { json, bin } = parseGlb(buffer)
  const parts = [bin]
  let length = bin.length
  json.images = images.map(({ image, bytes }) => {
    const pad = align4(length) - length
    if (pad) parts.push(Buffer.alloc(pad))
    length += pad
    json.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length })
    parts.push(bytes)
    length += bytes.length
    const next = { ...image, bufferView: json.bufferViews.length - 1, mimeType: 'image/webp' }
    delete next.uri
    return next
  })
  const tail = align4(length) - length
  if (tail) parts.push(Buffer.alloc(tail))
  json.buffers[0].byteLength = align4(length)
  return packGlb(json, Buffer.concat(parts))
}

export function compress(buffer, file) {
  const profile = profileFor(file)
  if (!profile) return { skipped: 'no profile' }
  const { json, bin } = parseGlb(buffer)
  if (json.asset?.extras?.compressed === MARK) return { skipped: 'already compressed' }
  const aware = clipAware(profile, json, new Reader(json, bin))
  const images = takeImages(json, bin, profile)
  const { buffer: shrunk, report } = shrinkGlb(packGlb(json, bin), aware)
  const out = parseGlb(putImages(shrunk, images))
  out.json.asset = { ...out.json.asset, extras: { ...(out.json.asset?.extras || {}), compressed: MARK } }
  return { buffer: packGlb(out.json, out.bin), report, rates: aware.rates }
}

function collect(target) {
  const stat = fs.statSync(target)
  if (stat.isFile()) return target.endsWith('.glb') ? [target] : []
  return fs.readdirSync(target).flatMap(name => collect(path.join(target, name)))
}

function rateSummary(rates) {
  const counts = new Map()
  for (const fps of rates.values()) counts.set(fps, (counts.get(fps) || 0) + 1)
  return [...counts].map(([fps, n]) => `${n}x${fps}`).join(' ') || 'no clips'
}

async function main() {
  await glbReady
  const args = process.argv.slice(2)
  const outAt = args.indexOf('--out')
  const outDir = outAt >= 0 ? args.splice(outAt, 2)[1] : null
  if (!args.length) {
    console.log('usage: node tools/compress_glb.mjs [--out dir] <file.glb|dir> [...]')
    process.exit(1)
  }
  let before = 0
  let after = 0
  for (const file of args.flatMap(collect)) {
    const input = fs.readFileSync(file)
    const result = compress(input, file)
    const name = path.relative(process.cwd(), file)
    if (result.skipped) {
      console.log(`${name}: skipped (${result.skipped})`)
      continue
    }
    const target = outDir ? path.join(outDir, path.basename(file)) : file
    if (outDir) fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(target, result.buffer)
    before += input.length
    after += result.buffer.length
    const r = result.report
    const clips = r.droppedClips.length ? `, dropped ${r.droppedClips.join(' ')}` : ''
    console.log(`${name}: ${(input.length / 1024).toFixed(0)} KB -> ${(result.buffer.length / 1024).toFixed(0)} KB, fps ${rateSummary(result.rates)}, keys ${r.keys[0]} -> ${r.keys[1]}, rest tracks ${r.droppedTracks}${clips}`)
  }
  console.log(`total: ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) await main()
