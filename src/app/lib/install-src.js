// install-src.js
// Determines the Android APK architecture identifier at runtime.
// Used to match the correct release asset when checking/downloading upgrades.
//
// The Android APK splits produce four flavors:
//   arm64-v8a      -> Node.js os.arch() === 'arm64'
//   armeabi-v7a    -> Node.js os.arch() === 'arm'
//   x86_64         -> Node.js os.arch() === 'x64'
//   universal      -> (ignored; the device CPU resolves to one of the above)
//
// We resolve at runtime from os.arch() so the same bundled code works for
// every split without a build-time injection step: the APK the user installed
// only contains the native libraries for its target ABI, so os.arch() always
// reflects the ABI that is actually running on device.

import os from 'os'

const archMap = {
  arm64: 'arm64-v8a',
  arm: 'armeabi-v7a',
  x64: 'x86_64',
  // 32-bit x86 is virtually nonexistent on Android; treat it as x86_64 so
  // upgrade matching still resolves to a real asset.
  ia32: 'x86_64',
  x32: 'x86_64'
}

const arch = os.arch()
const installSrc = 'electerm-android-' + (archMap[arch] || 'arm64-v8a')

export default installSrc
