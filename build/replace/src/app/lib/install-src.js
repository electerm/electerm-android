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
//
// NO FILE EXTENSION. This string has to satisfy two contracts at once:
//
//  1. electerm.org's /data/electerm-github-release.json?src=<this> filter
//     (src/release-asset-filter.js there). It normalises both sides with
//     assetKey()/assetStem(), so an extension-less query resolves to the real
//     file: "?src=electerm-android-arm64-v8a" -> electerm-android-arm64-v8a-<ver>.apk.
//
//  2. the client's asset match in @electerm/electerm-react's update-check.js:
//       assets.find(r => r.name.includes(installSrc))
//     Published asset names carry the version BETWEEN the abi and the
//     extension (electerm-android-arm64-v8a-5.5.76.apk), so no string that
//     ends in ".apk" can ever be a substring of one. With ".apk" appended,
//     `.includes()` returns false, browserDownloadUrl comes back empty and
//     `doUpgrade()` hits its `if (downloadUrl)` guard and returns silently —
//     the Upgrade button looks dead. Keep this version-less and extension-less.

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
