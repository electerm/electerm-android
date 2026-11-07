import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { isAndroidAsset, mirrorUrl } from '../build/replace/src/client/electerm-react/common/download-mirror.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The real asset URL electerm.org returns for
// /data/electerm-github-release.json?src=electerm-android-arm64-v8a
const androidUrl = 'https://github.com/electerm/electerm-android/releases/download/v5.9.0/electerm-android-arm64-v8a-5.9.0.apk'

// Mirror links published on https://electerm.org/ for that exact asset
// (Android download card, built by bin/data.js in the electerm.org repo).
const expected = {
  github: androidUrl,
  'gh-proxy': `https://mirror.electerm.org/${androidUrl}`,
  atomgit: 'https://atomgit.com/electerm/electerm-android/releases/download/v5.9.0/electerm-android-arm64-v8a-5.9.0.apk',
  sourceforge: 'https://master.dl.sourceforge.net/project/electerm.mirror/v5.9.0/electerm-android-arm64-v8a-5.9.0.apk?viasf=1',
  r2: 'https://r2.electerm.org/r1/electerm-android-arm64-v8a-5.9.0.apk'
}

test('every upgrade mirror matches the real URL published by electerm.org', () => {
  for (const [mirror, url] of Object.entries(expected)) {
    assert.equal(mirrorUrl(androidUrl, mirror), url, mirror)
  }
})

test('all four Android ABIs use the android repo and the /r1/ prefix', () => {
  for (const abi of ['arm64-v8a', 'armeabi-v7a', 'x86_64', 'universal']) {
    const file = `electerm-android-${abi}-5.9.0.apk`
    const url = `https://github.com/electerm/electerm-android/releases/download/v5.9.0/${file}`
    assert.equal(
      mirrorUrl(url, 'atomgit'),
      `https://atomgit.com/electerm/electerm-android/releases/download/v5.9.0/${file}`
    )
    assert.equal(mirrorUrl(url, 'r2'), `https://r2.electerm.org/r1/${file}`)
  }
})

test('desktop assets keep the desktop repo and the /r/ prefix', () => {
  const url = 'https://github.com/electerm/electerm/releases/download/v5.9.0/electerm-5.9.0-win-x64-installer.exe'
  assert.equal(
    mirrorUrl(url, 'atomgit'),
    'https://atomgit.com/electerm/electerm/releases/download/v5.9.0/electerm-5.9.0-win-x64-installer.exe'
  )
  assert.equal(
    mirrorUrl(url, 'r2'),
    'https://r2.electerm.org/r/electerm-5.9.0-win-x64-installer.exe'
  )
})

test('isAndroidAsset only flags APKs / android release URLs', () => {
  assert.equal(isAndroidAsset('a.apk', ''), true)
  assert.equal(isAndroidAsset('', androidUrl), true)
  assert.equal(isAndroidAsset('electerm-5.9.0-win-x64.tar.gz', 'https://github.com/electerm/electerm/x'), false)
})

test('empty, non-release and unknown-mirror inputs are safe', () => {
  assert.equal(mirrorUrl('', 'atomgit'), '')
  assert.equal(mirrorUrl(undefined, 'r2'), '')
  assert.equal(mirrorUrl('https://electerm.org/download', 'atomgit'), '')
  assert.equal(mirrorUrl('https://electerm.org/download', 'github'), 'https://electerm.org/download')
  assert.equal(mirrorUrl(androidUrl, 'some-mirror'), androidUrl)
})

// The overlay replaces the package file wholesale. If upstream adds/renames an
// export, upgrade.jsx (and anything else importing update-check) would break
// at bundle time — catch that here instead of on a device.
test('overlay keeps the upstream export surface', () => {
  const names = (file) => [...file.matchAll(/export (?:async )?function (\w+)/g)]
    .map(m => m[1]).sort()
  const overlay = readFileSync(path.join(root, 'build/replace/src/client/electerm-react/common/update-check.js'), 'utf8')
  const upstream = readFileSync(path.join(root, 'node_modules/@electerm/electerm-react/client/common/update-check.js'), 'utf8')
  assert.deepEqual(names(overlay), names(upstream))
})
