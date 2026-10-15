import http from 'node:http'
import fs from 'node:fs'
import { chromium } from 'playwright'

const file = process.argv[2]
const html = fs.readFileSync(file)
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(html) })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const problems = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()) })
page.on('pageerror', e => problems.push('pageerror ' + e.message))

await page.addInitScript(() => {
  let hidden = false
  Object.defineProperty(Document.prototype, 'hidden', { get: () => hidden })
  Object.defineProperty(Document.prototype, 'visibilityState', { get: () => (hidden ? 'hidden' : 'visible') })
  window.__setHidden = h => { hidden = h; document.dispatchEvent(new Event('visibilitychange')) }
  window.__iosGate = false
  const realResume = AudioContext.prototype.resume
  AudioContext.prototype.resume = function () {
    if (window.__iosGate && !navigator.userActivation.isActive) return new Promise(() => {})
    return realResume.call(this)
  }
  window.__osResume = () => { window.__iosGate = false; return realResume.call(Howler.ctx) }
  const blocks = []
  const raw = []
  window.__blocks = blocks
  window.__raw = raw
  window.__rate = () => Howler.ctx.sampleRate
  let tapped = null
  let proc = null
  const tap = () => {
    if (!window.Howler || !Howler.masterGain || Howler.masterGain === tapped) return
    tapped = Howler.masterGain
    const ctx = Howler.ctx
    const code = `class Cap extends AudioWorkletProcessor { constructor() { super(); this.buf = new Float32Array(1024); this.n = 0 } process(inputs) { if (this.n && currentTime - this.last > 0.01) { this.port.postMessage({ L: this.buf.slice(0, this.n), ct: this.ct }); this.n = 0 } this.last = currentTime; if (!this.n) this.ct = currentTime; const ch = inputs[0] && inputs[0][0]; if (ch) { this.buf.set(ch, this.n); this.n += ch.length } else { this.buf.fill(0, this.n, this.n + 128); this.n += 128 } if (this.n >= 1024) { this.port.postMessage({ L: this.buf.slice(), ct: this.ct }); this.n = 0 } return true } } registerProcessor('cap', Cap)`
    const modUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
    const gainNode = tapped
    ctx.audioWorklet.addModule(modUrl).then(() => {
      proc = new AudioWorkletNode(ctx, 'cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      const sink = ctx.createGain()
      sink.gain.value = 0
      proc.port.onmessage = e => {
        const L = e.data.L
        let peak = 0, sq = 0
        for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]); if (a > peak) peak = a; sq += L[i] * L[i] }
        blocks.push({ t: performance.now(), ct: e.data.ct, peak, rms: Math.sqrt(sq / L.length), i: raw.length })
        raw.push(L)
      }
      gainNode.connect(proc)
      proc.connect(sink)
      sink.connect(ctx.destination)
    })
  }
  setInterval(tap, 50)
  const N = 1024
  const re = new Float64Array(N), im = new Float64Array(N)
  window.hfOf = L => {
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)); re[i] = (L[i] || 0) * w; im[i] = 0 }
    for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
    for (let len = 2; len <= N; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k); const xr = re[i + k + len / 2] * c - im[i + k + len / 2] * s, xi = re[i + k + len / 2] * s + im[i + k + len / 2] * c; re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi } }
    const rate = Howler.ctx.sampleRate
    let hi = 0
    const k0 = Math.ceil(7000 / rate * N)
    for (let k = k0; k < N / 2; k++) hi += re[k] * re[k] + im[k] * im[k]
    return Math.sqrt(hi / N)
  }
  window.__music = () => {
    const out = {}
    if (!window.Howler) return out
    for (const h of Howler._howls) {
      const m = /(music_\w+|amb_\w+)/.exec(h._src)
      if (!m) continue
      const live = h._sounds.filter(s => !s._paused)
      if (live.length) out[m[1]] = live.map(s => +h.seek(s._id).toFixed(2) + '@' + h.volume(s._id).toFixed(2))
    }
    return out
  }
  window.__state = () => ({ ctx: window.Howler && Howler.ctx ? Howler.ctx.state : 'none', gain: window.Howler && Howler.masterGain ? +Howler.masterGain.gain.value.toFixed(3) : null, music: window.__music() })
})

