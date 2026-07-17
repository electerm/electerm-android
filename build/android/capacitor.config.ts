import { CapacitorConfig } from '@capacitor/cli'

// electerm for Android
//
// The web frontend and the electerm Node.js backend are both bundled into
// `www`:
//   - `www/index.html`        a tiny local "loading" page that waits for the
//                             on-device Node.js backend to come up, then
//                             redirects the WebView to it.
//   - `www/nodejs`            the electerm Node.js project (run by the
//                             @capawesome/capacitor-nodejs plugin). It serves
//                             the real app UI + the SSH/SFTP/... API on
//                             http://127.0.0.1:5577.
const config: CapacitorConfig = {
  appId: 'org.electerm.electerm',
  appName: 'electerm',
  webDir: 'www',
  // The loading page is served from the Capacitor local server and then
  // redirects (top-level navigation) to the on-device Node.js backend at
  // http://127.0.0.1:5577. Using the http scheme (instead of the default
  // https) avoids mixed-content blocking of that http backend.
  server: {
    androidScheme: 'http',
    // Keep navigation to the backend host in-app (don't hand it to the system
    // browser, which can't reach the app's private loopback port anyway).
    allowNavigation: ['127.0.0.1']
  },
  plugins: {
    Nodejs: {
      // directory (relative to webDir) that holds the Node.js project
      nodeDir: 'nodejs',
      // start the Node.js engine automatically when the app launches
      startMode: 'auto'
    }
  }
}

export default config
