/**
 * load font list after start
 */
import log from '../common/log.js'

// `font-list` (a native-ish module) may be absent on some platforms (e.g. the
// Android runtime). Load it lazily and tolerate its absence so the server can
// still start.
let fontsPromise = null
function loadGetFonts () {
  if (!fontsPromise) {
    fontsPromise = import('font-list')
      .then(m => m.getFonts)
      .catch(err => {
        log.warn('font-list is not available:', err.message)
        return null
      })
  }
  return fontsPromise
}

export const loadFontList = async () => {
  const getFonts = await loadGetFonts()
  if (!getFonts) {
    return []
  }
  try {
    const fonts = await getFonts()
    return fonts.map(f => f.replace(/"/g, ''))
  } catch (err) {
    log.error('load font list error')
    log.error(err)
    return []
  }
}
