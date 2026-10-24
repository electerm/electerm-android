/**
 * simple login with password only
 *
 * Development only. In production the homepage is a static file:
 * build/bin/gen-index-html.js renders `index.pug` once at build time into
 * `dist/assets/index.html`, which express.static serves — no template engine, no
 * per-request render, and the pug compiler (1.5 MB of the server bundle) stays
 * out of the app.
 *
 * Both paths build the payload through lib/view-data.js so the dev page and the
 * generated page cannot drift apart.
 */

import {
  isDev,
  isMac,
  isWin,
  home
} from '../common/runtime-constants.js'
import { createToken } from './jwt.js'
import { logDir } from '../server/session-log.js'
import { getLogDir } from '../widgets/instance-log.js'
import { buildViewData } from './view-data.js'

function buildServer () {
  return `http://${process.env.HOST}:${process.env.PORT}`
}

export async function index (req, res) {
  const server = process.env.SERVER || (isDev ? buildServer() : '')
  const cdn = process.env.CDN || server
  const data = buildViewData({
    isDev,
    isMac,
    isWin,
    cdn,
    server,
    home,
    sessionLogPath: logDir,
    widgetLogPath: getLogDir(),
    query: req.query,
    // The web UI auto-logs-in while ENABLE_AUTH is unset, which is how a
    // password-less install gets a usable API token.
    tokenElecterm: process.env.ENABLE_AUTH ? undefined : createToken()
  })
  res.render('index', data)
}
