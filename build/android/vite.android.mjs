// Vite config used to build the electerm *frontend* for the Android app.
//
// It is intentionally almost identical to build/vite/conf.js (the web build)
// except the output goes inside the Capacitor web dir so it ends up next to
// the Node.js backend that actually serves it on the device.
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { cwd, version } from '../vite/common.js'
import def from '../vite/def.js'

function buildInput () {
  return {
    electerm: resolve(cwd, 'src/client/entry-web/electerm.jsx'),
    basic: resolve(cwd, 'src/client/entry-web/basic.js'),
    worker: resolve(cwd, 'src/client/entry-web/worker.js')
  }
}

export default defineConfig({
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
    codeSplitting: false,
    emptyOutDir: false,
    // Output the built frontend *inside* the Node.js project so the backend
    // (which serves `dist/assets`) finds it at runtime on the device.
    outDir: resolve(cwd, 'build/android/www/nodejs/dist/assets'),
    rollupOptions: {
      input: buildInput(),
      output: {
        format: 'esm',
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
