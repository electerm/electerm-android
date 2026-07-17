// Static imports so bundlers (esbuild) can discover and include all session
// modules. Dynamic import() with a computed path (e.g. `./session-${type}.js`)
// is opaque to bundlers — the files are never included in the bundle and the
// import fails at runtime. A plain dispatch table is the standard fix.
import * as sessionSsh from './session-ssh.js'
import * as sessionTelnet from './session-telnet.js'
import * as sessionSerial from './session-serial.js'
import * as sessionLocal from './session-local.js'
import * as sessionRdp from './session-rdp.js'
import * as sessionVnc from './session-vnc.js'
import * as sessionSpice from './session-spice.js'

const sessionModules = {
  ssh: sessionSsh,
  telnet: sessionTelnet,
  serial: sessionSerial,
  local: sessionLocal,
  rdp: sessionRdp,
  vnc: sessionVnc,
  spice: sessionSpice
}

function getType (initOptions) {
  const type = initOptions.termType || initOptions.type
  const tail = [
    'telnet',
    'serial',
    'local',
    'rdp',
    'vnc',
    'spice'
  ].includes(type)
    ? type
    : 'ssh'
  return tail
}

export const terminal = async function (initOptions, ws) {
  const type = getType(initOptions)
  console.log('type', type)
  const { terminal } = sessionModules[type]
  return terminal(initOptions, ws)
}

export const testConnection = async (initOptions, ws) => {
  const type = getType(initOptions)
  const { testConnection } = sessionModules[type]
  return testConnection(initOptions, ws)
}
