import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')
export const CACHE = path.join(ROOT, 'node_modules', '.cache', 'single')
fs.mkdirSync(CACHE, { recursive: true })

let pythonPath = null

export function python() {
  if (pythonPath) return pythonPath
  const candidates = [process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean)
  for (const candidate of candidates) {
    try {
      pythonPath = execFileSync(candidate, ['-c', 'import sys, PIL; print(sys.executable)'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      return pythonPath
    } catch {}
  }
  throw new Error('no python with Pillow found; set PYTHON')
}

export function hash(...parts) {
  const h = createHash('sha1')
  for (const p of parts) h.update(typeof p === 'string' ? p : Buffer.isBuffer(p) || p instanceof Uint8Array ? p : JSON.stringify(p))
  return h.digest('hex').slice(0, 20)
}

export function cached(key, ext, make) {
  const file = path.join(CACHE, `${key}${ext}`)
  if (fs.existsSync(file)) return fs.readFileSync(file)
  const data = make()
  fs.writeFileSync(file, data)
  return data
}

export function encodeImages(jobs) {
  const todo = []
  const results = jobs.map(job => {
    const key = hash('img6', job.data, { ...job, data: undefined })
    const out = path.join(CACHE, `${key}.img`)
    if (!fs.existsSync(out) && !todo.some(t => t.out === out)) {
      const src = path.join(CACHE, `${key}.src`)
      fs.writeFileSync(src, job.data)
      todo.push({ ...job, data: undefined, src, out })
    }
    return out
  })
  if (todo.length) {
    const list = path.join(CACHE, `jobs-${process.pid}-${Date.now()}.json`)
    fs.writeFileSync(list, JSON.stringify(todo))
    execFileSync(python(), [path.join(import.meta.dirname, 'images.py'), list], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 })
    fs.rmSync(list)
    for (const job of todo) fs.rmSync(job.src)
  }
  return results.map(file => fs.readFileSync(file))
}

export function imageKind(data) {
  if (data.length > 12 && data.toString('ascii', 4, 8) === 'ftyp') return 'avif'
  if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF') return 'webp'
  if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47) return 'png'
  return 'jpeg'
}

export const kb = n => `${(n / 1024).toFixed(0)}K`
export const mb = n => `${(n / 1048576).toFixed(2)} MB`
