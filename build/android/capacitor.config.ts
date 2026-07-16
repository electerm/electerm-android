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