const url = `http://127.0.0.1:${server.address().port}/`
await page.goto(url)
await page.waitForFunction(() => window.__game && window.__game.state === 'select', null, { timeout: 120000 })
await page.waitForTimeout(800)
await page.touchscreen.tap(195, 422)
await page.waitForTimeout(3000)

const report = []
const now = () => page.evaluate(() => performance.now())
const wait = ms => page.waitForTimeout(ms)
const state = () => page.evaluate(() => window.__state())
const gesture = () => page.touchscreen.tap(6, 300)

async function window_(from, to, ct) {
  return page.evaluate(([a, b, c]) => window.__blocks.filter(x => x.t >= a && x.t < b && (c == null || x.ct >= c)).map(x => ({ ...x, hf: hfOf(window.__raw[x.i]) })), [from, to, ct])
}

function stats(blocks) {
  if (!blocks.length) return { n: 0, peak: 0, rms: 0, hf: 0, click: 0 }
  let peak = 0, rms = 0, hf = 0, click = 0
  for (const b of blocks) {
    peak = Math.max(peak, b.peak)
    rms += b.rms
    hf = Math.max(hf, b.hf)
    if (b.hf > HF_LIMIT) click++
  }
  return { n: blocks.length, peak: +peak.toFixed(3), rms: +(rms / blocks.length).toFixed(4), hf: +hf.toFixed(4), click }
}
const HF_LIMIT = 0.025
const env = blocks => blocks.slice(0, 6).map(b => +b.rms.toFixed(3)).join(' ')

async function scenario(name, lock, unlock, opts = {}) {
  const t0 = await now()
  await wait(1200)
  const t1 = await now()
  const before = await state()
  await lock()
  await wait(opts.lockMs || 2500)
  const during = await state()
  const t2 = await now()
  const ct3 = await page.evaluate(() => Howler.ctx.currentTime)
  await unlock()
  const t3 = await now()
  await wait(opts.afterMs || 2500)
  const t4 = await now()
  const after = await state()
  const base = stats(await window_(t0, t1))
  const locked = stats(await window_(t1 + 250, t2))
  const stale = stats(await window_(t2, t3 + 600, -1).then(bs => bs.filter(b => b.ct < ct3)))
  const wakeBlocks = await window_(t2, t3 + 600, ct3)
  const wake = stats(wakeBlocks)
  const rest = stats(await window_(t3 + 600, t4))
  const firstSound = wakeBlocks.find(b => b.rms > 0.003)
  const verdicts = []
  if (!opts.toggle && locked.n && locked.peak > 0.001) verdicts.push('SOUND WHILE LOCKED')
  if (opts.silentAfter) { if (rest.peak > 0.001) verdicts.push('SOUND WHILE MUTED') }
  else if (rest.rms < 0.002) verdicts.push('NO SOUND AFTER UNLOCK')
  if (wake.click || rest.click) verdicts.push('HF/CLICK/SQUEAL')
  const first = wakeBlocks.find(b => b.rms > 0.003)
  if (first && wakeBlocks.length > 8 && first.rms > 0.5 * wakeBlocks[Math.min(wakeBlocks.length - 1, wakeBlocks.indexOf(first) + 6)].rms && first.rms > 0.02) verdicts.push('NO FADE-IN')
  if (base.peak > 0.01 && wake.peak > base.peak * 1.6) verdicts.push('BURST')
  for (const k in after.music) if (after.music[k].length > 1) verdicts.push('DOUBLE ' + k)
  report.push({ name, verdict: verdicts.length ? verdicts.join(', ') : 'OK', base, locked, wake, rest, firstSoundMs: firstSound ? Math.round(firstSound.t - t3) : null, env: env(wakeBlocks.slice(wakeBlocks.indexOf(firstSound))), before, during, after, stale })
}

