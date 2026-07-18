/**
 * download upgrade class
 *
 * Ported from the desktop electerm source. Adapted for the
 * electerm-android ESM backend:
 *   - ESM imports
 *   - message ids aligned with the @electerm/electerm-react client
 *     contract (upgrade:data / upgrade:end / upgrade:err)
 *   - `process.send` (Electron IPC) replaced with `showItemInFolder`
 *     so it works under the on-device Node runtime
 */

import fs from 'fs'
import { resolve } from 'path'
import axios from 'axios'
import _ from 'lodash'
import { packInfo, tempDir } from '../common/runtime-constants.js'
import installSrc from '../lib/install-src.js'
import { fsExport } from '../lib/fs.js'
import { createProxyAgent } from '../lib/proxy-agent.js'
import { showItemInFolder } from '../lib/show-item-in-folder.js'
import log from '../common/log.js'
import globalState from './global-state.js'

axios.defaults.proxy = false
const { openFile, rmrf } = fsExport

function getUrl (url, mirror) {
  if (mirror === 'gh-proxy') {
    return `https://electerm-mirror.html5beta.com/${url}`
  } if (mirror === 'sourceforge') {
    const arr = url.split('/')
    const len = arr.length
    return `https://master.dl.sourceforge.net/project/electerm.mirror/${arr[len - 2]}/${arr[len - 1]}?viasf=1`
  } else if (mirror === 'r2') {
    return `https://electerm-store.html5beta.com/r/${url.split('/').pop()}`
  } else {
    return url
  }
}

function getReleaseInfo (filter, releaseInfoUrl, agent) {
  const conf = {
    url: releaseInfoUrl,
    timeout: 15000
  }
  if (agent) {
    conf.httpsAgent = agent
  }
  return axios(conf)
    .then((res) => {
      return res.data
        .release
        .assets
        .filter(filter)[0]
    })
}

class Upgrade {
  constructor (options) {
    this.options = options
  }

  async init () {
    const {
      id,
      ws,
      proxy,
      mirror
    } = this.options
    // register id early so destroy() works even if init() is aborted
    this.id = id
    const agent = createProxyAgent(proxy)
    const releaseInfoUrl = `${packInfo.homepage}/data/electerm-github-release.json?_=${+new Date()}`
    const filter = r => {
      return r.name.includes(installSrc)
    }
    const releaseInfo = await getReleaseInfo(filter, releaseInfoUrl, agent)
      .catch(err => this.onError(err, id, ws))
    if (!releaseInfo) {
      return
    }
    const localPath = resolve(tempDir, releaseInfo.name)
    const remotePath = getUrl(releaseInfo.browser_download_url, mirror)
    await rmrf(localPath).catch(log.error)
    const { size } = releaseInfo
    this.localPath = localPath
    const readSteam = await axios({
      url: remotePath,
      httpsAgent: agent,
      responseType: 'stream'
    })
      .then(r => r.data)
      .catch(err => {
        this.onError(err, id, ws)
      })
    if (!readSteam) {
      return
    }
    const writeSteam = fs.createWriteStream(localPath)

    let count = 0

    this.pausing = false

    this.onData = _.throttle((count) => {
      if (this.onDestroy) {
        return
      }

      ws.s({
        id: 'upgrade:data:' + id,
        data: Math.floor(count * 100 / size)
      })
    }, 1000)

    readSteam.on('data', chunk => {
      const res = writeSteam.write(chunk)
      if (res) {
        count += chunk.length
        this.onData(count)
      } else {
        readSteam.pause()
        writeSteam.once('drain', () => {
          count += chunk.length
          this.onData(count)
          if (!this.pausing) {
            readSteam.resume()
          }
        })
      }
    })

    readSteam.on('close', () => {
      writeSteam.end('', () => this.onEnd(id, ws))
    })

    readSteam.on('error', (err) => this.onError(err, id, ws))

    this.readSteam = readSteam
    this.writeSteam = writeSteam
    this.ws = ws
    this.destroy = this.destroy.bind(this)
  }

  onEnd (id, ws) {
    if (this.onDestroy) {
      return
    }
    openFile(this.localPath).catch(log.error)
    // showItemInFolder(this.localPath).catch(log.error)
    ws.s({
      id: 'upgrade:end:' + id,
      data: this.localPath
    })
  }

  onError (err, id, ws) {
    ws.s({
      id: 'upgrade:err:' + id,
      error: {
        message: err.message,
        stack: err.stack
      }
    })
  }

  pause () {
    this.pausing = true
    this.readSteam.pause()
  }

  resume () {
    this.pausing = false
    this.readSteam.resume()
  }

  destroy () {
    this.onDestroy = true
    this.readSteam && this.readSteam.destroy()
    this.ws && this.ws.close()
    globalState.removeUpgradeInst(this.id)
  }

  // end
}

export { Upgrade }
