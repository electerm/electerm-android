/**
 * Build the electerm Android web bundle.
 *
 * Produces `build/android/www`, which Capacitor copies into the native app:
 *   - www/index.html              local "loading" page (waits for the Node backend)
 *   - www/nodejs                  the electerm Node.js project, run on-device by
 *                                 @capawesome/capacitor-nodejs. It serves the real
 *                                 UI + the SSH/SFTP/telnet/ftp/RDP/VNC/Spice API on
 *                                 http://127.0.0.1:5577.
 *
 * Steps:
 *   1. vite build the frontend  -> www/nodejs/dist/assets
 *   2. copy static assets (icons, images, views) into the node project
 *   3. esbuild bundle the backend -> www/nodejs/app.bundle.mjs. Native modules
 *      that are not built for Android yet (node-pty, serialport, node-bash,
 *      font-list) are kept *external*: the source loads them via guarded
 *      `import()` calls that fall back gracefully, so a missing module never
 *      prevents the server from starting. Logging uses a built-in dependency-free
 *      logger (no `electron-log`), and `node:sqlite` is replaced by a sql.js-backed
 *      shim (the on-device runtime is Node 18, which has no built-in `node:sqlite`).
 */
import { build as viteBuild } from 'vite'
import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..', '..') // build/android -> repo root

// Make every path that reads process.cwd() resolve against the repo root,
// regardless of where this script is invoked from.
process.chdir(ROOT)

const WWW = path.resolve(__dirname, 'www')
const NODEJS_DIR = path.resolve(WWW, 'nodejs')
const VERSION = JSON.parse(
  fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8')
).version

// --------------------------------------------------------------------------
// 1. Frontend
// --------------------------------------------------------------------------
async function runVite () {
  console.log('[android] building frontend (vite)…')
  await viteBuild({
    configFile: path.resolve(__dirname, 'vite.android.mjs'),
    root: ROOT,
    logLevel: 'warn'
  })
}

// --------------------------------------------------------------------------
// 2. Static assets for the node project
// --------------------------------------------------------------------------
function copyDir (from, to) {
  if (!fs.existsSync(from)) {
    console.warn('[android] skip missing source:', from)
    return
  }
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name)
    const d = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

function copyFrontendAssets () {
  console.log('[android] copying static assets into node project…')
  const assets = path.resolve(NODEJS_DIR, 'dist', 'assets')

  copyDir(path.resolve(ROOT, 'src/client/statics'), assets)
  copyDir(
    path.resolve(ROOT, 'node_modules/electerm-icons/icons'),
    path.resolve(assets, 'icons')
  )
  copyDir(
    path.resolve(ROOT, 'node_modules/@electerm/electerm-resource/res/imgs'),
    path.resolve(assets, 'images')
  )
  copyDir(
    path.resolve(ROOT, 'node_modules/@electerm/electerm-resource/tray-icons'),
    path.resolve(assets, 'images')
  )

  fs.mkdirSync(path.resolve(NODEJS_DIR, 'views'), { recursive: true })
  fs.copyFileSync(
    path.resolve(ROOT, 'src/app/views/index.pug'),
    path.resolve(NODEJS_DIR, 'views/index.pug')
  )
}

