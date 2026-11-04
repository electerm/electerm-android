#!/usr/bin/env node
/**
 * Verify a built Android App Bundle before uploading it to Google Play.
 *
 * Checks the things Play would reject anyway, so the CI fails fast with a
 * clear message instead of a 400 from the Android Publisher API:
 *   - the .aab exists and is not empty
 *   - it is signed (META-INF/*.RSA, produced by the upload key)
 *   - its packaged manifest carries the expected versionCode / versionName
 *   - the manifest targets the SDK level Play currently requires
 *
 * The manifest inside an .aab is protobuf-encoded, so the values are not
 * readable with `strings` — they are length-prefixed right after the
 * attribute name, which is what this script looks for.
 *
 * Usage:
 *   node build/android/scripts/verify-aab.mjs <path/to/app.aab> <versionCode> <versionName> [targetSdk]
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const [aab, wantCode, wantName, wantTargetSdk] = process.argv.slice(2)

if (!aab || !wantCode || !wantName) {
  console.error(
    'Usage: node verify-aab.mjs <app.aab> <versionCode> <versionName> [targetSdk]'
  )
  process.exit(1)
}

function fail (msg) {
  console.error(`FATAL: ${msg}`)
  process.exit(1)
}

if (!fs.existsSync(aab)) fail(`${aab} does not exist`)
const size = fs.statSync(aab).size
if (size === 0) fail(`${aab} is empty`)
console.log(`[verify] ${aab} (${(size / 1048576).toFixed(1)} MB)`)

// --- signature -------------------------------------------------------------
const listing = execFileSync('unzip', ['-l', aab], { encoding: 'utf8' })
if (!/META-INF\/.+\.RSA/.test(listing)) {
  fail('AAB is not signed — expected META-INF/<alias>.RSA from the upload key')
}
console.log('[verify] signed: OK')

// --- manifest --------------------------------------------------------------
const xml = execFileSync('unzip', ['-p', aab, 'base/manifest/AndroidManifest.xml'], {
  maxBuffer: 1 << 24
})
const buf = Buffer.from(xml)

function readAfter (key) {
  const i = buf.indexOf(key)
  if (i < 0) return null
  const win = buf.subarray(i + key.length, i + key.length + 24).toString('latin1')
  const m = win.match(/[\x20-\x7e]+/)
  return m ? m[0].replace(/["'(\s].*$/, '') : null
}

const code = readAfter('versionCode')
const name = readAfter('versionName')
console.log(`[verify] manifest versionCode=${code} versionName=${name}`)

if (code !== wantCode) {
  fail(`versionCode is "${code}", expected "${wantCode}" — ` +
    'the version injection step did not run or did not stick')
}
if (name !== wantName) {
  fail(`versionName is "${name}", expected "${wantName}"`)
}

// targetSdkVersion lives in the uses-sdk element, encoded as an int rather
// than a string, so read it out of the protobuf varint that follows.
if (wantTargetSdk) {
  const i = buf.indexOf('targetSdkVersion')
  if (i < 0) fail('targetSdkVersion not found in the AAB manifest')
  // the attribute name is followed by a length-prefixed value
  const tail = buf.subarray(i + 'targetSdkVersion'.length, i + 'targetSdkVersion'.length + 12)
  const digits = tail.toString('latin1').match(/\d+/)
  if (!digits) fail('could not decode targetSdkVersion from the AAB manifest')
  console.log(`[verify] manifest targetSdkVersion=${digits[0]}`)
  if (digits[0] !== String(wantTargetSdk)) {
    fail(`targetSdkVersion is ${digits[0]}, expected ${wantTargetSdk}`)
  }
}

console.log('[verify] all checks passed')
