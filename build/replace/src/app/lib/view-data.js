/**
 * The `window.et` payload for the homepage.
 *
 * Two callers build it and they must agree on the shape:
 *
 *   - lib/view.js                      dev only, renders index.pug per request
 *   - build/bin/gen-index-html.js      prod, renders index.html once at build time
 *
 * Everything that only the running server knows (absolute paths, the auth
 * token, the request query) is a parameter rather than an import. The build
 * machine cannot know the device's `HOME`, `sessionLogPath` or `widgetLogPath`,
 * so the generated production page leaves those keys out entirely and the app
 * picks them up from /api/get-constants once it boots. Anything added here that
 * is *not* a parameter is therefore frozen into the build — keep it that way:
 * no paths, no clocks, no secrets.
 */
import { packInfo as packInfoEnv, extIconPath } from '../common/runtime-constants.js'
import fsFunctions from '../common/fs-functions.js'
import copy from 'json-deep-copy'

const defaultAIPreset = {
  baseURLAI: 'https://ai.electerm.org/api/ai',
  apiPathAI: '/chat/completions',
  modelAI: 'free',
  authHeaderNameAI: 'Authorization: Bearer',
  id: 'ai.electerm.org',
  nameAI: 'ai.electerm.org'
}

// All session types the app knows about.
const supportSessionTypes = [
  'ssh',
  'telnet',
  'web',
  'rdp',
  'vnc',
  'ftp',
  'spice'
]

// eg: window.et.sysMenus = ['onNewSsh', 'bookmarks', 'openSetting', 'close']
// available keys: onNewSsh, addTab, bookmarks, history, sessions, layout,
// openAbout, openSetting, openDevTools, zoom, minimize, maximize, reload,
// onCheckUpdate, restart, close
const sysMenus = [
  'onNewSsh',
  'openSetting',
  'openAbout',
  'zoom',
  'reload'
]

export function buildViewData (opts = {}) {
  const { cdn = '' } = opts
  // `packInfo` is the *node project's* package.json as the device sees it. At
  // build time runtime-constants reads this repo's package.json instead, which
  // is ~6 KB of dependencies and scripts — never ship that to the page.
  const packInfo = opts.packInfo || packInfoEnv
  const data = {
    isDev: !!opts.isDev,
    isMac: !!opts.isMac,
    isWin: !!opts.isWin,
    packInfo,
    version: opts.version || packInfo.version,
    siteName: opts.siteName || packInfo.name,
    defaultAIPreset,
    fsFunctions,
    isWebApp: true,
    disableUpgradeCheck: false,
    versionFile: 'version-android.html',
    downloadUpgradeFromBrowser: true,
    extIconPath: cdn + extIconPath,
    cdn,
    query: opts.query || {},
    server: opts.server || '',
    hasNodePty: false,
    needMigrate: false,
    supportSessionTypes,
    sysMenus
  }
  // Runtime-only values. Omitted from the build-time page on purpose: see the
  // header comment. `undefined` here means "not known yet", not "empty".
  for (const key of ['home', 'sessionLogPath', 'widgetLogPath', 'tokenElecterm']) {
    if (opts[key] !== undefined) {
      data[key] = opts[key]
    }
  }
  data._global = copy(data)
  return data
}
