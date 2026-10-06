import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const url = process.argv[2] || 'http://localhost:4173/'
const out = process.argv[3] || path.join(import.meta.dirname, 'boot.json')
const publicDir = path.resolve(import.meta.dirname, '..', '..', 'public')
const DEVICES = [
  { viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 },
  { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
]

const normalize = file => file.replace(/_lob_m\.glb$/, '_lob.glb').replace(/\.m4a$/, '.mp3')
const seen = new Set()
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'] })

for (const device of DEVICES) {
  const page = await browser.newPage(device)
  const requests = []
  page.on('request', r => {
    const u = new URL(r.url())
    if (!u.protocol.startsWith('http')) return
    const file = decodeURIComponent(u.pathname).replace(/^\//, '')
    if (file.startsWith('assets/')) requests.push([file, Date.now()])
  })
  await page.goto(url)
  await page.waitForFunction(() => window.__BOOT && window.__BOOT.marks.some(m => m[0] === 'select'), null, { timeout: 180000 })
  const revealAt = await page.evaluate(() => performance.timeOrigin + window.__BOOT.marks.find(m => m[0] === 'select')[1])
  for (const [file, at] of requests) if (at <= revealAt) seen.add(file)
  await page.close()
}
await browser.close()

const list = [...new Set([...seen].map(normalize))]
  .filter(f => [f, f.replace(/\.mp3$/, '.m4a')].some(p => fs.existsSync(path.join(publicDir, p)) && fs.statSync(path.join(publicDir, p)).isFile()))
  .sort()
fs.writeFileSync(out, `${JSON.stringify(list, null, 1)}\n`)
console.log(list.length, 'boot assets')
