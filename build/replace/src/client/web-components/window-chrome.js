/**
 * Window chrome (status bar + navigation bar) colour sync — Android build.
 *
 * Problem: the two system strips (status bar at the top, gesture / 3-button bar
 * at the bottom) are painted OUTSIDE the web page. Since Android 15 enforces
 * edge-to-edge for apps targeting SDK 35+, `android:statusBarColor` /
 * `android:navigationBarColor` are ignored, so the strips keep the *system*
 * light/dark default: a dark electerm theme on a light-mode phone gets a white
 * status bar and a white bottom strip (with near-invisible dark icons).
 *
 * The only source of truth for what those strips should look like is the UI
 * theme itself. electerm themes are applied as
 *   :root { --main-dark: ...; --main: ...; --text: ...; }
 * by electerm-react/components/main/ui-theme.jsx (it rewrites the
 * <style id="theme-css"> element), so the page can read the *live* values back
 * out of the computed style and hand them to the native side.
 *
 * Which variable goes where — the strips have to continue the surface they sit
 * against, otherwise there is a visible seam:
 *   - top strip    -> --main-dark: the tab bar / header background it touches.
 *   - bottom strip -> --main: the footer (and the main surface behind it).
 *
 * Bridge (ElectermWindowChrome.java, MainActivity installs it as
 * `window.ElectermChrome`):
 *   window.ElectermChrome.setWindowChrome(topArgb, bottomArgb)
 * Both are '#AARRGGBB'. Called once on startup and again whenever the theme
 * changes, so picking a different theme in settings re-paints the strips
 * immediately — no restart, no hardcoded colour.
 *
 * On a plain browser (dev server, desktop) `window.ElectermChrome` is absent
 * and this module does nothing.
 *
 * Same feature as electerm-harmony's build-src/replace/client/web-components/
 * window-chrome.js, adapted to the Android bridge.
 */

// The two theme values that describe "what the chrome should look like".
const TOP_VAR = '--main-dark'
const BOTTOM_VAR = '--main'

// electerm-react writes the live theme into this <style> element.
const THEME_STYLE_ID = 'theme-css'

// How long to keep waiting for #theme-css to appear (ms). It is server-rendered
// empty in views/index.pug and filled by React after mount, so it exists early —
// but the element is replaced on some reload paths, hence the bounded wait.
const STYLE_WAIT_TIMEOUT = 5000
const STYLE_WAIT_INTERVAL = 50

function getNative () {
  try {
    const native = window.ElectermChrome
    return native && typeof native.setWindowChrome === 'function'
      ? native
      : null
  } catch (e) {
    return null
  }
}

// ---------------------------------------------------------------------------
// colour normalisation
// ---------------------------------------------------------------------------

function clampByte (n) {
  if (!isFinite(n)) return 0
  return Math.max(0, Math.min(255, Math.round(n)))
}

function hexByte (n) {
  return clampByte(n).toString(16).padStart(2, '0')
}

/**
 * '#rgb' / '#rgba' / '#rrggbb' / '#rrggbbaa' -> '#aarrggbb'.
 * CSS orders the channels RGB then A; Android's Color.parseColor wants ARGB,
 * so an 8-digit CSS colour has to be rotated, not just copied.
 */
function fromHex (value) {
  const m = /^#([0-9a-f]{3,8})$/i.exec(value)
  if (!m) return ''
  let h = m[1]
  if (h.length === 3 || h.length === 4) {
    h = h.split('').map(c => c + c).join('')
  }
  if (h.length === 6) return '#ff' + h.toLowerCase()
  if (h.length === 8) return ('#' + h.slice(6) + h.slice(0, 6)).toLowerCase()
  return ''
}

/**
 * One rgb() channel -> 0..255 byte. Both the legacy comma form and the
 * CSS Color 4 space form allow percentages, so `rgb(10% 20% 30%)` must work
 * the same as `rgb(26, 51, 77)`.
 */
function channelByte (token) {
  const text = String(token).trim()
  const isPercent = text.endsWith('%')
  const n = parseFloat(text)
  if (isNaN(n)) return NaN
  return clampByte(isPercent ? n * 255 / 100 : n)
}

/** Alpha channel -> 0..255 byte. Omitted means fully opaque. */
function alphaByte (token) {
  if (token === undefined) return 255
  const text = String(token).trim()
  if (!text) return 255
  const isPercent = text.endsWith('%')
  const n = parseFloat(text)
  if (isNaN(n)) return 255
  if (isPercent) return clampByte(n * 255 / 100)
  // rgba() alpha is 0..1; anything above that is already a 0..255 byte.
  return clampByte(n <= 1 ? n * 255 : n)
}

