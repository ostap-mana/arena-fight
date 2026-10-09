const params = new URLSearchParams(location.search)
const forced = params.get('q')

export const PERF_HUD = params.has('fps')

export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
export const FORCED_QUALITY = forced === 'low' || forced === 'high' ? forced : null
export const LOW_TIER = FORCED_QUALITY ? FORCED_QUALITY === 'low' : COARSE
