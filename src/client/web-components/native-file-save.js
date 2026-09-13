/**
 * Native file save for the Android WebView build.
 *
 * Problem: the stock "download from browser" flow (fetch -> blob: URL ->
 * `<a download>.click()`) is a no-op inside Android WebView — WebView has no
 * download handling for `blob:` URLs / the `download` attribute unless the
 * native side installs a DownloadListener, which Capacitor does not.
 *
 * The electerm UI runs on the on-device Node backend (http://127.0.0.1:5577),
 * which is NOT Capacitor's own origin. Capacitor only injects its plugin
 * runtime (window.Capacitor + PluginHeaders) into documents it serves itself,
 * so on the real UI page `registerPlugin()` silently falls back to the plugin's
 * *web* implementation — the blob-anchor download above. A Capacitor plugin
 * therefore cannot be relied on here.
 *
 * Fix: the app's MainActivity attaches a small purpose-built bridge
 * (`window.ElectermNative`, see ElectermSaveBridge.java). It streams
 * /api/download straight into the public Downloads collection via MediaStore,
 * so the file is visible in the Android file manager — unlike the app-private
 * sandbox (`getFilesDir()/...`), which third-party file managers cannot list.
 *
 * Layout of the chain, best first:
 *   1. window.ElectermNative  - works on the Node-served UI page (Android app)
 *   2. @capgo/capacitor-file-sharer - only where Capacitor's runtime exists
 *   3. blob anchor click      - desktop browser
 *
 * Only `window.et.downloadFromBrowser(serverPath)` is consumed by upstream
 * electerm-react (sftp/file-item.jsx); `saveBlobNative` / `saveTextNative`
 * are extra hooks used by our own dialogs (file-select-dialog,
 * common/download).
 */

import message from '../electerm-react/components/common/message'

let cachedSaver = null

// ---------------------------------------------------------------------------
// window.ElectermNative bridge plumbing
// ---------------------------------------------------------------------------

const nativeCalls = new Map()
let nativeSeq = 0
// A download can legitimately take a while (a directory is tarred on the fly),
// but a hung call must not leave the UI waiting forever.
const nativeCallTimeout = 10 * 60 * 1000

function getElectermNative () {
  try {
    const native = window.ElectermNative
    return native && typeof native.getVersion === 'function' ? native : null
  } catch (e) {
    return null
  }
}

// Called from Java (ElectermSaveBridge.report) on the WebView thread.
function onNativeSaveResult (callbackId, ok, dataJson, error) {
  const pending = nativeCalls.get(callbackId)
  if (!pending) return
  nativeCalls.delete(callbackId)
  clearTimeout(pending.timer)
  if (!ok) {
    pending.reject(new Error(error || 'native save failed'))
    return
  }
  let data = {}
  try {
    data = dataJson ? JSON.parse(dataJson) : {}
  } catch (e) {
    data = {}
  }
  pending.resolve(data)
}

window.__etNativeSaveResult = onNativeSaveResult

function callElectermNative (method, args) {
  const native = getElectermNative()
  if (!native) return Promise.reject(new Error('ElectermNative unavailable'))
  const callbackId = 'et-' + (++nativeSeq) + '-' + Date.now()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeCalls.delete(callbackId)
      reject(new Error('native save timed out'))
    }, nativeCallTimeout)
    nativeCalls.set(callbackId, { resolve, reject, timer })
    try {
      native[method].apply(native, args.concat([callbackId]))
    } catch (e) {
      nativeCalls.delete(callbackId)
      clearTimeout(timer)
      reject(e)
    }
  })
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function basenameOf (p) {
  if (!p) return 'download'
  const parts = String(p).split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : 'download'
}

function parseDispositionFilename (header, fallback) {
  if (header) {
    // RFC 5987 first: filename*=UTF-8''...
    const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header)
    if (star && star[1]) {
      try {
        const decoded = decodeURIComponent(star[1].replace(/"/g, ''))
        if (decoded) return decoded
      } catch (e) {
        // fall through to plain filename
      }
    }
    const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i.exec(header)
    const name = plain && (plain[1] || plain[2])
    if (name) {
      try {
        return decodeURIComponent(name.trim())
      } catch (e) {
        return name.trim()
      }
    }
  }
  return fallback
}

function guessContentType (filename, headerType) {
  if (headerType && headerType !== 'application/octet-stream') return headerType
  const ext = String(filename).split('.').pop().toLowerCase()
  if (ext === 'gz' || ext === 'tgz') return 'application/gzip'
  if (ext === 'zip') return 'application/zip'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'txt' || ext === 'log' || ext === 'md') return 'text/plain'
  if (ext === 'json') return 'application/json'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

// btoa() on the whole string at once blows the stack for large files,
// convert in 32k chunks.
function uint8ToBase64 (u8) {
  let out = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    out += String.fromCharCode.apply(null, u8.subarray(i, i + chunk))
  }
  return btoa(out)
}

