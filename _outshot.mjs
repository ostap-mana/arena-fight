import { chromium } from 'playwright'
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const logs = []
const sizes = [[420, 860, 'p'], [1400, 760, 'l'], [812, 375, 's']]
for (const kind of ['victory', 'defeat']) {
  for (const [w, h, tag] of sizes) {
    const page = await browser.newPage({ viewport: { width: w, height: h } })
    page.on('pageerror', e => logs.push('[pageerror] ' + e.message))
    page.on('console', m => { if (m.type() === 'error') logs.push('[error] ' + m.text()) })
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    await page.evaluate(k => { document.getElementById('boot').style.display = 'none'; window.__game.showOutcome(k) }, kind)
    if (tag === 'p') {
      await page.waitForTimeout(250)
      await page.screenshot({ path: 'C:/Users/Yonix/AppData/Local/Temp/claude/c--Users-Yonix-Desktop-BUILD/f9c284bd-2d6b-45f5-af49-f61d0009adb5/scratchpad/' + kind + '-' + tag + '-intro.png' })
    }
    await page.waitForTimeout(1600)
    const r = await page.evaluate(() => {
      const q = s => document.querySelector('#outcome ' + s).getBoundingClientRect().toJSON()
      const l = document.querySelector('#outcome .label')
      return { card: q('.card'), fig: q('.figure'), ctl: q('.control'), label: getComputedStyle(l).fontSize, fam: document.fonts.check('500 20px Hitzone') }
    })
    logs.push(kind + tag + ' ' + JSON.stringify(r, (k, v) => typeof v === 'number' ? Math.round(v) : v))
    await page.screenshot({ path: 'C:/Users/Yonix/AppData/Local/Temp/claude/c--Users-Yonix-Desktop-BUILD/f9c284bd-2d6b-45f5-af49-f61d0009adb5/scratchpad/' + kind + '-' + tag + '.png' })
    await page.close()
  }
}
console.log(logs.join('\n'))
await browser.close()