function writeLoadingPage () {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>electerm</title>
  <style>
    html, body { height: 100%; margin: 0; background: #15171a; color: #cfd6e4;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .wrap { height: 100%; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 18px; }
    .logo { font-size: 22px; font-weight: 600; letter-spacing: .5px; }
    .spin { width: 34px; height: 34px; border: 3px solid rgba(255,255,255,.15);
      border-top-color: #4aa3ff; border-radius: 50%; animation: r 1s linear infinite; }
    @keyframes r { to { transform: rotate(360deg); } }
    .msg { font-size: 13px; opacity: .7; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">electerm</div>
    <div class="spin"></div>
    <div class="msg" id="msg">Starting engine…</div>
  </div>
  <script>
    // Reach the on-device Node.js backend at http://127.0.0.1:5577.
    // Subresource probes are unreliable here:
    //   - fetch()        -> Chromium Private Network Access ("Failed to fetch")
    //   - CapacitorHttp  -> works only where the native client allows cleartext
    // A top-level navigation is NOT a subresource (PNA does not apply) and the
    // network-security-config permits cleartext to 127.0.0.1, so once the engine
    // is up we navigate. allowNavigation:["127.0.0.1"] keeps it in-app.
    var PORT = 5577;
    var BASE = 'http://127.0.0.1:' + PORT + '/';
    var Http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    var done = false;
    function go (src) {
      if (done) return;
      done = true;
      location.replace(BASE);
    }
    function tryLoad () {
      if (Http) {
        Http.get({ url: BASE })
          .then(function (r) {
            if (r && r.status >= 200 && r.status < 500) go('capacitorhttp');
            else setTimeout(tryLoad, 700);
          })
          .catch(function () {
            document.getElementById('msg').textContent = 'Waiting for engine…';
            setTimeout(tryLoad, 700);
          });
      } else {
        fetch(BASE, { mode: 'no-cors' })
          .then(function () { go('fetch'); })
          .catch(function () {
            document.getElementById('msg').textContent = 'Waiting for engine…';
            setTimeout(tryLoad, 700);
          });
      }
    }
    tryLoad();
    // Fallback: probes blocked on this device -> after the engine has had time
    // to come up (~1-2s), navigate directly (works because navigation is exempt).
    setTimeout(function () { go('timeout'); }, 4000);
  </script>
</body>
</html>
`
  fs.writeFileSync(path.resolve(WWW, 'index.html'), html)
}

// --------------------------------------------------------------------------
// 3. Backend (esbuild) with native stubs + node:sqlite shim
// --------------------------------------------------------------------------
async function genSqliteShim () {
  // sql.js exposes `./dist/*` through its "exports", so resolve the wasm
  // directly (its package.json subpath is intentionally not exported).
  const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm')
  const wasm = fs.readFileSync(wasmPath)
  const b64 = wasm.toString('base64')

  // Synchronous `DatabaseSync` shim backed by sql.js (pure JS + WASM).
  // Module-level `await initSqlJs(...)` guarantees SQL is ready before any
  // `new DatabaseSync(...)` / `stmt.all()` is executed.
  const shim = `import initSqlJs from 'sql.js'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'

const wasmBinary = Uint8Array.from(atob(${JSON.stringify(b64)}), c => c.charCodeAt(0))
const SQL = await initSqlJs({ wasmBinary })

export class DatabaseSync {
  constructor (path) {
    this.path = path
    const buf = fs.existsSync(path) ? fs.readFileSync(path) : undefined
    this.db = new SQL.Database(buf)
  }
  exec (sql) {
    this.db.run(sql)
    this._persist()
  }
  prepare (sql) {
    return new Stmt(this.db, sql, this)
  }
  _persist () {
    try { fs.writeFileSync(this.path, Buffer.from(this.db.export())) } catch (e) {}
  }
}

class Stmt {
  constructor (db, sql, owner) {
    this.s = db.prepare(sql)
    this.owner = owner
  }
  all () {
    const out = []
    while (this.s.step()) out.push(this.s.getAsObject())
    this.s.free()
    return out
  }
  get (...params) {
    if (params.length) this.s.bind(params)
    const r = this.s.step() ? this.s.getAsObject() : undefined
    this.s.free()
    return r
  }
  run (...params) {
    if (params.length) this.s.bind(params)
    this.s.step()
    const ch = this._changes()
    this.s.free()
    this.owner._persist()
    return { changes: ch }
  }
  _changes () {
    const res = this.owner.db.exec('SELECT changes()')
    return res && res[0] && res[0].values && res[0].values[0] ? res[0].values[0][0] : 0
  }
}
`
  const genDir = path.resolve(__dirname, '.gen')
  fs.mkdirSync(genDir, { recursive: true })
  const shimPath = path.resolve(genDir, 'node-sqlite-shim.mjs')
  fs.writeFileSync(shimPath, shim)
  return shimPath
}

// esbuild plugin: rewrite path-to-regexp v8 Unicode property-escape regexes
// so they run on the on-device Node 18 build (which lacks \p{...} support
// inside character classes due to its stripped ICU data).
//
// path-to-regexp v8 defines three regexes that use \p{ID_Start} and
// \p{ID_Continue} — Unicode property escapes that require full ICU support.
// We replace them with ASCII-equivalent character classes; route parameter
// names are always ASCII in practice, so the behaviour is identical.
const patchPathToRegexpPlugin = {
  name: 'patch-path-to-regexp',
  setup (build) {
    build.onLoad({ filter: /path-to-regexp/ }, async (args) => {
      let src = await fs.promises.readFile(args.path, 'utf8')
      src = src
        .replace(
          '/^[$_\\p{ID_Start}]$/u',
          '/^[$_a-zA-Z]$/'
        )
        .replace(
          '/^[$\\u200c\\u200d\\p{ID_Continue}]$/u',
          '/^[$\\u200c\\u200da-zA-Z0-9_]$/'
        )
        .replace(
          '/^[$_\\p{ID_Start}][$\\u200c\\u200d\\p{ID_Continue}]*$/u',
          '/^[$_a-zA-Z][$\\u200c\\u200da-zA-Z0-9_]*$/'
        )
      return { contents: src, loader: 'js' }
    })
  }
}

async function bundleBackend (shimPath) {
  console.log('[android] bundling backend (esbuild)…')
  await esbuild.build({
    entryPoints: [path.resolve(ROOT, 'src/app/app.js')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    outfile: path.resolve(NODEJS_DIR, 'app.bundle.mjs'),
    alias: {
      // The on-device runtime is Node 18, which has no built-in `node:sqlite`.
      // Replace it with the sql.js-backed synchronous shim produced above.
      'node:sqlite': shimPath
    },
    // Native modules that are not built for Android yet. Keep them external so
    // esbuild never tries to resolve them; the guarded `import()` calls in the
    // source fall back gracefully at runtime (see DISABLE_LOCAL_TERMINAL).
    external: [
      'node-pty',
      'serialport',
      'node-bash',
      'font-list'
    ],
    // Some bundled CJS deps (e.g. sql.js's initSqlJs) reference __dirname /
    // __filename, which don't exist in an ESM bundle. Define them from
    // import.meta.url. NOTE: do NOT `import { dirname } from "path"` here —
    // the bundle already imports `dirname` at top level, which would collide
    // ("Identifier 'dirname' has already been declared"). Alias fileURLToPath
    // to a private name for the same reason, and derive __dirname from a
    // directory URL.
    banner: {
      js: "import { createRequire } from 'module'; import { fileURLToPath as __etu } from 'url'; const require = createRequire(import.meta.url); const __filename = __etu(import.meta.url); const __dirname = __etu(new URL('.', import.meta.url));"
    },
    plugins: [patchPathToRegexpPlugin],
    // keep node built-ins external; everything else is bundled
    logLevel: 'info'
  })
}

function copyEnv () {
  const src = path.resolve(__dirname, '.env')
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.resolve(NODEJS_DIR, '.env'))
    console.log('[android] copied runtime .env ->', path.resolve(NODEJS_DIR, '.env'))
  }
}

function writeNodeEntry () {
  const entry = `import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __d = fileURLToPath(new URL('.', import.meta.url))

// The embedded Node.js engine starts with cwd "/" (Android filesystem root),
// not the nodejs-project directory. electerm's runtime-constants.js reads
// "package.json" via resolve(process.cwd(), 'package.json'), so without
// chdir it tries to open "/package.json" -> ENOENT -> uncaught exception ->
// the Node process exits and the app crashes (SIGSEGV during teardown).
// Switch cwd to the project directory before loading the backend bundle.
process.chdir(__d)

// Runtime configuration for the on-device electerm server.
process.env.NODE_ENV = 'production'
process.env.HOST = '127.0.0.1'
process.env.PORT = '5577'
// Local-only app: a fixed secret is fine. The web UI auto-logs-in because
// ENABLE_AUTH is not set.
process.env.SERVER_SECRET = 'electerm-android-local-dev-secret'
// No real pty on Android -> disable the local terminal feature.
process.env.DISABLE_LOCAL_TERMINAL = '1'
// Tell the server where the pug views live (cwd is now the node project dir,
// set above via process.chdir(__d)).
process.env.VIEW_FOLDER = resolve(__d, 'views')

// Stable, app-private user-data directory.
// The Node.js project is extracted by @capawesome/capacitor-nodejs into the
// app's internal storage (getFilesDir()/nodejs). If we keep user data inside
// that extracted project it can be wiped when the bundled node project is
// refreshed on an app update. Putting it in a sibling directory keeps the
// database, uploads and logs safe across updates.
const userDataDir = (() => {
  try {
    const dir = resolve(__d, '..', 'electerm-data')
    mkdirSync(dir, { recursive: true })
    return dir
  } catch (e) {
    const fallback = resolve(__d, 'data')
    mkdirSync(fallback, { recursive: true })
    return fallback
  }
})()
process.env.DB_PATH = userDataDir

await import('./app.bundle.mjs')
`
  fs.writeFileSync(path.resolve(NODEJS_DIR, 'index.js'), entry)
  fs.writeFileSync(
    path.resolve(NODEJS_DIR, 'package.json'),
    JSON.stringify(
      { name: 'electerm-node', version: VERSION, main: 'index.js', type: 'module' },
      null,
      2
    )
  )
}

// --------------------------------------------------------------------------
// --------------------------------------------------------------------------
async function main () {
  fs.rmSync(WWW, { recursive: true, force: true })
  fs.mkdirSync(NODEJS_DIR, { recursive: true })

  await runVite()
  copyFrontendAssets()
  writeLoadingPage()

  const shimPath = await genSqliteShim()
  await bundleBackend(shimPath)
  writeNodeEntry()
  copyEnv()

  console.log('[android] web + node project ready at', WWW)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
