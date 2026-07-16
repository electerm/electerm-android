# electerm for Android — build & test

This folder turns the electerm-web codebase into a native Android app.

## How it works

```
WebView (frontend)  ── http://127.0.0.1:5577 ──►  Node.js backend (on device)
   loads index.html                                    serves UI + SSH/SFTP/...
   (local "loading" page)                              API/WebSocket on same origin
```

- **Capacitor** provides the native Android shell + WebView.
- **`@capawesome/capacitor-nodejs`** embeds a Node.js runtime and auto-starts the
  electerm backend (`www/nodejs`) when the app launches. The bundled Node.js is
  **v18**, so:
  - native modules that can't be built for Android (`node-pty`, `serialport`,
    `node-bash`, `font-list`) are kept **external**. The backend
    loads them through guarded `import()` / dynamic-require calls that catch the
    load failure, so a missing native module never prevents the server from
    starting — the feature that needs it simply stays unavailable;
  - logging uses a small **dependency-free Node.js logger** (no `electron-log`),
    so there is one less desktop-only dependency to worry about on mobile.
  - electerm's `node:sqlite` usage is shimmed with **sql.js** (pure JS + WASM),
    because built-in `node:sqlite` only exists on Node ≥ 22.5.
- The backend is configured by `build/android/.env` (copied into
  `www/nodejs/.env`), which sets `DISABLE_LOCAL_TERMINAL=1` because the local
  terminal / serial features are not available on Android yet.
- The WebView first shows a small local "loading" page (`www/index.html`) that
  polls the backend and redirects once it is listening.

## Prerequisites (local build)

- Node.js ≥ 24
- Java JDK 17+ (21 recommended)
- Android SDK (platform-36, build-tools 36.0.0) with `sdkmanager` on `PATH`
- Python 3 (only to (re)generate icon/splash assets)

## Build

```bash
# 1. install everything
npm ci                       # root: electerm deps + esbuild + sql.js
npm --prefix build/android install   # capacitor + @capawesome/capacitor-nodejs

# 2. (optional) regenerate icons/splash from temp/ logos
npm --prefix build/android run assets

# 3. build the web frontend + Node.js backend bundle into build/android/www
npm run build:android

# 4. create the native project + sync assets/plugins
cd build/android
npx cap add android      # only needed once (committed android/ is git-ignored)
npx cap sync android

# 5. (optional) overlay the electerm icons/splash
cp -r res-overlay/. android/app/src/main/res/

# 6. build
cd android
./gradlew assembleDebug          # debug APK
./gradlew assembleRelease        # release APK (sign it yourself)
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

## Install & test on a device

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
# or just copy the APK over and tap it
```

Open electerm, wait for "Starting engine…" → it redirects to the running backend.
Then add an SSH/SFTP/Telnet/FTP/RDP/VNC/Spice connection and try it.

## Known limitations on Android

- **Local terminal / serial port** are disabled via `DISABLE_LOCAL_TERMINAL=1` in
  `build/android/.env` (and the `node-pty` / `serialport` native modules simply are
  not present on the device). The guarded imports mean the app still starts fine;
  these features can be re-enabled once native libraries are built for Android.
  SSH, SFTP, Telnet, FTP, RDP, VNC and Spice work because they are network protocols
  implemented in pure JS / WASM.
- The device must allow "Install from unknown sources" for sideloaded APKs.
- Data is stored inside the app's sandbox (`data/sqlite/...` under the Node project).

## CI

`.github/workflows/build-android.yml` builds debug **and** release (ephemerally
signed) APKs and uploads them as the `electerm-android-apks` artifact. Download it
from the workflow run and install on your device.
