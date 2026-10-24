/**
 * Render the homepage to a static `dist/assets/index.html` at build time.
 *
 * The production server does not render pages: express.static serves this file
 * for `/`. That keeps the pug compiler (1.5 MB of the server bundle:
 * @babel/parser + @babel/types + acorn + pug-*) out of the Android app, and
 * takes the render off the request path entirely.
 *
 * The payload comes from src/app/lib/view-data.js — the same builder the dev
 * renderer uses — so the two cannot drift. Runtime-only values (HOME, session
 * and widget log paths) are deliberately left out: the build machine cannot
 * know them, and /api/get-constants delivers them once the app boots.
 *
 * The auth token IS baked in. It has to be: the page is what seeds
 * localStorage.tokenElecterm, and it is served before the app can call any API.
 * This is not a new exposure — SERVER_SECRET is already compiled into
 * index.js in the same APK, so anyone who can read the app can already mint a
 * token, and `/` was already handing one to any local caller. Signing without a
 * timestamp keeps the build reproducible (no `iat`/`exp` → same bytes every
 * build); the previous token lived 120 years, so expiry was never real here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SELF = fileURLToPath(import.meta.url)
const __dirname = path.dirname(SELF)
const ROOT = path.resolve(__dirname, '..', '..')

const DEFAULTS = {
  view: 'src/app/views/index.pug'
}

export async function generateIndexHtml ({
  outDir,
  view = DEFAULTS.view,
  secret,
  user,
  packInfo,
  version,
  siteName,
  root = ROOT
} = {}) {
  if (!outDir) {
    throw new Error('generateIndexHtml: outDir is required')
  }
  if (!secret) {
    throw new Error('generateIndexHtml: secret is required')
  }
  // runtime-constants resolves extIconPath (and isDev) from NODE_ENV at import
  // time, so pin the production branch regardless of how the build was invoked.
  process.env.NODE_ENV = 'production'

  const { default: pug } = await import('pug')
  const jwt = require('jsonwebtoken')
  const viewDataUrl = pathToFileURL(
    path.resolve(root, 'src/app/lib/view-data.js')
  ).href
  const { buildViewData } = await import(viewDataUrl)

  const tokenElecterm = jwt.sign(
    { id: user },
    secret,
    { noTimestamp: true }
  )

  const data = buildViewData({
    isDev: false,
    // the app only ever runs as a web app on Android
    isMac: false,
    isWin: false,
    cdn: '',
    server: '',
    query: {},
    // what the device's own package.json will contain (build.mjs writes it)
    packInfo,
    version,
    siteName,
    tokenElecterm
  })

  const html = pug.renderFile(path.resolve(root, view), data)

  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'index.html')
  let previous = ''
  try {
    previous = fs.readFileSync(outPath, 'utf8')
  } catch (e) {}
  const changed = previous !== html
  if (changed) {
    fs.writeFileSync(outPath, html)
  }
  return { outPath, bytes: html.length, changed }
}

// `node build/bin/gen-index-html.js --out <dir> --secret <s>`
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const args = process.argv.slice(2)
  const arg = (name, def) => {
    const i = args.indexOf('--' + name)
    return i === -1 ? def : args[i + 1]
  }
  const root = path.resolve(arg('root', ROOT))
  generateIndexHtml({
    outDir: path.resolve(root, arg('out', 'build/android/www/nodejs/dist/assets')),
    view: arg('view', DEFAULTS.view),
    secret: arg('secret', process.env.SERVER_SECRET),
    user: arg('user', process.env.SERVER_USER),
    version: arg('version', require(path.resolve(root, 'package.json')).version),
    siteName: arg('site-name', undefined),
    root
  }).then((r) => {
    console.log(
      '[gen-index] ' + (r.changed ? 'wrote ' : 'up to date: ') +
      path.relative(root, r.outPath) + ' (' + r.bytes + ' bytes)'
    )
  }).catch((e) => {
    console.error('[gen-index] failed:', e.message)
    process.exit(1)
  })
}
