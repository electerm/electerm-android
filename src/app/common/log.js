import { config } from 'dotenv'
import fs from 'fs'
import path from 'path'

config()

// Lightweight, dependency-free logger.
// - Logs to the console (level-aware) and, when possible, to a rolling file
//   under the node project's `data/log` directory so logs can be pulled for
//   debugging on Android.
// - Replaces `electron-log` entirely so the backend has no native/desktop-only
//   dependency and starts reliably on the mobile Node runtime.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 }

function levelFromEnv () {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase()
  return Object.prototype.hasOwnProperty.call(LEVELS, raw) ? LEVELS[raw] : LEVELS.info
}

const threshold = levelFromEnv()

let logFile = null
try {
  // Honour DB_PATH (set by the Android entry point to a stable, app-private
  // directory) so logs live next to the database/uploads. Fall back to
  // <cwd>/data/log when DB_PATH is not set (desktop / local runs).
  const base = process.env.DB_PATH
    ? path.resolve(process.env.DB_PATH, 'log')
    : path.resolve(process.cwd(), 'data', 'log')
  fs.mkdirSync(base, { recursive: true })
  logFile = path.join(base, 'electerm.log')
} catch (e) {
  // File logging is best-effort; never let it break startup.
  logFile = null
}

function ts () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function formatArg (a) {
  if (a instanceof Error) return a.stack || a.message
  if (typeof a === 'string') return a
  if (a === undefined) return 'undefined'
  if (a === null) return 'null'
  try {
    return JSON.stringify(a)
  } catch (e) {
    return String(a)
  }
}

function emit (level, args) {
  const line = `[${ts()}] ${level} › ${args.map(formatArg).join(' ')}`
  if (LEVELS[level] <= threshold) {
    const fn =
      level === 'error' ? console.error
        : level === 'warn' ? console.warn
          : level === 'debug' ? console.debug
            : console.log
    fn(line)
  }
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n')
    } catch (e) {
      // ignore write failures
    }
  }
}

const logger = {
  error: (...args) => emit('error', args),
  warn: (...args) => emit('warn', args),
  info: (...args) => emit('info', args),
  debug: (...args) => emit('debug', args),
  // kept for minimal API compatibility with callers that touch transports
  transports: { console: { format: '' } }
}

export default logger