/** 'rgb(r,g,b)' / 'rgba(r,g,b,a)' / 'rgb(r g b / a)' -> '#aarrggbb'. */
function fromRgb (value) {
  const m = /^rgba?\(([^)]*)\)$/i.exec(value)
  if (!m) return ''
  const parts = m[1].split(/[,/\s]+/).filter(Boolean)
  if (parts.length < 3) return ''
  const channels = parts.slice(0, 3).map(channelByte)
  if (channels.some(n => isNaN(n))) return ''
  return '#' + hexByte(alphaByte(parts[3])) + channels.map(hexByte).join('')
}

/**
 * Resolve anything the two parsers above do not understand (named colours,
 * hsl(), ...) by letting the engine compute it: a throwaway element's `color`
 * always comes back as rgb()/rgba().
 */
function resolveViaEngine (value) {
  try {
    const probe = document.createElement('span')
    probe.style.display = 'none'
    probe.style.color = value
    // Assigning an invalid value leaves the property empty.
    if (!probe.style.color) return ''
    const host = document.body || document.documentElement
    host.appendChild(probe)
    const computed = getComputedStyle(probe).color
    host.removeChild(probe)
    return computed || ''
  } catch (e) {
    return ''
  }
}

/** Normalise any CSS colour to '#AARRGGBB', or '' when it cannot be resolved. */
export function toArgb (value) {
  if (value === undefined || value === null) return ''
  const raw = String(value).trim()
  if (!raw) return ''
  const direct = fromHex(raw) || fromRgb(raw)
  if (direct) return direct
  const resolved = resolveViaEngine(raw)
  return resolved ? (fromHex(resolved) || fromRgb(resolved)) : ''
}

// ---------------------------------------------------------------------------
// theme -> bridge
// ---------------------------------------------------------------------------

function currentChromeColors () {
  let style
  try {
    style = getComputedStyle(document.documentElement)
  } catch (e) {
    return null
  }
  const top = toArgb(style.getPropertyValue(TOP_VAR))
  const bottom = toArgb(style.getPropertyValue(BOTTOM_VAR))
  if (!top || !bottom) return null
  return { top, bottom }
}

// Last pair handed to the native side, so the observers (which fire for
// unrelated DOM churn too) cannot spam the window with identical calls.
let lastSent = ''
let pending = false

function apply () {
  pending = false
  const native = getNative()
  if (!native) return
  const colors = currentChromeColors()
  if (!colors) return
  const key = colors.top + '|' + colors.bottom
  if (key === lastSent) return
  lastSent = key
  try {
    native.setWindowChrome(colors.top, colors.bottom)
  } catch (e) {
    // Let the next change retry rather than wedging on a stale key.
    lastSent = ''
    console.warn('[electerm-android] setWindowChrome failed', e)
  }
}

function scheduleApply () {
  if (pending) return
  pending = true
  setTimeout(apply, 0)
}

/**
 * Watch for theme changes. electerm-react sets `style.innerHTML` on the
 * #theme-css element, which is a childList mutation; `:root` inline styles are
 * watched too because some theme paths set variables there directly.
 */
function installObservers (styleElement) {
  const observer = new MutationObserver(scheduleApply)
  observer.observe(styleElement, {
    childList: true,
    characterData: true,
    subtree: true
  })
  try {
    const rootObserver = new MutationObserver(scheduleApply)
    rootObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style', 'class']
    })
  } catch (e) {
    // documentElement not available yet — the #theme-css observer still works
  }
}

/**
 * Wire the sync up. Safe to call on any host: without the native bridge this
 * returns immediately and never touches the DOM.
 */
export function installWindowChromeSync () {
  if (!getNative()) return

  // Paint with whatever :root already holds (theme.styl ships dark defaults, so
  // this is immediately usable) — better than leaving the system colour up
  // while the bundle loads.
  apply()

  let waited = 0
  function waitForThemeStyle () {
    const styleElement = document.getElementById(THEME_STYLE_ID)
    if (styleElement) {
      installObservers(styleElement)
      apply()
      return
    }
    waited += STYLE_WAIT_INTERVAL
    if (waited >= STYLE_WAIT_TIMEOUT) {
      // #theme-css never showed up: the :root defaults are all we have.
      return
    }
    setTimeout(waitForThemeStyle, STYLE_WAIT_INTERVAL)
  }
  waitForThemeStyle()

  // Insurance for the mount window: the saved theme is applied shortly after
  // React mounts, and a re-read catches it even if the mutation is missed.
  setTimeout(apply, 400)
  setTimeout(apply, 1500)
}
