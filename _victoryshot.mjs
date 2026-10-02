import { chromium } from 'playwright'

const [hero = 'ricklow', kind = 'victory', size = '390x844', dpr = '3', times = '4500', out = 'shot'] = process.argv.slice(2)
const [w, h] = size.split('x').map(Number)
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: Number(dpr) })
const logs = []
page.on('pageerror', e => logs.push('[pageerror] ' + e.message))
page.on('console', m => { if (m.type() === 'error') logs.push('[error] ' + m.text()) })
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await page.evaluate(([id, k]) => {
  document.getElementById('boot').style.display = 'none'
  window.__game.ui.outcome.setHero(id)
  window.__game.ui.outcome.primed = true
  window.__game.ui.outcome.primeClips()
}, [hero, kind])
await page.waitForTimeout(1500)
await page.evaluate(k => window.__game.showOutcome(k), kind)
let last = 0
for (const t of times.split(',').map(Number)) {
  await page.waitForTimeout(t - last)
  last = t
  const info = await page.evaluate(() => {
    const o = window.__game.ui.outcome
    const r = s => document.querySelector('#outcome ' + s).getBoundingClientRect().toJSON()
    const c = o.clip
    return {
      fig: r('.figure'), band: r('.band'),
      canvas: c ? { w: c.canvas.width, h: c.canvas.height, hidden: c.canvas.hidden, t: c.video.currentTime, rs: c.video.readyState, vw: c.video.videoWidth, vh: c.video.videoHeight, rect: c.canvas.getBoundingClientRect().toJSON() } : null,
    }
  })
  logs.push(`${t}ms ` + JSON.stringify(info, (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v))
  await page.screenshot({ path: `${out}-${t}.png` })
}
console.log(logs.join('\n'))
await browser.close()
