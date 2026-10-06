import { decodePack, readPack, needsMerge, merge, SIDECARS } from './unpack.js'

const own = bytes => (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice())

self.onmessage = event => {
  const { tier, text, info } = event.data
  try {
    const { bin, raw } = decodePack(text, info)
    self.postMessage({ tier, bin, raw })
    const files = readPack(bin, raw)
    for (const name of files.keys()) {
      if (SIDECARS.some(ext => name.endsWith(ext)) || !needsMerge(files, name)) continue
      const bytes = own(merge(files, name))
      self.postMessage({ tier, name, bytes }, [bytes.buffer])
    }
    self.postMessage({ tier, done: true })
  } catch (error) {
    self.postMessage({ tier, error: String(error && error.stack || error) })
  }
}
