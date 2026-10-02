import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:5173/test.html'
const out = process.argv[3] || 'shot.png'
const wait = Number(process.argv[4] || 2500)
const w = Number(process.argv[5] || 1600)
const h = Number(process.argv[6] || 760)

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
const logs = []
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', e => logs.push('[pageerror] ' + e.stack))
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(wait)
await page.screenshot({ path: out })
console.log(logs.slice(0, 40).join('\n'))
await browser.close()
