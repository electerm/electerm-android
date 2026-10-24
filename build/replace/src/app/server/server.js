import express from 'express'
import { wsRoutes } from '../routes/ws.js'
import { httpRoutes } from '../routes/http.js'
import { applyExtensions } from '../lib/extensions.js'
import morgan from 'morgan'
import {
  isDev,
  cwd
} from '../common/runtime-constants.js'
import { resolve } from 'path'
import log from '../common/log.js'
import { applySystemCAsToGlobalAgent } from '../lib/system-ca.js'

export async function createApp () {
  const loadedCount = applySystemCAsToGlobalAgent()
  if (loadedCount > 0) {
    log.info(`[TLS] loaded ${loadedCount} system CA certificate(s) into main process`)
  }

  const app = express()
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
  wsRoutes(app)
  await applyExtensions(app)
  return app
}
