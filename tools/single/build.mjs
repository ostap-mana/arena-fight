import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { build as viteBuild } from 'vite'
import { rolldown } from 'rolldown'
import { glbReady, shrinkGlb, parseGlb, Reader } from './glb.mjs'
import { encodeAnimations } from './anim.mjs'
import { encodeVfxMeshes } from './vfxmesh.js'
import { encodeImages, imageKind, cached, hash, python, ROOT, CACHE, kb, mb } from './util.mjs'
import { bytesToText, lzma } from './pack.mjs'
import { GLB, IMAGE, HUD, AUDIO, ALPHA_QUALITY, profileFor } from './profiles.mjs'
import { HEROES, TITANS, ENEMIES, WAVES } from '../../src/data/heroes.js'

const LIMIT = 5000000
const SMALL_IMAGE = Number(process.env.SMALL_IMAGE || 16384)
const PUBLIC = path.join(ROOT, 'public')
const OUT_DIR = path.join(ROOT, 'dist-single')
const OUT_NAME = 'invokers.html'
const APP_DIR = path.join(CACHE, 'app')
const BOOT_LIST = path.join(import.meta.dirname, 'boot.json')
const MIME = { glb: 'model/gltf-binary', json: 'application/json', mp3: 'audio/mpeg', woff2: 'font/woff2', js: 'text/javascript', css: 'text/css', avif: 'image/avif', webp: 'image/webp', png: 'image/png', svg: 'image/svg+xml' }
const report = new Map()
const started = Date.now()

const ext = file => path.extname(file).slice(1).toLowerCase()
const readPublic = file => fs.readFileSync(path.join(PUBLIC, file))
const tally = (group, before, after) => {
  const row = report.get(group) || { count: 0, before: 0, after: 0 }
  row.count++
  row.before += before
  row.after += after
  report.set(group, row)
}
const log = text => process.stdout.write(`${text}\n`)
const keyOf = value => JSON.stringify(value, (k, v) => (v instanceof RegExp ? v.toString() : v))

function manifest() {
  const list = new Set(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'manifest.json'), 'utf8')))
  const before = new Set()
  const after = new Set()
  const libs = []
  for (const file of [...list]) {
    const vfx = /^assets\/vfx\/(\w+)\.json$/.exec(file)
    if (!vfx) continue
    const lib = JSON.parse(readPublic(file))
    const pruned = vfx[1] === 'loot' ? lib : pruneVfx(lib, vfx[1], sourceText())
    libs.push(pruned)
    for (const t of Object.values(lib.textures || {})) before.add(`assets/vfx/${t.f}`)
    for (const t of Object.values(pruned.textures || {})) after.add(`assets/vfx/${t.f}`)
  }
  for (const tex of after) if (fs.existsSync(path.join(PUBLIC, tex))) list.add(tex)
  for (const tex of before) if (!after.has(tex)) list.delete(tex)
  const models = fxModels(libs)
  for (const file of [...list]) if (/^assets\/glb\/fx_\w+\.glb$/.test(file) && !models.has(file)) list.delete(file)
  return [...list].sort()
}

function roundNumbers(value, digits) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : Number(value.toPrecision(digits))
  if (Array.isArray(value)) return value.map(v => roundNumbers(v, digits))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = roundNumbers(v, digits)
    return out
  }
  return value
}

