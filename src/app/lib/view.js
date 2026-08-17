/**
 * simple login with password only
 */

import {
  isDev,
  isMac,
  isWin,
  packInfo,
  home,
  extIconPath,
  defaultUserName,
  cwd
} from '../common/runtime-constants.js'
import { migrationNotice } from './fancy-console.js'
import fsFunctions from '../common/fs-functions.js'
import copy from 'json-deep-copy'
import { createToken } from './jwt.js'
import { logDir } from '../server/session-log.js'
import { resolve } from 'path'
import fs from 'fs'

const defaultAIPreset = {
  baseURLAI: 'https://ai.electerm.org/api/ai',
  apiPathAI: '/chat/completions',
  modelAI: 'mistral-small-latest',
  authHeaderNameAI: 'Authorization: Bearer',
  id: 'ai.electerm.org',
  nameAI: 'ai.electerm.org(default free)'
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
    supportSessionTypes
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
