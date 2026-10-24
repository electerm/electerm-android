import { osResolve } from './resolve'

export default function () {
  // window.et.sessionLogPath only exists in a dev render: in production the
  // homepage is a build-time static file with no absolute paths, and the log
  // dir arrives with /api/get-constants (see lib/get-constants.js).
  return window.et.sessionLogPath ||
    window.pre?.sessionLogPath ||
    osResolve(window.store.appPath, 'electerm', 'session_logs')
}
