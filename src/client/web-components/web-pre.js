import * as path from './path.js'
import message from '../electerm-react/components/common/message'

const {
  ipcOnEvent,
  ipcOffEvent,
  runGlobalAsync,
  getZoomFactor,
  setZoomFactor,
  runSync
} = window.api

// Encoding function
function encodeUint8Array (uint8Array) {
  let str = ''
  const len = uint8Array.byteLength

  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(uint8Array[i])
  }

  return btoa(str)
}

// Decoding function
function decodeBase64String (base64String) {
  const str = atob(base64String)
  const len = str.length

  const uint8Array = new Uint8Array(len)

  for (let i = 0; i < len; i++) {
    uint8Array[i] = str.charCodeAt(i)
  }

  return uint8Array
}

window.log = window.console

// Fallback clipboard copy using execCommand, for Android WebView where
// navigator.clipboard.writeText() may fail silently (non-secure http
// scheme, missing user-gesture context from antd Dropdown menu clicks,
// or Promise rejection that the try/catch does not catch).
// execCommand('copy') uses the WebView's internal clipboard mechanism
// which is connected to the Android system ClipboardManager.
function execCommandCopy (str) {
  const textarea = document.createElement('textarea')
  textarea.value = str
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  textarea.style.top = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  // For iOS Safari compatibility
  textarea.setSelectionRange(0, str.length)
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch (e) {
    // ignore
  }
  document.body.removeChild(textarea)
  return ok
}

window.pre = {
  resolve: (...args) => {
    return path.resolve(...args.map(d => d || ''))
  },
  transferKeys: [
    'pause',
    'resume',
    'destroy'
  ],
  // Safe defaults for API-dependent data to prevent render crashes
  // before /api/get-constants response arrives (fixes Android info-modal
  // showing only background with no content)
  osInfoData: [],
  osInfo: () => { return window.pre.osInfoData || [] },
  extIconPath: window.et.extIconPath,
  readClipboard: () => {
    return window.et.clipboard || ''
  },

  writeClipboard: str => {
    window.et.clipboard = str
    if (!navigator.clipboard) {
      // navigator.clipboard not available — use execCommand fallback
      // (works in Android WebView via the system ClipboardManager)
      if (!execCommandCopy(str)) {
        message.error('Clipboard API not available')
      }
      return
    }
    try {
      const promise = navigator.clipboard.writeText(str)
      // Handle Promise rejection — the try/catch above only catches
      // synchronous errors, not async rejections. On Android WebView,
      // writeText() may reject because the page is served over http://
      // (not a secure context) or the user-gesture requirement is not
      // satisfied from a Dropdown menu click.
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {
          execCommandCopy(str)
        })
      }
      return promise
    } catch (err) {
      // Synchronous error — try execCommand fallback
      if (!execCommandCopy(str)) {
        message.error('Failed to copy text: ' + err)
      }
    }
  },
  readClipboardSync: function readClipboard () {
    if (!navigator.clipboard) {
      // Fallback: return in-memory clipboard value (may be stale if the
      // user copied via the WebView's native text selection, but there
      // is no synchronous clipboard read API available in this case).
      return window.et.clipboard || ''
    }
    try {
      return navigator.clipboard.readText()
    } catch (err) {
      // Fallback: return in-memory clipboard value
      return window.et.clipboard || ''
    }
  },

  // writeClipboard: function writeClipboard (str) {
  //   if (!navigator.clipboard) {
  //     message.error('Clipboard API not available')
  //     return
  //   }
  //   try {
  //     return navigator.clipboard.writeText(str)
  //   } catch (err) {
  //     message.error('Failed to copy text: ' + err)
  //   }
  // },
  showItemInFolder: (href) => runSync('showItemInFolder', href),
  ipcOnEvent,
  ipcOffEvent,
  getZoomFactor,
  setZoomFactor,
  openExternal: (url) => {
    window.open(url, '_blank')
  },
  runSync,
  runGlobalAsync,
  versions: {}
}

// Ensure window.et.packInfo has all fields required by info-modal.jsx
// On Android/Capacitor the packInfo is minimal and missing author/bugs/releases/etc.
const _packInfoDefaults = {
  author: {
    name: 'ZHAO Xudong',
    email: 'zxdong@gmail.com',
    url: 'https://github.com/zxdong262'
  },
  homepage: 'https://electerm.org',
  bugs: {
    url: 'https://github.com/electerm/electerm/issues'
  },
  releases: 'https://github.com/electerm/electerm/releases',
  sponsorLink: 'https://electerm.org/sponsor-electerm/',
  knownIssuesLink: 'https://github.com/electerm/electerm/wiki/Known-issues',
  langugeRepo: 'https://github.com/electerm/electerm-languages'
}
if (window.et.packInfo) {
  window.et.packInfo = {
    ...window.et.packInfo,
    ..._packInfoDefaults
  }
}

const fs = {
  stat: (path, cb) => {
    window.fs.statCustom(path)
      .catch(err => cb(err))
      .then(obj => {
        obj.isDirectory = () => obj.isD
        obj.isFile = () => obj.isF
        cb(undefined, obj)
      })
  },
  access: (...args) => {
    const cb = args.pop()
    window.fs.access(...args)
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  },
  open: (...args) => {
    const cb = args.pop()
    window.fs.openCustom(...args)
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  },
  read: (p1, arr, ...args) => {
    const cb = args.pop()
    window.fs.readCustom(
      p1,
      encodeUint8Array(arr),
      ...args
    )
      .then((data) => {
        const { n, newArr } = data
        const newArr1 = decodeBase64String(newArr)
        cb(undefined, n, newArr1)
      })
      .catch(err => cb(err))
  },
  close: (fd, cb) => {
    window.fs.closeCustom(fd)
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  },
  readdir: (p, cb) => {
    window.fs.readdir(p)
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  },
  mkdir: (...args) => {
    const cb = args.pop()
    window.fs.mkdir(...args)
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  },
  write: (p1, buf, cb) => {
    window.fs.writeCustom(p1, encodeUint8Array(buf))
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  },
  realpath: (p, cb) => {
    window.fs.realpath(p)
      .then((data) => cb(undefined, data))
      .catch((err) => cb(err))
  }
}

window.reqs = {
  path,
  fs
}

function require (name) {
  return window.reqs[name]
}

require.resolve = name => name

window.require = require
