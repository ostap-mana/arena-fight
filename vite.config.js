import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { HEROES } from './src/data/heroes.js'
import { LOCATIONS, DEFAULT_LOCATION } from './src/data/locations.js'

const TUNE_FILES = ['src/data/heroes.js', 'src/data/builds.js']
const PUBLIC_DIR = resolve(import.meta.dirname, 'public')
const BOOT_JSON = ['assets/locations/index.json', 'assets/locations/lighting.json']

function commit() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: import.meta.dirname, encoding: 'utf8' }).trim()
  } catch {
    return 'nogit'
  }
}

function tuneHash() {
  const h = createHash('sha256')
  for (const file of TUNE_FILES) h.update(readFileSync(resolve(import.meta.dirname, file)))
  return h.digest('hex').slice(0, 4)
}

function stampBuild() {
  return {
    name: 'stamp-build',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const h = createHash('sha256')
        const bundle = ctx.bundle || {}
        for (const name of Object.keys(bundle).sort()) {
          const out = bundle[name]
          h.update(name)
          h.update(out.type === 'chunk' ? out.code : out.source)
        }
        h.update(html)
        const build = { buildId: h.digest('hex').slice(0, 12), commit: commit(), tuneHash: tuneHash(), at: new Date().toISOString() }
        return html.replace(/window\.__BUILD=\{[^\n]*?\};/, `window.__BUILD=${JSON.stringify(build)};`)
      },
    },
  }
}

function shelf(data) {
  var coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  var arena = data.arenas[new URLSearchParams(location.search).get('loc')] || data.arenas[data.fallback]
  var list = data.json.map(function (url) { return [url, 0] })
  if (arena) list.push(arena)
  data.lobby.forEach(function (pair) { list.push(pair[coarse ? 1 : 0]) })
  var jobs = {}
  var all = []
  var total = 0
  function wait(ms) { return new Promise(function (done) { setTimeout(done, ms) }) }
  function read(response, job) {
    if (!response.body || !response.body.getReader) {
      return response.arrayBuffer().then(function (buffer) { job.got = job.size; return buffer })
    }
    var reader = response.body.getReader()
    var parts = []
    var length = 0
    function pump() {
      return reader.read().then(function (step) {
        if (step.done) {
          var out = new Uint8Array(length)
          var at = 0
          parts.forEach(function (part) { out.set(part, at); at += part.length })
          job.got = job.size
          return out.buffer
        }
        parts.push(step.value)
        length += step.value.length
        job.got = Math.min(job.size, length)
        return pump()
      })
    }
    return pump()
  }
  function attempt(url, job, tries) {
    job.got = 0
    return fetch(url, { credentials: 'same-origin' }).then(function (response) {
      if (!response.ok) throw new Error(url + ': HTTP ' + response.status)
      return read(response, job)
    }).catch(function (error) {
      if (tries >= 2) throw error
      return wait(400 * (tries + 1)).then(function () { return attempt(url, job, tries + 1) })
    })
  }
  var queue = Promise.resolve()
  list.forEach(function (entry) {
    var job = { size: entry[1], got: 0 }
    total += job.size
    if (job.size) {
      job.done = queue.then(function () { return attempt(entry[0], job, 0) })
      queue = job.done.catch(function () {})
    } else {
      job.done = attempt(entry[0], job, 0)
    }
    job.done.catch(function () {})
    jobs[entry[0]] = job
    all.push(job)
  })
  window.__PREFETCH = {
    take: function (url) {
      var job = jobs[url]
      delete jobs[url]
      return job ? job.done : null
    },
    progress: function () {
      var got = 0
      all.forEach(function (job) { got += job.got })
      return total ? Math.min(1, got / total) : 1
    },
  }
}

function bootPrefetch() {
  const size = file => {
    try {
      return statSync(resolve(PUBLIC_DIR, file)).size
    } catch {
      return 0
    }
  }
  const entry = file => [file, size(file)]
  return {
    name: 'boot-prefetch',
    transformIndexHtml() {
      const index = JSON.parse(readFileSync(resolve(PUBLIC_DIR, 'assets/locations/index.json'), 'utf8'))
      const arenas = Object.fromEntries(LOCATIONS.filter(id => index[id]).map(id => [id, entry(`assets/locations/${index[id].file}`)]))
      const lobby = [...new Set(HEROES.map(h => h.lobby || h.model))].map(id => {
        const full = `assets/glb/${id}.glb`
        return [entry(full), entry(/_lob$/.test(id) ? `assets/glb/${id}_m.glb` : full)]
      })
      const data = { arenas, fallback: DEFAULT_LOCATION, lobby, json: BOOT_JSON }
      return [{ tag: 'script', children: `(${shelf.toString()})(${JSON.stringify(data)})`, injectTo: 'body' }]
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [bootPrefetch(), stampBuild()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
})
