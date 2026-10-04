/**
 * Proves the generated `src/` pipeline is faithful and reproducible.
 *
 * `src/` is not tracked in git. `build/bin/install.js` rebuilds it from the tip
 * of upstream electerm-web's default branch plus the Android delta
 * (`build/replace/**` and `build/delete-list.js`). This test asserts the rebuild
 * is a no-op with respect to what actually ships:
 *
 *   before: snapshot src/  -> build -> hash the output tree
 *   after:  regenerate src/ from upstream + delta -> build -> hash again
 *   assert: the two src trees are byte-identical AND the two build outputs are
 *           byte-identical
 *
 * A failure means one of three things:
 *   - the delta in build/replace is incomplete, so the regenerated src/ drifts
 *     from the reference tree (reported file by file);
 *   - someone hand-edited `src/`, which the next install would silently revert;
 *   - the build stopped being deterministic (the build output is not stable
 *     across identical inputs), which would make this test meaningless.
 *
 * NOTE: this test overwrites `src/` in the working tree. That is safe — src/ is
 * generated — but do not run it with uncommitted hand-edits inside src/.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SRC = path.resolve(ROOT, 'src')
const WWW = path.resolve(ROOT, 'build/android/www')
const INSTALL = path.resolve(ROOT, 'build/bin/install.js')
const BUILD = path.resolve(ROOT, 'build/android/build.mjs')

// `client/electerm-react` comes from the npm package, not upstream; `ref` is
// install.js's bookkeeping about the tree. Neither is part of the generated
// tree, so both are excluded from every comparison.
const EXCLUDED = ['client/electerm-react', 'ref']
const REF_FILE = path.resolve(SRC, 'ref')

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** rel (posix) -> sha256 of contents, skipping the excluded paths. */
function treeMap (dir) {
  const out = new Map()
  const walk = (cur) => {
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const abs = path.join(cur, entry.name)
      const rel = path.relative(dir, abs).split(path.sep).join('/')
      if (EXCLUDED.some(e => rel === e || rel.startsWith(e + '/'))) continue
      if (entry.isDirectory()) walk(abs)
      else if (entry.isFile()) out.set(rel, sha256(fs.readFileSync(abs)))
    }
  }
  walk(dir)
  return out
}

/** Stable hash over a whole tree map. */
function mapHash (map) {
  const h = crypto.createHash('sha256')
  for (const rel of [...map.keys()].sort()) {
    h.update(rel).update('\0').update(map.get(rel)).update('\n')
  }
  return h.digest('hex')
}

/** Human-readable diff of two tree maps, or null when identical. */
function diffTrees (a, b) {
  const missing = []
  const extra = []
  const changed = []
  for (const [rel, hash] of a) {
    if (!b.has(rel)) missing.push(rel)
    else if (b.get(rel) !== hash) changed.push(rel)
  }
  for (const rel of b.keys()) if (!a.has(rel)) extra.push(rel)
  if (!missing.length && !extra.length && !changed.length) return null
  const lines = []
  for (const f of missing) lines.push(`  only in before : ${f}`)
  for (const f of extra) lines.push(`  only in after  : ${f}`)
  for (const f of changed) lines.push(`  content differs: ${f}`)
  return lines.join('\n')
}

function node (script) {
  return execFileSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
}

/**
 * Snapshot src/ with rsync rather than fs.cpSync: the tree is ~700 files (the
 * generated client dominates) and rsync is both faster and a real binary, so
 * it does not go through any filesystem shim. The generated client is excluded
 * because it is not derived from upstream.
 */
function snapshotSrc (destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  execFileSync(
    'rsync',
    [
      '-a',
      `--exclude=/${EXCLUDED[0]}/`,
      `${SRC}/`,
      `${destDir}/`
    ],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] }
  )
  return destDir
}

function runBuild () {
  execFileSync(process.execPath, [BUILD], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit']
  })
  assert.ok(fs.existsSync(WWW), 'build produced no build/android/www')
  return treeMap(WWW)
}

test('regenerated src/ and its build output are byte-identical to the reference', async (t) => {
  // Preconditions: the test rebuilds src/, but the generated client must exist
  // because install.js replaces src/ wholesale and the client comes from the
  // npm package.
  assert.ok(
    fs.existsSync(path.resolve(SRC, 'client/electerm-react')),
    'src/client/electerm-react is missing — run `npm install` first'
  )

  // ---- before -------------------------------------------------------------
  const beforeDir = snapshotSrc(fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-src-before-')))
  const srcBefore = treeMap(beforeDir)
  const wwwBefore = runBuild()
  console.log(`[src] before: ${srcBefore.size} src files, ${wwwBefore.size} build files`)

  // ---- after --------------------------------------------------------------
  // Drop src/ref so install.js cannot take the skip path: this test is about
  // the pipeline actually running.
  await t.test('install.js regenerates src/', () => {
    fs.rmSync(REF_FILE, { force: true })
    const out = node(INSTALL)
    console.log(out.trim())
  })

  const srcAfter = treeMap(SRC)
  const srcDiff = diffTrees(srcBefore, srcAfter)
  assert.equal(srcDiff, null, `regenerated src/ drifted from the reference:\n${srcDiff}`)
  console.log(`[src] after:  ${srcAfter.size} src files — identical to before`)

  const wwwAfter = runBuild()
  const wwwDiff = diffTrees(wwwBefore, wwwAfter)
  assert.equal(wwwDiff, null, `build output is not reproducible:\n${wwwDiff}`)
  console.log(`[src] build output identical: ${wwwAfter.size} files, sha256 ${mapHash(wwwAfter).slice(0, 16)}…`)
})

test('install.js skips the download when the ref and delta are unchanged', () => {
  assert.ok(fs.existsSync(REF_FILE), 'src/ref should exist after an install')

  // Park the mtime, so a rewrite is detectable even if the contents are equal.
  const parked = new Date(2000, 0, 1)
  fs.utimesSync(REF_FILE, parked, parked)
  const before = treeMap(SRC)

  const out = node(INSTALL)

  assert.match(out, /skipping download/, `expected install.js to skip, got:\n${out}`)
  const diff = diffTrees(before, treeMap(SRC))
  assert.equal(diff, null, `a skipped run changed src/:\n${diff}`)
  assert.equal(
    fs.statSync(REF_FILE).mtimeMs,
    parked.getTime(),
    'src/ref was rewritten, so the run did not actually skip'
  )
})