function absoluteUrl (u) {
  try {
    return new URL(u, window.location.href).href
  } catch (e) {
    return u
  }
}

function currentToken () {
  try {
    return (window.store && window.store.config && window.store.config.tokenElecterm) || ''
  } catch (e) {
    return ''
  }
}

function isNativePlatform () {
  try {
    // Capacitor core itself detects android via window.androidBridge (the
    // native JavascriptInterface, attached to the WebView so it survives
    // top-level navigation to the on-device backend at 127.0.0.1).
    // window.Capacitor may be missing if the injected runtime hasn't run,
    // so check the bridge first and only then consult window.Capacitor.
    if (typeof window !== 'undefined' && window.androidBridge) return true
    const cap = window.Capacitor
    if (!cap) return false
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform()
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web'
    return !!cap.isNative
  } catch (e) {
    return false
  }
}

// The stock `<a download>` flow is a silent no-op inside Android WebView.
// Detect it via the "; wv)" UA token so we can show an error instead of
// pretending the download worked.
function isAndroidWebView () {
  try {
    return /; wv\)/.test(window.navigator.userAgent || '')
  } catch (e) {
    return false
  }
}

// True only when the NATIVE FileSharer implementation is reachable.
// registerPlugin() with a `web` fallback silently uses the anchor-click
// web implementation when the native plugin header is missing (i.e. the page
// is not served from Capacitor's own origin, or `cap sync` didn't pick up the
// dependency) — that web path is a no-op in the WebView, so we must not
// mistake it for a working native saver.
function hasNativeFileSharer () {
  try {
    const cap = window.Capacitor
    const headers = cap && cap.PluginHeaders
    return !!(headers && headers.some(h => h && h.name === 'FileSharer'))
  } catch (e) {
    return false
  }
}

async function getFileSharer () {
  if (cachedSaver !== null) return cachedSaver
  try {
    const mod = await import('@capgo/capacitor-file-sharer')
    cachedSaver = mod && mod.FileSharer ? mod.FileSharer : false
  } catch (e) {
    cachedSaver = false
  }
  return cachedSaver
}

export async function canSaveNative () {
  if (getElectermNative()) return true
  if (!isNativePlatform()) return false
  if (!hasNativeFileSharer()) return false
  const saver = await getFileSharer()
  return !!saver
}

// Diagnostic helper for on-device debugging (remote inspector console):
//   await window.et.downloadDiag()
// Reports each link of the download chain so a broken one is identifiable.
export async function downloadDiag () {
  const native = getElectermNative()
  let nativeVersion = null
  try {
    if (native) nativeVersion = native.getVersion()
  } catch (e) {
    nativeVersion = 'error: ' + (e && e.message)
  }
  const info = {
    hasElectermNative: !!native,
    electermNativeVersion: nativeVersion,
    hasCapacitor: !!(window.Capacitor),
    hasAndroidBridge: !!(typeof window !== 'undefined' && window.androidBridge),
    capacitorPlatform: null,
    isNativePlatform: isNativePlatform(),
    hasNativeFileSharerHeader: hasNativeFileSharer(),
    fileSharerModuleLoaded: false,
    isAndroidWebView: isAndroidWebView(),
    userAgent: (window.navigator && window.navigator.userAgent) || ''
  }
  try {
    if (window.Capacitor && typeof window.Capacitor.getPlatform === 'function') {
      info.capacitorPlatform = window.Capacitor.getPlatform()
    }
  } catch (e) {
    info.capacitorPlatform = 'error: ' + (e && e.message)
  }
  try {
    const saver = await getFileSharer()
    info.fileSharerModuleLoaded = !!saver
  } catch (e) {
    info.fileSharerModuleLoaded = 'error: ' + (e && e.message)
  }
  try {
    console.log('[electerm-android] downloadDiag:', JSON.stringify(info))
  } catch (e) {}
  return info
}

async function saveBase64Native ({ filename, base64Data, contentType }) {
  const FileSharer = await getFileSharer()
  if (!FileSharer) throw new Error('native file saver unavailable')
  const res = await FileSharer.save({
    filename,
    base64Data,
    contentType,
    android: {
      saveDirectory: 'downloads'
    }
  })
  return res && res.uri
}

