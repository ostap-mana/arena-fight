import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i < 0 ? fallback : args[i + 1]
}
const ROOT = path.resolve(import.meta.dirname, '..', '..')
const file = path.resolve(ROOT, flag('file', 'dist-single/invokers.html'))
const shots = flag('shots', '')
const heroes = flag('heroes', '0,1,2').split(',').map(Number)
const width = Number(flag('w', 430))
const height = Number(flag('h', 932))
const html = fs.readFileSync(file)
const text = html.toString('utf8')
const outbound = []
const problems = []
const notes = []

const statics = [
  ['size', `${html.length} bytes ${html.length <= 5000000 ? 'under' : 'OVER'} 5,000,000`],
  ['build stamp', /window\.__BUILD=\{[^;\n]*"buildId":"[0-9a-f]{12}"/.test(text)],
  ['passport in first 300000 chars', /window\.__CREATIVE=\{/.test(text.slice(0, 300000))],
  ['bus in plain text', /window\.__PLAYABLE\s*=\s*\{/.test(text) && /\bon\s*:\s*function/.test(text)],
  ['external script src', (text.match(/<script[^>]+src\s*=\s*["']?(https?:)?\/\//gi) || []).length],
  ['external link href', (text.match(/<link[^>]+href\s*=\s*["']?(https?:)?\/\//gi) || []).length],
  ['window.open', (text.match(/window\.open\s*\(/g) || []).length],
  ['mraid', (text.match(/mraid/gi) || []).length],
]
for (const [k, v] of statics) console.log(`static  ${k}: ${v}`)

const server = createServer((req, res) => {
  if (req.url !== '/' && !req.url.startsWith('/?')) {
    outbound.push(req.url)
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = flag('url', '') || `http://127.0.0.1:${server.address().port}/`
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] })
if (shots) fs.mkdirSync(shots, { recursive: true })

async function shot(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function run(index) {
  const mobile = args.includes('--mobile')
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  page.on('console', m => {
    const t = m.text()
    if (m.type() === 'error' || m.type() === 'warning' || t.includes('single:')) problems.push(`[hero ${index}] [${m.type()}] ${t}`)
  })
  page.on('pageerror', e => problems.push(`[hero ${index}] [pageerror] ${e.message}`))
  page.on('request', r => {
    const u = r.url()
    if (/^https?:/.test(u) && u !== url && !flag('url', '')) outbound.push(u)
  })
  const t0 = Date.now()
  await page.goto(url)
  const loaded = Date.now() - t0
  await page.waitForFunction(() => window.__game && window.__game.state === 'select', null, { timeout: 120000 })
  notes.push(`[hero ${index}] load event ${loaded} ms, select screen ${Date.now() - t0} ms`)
  await page.waitForTimeout(1200)
  await shot(page, `h${index}-0-select`)
  await page.mouse.click(width / 2, height / 2)
  await page.waitForTimeout(800)
  await page.evaluate(i => window.__game.previewHero(i), index)
  await page.waitForTimeout(3500)
  await shot(page, `h${index}-1-preview`)
  await page.evaluate(() => window.__game.backgroundLoad)
  await page.evaluate(() => window.__game.confirmPick())
  await page.waitForFunction(() => window.__game.state === 'battle', null, { timeout: 120000 })
  await page.evaluate(() => { const g = window.__game; g.hero.maxHp = g.hero.hp = 1e9 })
  await page.waitForTimeout(2500)
  await shot(page, `h${index}-2-battle`)
  for (const k of ['s1', 's2', 's3']) {
    await page.evaluate(key => window.__game.useSkill(key), k)
    await page.waitForTimeout(1800)
  }
  await shot(page, `h${index}-3-skills`)
  await page.evaluate(() => { const g = window.__game; g.ult = 1; g.ultReady = true; g.castUltimate() })
  await page.waitForTimeout(1200)
  await shot(page, `h${index}-4-ult`)
  await page.waitForTimeout(1500)
  await page.evaluate(() => { const g = window.__game; g.titan = 1; g.titanReady = true; g.transform() })
  await page.waitForTimeout(4500)
  await shot(page, `h${index}-5-titan`)
  for (const k of ['s1', 's2']) {
    await page.evaluate(key => { const g = window.__game; g.cooldowns[key] = 0; g.useSkill(key) }, k)
    await page.waitForTimeout(2000)
  }
  await page.waitForTimeout(10000)
  for (let w = 0; w < 4; w++) {
    await page.evaluate(() => { const g = window.__game; if (g.state === 'battle' && g.waveIndex < 3) g.nextWave() })
    await page.waitForTimeout(3500)
  }
  await shot(page, `h${index}-6-boss`)
  await page.waitForTimeout(12000)
  await shot(page, `h${index}-7-boss-fight`)
  const audio = await page.evaluate(() => {
    const out = {}
    for (const h of Howler._howls) out[h._src] = h.state()
    return out
  })
  const broken = Object.entries(audio).filter(([, s]) => s !== 'loaded' && s !== 'unloaded')
  if (broken.length) problems.push(`[hero ${index}] audio not loaded: ${JSON.stringify(broken)}`)
  await page.keyboard.press('KeyV')
  await page.waitForTimeout(3500)
  await shot(page, `h${index}-8-victory`)
  await page.keyboard.press('KeyR')
  await page.waitForTimeout(5000)
  await page.keyboard.press('KeyD')
  await page.waitForTimeout(4000)
  await shot(page, `h${index}-9-defeat`)
  await page.close()
}

for (const h of heroes) {
  try {
    await run(h)
  } catch (e) {
    problems.push(`[hero ${h}] FAILED ${e.message.split('\n')[0]}`)
  }
}
await browser.close()
server.close()
for (const n of notes) console.log(n)
console.log(`outbound requests: ${outbound.length}${outbound.length ? ' ' + [...new Set(outbound)].slice(0, 20).join(' ') : ''}`)
console.log(`problems: ${problems.length}`)
for (const p of [...new Set(problems)].slice(0, 60)) console.log('  ' + p)
process.exitCode = problems.length || outbound.length ? 1 : 0
