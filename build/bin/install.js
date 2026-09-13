import pkg from 'shelljs'
import fs from 'node:fs'
import path from 'node:path'

const { echo, rm, cp } = pkg

echo('install required modules')

rm('-rf', 'src/client/electerm-react')
cp('-r', 'node_modules/@electerm/electerm-react/client', 'src/client/electerm-react')

// Overlay Android customizations onto the vendored client.
// src/client/electerm-react is re-created from node_modules on every install,
// so files that need changes live under build/replace, mirroring their
// repo-relative path (e.g. build/replace/src/client/electerm-react/...).
// Adding a new override is just dropping the full replacement file there.
function overlayReplaceDir () {
  const replaceDir = 'build/replace'
  if (!fs.existsSync(replaceDir)) {
    return
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const src = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(src)
      } else if (entry.isFile()) {
        const dest = path.relative(replaceDir, src)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
        echo('replace: ' + dest)
      }
    }
  }
  walk(replaceDir)
}

try {
  overlayReplaceDir()
} catch (e) {
  echo('WARNING: build/replace overlay failed: ' + e.message)
}

echo('done install required modules')
