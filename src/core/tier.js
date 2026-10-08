const forced = new URLSearchParams(location.search).get('q')

export const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
export const FORCED_QUALITY = forced === 'low' || forced === 'high' ? forced : null
export const LOW_TIER = FORCED_QUALITY ? FORCED_QUALITY === 'low' : COARSE
