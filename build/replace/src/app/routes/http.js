import { randomBytes } from 'node:crypto'
import { bp } from '../server/base-path.js'
import { mountWidgetAssets } from '../widgets/client-assets.js'
import express from 'express'
import { login } from '../lib/login.js'
import { index } from '../lib/view.js'
import { getConstants } from '../lib/get-constants.js'
import { resolve } from 'path'
import {
  cwd,
  isDev
} from '../common/runtime-constants.js'
import {
  jwtAuth,
  errHandler
} from '../lib/jwt.js'
import { fileTransferRoutes } from './file-transfer.js'
import { widgetUIRoutes } from './widget-ui.js'
import { iconRoutes } from './icon.js'

export function httpRoutes (app) {
  // No "/" route in production: build/bin/gen-index-html.js writes
  // dist/assets/index.html at build time and express.static (below) serves it.
  // Only a dev run renders the template, and only a dev run needs the pug view
  // engine — see lib/view.js and server/server.js.
  if (isDev) {
    app.get('/', index)
  }
  app.post('/api/login', login)
  // Frames and stylesheets cannot send the native client's JWT header.
  // Grant access only to widget assets after a verified bootstrap request.
  const assetKey = randomBytes(32).toString('hex')
  app.get('/api/get-constants', jwtAuth, errHandler, (req, res, next) => {
    res.cookie('electerm_assets', assetKey, {
      httpOnly: true, sameSite: 'strict', secure: req.secure, path: bp('/api/widget-assets')
    })
    next()
  }, getConstants)
  mountWidgetAssets(app, (req, res, next) => {
    const cookies = (req.headers.cookie || '').split(';').map(pair => pair.trim())
    if (cookies.includes('electerm_assets=' + assetKey)) return next()
    res.sendStatus(401)
  })
  fileTransferRoutes(app, [jwtAuth, errHandler])
  // downloaded bookmark icons, `<data dir>/icons`; an <img> is the client, so
  // no token — see the notes in the file
  iconRoutes(app)
  // a widget's own <iframe> document and its assets; no token, see the file
  widgetUIRoutes(app)
  if (isDev) {
    app.use(express.static(
      resolve(cwd, 'node_modules')
    ))
    app.use(express.static(
      resolve(cwd, 'src/client/statics')
    ))
  } else {
    app.use(express.static(
      resolve(cwd, 'dist/assets')
    ))
  }
}
