import { verify, jwtAuth, errHandler } from '../lib/jwt.js'
import express from 'express'
import { wsRoutes } from '../routes/ws.js'
import { httpRoutes } from '../routes/http.js'
import { applyExtensions } from '../lib/extensions.js'
import morgan from 'morgan'
import {
  isDev,
  cwd
} from '../common/runtime-constants.js'
import { stripBasePath } from './base-path.js'
import { resolve } from 'path'
import log from '../common/log.js'
import { applySystemCAsToGlobalAgent } from '../lib/system-ca.js'
import globalState from './global-state.js'
import { configure as configureCssBus } from '../widgets/css-bus.js'

export async function createApp () {
  const loadedCount = applySystemCAsToGlobalAgent()
  if (loadedCount > 0) {
    log.info(`[TLS] loaded ${loadedCount} system CA certificate(s) into main process`)
  }

  const app = express()
  // optional BASE_PATH sub-path, see ./base-path.js
  app.use(stripBasePath())
  // parse application/x-www-form-urlencoded
  app.use(express.urlencoded({ extended: true }))

  // parse application/json
  app.use(express.json())

  app.use(morgan(
    ':method :url :status :res[content-length] - :response-time ms'
  ))
  app.set('x-powered-by', false)

  // The pug view engine exists for `npm run dev` only. In production the
  // homepage is dist/assets/index.html, written by build/bin/gen-index-html.js,
  // so nothing renders a template and the compiler is never loaded: `pug` is
  // kept external in the esbuild config and this branch is dead on device.
  if (isDev) {
    const { default: pug } = await import('pug')
    app.set('view engine', 'pug')
    app.engine('pug', pug.__express)
    app.set('views', resolve(cwd, 'src/app/views'))
  }

  httpRoutes(app)
  wsRoutes(app, {
    verifyClient: ({ req }) => {
      try {
        const token = new URL(req.url, 'http://localhost').searchParams.get('token')
        return verify(token).id === process.env.SERVER_USER
      } catch {
        return false
      }
    },
    trackSocket: () => {}
  })
  // Widget stylesheets are applied in the renderer, so a widget's css has to
  // reach the browser: this is the web app's counterpart of the desktop
  // ipc broadcast (see ipc.js and client/common/widget-style-host.js). A tab
  // that loads while widgets are running asks getWidgetStyles instead.
  configureCssBus(payload => {
    const ws = globalState.getCommonWs()
    if (!ws || ws.readyState !== 1 || typeof ws.s !== 'function') {
      return
    }
    try {
      ws.s({ type: 'widget-css', ...payload })
    } catch (e) {
      log.error('widget css broadcast fails', e)
    }
  })
  await applyExtensions(app, (req, res, next) => jwtAuth(req, res, err => err ? errHandler(err, req, res, next) : next()))
  return app
}