function strings(value, out = new Set()) {
  if (typeof value === 'string') out.add(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

const SKILL_TYPES = 4
const SCRIPT_SKILL = /^ActiveSkill(\d+)$/

function liveSkillTypes(hero) {
  return new Set([...hero.skills.map(s => s.fx), hero.ult && hero.ult.fx].filter(Boolean))
}

function liveSkills(lib, hero) {
  if (!hero || !lib.skills) return { skills: lib.skills, script: lib.script }
  const live = liveSkillTypes(hero)
  const skills = Object.fromEntries(Object.entries(lib.skills).filter(([type]) => Number(type) > SKILL_TYPES || live.has(Number(type))))
  if (!lib.script) return { skills, script: lib.script }
  const script = { ...lib.script }
  if (script.skills) {
    script.skills = Object.fromEntries(Object.entries(script.skills).filter(([key]) => {
      const slot = SCRIPT_SKILL.exec(key)
      return !slot || live.has(Number(slot[1]))
    }))
  }
  return { skills, script }
}

function pruneVfx(lib, code, source) {
  const hero = HEROES.find(h => h.vfx === code)
  const { skills, script } = liveSkills(lib, hero)
  const lobbySkins = !!hero && hero.lobbySkin !== false
  const used = new Set()
  for (const skill of Object.values(skills || {})) for (const e of skill.fx || []) used.add(e.fx)
  for (const name of strings({ ...(script || {}), models: {} })) used.add(name)
  for (const name of Object.keys(lib.prefabs)) {
    if (/^FX_/.test(name) && /Skin/.test(name) && !/LOB|Lobby|Trail|Intro/.test(name)) used.add(name)
    const socket = lib.lobbySockets && lib.lobbySockets[name]
    if (lobbySkins && socket && !socket.off && /Skin/.test(name)) used.add(name)
    if (source.includes(`'${name}'`)) used.add(name)
  }
  if (script && script.models) script.models = Object.fromEntries(Object.entries(script.models).filter(([name]) => used.has(name)))
  const prefabs = Object.fromEntries(Object.entries(lib.prefabs).filter(([name]) => used.has(name)))
  const refs = strings(prefabs, strings(script))
  const materials = Object.fromEntries(Object.entries(lib.materials || {}).filter(([name]) => refs.has(name)))
  const meshes = Object.fromEntries(Object.entries(lib.meshes || {}).filter(([name]) => refs.has(name)))
  const texRefs = strings(materials, refs)
  const textures = Object.fromEntries(Object.entries(lib.textures || {}).filter(([name]) => texRefs.has(name)))
  return { ...lib, skills, script, prefabs, materials, meshes, textures }
}

function fxModels(libs) {
  return new Set(libs.flatMap(lib => Object.values((lib.script && lib.script.models) || {}).map(spec => `assets/glb/${spec.model}.glb`)))
}

let vfxSource = null

function processJson(file) {
  const data = readPublic(file)
  let parsed = JSON.parse(data)
  const vfx = /^assets\/vfx\/(\w+)\.json$/.exec(file)
  if (vfx && vfx[1] !== 'loot') {
    vfxSource ??= sourceText()
    parsed = pruneVfx(parsed, vfx[1], vfxSource)
  }
  const entries = []
  if (vfx && vfx[1] !== 'loot' && parsed.meshes && Object.keys(parsed.meshes).length) {
    const blob = encodeVfxMeshes(parsed.meshes)
    parsed = { ...parsed, meshes: {} }
    tally('vfx-mesh', 0, blob.length)
    entries.push({ name: `${file}.mesh`, type: 'application/octet-stream', bytes: blob, packed: true })
  }
  const out = Buffer.from(JSON.stringify(/^assets\/vfx\//.test(file) ? roundNumbers(parsed, 4) : parsed))
  tally('json', data.length, out.length)
  entries.unshift({ name: file, type: MIME.json, bytes: out, packed: true })
  return entries
}

function processGlb(file) {
  const data = readPublic(file)
  const profile = profileFor(GLB, file)
  if (!profile) throw new Error(`no glb profile for ${file}`)
  const key = hash('glb9', data, keyOf(profile))
  const anim = profile.anim && /"animations"/.test(data.subarray(0, 20 + data.readUInt32LE(12)).toString('utf8'))
  const animFile = path.join(CACHE, `${key}.anim`)
  const out = cached(key, '.glb', () => {
    const reportAnim = { keys: [0, 0], droppedTracks: 0 }
    if (anim) {
      const { json, bin } = parseGlb(data)
      const blob = encodeAnimations(json, new Reader(json, bin), profile, reportAnim)
      fs.writeFileSync(animFile, blob || Buffer.alloc(0))
    }
    const { buffer, report: r } = shrinkGlb(data, anim ? { ...profile, skipAnimations: true } : profile)
    const keys = anim ? reportAnim.keys : r.keys
    log(`  glb ${file}: ${kb(r.before)} -> ${kb(r.after)} tris ${r.triangles.join('->')} keys ${keys.join('->')} images ${kb(r.images[0])}->${kb(r.images[1])}`)
    return buffer
  })
  const entries = [{ name: file, type: MIME.glb, bytes: out, packed: true }]
  tally('glb', data.length, out.length)
  if (anim && fs.existsSync(animFile) && fs.statSync(animFile).size) {
    const blob = fs.readFileSync(animFile)
    tally('anim', 0, blob.length)
    entries.push({ name: `${file}.anim`, type: 'application/octet-stream', bytes: blob, packed: true })
  }
  return entries
}

function processImages(files, table, group) {
  const jobs = files.map(file => {
    const profile = Array.isArray(table) ? profileFor(table, file.name) || {} : table
    return { data: file.data, format: 'webp', alpha_quality: ALPHA_QUALITY, ...profile }
  })
  const encoded = encodeImages(jobs)
  return files.map((file, i) => {
    let bytes = encoded[i]
    if (bytes.length >= file.data.length && imageKind(file.data) !== 'png') bytes = file.data
    tally(group, file.data.length, bytes.length)
    return { name: file.name, type: MIME[imageKind(bytes)], bytes, packed: bytes.length < SMALL_IMAGE }
  })
}

function heroSkillSound(code, rest) {
  const slot = /^skill_(\d+)$/.exec(rest)
  const hero = HEROES.find(h => h.model === code)
  return !!slot && !!hero && Number(slot[1]) <= hero.skills.length
}

function soundKeys(bank, sourceText) {
  const heroes = HEROES.map(h => h.model)
  const titans = [...new Set(HEROES.map(h => TITANS[h.titan].model))]
  const foes = [...new Set(WAVES.flatMap(w => w.spawns.map(([type]) => ENEMIES[type])))]
  const enemies = foes.filter(e => !e.boss).map(e => e.sfx || e.model)
  const boss = foes.filter(e => e.boss).map(e => e.sfx || e.model)
  const literal = key => sourceText.includes(`'${key}'`)
  const emitted = new Set(Object.values(bank.emitters || {}))
  return key => {
    const code = key.split('_')[0]
    const rest = key.slice(code.length + 1)
    if (literal(key) || emitted.has(key)) return true
    if (heroes.includes(code)) return /^(intro|attack_\d+|ult|hit_combo|damage|death)$/.test(rest) || heroSkillSound(code, rest)
    if (titans.includes(code)) return /^(summon_vo|attack_\d+|skill_\d+|hit_combo|damage|death|morph|demorph)$/.test(rest)
    if (enemies.includes(code)) return /^(attack_\d+|take_damage|damage|death|hit_combo)$/.test(rest)
    if (boss.includes(code)) return /^(attack_\d+|skill_\d+|ult|take_damage|damage|death|hit_combo)$/.test(rest)
    return /^(step_ground|step_big_anima_bosses|dash|freeze|mob_spawn)$/.test(key)
  }
}

function sourceText() {
  const files = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.js$/.test(entry.name)) files.push(fs.readFileSync(full, 'utf8'))
    }
  }
  walk(path.join(ROOT, 'src'))
  return files.join('\n')
}

function processAudio(list) {
  const bank = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/sounds.json'), 'utf8'))
  const keep = soundKeys(bank, sourceText())
  const job = { rate: AUDIO.rate, music: [], sprites: [] }
  const outputs = []
  const capFor = key => (AUDIO.sfx.caps.find(([pattern]) => pattern.test(key)) || [null, AUDIO.sfx.cap])[1]
  const source = file => {
    const mp3 = file.replace(/\.m4a$/, '.mp3')
    return fs.existsSync(path.join(PUBLIC, mp3)) ? mp3 : file
  }
  const groups = {}
  for (const [name, group] of Object.entries(bank.groups)) {
    const keys = Object.entries(group.sprite).filter(([key]) => keep(key.split('#')[0]) && Number(key.split('#')[1] || 0) < (AUDIO.sfx.variants || 99))
    keys.sort((a, b) => a[1][0] - b[1][0])
    groups[name] = keys.map(([key]) => key)
    const src = source(group.src)
    const out = path.join(CACHE, `${hash('sprite3', readPublic(src), keyOf([keys, AUDIO.sfx, AUDIO.rate]))}.mp3`)
    job.sprites.push({ src: path.join(PUBLIC, src), out, keys: keys.map(([key, [start, dur]]) => [key, start, dur, capFor(key.split('#')[0])]), codec: AUDIO.sfx.codec, floor: AUDIO.sfx.floor, gap: AUDIO.sfx.gap, group: name, name: group.src.replace(/\.m4a$/, '.mp3') })
  }
  const loose = [...new Set(list.filter(f => /^assets\/audio\/[^/]+\.(m4a|mp3)$/.test(f)).map(f => f.replace(/\.m4a$/, '.mp3')))]
  const aliases = AUDIO.aliases || {}
  for (const file of loose.filter(f => !aliases[path.basename(f, '.mp3')])) {
    const base = path.basename(file, '.mp3')
    const spec = AUDIO.music[base] || { length: 1e9, codec: AUDIO.oneShot.codec }
    const src = source(file)
    const out = path.join(CACHE, `${hash('music5', readPublic(src), keyOf([spec, AUDIO.rate]))}.mp3`)
    job.music.push({ ...spec, length: spec.length, src: path.join(PUBLIC, src), out, name: file })
  }
  const todo = { rate: job.rate, music: job.music.filter(m => !fs.existsSync(m.out)), sprites: job.sprites.filter(s => !fs.existsSync(s.out) || !fs.existsSync(`${s.out}.json`)) }
  for (const m of todo.music) {
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', m.src]).toString().trim())
    m.length = Math.min(m.length, seconds - (m.xfade || 0))
  }
  if (todo.music.length || todo.sprites.length) {
    const jobFile = path.join(CACHE, `audio-${process.pid}.json`)
    fs.writeFileSync(jobFile, JSON.stringify(todo))
    const result = JSON.parse(execFileSync(python(), [path.join(import.meta.dirname, 'audio.py'), jobFile], { maxBuffer: 64 << 20 }).toString())
    fs.rmSync(jobFile)
    for (const s of result.sprites) fs.writeFileSync(`${s.out}.json`, JSON.stringify(s.sprite))
  }
  for (const s of job.sprites) {
    const sprite = JSON.parse(fs.readFileSync(`${s.out}.json`, 'utf8'))
    bank.groups[s.group].sprite = sprite
    const bytes = fs.readFileSync(s.out)
    tally('audio-sfx', readPublic(source(bank.groups[s.group].src)).length, bytes.length)
    outputs.push({ name: s.name, type: MIME.mp3, bytes, packed: false })
  }
  const kept = new Set(Object.values(groups).flat().map(k => k.split('#')[0]))
  for (const key of Object.keys(bank.sounds)) if (!kept.has(key)) delete bank.sounds[key]
  for (const [key, s] of Object.entries(bank.sounds)) {
    s.n = Object.keys(bank.groups[s.g].sprite).filter(k => k.split('#')[0] === key).length
    delete s.event
    delete s.len
  }
  for (const m of job.music) {
    const bytes = fs.readFileSync(m.out)
    tally('audio-music', readPublic(source(m.name)).length, bytes.length)
    outputs.push({ name: m.name, type: MIME.mp3, bytes, packed: false })
  }
  for (const [alias, target] of Object.entries(aliases)) {
    const hit = outputs.find(o => o.name === `assets/audio/${target}.mp3`)
    if (hit) outputs.push({ ...hit, name: `assets/audio/${alias}.mp3`, alias: true })
  }
  return { files: outputs, bank }
}

async function buildApp(bank) {
  fs.rmSync(APP_DIR, { recursive: true, force: true })
  const sounds = path.join(ROOT, 'src', 'data', 'sounds.json')
  const result = await viteBuild({
    configFile: false,
    root: ROOT,
    base: './',
    logLevel: 'warn',
    publicDir: false,
    plugins: [{
      name: 'single-sounds',
      enforce: 'pre',
      load(id) {
        if (path.resolve(id.split('?')[0]) === sounds) return JSON.stringify(bank)
        return null
      },
    }],
    build: {
      outDir: APP_DIR,
      emptyOutDir: true,
      target: 'es2020',
      assetsInlineLimit: 0,
      modulePreload: false,
      cssCodeSplit: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 100000,
      write: false,
    },
    experimental: {
      renderBuiltUrl(filename, { hostType }) {
        if (hostType === 'js') return { runtime: `window.__ASSET(${JSON.stringify(filename)})` }
        if (hostType === 'css') return `__ASSET__/${filename}`
        return filename
      },
    },
  })
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(r => r.output)
  const chunks = outputs.filter(o => o.type === 'chunk')
  if (chunks.length !== 1) throw new Error(`expected one js chunk, got ${chunks.map(c => c.fileName).join(', ')}`)
  const css = outputs.filter(o => o.type === 'asset' && o.fileName.endsWith('.css'))
  const assets = outputs.filter(o => o.type === 'asset' && !o.fileName.endsWith('.css') && !o.fileName.endsWith('.html'))
  const code = chunks[0].code
  if (/import\.meta\.url/.test(code)) log('  warning: app code uses import.meta.url')
  return { js: Buffer.from(code), css: Buffer.from(css.map(c => c.source).join('\n')), assets: assets.map(a => ({ name: a.fileName, data: Buffer.from(a.source) })) }
}

async function bundleScript(file) {
  const bundle = await rolldown({ input: path.join(import.meta.dirname, file), logLevel: 'warn' })
  const { output } = await bundle.generate({ format: 'iife', minify: true })
  await bundle.close()
  const code = output[0].code.trim()
  if (/<\/script/i.test(code)) throw new Error(`${file} contains a closing script tag`)
  return code
}

function bootSet() {
  return new Set(fs.existsSync(BOOT_LIST) ? JSON.parse(fs.readFileSync(BOOT_LIST, 'utf8')) : [])
}

function splitTiers(files, boot) {
  const parentOf = name => name.replace(/\.(anim|mesh)$/, '')
  const early = f => f.boot || boot.has(parentOf(f.name))
  const bootHashes = new Set(files.filter(early).map(f => hash(f.bytes)))
  const first = files.filter(f => early(f) || bootHashes.has(hash(f.bytes)))
  const rest = files.filter(f => !first.includes(f))
  return rest.length ? [first, rest] : [first]
}

function packAll(files) {
  const index = []
  const storedParts = []
  const packedParts = []
  const seen = new Map()
  let storedAt = 0
  let packedAt = 0
  const place = f => {
    const key = `${f.packed ? 1 : 0}:${hash(f.bytes)}`
    if (seen.has(key)) return seen.get(key)
    let at
    if (f.packed) {
      at = packedAt
      packedParts.push(f.bytes)
      packedAt += f.bytes.length
    } else {
      at = storedAt
      storedParts.push(f.bytes)
      storedAt += f.bytes.length
    }
    seen.set(key, at)
    return at
  }
  const order = [...files].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type.localeCompare(b.type)))
  for (const f of order) index.push([f.name, f.type, f.packed ? 1 : 0, place(f), f.bytes.length])
  const indexBytes = Buffer.from(JSON.stringify(index))
  const head = Buffer.alloc(4)
  head.writeUInt32LE(indexBytes.length)
  const raw = Buffer.concat([head, indexBytes, ...packedParts])
  if (process.env.DUMP) fs.writeFileSync(path.join(process.env.DUMP, 'raw.bin'), raw)
  const { data: lz, props } = lzma(raw, { lc: 3, lp: 0, pb: 0 })
  const bin = Buffer.concat([...storedParts, lz])
  return { bin, storedLength: storedAt, rawLength: raw.length, lzLength: lz.length, props }
}