async function suite(tag) {
  await scenario(`${tag} android lock (hidden+freeze)`,
    async () => { await page.evaluate(() => { window.__setHidden(true); setTimeout(() => document.dispatchEvent(new Event('freeze')), 300) }) },
    async () => { await page.evaluate(() => { document.dispatchEvent(new Event('resume')); window.__setHidden(false) }) })

  await scenario(`${tag} android lock (hidden only, quick)`,
    async () => { await page.evaluate(() => window.__setHidden(true)) },
    async () => { await page.evaluate(() => window.__setHidden(false)) }, { lockMs: 400 })

  await scenario(`${tag} iphone lock, OS resumes itself`,
    async () => { await page.evaluate(() => { window.__iosGate = true; Howler.ctx.suspend(); setTimeout(() => window.__setHidden(true), 30) }) },
    async () => { await page.evaluate(() => { window.__setHidden(false); setTimeout(() => window.__osResume(), 150) }) })

  await scenario(`${tag} iphone lock, needs a tap`,
    async () => { await page.evaluate(() => { window.__iosGate = true; Howler.ctx.suspend(); setTimeout(() => window.__setHidden(true), 30) }) },
    async () => { await page.evaluate(() => window.__setHidden(false)); await wait(300); await gesture() })

  await scenario(`${tag} ad sdk pause+mute (no visibility)`,
    async () => { await page.evaluate(() => { window.__PLAYABLE.pause(); window.__PLAYABLE.setAudio(false) }) },
    async () => { await page.evaluate(() => { window.__PLAYABLE.resume(); window.__PLAYABLE.setAudio(true) }) })

  await scenario(`${tag} ad sdk iphone: OS cuts audio, sdk pause`,
    async () => { await page.evaluate(() => { window.__iosGate = true; Howler.ctx.suspend(); window.__PLAYABLE.pause(); window.__PLAYABLE.setAudio(false) }) },
    async () => { await page.evaluate(() => { window.__PLAYABLE.resume(); window.__PLAYABLE.setAudio(true); setTimeout(() => window.__osResume(), 100) }) })

  await scenario(`${tag} ad webview: OS suspends audio, sdk only pause/resume`,
    async () => { await page.evaluate(() => { Howler.ctx.suspend(); window.__PLAYABLE.pause() }) },
    async () => { await page.evaluate(() => window.__PLAYABLE.resume()) })

  await scenario(`${tag} muted, lock, unlock stays muted`,
    async () => { await page.evaluate(() => { window.__PLAYABLE.setAudio(false); window.__setHidden(true) }) },
    async () => { await page.evaluate(() => window.__setHidden(false)) }, { silentAfter: true })

  await scenario(`${tag} unmute after that`,
    async () => {},
    async () => { await page.evaluate(() => window.__PLAYABLE.setAudio(true)) }, { lockMs: 300 })

  await scenario(`${tag} rapid mute toggles`,
    async () => { await page.evaluate(async () => { for (let i = 0; i < 9; i++) { window.__PLAYABLE.setAudio(i % 2 === 1); await new Promise(r => setTimeout(r, 40)) } }) },
    async () => { await page.evaluate(() => window.__PLAYABLE.setAudio(true)) }, { lockMs: 300, toggle: true })

  await scenario(`${tag} lock-unlock-lock-unlock fast`,
    async () => { await page.evaluate(async () => { for (let i = 0; i < 4; i++) { window.__setHidden(true); await new Promise(r => setTimeout(r, 70)); window.__setHidden(false); await new Promise(r => setTimeout(r, 70)) } window.__setHidden(true) }) },
    async () => { await page.evaluate(() => window.__setHidden(false)) }, { lockMs: 1500, toggle: true })
}

await suite('lobby')
await page.evaluate(() => window.__game.tapCard(0))
await wait(1500)
await page.evaluate(() => window.__game.confirmPick())
await page.waitForFunction(() => window.__game.state === 'battle', null, { timeout: 120000 })
await page.evaluate(() => { const g = window.__game; g.hero.maxHp = g.hero.hp = 1e9 })
await wait(3000)
await suite('battle')
await page.evaluate(() => { const g = window.__game; g.titan = 1; g.titanReady = true; g.transform() })
await wait(1500)
await scenario('titan morph android lock',
  async () => { await page.evaluate(() => window.__setHidden(true)) },
  async () => { await page.evaluate(() => window.__setHidden(false)) })

for (const r of report) {
  console.log(`\n## ${r.name}: ${r.verdict}`)
  console.log(`  base ${JSON.stringify(r.base)}\n  locked ${JSON.stringify(r.locked)}\n  wake ${JSON.stringify(r.wake)} first sound ${r.firstSoundMs} ms env ${r.env}\n  rest ${JSON.stringify(r.rest)}`)
  console.log(`  pre-lock leftovers ${JSON.stringify(r.stale)}`)
  console.log(`  before ${JSON.stringify(r.before)}\n  during ${JSON.stringify(r.during)}\n  after ${JSON.stringify(r.after)}`)
}
console.log('\nproblems', problems)
await browser.close()
server.close()
