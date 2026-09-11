/**
 * simple login with password only
 */

import {
  isDev,
  isMac,
  isWin,
  packInfo,
  home,
  extIconPath
} from '../common/runtime-constants.js'
import fsFunctions from '../common/fs-functions.js'
import copy from 'json-deep-copy'
import { createToken } from './jwt.js'
import { logDir } from '../server/session-log.js'
const defaultAIPreset = {
  baseURLAI: 'https://ai.electerm.org/api/ai',
  apiPathAI: '/chat/completions',
  modelAI: 'free',
  authHeaderNameAI: 'Authorization: Bearer',
  id: 'ai.electerm.org',
  nameAI: 'ai.electerm.org'
}

function buildServer () {
  return `http://${process.env.HOST}:${process.env.PORT}`
}

export async function index (req, res) {
  const server = process.env.SERVER || (isDev ? buildServer() : '')
  const cdn = process.env.CDN || server
  const hasNodePty = false
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
  const data = {
    isDev,
    isMac,
    isWin,
    packInfo,
    home,
    version: packInfo.version,
    siteName: packInfo.name,
    defaultAIPreset,
    fsFunctions,
    isWebApp: true,
    disableUpgradeCheck: false,
    versionFile: 'version-android.html',
    downloadUpgradeFromBrowser: true,
    extIconPath: cdn + extIconPath,
    cdn,
    sessionLogPath: logDir,
    query: req.query,
    server,
    hasNodePty,
    needMigrate: false,
    supportSessionTypes,
    // eg: window.et.sysMenus = ['onNewSsh', 'bookmarks', 'openSetting', 'close']
    // available keys: onNewSsh, addTab, bookmarks, history, sessions, layout,
    // openAbout, openSetting, openDevTools, zoom, minimize, maximize, reload,
    // onCheckUpdate, restart, close
    sysMenus: [
      'onNewSsh',
      'openSetting',
      'openAbout',
      'zoom',
      'reload'
    ]
  }
  const {
    ENABLE_AUTH
  } = process.env
  if (!ENABLE_AUTH) {
    data.tokenElecterm = createToken()
  }
  data._global = copy(data)
  res.render('index', data)
}