export async function saveBlobNative (filename, blob, contentType) {
  const type = contentType || blob.type || guessContentType(filename)
  if (getElectermNative()) {
    const buf = new Uint8Array(await blob.arrayBuffer())
    const res = await callElectermNative('saveBase64', [filename, uint8ToBase64(buf), type])
    return res && res.location
  }
  const base64Data = uint8ToBase64(new Uint8Array(await blob.arrayBuffer()))
  return saveBase64Native({ filename, base64Data, contentType: type })
}

export async function saveTextNative (filename, text) {
  const bytes = new TextEncoder().encode(text || '')
  if (getElectermNative()) {
    const res = await callElectermNative('saveBase64', [
      filename,
      uint8ToBase64(bytes),
      guessContentType(filename, 'text/plain')
    ])
    return res && res.location
  }
  return saveBase64Native({
    filename,
    base64Data: uint8ToBase64(bytes),
    contentType: guessContentType(filename, 'text/plain')
  })
}

function anchorDownloadFallback (filename, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

/**
 * Replacement for the broken-in-WebView blob-anchor download.
 * Fetches /api/download (token header included) and saves the result to
 * the public Downloads collection via MediaStore when running natively.
 * On plain desktop web it falls back to the classic blob-anchor download.
 * Inside Android WebView WITHOUT a working native saver it reports an
 * error instead of silently no-op anchor clicking.
 */
export async function downloadPathFromServer (serverPath) {
  const fallbackName = basenameOf(serverPath)
  const url = '/api/download?path=' + encodeURIComponent(serverPath)

  // 1. Purpose-built native bridge. Streams the response natively, so the
  //    file never has to pass through JS memory.
  if (getElectermNative()) {
    try {
      const res = await callElectermNative('saveUrl', [
        absoluteUrl(url),
        currentToken(),
        fallbackName
      ])
      const name = (res && res.name) || fallbackName
      message.success('Saved to Downloads: ' + name)
      return (res && res.location) || name
    } catch (err) {
      console.log('[electerm-android] native save failed:', err)
      message.error('Save failed: ' + (err && err.message))
      return
    }
  }

  let res
  try {
    res = await window.api.fetch(url)
  } catch (err) {
    const onError = window.store && window.store.onError
    if (onError) onError(err)
    else message.error('Download failed: ' + (err && err.message))
    return
  }
  if (!res) return
  const headerType = res.headers && res.headers.get
    ? res.headers.get('content-type')
    : ''
  const disposition = res.headers && res.headers.get
    ? res.headers.get('content-disposition')
    : ''
  let filename = parseDispositionFilename(disposition, fallbackName)
  // Backend tars directories but only signals it via headers; if the
  // disposition parse missed it, restore the .tar.gz suffix.
  if (filename === fallbackName && headerType === 'application/gzip' && !/\.tar\.gz$/i.test(filename)) {
    filename = filename + '.tar.gz'
  }
  const blob = await res.blob()
  if (await canSaveNative()) {
    try {
      const uri = await saveBlobNative(filename, blob, headerType || undefined)
      message.success('Saved to Downloads: ' + filename + (uri ? ' (' + uri + ')' : ''))
      return uri
    } catch (err) {
      console.log('[electerm-android] native save failed:', err)
      message.error('Save failed: ' + (err && err.message))
      return
    }
  }
  // No native saver. On a real desktop browser the anchor fallback works;
  // inside Android WebView it is a silent no-op, so report instead of
  // pretending the download happened. NOTE: on Android 10+ the MediaStore
  // save needs no storage permission — the absence of a permission popup
  // is normal; success is the "Saved to Downloads" toast above.
  if (isAndroidWebView() || isNativePlatform()) {
    downloadDiag()
    message.error(
      'Download failed: native file saver unavailable' +
      (hasNativeFileSharer() ? '' : ' (FileSharer plugin not registered)') +
      '. Check Downloads / retry.'
    )
    return
  }
  anchorDownloadFallback(filename, blob)
}

export function installDownloadFromBrowserHook () {
  if (!window.et) window.et = {}
  window.et.downloadFromBrowser = downloadPathFromServer
  window.et.saveBlobNative = saveBlobNative
  window.et.saveTextNative = saveTextNative
  window.et.downloadDiag = downloadDiag
  window.et.canSaveNative = canSaveNative
  // Log the download chain state once at startup so `adb logcat` /
  // remote-inspector captures it without manual repro steps.
  try {
    downloadDiag()
  } catch (e) {}
}