function dataUri(file, data) {
  return `data:${MIME[imageKind(data)]};base64,${data.toString('base64')}`
}

function composeHtml(packs, runtime, worker, logos) {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n')
  const head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'))
  let body = src.slice(src.indexOf('<body>') + 6, src.indexOf('</body>'))
  body = body.replace(/\s*<script type="module" src="\/src\/main\.js"><\/script>/, '')
  for (const [file, data] of Object.entries(logos)) body = body.split(`src="${file}"`).join(`src="${dataUri(file, data)}"`)
  const packTag = (pack, tier) => {
    const tiers = tier === 0 ? ` data-tiers="${packs.length}"` : ''
    return `<script id="pack${tier}" type="text/plain"${tiers} data-n="${pack.bin.length}" data-s="${pack.storedLength}" data-u="${pack.rawLength}" data-p="${pack.props}">${bytesToText(pack.bin)}</script>`
  }
  const later = packs.slice(1).flatMap((pack, i) => [packTag(pack, i + 1), `<script>window.__SINGLE_FEED&&window.__SINGLE_FEED(${i + 1})</script>`])
  const parts = ['<!doctype html>\n<html lang="en">\n<head>', head.trim(), '<link rel="icon" href="data:,">', '</head>\n<body>', body.trim(), `<script id="lzw" type="text/plain">${worker}</script>`, packTag(packs[0], 0), `<script>${runtime}</script>`, ...later, '</body>\n</html>\n']
  let html = parts.join('\n')
  const build = { buildId: createHash('sha256').update(html).digest('hex').slice(0, 12), commit: commit(), tuneHash: tuneHash(), at: new Date().toISOString() }
  html = html.replace(/window\.__BUILD=\{[^\n]*?\};/, `window.__BUILD=${JSON.stringify(build)};`)
  return { html, build }
}

