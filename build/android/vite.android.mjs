// Vite config used to build the electerm *frontend* for the Android app.
//
// On the device every asset is served by the local Node.js server on
// 127.0.0.1, so a request is not free: the WebView keeps only a handful of
// connections open and node answers them one at a time (~15 ms each in the
// emulator, morgan logging included). The stock web build emits ~250 chunks,
// 138 of which the first screen pulls in — that alone measured ~2.2 s of the
// launch.
//
// Rolldown's `output.codeSplitting: false` inlines every dynamic import into
// its entry, so the app boots from 3 files instead of 250. Measured on the
// emulator: bookmark list on screen 6.84 s -> 5.68 s, resource requests
// 144 -> 8.
//
// `codeSplitting: false` rejects multiple inputs, so the build runs once per
// entry (see build/android/build.mjs) and the per-entry CSS is concatenated.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { cwd, version } from '../vite/common.js'
import def from '../vite/def.js'

// index.pug loads `js/basic-<version>.js`; basic.js then injects
// `js/electerm-<version>.js` itself (see loadScript), and the worker is spawned
// from `js/worker-<version>.js` — all three must stay separate files.
const ENTRIES = {
  electerm: resolve(cwd, 'src/client/entry-web/electerm.jsx'),
  basic: resolve(cwd, 'src/client/entry-web/basic.js'),
  worker: resolve(cwd, 'src/client/entry-web/worker.js')
}

// Keep this order: it decides how the per-entry CSS files are concatenated.
export const entryNames = ['electerm', 'basic', 'worker']

export function createConfig (name, outDir) {
  return defineConfig({
    plugins: [
      react({ include: /\.(mdx|js|jsx|ts|tsx|mjs)$/ })
    ],
    define: def,
    publicDir: false,
    legacy: {
      inconsistentCjsInterop: true
    },
    resolve: {
      alias: {
        'ironrdp-wasm': resolve(cwd, 'node_modules/ironrdp-wasm/pkg/rdp_client.js'),
        '@novnc/novnc/core/rfb': resolve(cwd, 'node_modules/@novnc/novnc/core/rfb.js'),
        // @xterm/addon-ligatures pulls in lru-cache which touches
        // node:diagnostics_channel at import time; stub it for the browser.
        'node:diagnostics_channel': resolve(cwd, 'build/vite/diagnostics-channel-stub.js'),
        diagnostics_channel: resolve(cwd, 'build/vite/diagnostics-channel-stub.js')
      }
    },
    optimizeDeps: {
      exclude: ['ironrdp-wasm']
    },
    root: resolve(cwd),
    build: {
      target: 'esnext',
      cssCodeSplit: false,
      emptyOutDir: false,
      // Output the built frontend *inside* the Node.js project so the backend
      // (which serves `dist/assets`) finds it at runtime on the device.
      outDir,
      rollupOptions: {
        input: { [name]: ENTRIES[name] },
        output: {
          format: 'esm',
          // Inline every dynamic import into this entry: no chunk requests.
          codeSplitting: false,
          entryFileNames: `js/[name]-${version}.js`,
          chunkFileNames: `chunk/[name]-${version}-[hash].js`,
          assetFileNames: chunkInfo => {
            const { name } = chunkInfo
            if (/\.(png|jpe?g|gif|svg|webp|ico|bmp)$/i.test(name)) {
              return `images/${name}`
            } else if (name && name.endsWith('.css')) {
              return `css/style-${version}[extname]`
            } else {
              return 'assets/[name]-[hash][extname]'
            }
          }
        }
      }
    }
  })
}
