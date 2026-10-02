import { chromium } from 'playwright'
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'src', 'assets', 'GENERAL', 'lose-win')
const FRAME = 'fh=3.0&ty=1.35'

const PRESETS = {
  ricklow: {
    victory: { query: `${FRAME}&vignette=0.45`, frames: 250, loop: 190 },
    defeat: {
      query: `${FRAME}&skin=0&ing=Stun,Sleep&plan=${encodeURIComponent(JSON.stringify([
        { clip: 'IdleLOB' },
        { clip: 'Stun', at: 0.15, fade: 0.25, rest: true },
        { clip: 'Sleep', at: 1.2, fade: 0.6 },
      ]))}`,
      frames: 110,
      loop: 60,
    },
  },
}

const [hero = 'ricklow', kind = 'victory', port = '5173', crf = '28'] = process.argv.slice(2)
const preset = PRESETS[hero]?.[kind]
if (!preset) {
  console.error(`no preset for ${hero} ${kind}`)
  process.exit(1)
}

function run(cmd, args, input) {
  const child = spawn(cmd, args, { stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] })
  return { child, done: new Promise((resolve, reject) => child.on('close', code => (code ? reject(new Error(`${cmd} ${code}`)) : resolve()))) }
}

const clipPath = path.join(OUT, `${hero}-${kind}.mp4`)
const posterPath = path.join(OUT, `${hero}-${kind}.webp`)
const stillPath = path.join(os.tmpdir(), `${hero}-${kind}-still.png`)
const clipTemp = path.join(os.tmpdir(), `${hero}-${kind}.mp4`)
const posterTemp = path.join(os.tmpdir(), `${hero}-${kind}.webp`)
const encoder = run('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-i', '-', '-frames:v', String(preset.frames),
  '-c:v', 'libx264', '-profile:v', 'high', '-level', '3.1', '-preset', 'veryslow', '-crf', crf, '-pix_fmt', 'yuv420p',
  '-g', '60', '-force_key_frames', `expr:eq(n,${preset.loop})`, '-movflags', '+faststart', '-an', clipTemp], true)

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] })
const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1 })
page.on('pageerror', e => console.error('[pageerror]', e.message))
await page.goto(`http://localhost:${port}/tools/outcome-lab.html?hero=${hero}&kind=${kind}&${preset.query}`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.lab && window.lab.ready, null, { timeout: 60000 })
await page.evaluate(() => window.lab.ready)
for (let i = 0; i < preset.frames; i++) {
  const url = await page.evaluate(() => window.lab.capture())
  const png = Buffer.from(url.split(',')[1], 'base64')
  if (!encoder.child.stdin.write(png)) await new Promise(r => encoder.child.stdin.once('drain', r))
  if (i === preset.loop) {
    const still = await page.evaluate(() => window.lab.still())
    fs.writeFileSync(stillPath, Buffer.from(still.split(',')[1], 'base64'))
  }
}
encoder.child.stdin.end()
await encoder.done
await browser.close()
await run('ffmpeg', ['-v', 'error', '-y', '-i', stillPath, '-c:v', 'libwebp', '-quality', '88', '-pix_fmt', 'yuva420p', posterTemp]).done
fs.copyFileSync(clipTemp, clipPath)
fs.copyFileSync(posterTemp, posterPath)
for (const p of [stillPath, clipTemp, posterTemp]) fs.rmSync(p, { force: true })
console.log(`${clipPath}\n${posterPath}\nloop from ${preset.loop}/30 s`)
