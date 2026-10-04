const RETRIES = 3
const RETRY_GAP_MS = 400

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function prefetched(url) {
  const shelf = globalThis.__PREFETCH
  return shelf && typeof shelf.take === 'function' ? shelf.take(url) : null
}

async function download(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
      return await response.arrayBuffer()
    } catch (error) {
      if (attempt >= RETRIES) throw error
      await wait(RETRY_GAP_MS * (attempt + 1))
    }
  }
}

export function fetchBuffer(url) {
  const early = prefetched(url)
  return early ? early.catch(() => download(url)) : download(url)
}

export async function fetchJson(url) {
  return JSON.parse(new TextDecoder().decode(await fetchBuffer(url)))
}

export function prefetchProgress() {
  const shelf = globalThis.__PREFETCH
  return shelf && typeof shelf.progress === 'function' ? shelf.progress() : 1
}
