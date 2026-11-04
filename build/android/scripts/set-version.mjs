#!/usr/bin/env node
/**
 * Inject versionCode / versionName into the generated Gradle app module.
 *
 * Why this exists:
 *   Capacitor's `cap add android` template hardcodes
 *       versionCode 1
 *       versionName "1.0"
 *   Google Play rejects an upload whose versionCode was already used, and
 *   requires it to increase with every release. The upstream electerm version
 *   (package.json) is the single source of truth here, so map it:
 *
 *       versionCode = major * 1000000 + minor * 1000 + patch
 *
 *   5.8.0  -> 5008000
 *   5.7.21 -> 5007021
 *   5.5.77 -> 5005077
 *
 *   Play's versionCode ceiling is 2100000000, so this scheme leaves room for
 *   major <= 2100 and patch <= 999. The upstream version scheme uses the patch
 *   slot as a build counter (5.5.77, 5.7.21), which stays well under 1000.
 *
 * Usage:
 *   node build/android/scripts/set-version.mjs <app/build.gradle> [version]
 *
 * `version` defaults to the root package.json version.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')

const target = process.argv[2]
if (!target) {
  console.error('Usage: node set-version.mjs <app/build.gradle> [version]')
  process.exit(1)
}

const version = process.argv[3] ||
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

const parts = String(version).split('.').map(n => parseInt(n, 10))
if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0)) {
  console.error(`FATAL: cannot parse version "${version}" as major.minor.patch`)
  process.exit(1)
}
const [major, minor, patch] = parts
if (patch > 999 || minor > 999) {
  console.error(
    `FATAL: version "${version}" does not fit the versionCode mapping ` +
    '(minor and patch must be <= 999).'
  )
  process.exit(1)
}
const versionCode = major * 1000000 + minor * 1000 + patch
if (versionCode > 2100000000) {
  console.error(`FATAL: versionCode ${versionCode} exceeds Play's limit 2100000000`)
  process.exit(1)
}

const src = fs.readFileSync(target, 'utf8')

const next = src
  .replace(
    /^([ \t]*)versionCode[ \t]+\d+[ \t]*$/m,
    `$1versionCode ${versionCode}`
  )
  .replace(
    /^([ \t]*)versionName[ \t]+"[^"]*"[ \t]*$/m,
    `$1versionName "${version}"`
  )

// Verify by value, not by "did the text change": re-running this script with
// the version already applied is a legitimate no-op and must succeed.
const codeRe = new RegExp(`^[ \\t]*versionCode[ \\t]+${versionCode}[ \\t]*$`, 'm')
const nameRe = new RegExp(`^[ \\t]*versionName[ \\t]+"${version}"[ \\t]*$`, 'm')

if (!codeRe.test(next) || !nameRe.test(next)) {
  console.error(
    `FATAL: could not set versionCode=${versionCode} / versionName="${version}" ` +
    `in ${target}. The Capacitor template layout changed — update this script.`
  )
  process.exit(1)
}

if (next !== src) fs.writeFileSync(target, next)
console.log(`[android] versionCode=${versionCode} versionName=${version} -> ${target}`)
