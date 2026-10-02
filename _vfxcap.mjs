import { chromium } from 'playwright'
import fs from 'fs'

const hero = Number(process.argv[2] || 0)
const outDir = process.argv[3]
const actions = JSON.parse(process.argv[4] || '["s1","s2","s3","ult","atk","atk","atk"]')
const times = JSON.parse(process.argv[5] || '[0.1,0.25,0.4,0.6,0.85,1.15,1.5,2.0]')
const port = process.argv[6] || '5173'
const view = process.argv[7] || 'battle'
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1 })
const logs = []
page.on('console', m => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`) })
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')))
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' })
const ready = () => page.evaluate(() => !!(window.__game && window.__game.selectActors && window.__game.selectActors.length === 3))
for (let i = 0; i < 150 && !(await ready()); i++) {
  await page.keyboard.press('Space').catch(() => {})
  await page.waitForTimeout(1000)
}
await page.waitForTimeout(800)
await page.evaluate(h => { const g = window.__game; if (g.heroIndex !== h) g.pickHero(h); g.pickHero(h) }, hero)
await page.waitForFunction(() => window.__game.state === 'battle' && window.__game.enemies.filter(e => !e.dead).length >= 3, null, { timeout: 90000 })
await page.waitForTimeout(600)
await page.evaluate(view => {
  const g = window.__game
  g.paused = true
  g.setAuto(false)
  g.pending = []
  g.hurtHero = () => {}
  g.addTitan = () => {}
  g.victory = () => {}
  g.nextWave = () => {}
  for (const el of document.querySelectorAll('.hint, .gesture, #hint, .banner')) el.style.display = 'none'
  g.updateEnemies = function (dt) {
    for (const e of this.enemies) {
      if (e.stagger > 0) {
        e.stagger -= dt
        if (e.rig.state !== 'hit') e.rig.play('hit', { force: true, fade: 0.06 })
      } else if (e.rig.state === 'hit' && e.rig.finished) e.rig.play('idle', { fade: 0.2 })
      e.update(dt, {})
    }
  }
  const h = g.hero
  h.setPos(0, 0)
  h.facing = h.targetFacing = 0
  const live = g.enemies.filter(e => !e.dead)
  const spots = [[0, 3.2], [-1.9, 4.4], [1.9, 4.4], [0, 6.2], [-3.4, 2.4], [3.4, 2.4]]
  live.forEach((e, i) => {
    const s = spots[i % spots.length]
    e.hp = e.maxHp = 1e7
    e.setPos(s[0], s[1])
    e.pos.y = e.def.fly || 0
    e.faceTo(0, 0)
    e.facing = e.targetFacing
    e.rig.play('idle', { force: true })
  })
  if (view === 'close') {
    const base = g.updateCamera.bind(g)
    g.updateCamera = function (dt) {
      base(dt)
      this.camera.position.set(4.6, 4.2, -3.2)
      this.camera.lookAt(0, 1.0, 2.2)
    }
  }
  window.__adv = (sec, fps = 30) => {
    const n = Math.max(1, Math.round(sec * fps))
    for (let i = 0; i < n; i++) {
      const dt = (1 / fps) * g.timeScale
      g.t += dt
      g.step(dt)
    }
  }
  window.__trigger = a => {
    const h = g.hero
    h.setPos(0, 0)
    h.facing = h.targetFacing = 0
    for (const k in g.cooldowns) g.cooldowns[k] = 0
    g.timeScale = 1
    if (g.titanMode) g.titanT = 1e9
    if (a === 'titan') { g.titanReady = true; g.transform(); return 'morph' }
    if (a === 'ult') { g.ultReady = true; g.ult = 1; return g.castUltimate() }
    if (a === 'atk') { g.attack(); return h.rig.action && h.rig.action.getClip().name }
    if (a === 'dash') { g.dash([0, 1]); return true }
    g.useSkill(a)
    return h.rig.action && h.rig.action.getClip().name
  }
}, view)
await page.evaluate(() => window.__adv(0.5))
const manifest = []
for (let ai = 0; ai < actions.length; ai++) {
  const a = actions[ai]
  const clip = await page.evaluate(a => window.__trigger(a), a)
  let t = 0
  const frames = []
  for (const tt of times) {
    await page.evaluate(d => window.__adv(d), tt - t)
    t = tt
    await page.waitForTimeout(120)
    const file = `${outDir}/a${ai}_${a}_t${String(Math.round(tt * 100)).padStart(3, '0')}.png`
    await page.screenshot({ path: file })
    frames.push(file)
  }
  manifest.push({ action: a, clip, frames })
  await page.evaluate(() => window.__adv(2.2))
  if (a === 'titan') {
    for (let k = 0; k < 60 && !(await page.evaluate(() => window.__game.titanMode && window.__game.state === 'battle')); k++) {
      await page.waitForTimeout(500)
      await page.evaluate(() => window.__adv(0.2))
    }
    await page.evaluate(() => { window.__game.titanT = 1e9; window.__adv(1.5) })
  }
}
fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify({ hero, manifest, logs }, null, 1))
console.log(JSON.stringify({ hero, actions: manifest.map(m => [m.action, m.clip]), logs: logs.slice(0, 10) }))
await browser.close()
