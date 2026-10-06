import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const url = process.argv[2] || 'http://localhost:4173/'
const out = process.argv[3] || path.join(import.meta.dirname, 'manifest.json')
const heroes = (process.argv[4] || '0,1,2').split(',').map(Number)
const seen = new Map()
const logs = []

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] })

async function run(heroIndex) {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 })
  page.on('request', r => {
    const u = new URL(r.url())
    if (u.protocol.startsWith('http')) seen.set(u.pathname, (seen.get(u.pathname) || 0) + 1)
  })
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[h${heroIndex}][${m.type()}] ${m.text()}`) })
  page.on('pageerror', e => logs.push(`[h${heroIndex}][pageerror] ${e.message}`))
  await page.goto(url)
  await page.waitForFunction(() => window.__game && window.__game.state === 'select', null, { timeout: 120000 })
  await page.mouse.click(215, 466)
  await page.waitForTimeout(1500)
  await page.evaluate(i => { const g = window.__game; g.previewHero(i) }, heroIndex)
  await page.waitForTimeout(4000)
  await page.evaluate(() => window.__game.backgroundLoad)
  await page.evaluate(() => window.__game.confirmPick())
  await page.waitForFunction(() => window.__game.state === 'battle', null, { timeout: 120000 })
  await page.evaluate(() => { const g = window.__game; g.hero.maxHp = g.hero.hp = 1e9 })
  for (const k of ['s1', 's2', 's3']) {
    await page.evaluate(key => window.__game.useSkill(key), k)
    await page.waitForTimeout(2500)
  }
  await page.evaluate(() => { const g = window.__game; g.ult = 1; g.ultReady = true; g.castUltimate() })
  await page.waitForTimeout(3000)
  await page.evaluate(() => { const g = window.__game; g.titan = 1; g.titanReady = true; g.transform() })
  await page.waitForTimeout(5000)
  for (const k of ['s1', 's2']) {
    await page.evaluate(key => { const g = window.__game; g.cooldowns[key] = 0; g.useSkill(key) }, k)
    await page.waitForTimeout(2500)
  }
  await page.waitForTimeout(12000)
  for (let w = 0; w < 4; w++) {
    await page.evaluate(() => { const g = window.__game; if (g.state === 'battle' && g.waveIndex < 3) g.nextWave() })
    await page.waitForTimeout(4000)
  }
  await page.waitForTimeout(20000)
  await page.keyboard.press('KeyV')
  await page.waitForTimeout(4000)
  await page.keyboard.press('KeyR')
  await page.waitForTimeout(6000)
  await page.keyboard.press('KeyD')
  await page.waitForTimeout(5000)
  await page.close()
}

for (const h of heroes) {
  try { await run(h) } catch (e) { logs.push(`[h${h}] FAIL ${e.message}`) }
}
const publicDir = path.resolve(import.meta.dirname, '..', '..', 'public')
const list = [...seen.keys()].map(p => decodeURIComponent(p).replace(/^\//, '')).filter(p => p.startsWith('assets/') && fs.existsSync(path.join(publicDir, p)) && fs.statSync(path.join(publicDir, p)).isFile()).sort()
fs.writeFileSync(out, `${JSON.stringify(list, null, 1)}\n`)
console.log(list.length, 'public assets;', logs.length, 'log lines')
for (const line of logs.slice(0, 30)) console.log(line)
await browser.close()
