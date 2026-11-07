/**
 * Real download URLs for release assets (Android client override).
 *
 * electerm.org publishes the canonical mirror links for every asset on its
 * download cards (electerm.org repo: bin/data.js -> getAtomGitUrl/getR2Url/
 * getSourceforgeUrl, rendered by src/views/parts/download-card.pug). The
 * shared desktop client rebuilds those links from the GitHub URL instead, but
 * it hardcodes two desktop-only assumptions:
 *
 *   - atomgit repo is always "electerm/electerm" -> APKs live in
 *     "electerm/electerm-android", so the link 404s;
 *   - R2 prefix is always "/r/" -> APKs are mirrored into "/r1/", and the
 *     host in the desktop client (electerm-store.html5beta.com) is retired.
 *
 * The app already fetches the real GitHub download URL from electerm.org
 * (/data/electerm-github-release.json?src=<installSrc>); this module derives
 * the other mirrors from it with exactly the rules the site uses, so the five
 * options in the upgrade dialog match the five links on electerm.org.
 *
 * Pure module: no client imports, so it can be unit tested under plain node.
 */

const releasePath = /\/releases\/download\/([^/]+)\/([^/?#]+)/

export function isAndroidAsset (name = '', url = '') {
  return String(name).endsWith('.apk') || String(url).includes('electerm-android')
}

export function mirrorUrl (browserDownloadUrl, mirror) {
  const url = String(browserDownloadUrl || '')
  if (!url) {
    return ''
  }
  const m = url.match(releasePath)
  if (!m) {
    // A non-release URL cannot be rewritten into a mirror path. "github" is
    // just the original URL anyway; anything else has no known equivalent.
    return mirror === 'github' ? url : ''
  }
  const [, tag, file] = m
  const android = isAndroidAsset(file, url)
  const repo = android ? 'electerm-android' : 'electerm'
  const r2Prefix = android ? 'r1' : 'r'
  switch (mirror) {
    case 'github':
      return url
    case 'gh-proxy':
      return `https://mirror.electerm.org/${url}`
    case 'atomgit':
      return `https://atomgit.com/electerm/${repo}/releases/download/${tag}/${file}`
    case 'sourceforge':
      return `https://master.dl.sourceforge.net/project/electerm.mirror/${tag}/${file}?viasf=1`
    case 'r2':
      return `https://r2.electerm.org/${r2Prefix}/${file}`
    default:
      return url
  }
}
