/**
 * Native file save for the Android WebView build.
 *
 * Problem: the stock "download from browser" flow (fetch -> blob: URL ->
 * `<a download>.click()`) is a no-op inside Android WebView — WebView has no
 * download handling for `blob:` URLs / the `download` attribute unless the
 * native side installs a DownloadListener, which Capacitor does not.
 *
 * Fix: save through the @capgo/capacitor-file-sharer plugin instead. Its
 * `save()` writes to MediaStore/Downloads on Android 10+ (and the matching
 * public directory on older versions), so the file is visible in the Android
 * file browser — unlike the app-private sandbox (`getFilesDir()/...`), which
 * third-party file managers cannot list. On plain web the plugin's web
 * implementation falls back to a normal browser download, so this module is
 * safe to install everywhere.
 *
 * Only `window.et.downloadFromBrowser(serverPath)` is consumed by upstream
 * electerm-react (sftp/file-item.jsx); `saveBlobNative` / `saveTextNative`
 * are extra hooks used by our own dialogs (file-select-dialog,
 * common/download).
 */

import message from '../electerm-react/components/common/message'

let cachedSaver = null

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

function isNativePlatform () {
  try {
    const cap = window.Capacitor
    if (!cap) return false
    if (typeof cap.isNativePlatform === 'function') return cap.isNativePlatform()
    if (typeof cap.getPlatform === 'function') return cap.getPlatform() !== 'web'
    return !!cap.isNative
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
  if (!isNativePlatform()) return false
  const saver = await getFileSharer()
  return !!saver
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
  const buf = new Uint8Array(await blob.arrayBuffer())
  const base64Data = uint8ToBase64(buf)
  const type = contentType || blob.type || guessContentType(filename)
  const FileSharer = await getFileSharer()
  if (!FileSharer) throw new Error('native file saver unavailable')
  return saveBase64Native({ filename, base64Data, contentType: type })
}

export async function saveTextNative (filename, text) {
  const bytes = new TextEncoder().encode(text || '')
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
 * the public Downloads collection via MediaStore when running natively,
 * otherwise falls back to the classic blob-anchor download.
 */
export async function downloadPathFromServer (serverPath) {
  const fallbackName = basenameOf(serverPath)
  const url = '/api/download?path=' + encodeURIComponent(serverPath)
  const res = await window.api.fetch(url).catch(window.store && window.store.onError)
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
      message.error('Save failed, downloading in browser instead: ' + (err && err.message))
    }
  }
  anchorDownloadFallback(filename, blob)
}

export function installDownloadFromBrowserHook () {
  if (!window.et) window.et = {}
  window.et.downloadFromBrowser = downloadPathFromServer
  window.et.saveBlobNative = saveBlobNative
  window.et.saveTextNative = saveTextNative
}
