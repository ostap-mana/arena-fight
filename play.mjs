import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:5174/'
const script = JSON.parse(process.argv[3] || '[]')
const w = Number(process.argv[4] || 900)
const h = Number(process.argv[5] || 520)

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
const logs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`) })
page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e.message).split('\n').slice(0, 4).join(' | ')))
await page.goto(url, { waitUntil: 'networkidle' })

for (const step of script) {
  if (step.wait) await page.waitForTimeout(step.wait)
  if (step.click) await page.mouse.click(step.click[0], step.click[1])
  if (step.tap) {
    await page.mouse.move(step.tap[0], step.tap[1])
    await page.mouse.down()
    await page.waitForTimeout(40)
    await page.mouse.up()
  }
  if (step.key) await page.keyboard.press(step.key)
  if (step.hold) {
    await page.keyboard.down(step.hold[0])
    await page.waitForTimeout(step.hold[1])
    await page.keyboard.up(step.hold[0])
  }
  if (step.eval) {
    const r = await page.evaluate(step.eval)
    if (r !== undefined && r !== null) console.log('EVAL:', JSON.stringify(r))
  }
  if (step.shot) await page.screenshot({ path: step.shot })
}

console.log(logs.slice(0, 25).join('\n'))
await browser.close()
