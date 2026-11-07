/**
 * check latest release for update warn
 *
 * ANDROID OVERLAY of @electerm/electerm-react/client/common/update-check.js.
 * Only the mirror URL construction differs from upstream; see
 * ./download-mirror.js for why. Everything else is kept in sync with the
 * package so this file can be dropped once upstream ships the same fix
 * (install.js applies build/replace/src/client/electerm-react/** last).
 */

import fetch from './fetch-from-server'
import { mirrorUrl } from './download-mirror.js'
import {
  baseUpdateCheckUrls, packInfo
} from './constants'
import dayjs from 'dayjs'

async function fetchData (url, options) {
  const data = {
    action: 'fetch',
    options: {
      ...options,
      url,
      timeout: 15000
    },
    proxy: window.store.getProxySetting()
  }
  return fetch(data)
}

function getInfo (url) {
  const n = Date.now()
  const tail = url.includes('?') ? '&_=' + n : '?_=' + n
  return fetchData(url + tail, {
    action: 'get-update-info',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/59.0.3071.115 Safari/537.36'
    },
    timeout: 1000 * 60 * 5
  })
    .catch(() => {
      return null
    })
}

export async function getLatestReleaseVersion (n) {
  let q = ''
  if (n) {
    const { store } = window
    const info = {
      load_time: store.loadTime,
      bookmark_count: store.bookmarks.length,
      lang: store.config.language,
      sync_with_github: !!store.config.syncSetting?.githubGistId,
      sync_with_gitee: !!store.config.syncSetting?.giteeGistId,
      version: packInfo.version,
      installSrc: store.installSrc,
      n: Date.now()
    }
    q = Object.keys(info).reduce((p, k, i) => {
      const pre = i ? '&' : '?'
      return p + pre + k + '=' + encodeURIComponent(info[k])
    }, '')
  }
  const versionFile = window.et.versionFile || 'version.html'
  let url = `${baseUpdateCheckUrls[0]}/${versionFile}${q}`
  let tagName = await getInfo(url)
  if (!tagName) {
    url = `${baseUpdateCheckUrls[1]}/${versionFile}${q}`
    tagName = await getInfo(url)
  }
  if (tagName) {
    return {
      tag_name: tagName
    }
  }
}

// Kept as an export because other client code may import it by name. The
// upstream implementation hardcoded "electerm/electerm", which is the desktop
// repo; APKs are released from "electerm/electerm-android" on both hosts, so
// the owner/repo has to come from the real download URL served by electerm.org.
export function getAtomgitUrl (url) {
  return mirrorUrl(url, 'atomgit')
}

export function getDownloadUrl (browserDownloadUrl, mirror) {
  return mirrorUrl(browserDownloadUrl, mirror)
}

export async function getLatestReleaseInfo () {
  const { installSrc } = window.store
  const src = installSrc ? '?src=' + encodeURIComponent(installSrc) : ''
  let url = `${baseUpdateCheckUrls[0]}/data/electerm-github-release.json${src}`
  let res = await getInfo(url)
  if (!res?.release?.body) {
    url = `${baseUpdateCheckUrls[1]}/data/electerm-github-release.json${src}`
    res = await getInfo(url)
  }
  if (!res || !res.release) {
    return undefined
  }
  const asset = (res.release.assets || []).find(r => r.name.includes(installSrc))
  return {
    body: res.release.body,
    date: dayjs(res.release.published_at).format('YYYY-MM-DD'),
    browserDownloadUrl: asset ? asset.browser_download_url : ''
  }
}