function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

function tuneHash() {
  const h = createHash('sha256')
  for (const file of ['src/data/heroes.js', 'src/data/builds.js']) h.update(fs.readFileSync(path.join(ROOT, file)))
  return h.digest('hex').slice(0, 4)
}

async function main() {
  await glbReady
  const list = manifest()
  log(`assets: ${list.length}`)
  const files = []
  const audio = processAudio(list)
  files.push(...audio.files)
  for (const file of list.filter(f => ext(f) === 'json')) files.push(...processJson(file))
  for (const file of list.filter(f => ext(f) === 'glb')) files.push(...processGlb(file))
  const images = list.filter(f => ['webp', 'png'].includes(ext(f)) && !f.startsWith('assets/img/'))
  files.push(...processImages(images.map(name => ({ name, data: readPublic(name) })), IMAGE, 'images'))
  const app = await buildApp(audio.bank)
  tally('app-js', app.js.length, app.js.length)
  tally('app-css', app.css.length, app.css.length)
  files.push({ name: 'app.js', type: MIME.js, bytes: app.js, packed: true, boot: true })
  files.push({ name: 'app.css', type: MIME.css, bytes: app.css, packed: true, boot: true })
  const hudImages = app.assets.filter(a => /\.(webp|png)$/.test(a.name))
  files.push(...processImages(hudImages, HUD, 'hud').map(f => ({ ...f, boot: true })))
  for (const a of app.assets.filter(a => !/\.(webp|png)$/.test(a.name))) {
    tally(`app-${ext(a.name)}`, a.data.length, a.data.length)
    files.push({ name: a.name, type: MIME[ext(a.name)] || 'application/octet-stream', bytes: a.data, packed: !/\.(woff2|mp3)$/.test(a.name), boot: true })
  }
  const logoFiles = ['assets/img/logo_base.webp', 'assets/img/logo_ring.webp']
  const logos = Object.fromEntries(processImages(logoFiles.map(name => ({ name, data: readPublic(name) })), IMAGE, 'logo').map(f => [f.name, f.bytes]))
  if (process.env.TOP) {
    const top = [...files].sort((a, b) => b.bytes.length - a.bytes.length).slice(0, Number(process.env.TOP))
    for (const f of top) log(`${kb(f.bytes.length).padStart(7)} ${f.packed ? 'lz' : '  '} ${f.name}`)
  }
  if (process.env.DUMP) {
    const groups = {}
    for (const f of files.filter(f => f.packed)) {
      const g = f.name.endsWith('.anim') ? 'anim' : f.name.endsWith('.glb') ? 'glb' : f.name.endsWith('.json') ? 'json' : f.name.endsWith('.mesh') ? 'mesh' : 'app'
      ;(groups[g] ||= []).push(f.bytes)
    }
    fs.mkdirSync(process.env.DUMP, { recursive: true })
    for (const [g, parts] of Object.entries(groups)) fs.writeFileSync(path.join(process.env.DUMP, `${g}.bin`), Buffer.concat(parts))
  }
  const packs = splitTiers(files, bootSet()).map(packAll)
  const runtime = await bundleScript('runtime.js')
  const worker = await bundleScript('worker.js')
  const { html, build } = composeHtml(packs, runtime, worker, logos)
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const out = path.join(OUT_DIR, OUT_NAME)
  fs.writeFileSync(out, html)
  const size = Buffer.byteLength(html)
  const rows = [...report.entries()].sort((a, b) => b[1].after - a[1].after)
  log('\ngroup            files      before       after')
  for (const [group, r] of rows) log(`${group.padEnd(16)} ${String(r.count).padStart(5)} ${mb(r.before).padStart(11)} ${mb(r.after).padStart(11)}`)
  packs.forEach((pack, i) => log(`${i ? 'later' : '\nfirst'}: stored ${mb(pack.storedLength)}  packed raw ${mb(pack.rawLength)} -> lzma ${mb(pack.lzLength)}  binary ${mb(pack.bin.length)}`))
  log(`html ${size} bytes (${mb(size)}) ${size <= LIMIT ? 'UNDER' : 'OVER'} the 5,000,000 byte limit  build ${build.buildId}  ${((Date.now() - started) / 1000).toFixed(0)}s`)
  log(out)
  if (size > LIMIT) process.exitCode = 2
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
