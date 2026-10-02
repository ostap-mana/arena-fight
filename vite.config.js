import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const TUNE_FILES = ['src/data/heroes.js', 'src/data/builds.js']

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

export default defineConfig({
  base: './',
  plugins: [stampBuild()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
})
