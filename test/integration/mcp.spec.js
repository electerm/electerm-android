/**
 * Integration tests for the electerm-android MCP server — runs against a LIVE app.
 *
 * Prerequisites:
 *   - electerm-android dev app running with the frontend connected
 *   - MCP Server widget started on http://127.0.0.1:30837/mcp, default config
 *     (no apiKey; bookmarks/groups/sftp enabled; tasks extension enabled)
 *
 * SSH-dependent tests use an in-process test SSH server (@electerm/ssh2),
 * see test/integration/lib/ssh-test-server.js — no external SSH host needed.
 *
 * NOTE: electerm-android has NO local terminal (node-pty cannot build for
 * Android), so unlike desktop electerm there are no local-terminal tests
 * here. SSH tabs are the primary path and cover exec mode + MCP Tasks.
 *
 * Uses only Node.js built-ins: node:test, node:assert, node:http, global fetch.
 * All tests self-skip when the MCP server is unreachable.
 * Run: node --test test/integration/mcp.spec.js   (or npm run test:integration)
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  startTestSshServer,
  ensureKnownHostsEntry,
  TEST_USERNAME,
  TEST_PASSWORD,
  TEST_PORT
} from './lib/ssh-test-server.js'

const HOST = process.env.MCP_HOST || '127.0.0.1'
const PORT = Number(process.env.MCP_PORT || 30837)
const serverUrl = `http://${HOST}:${PORT}/mcp`
const uid = Date.now()

// ─────────────────────────────────────────────────────────────────────────────
// HTTP helpers — global fetch (built-in). Localhost is never routed through
// env proxies because fetch does not honor HTTP_PROXY by default.
// ─────────────────────────────────────────────────────────────────────────────

// node:http with agent:false (no keep-alive pool) so the process exits
// cleanly once tests finish — a global-fetch keep-alive socket would keep
// the event loop alive and hang `node --test`. A hard timeout guarantees no
// single request can hang the suite if the app never responds.
function httpRequest (method, urlStr, body, headers = {}, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const data = body !== undefined && body !== null ? JSON.stringify(body) : null
    const reqHeaders = { ...headers }
    if (data !== null) {
      reqHeaders['content-type'] = reqHeaders['content-type'] || 'application/json'
      reqHeaders['content-length'] = Buffer.byteLength(data)
    }
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method.toUpperCase(),
      headers: reqHeaders,
      agent: false
    }, (res) => {
      let chunks = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { chunks += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data: chunks }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timed out (${timeoutMs}ms): ${method} ${urlStr}`))
    })
    if (data !== null) req.write(data)
    req.end()
  })
}

// Raw GET for the long-lived SSE stream — fetch would block reading the body,
// so drive node:http directly and resolve once the first heartbeat lands.
function streamGet (urlStr, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr)
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'GET',
      headers,
      agent: false
    }, (res) => {
      let data = ''
      let settled = false
      const finish = () => {
        if (!settled) {
          settled = true
          res.destroy()
          resolve({ status: res.statusCode, headers: res.headers, data })
        }
      }
      res.on('data', (chunk) => {
        data += chunk.toString()
        if (data.includes(': ping')) finish()
      })
      res.on('end', finish)
      setTimeout(finish, timeoutMs)
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('Stream request timed out'))
    })
    req.end()
  })
}

function parseSseBody (body) {
  const text = typeof body === 'string' ? body : ''
  const line = text.split('\n').find(l => l.startsWith('data:'))
  if (!line) return null
  return JSON.parse(line.slice(5).trim())
}

function baseHeaders (sid) {
  const h = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  }
  if (sid) h['mcp-session-id'] = sid
  return h
}

async function initSession ({ protocolVersion = '2025-11-25', withTasksCap = false } = {}) {
  const res = await httpRequest('post', serverUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion,
      capabilities: withTasksCap
        ? { extensions: { 'io.modelcontextprotocol/tasks': {} } }
        : {},
      clientInfo: { name: 'electerm-android-integration-test', version: '1.0.0' }
    }
  }, {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  })
  const sid = res.headers['mcp-session-id']
  assert.ok(sid && sid !== 'null', `expected a real session ID, got: ${sid}`)
  await httpRequest('post', serverUrl, {
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }, baseHeaders(sid))
  return { sid, init: parseSseBody(res.data) }
}

let requestId = 1000

async function callTool (sid, toolName, args, { withTasksCap = false } = {}) {
  const params = { name: toolName, arguments: args }
  if (withTasksCap) {
    params._meta = {
      'io.modelcontextprotocol/clientCapabilities': {
        extensions: { 'io.modelcontextprotocol/tasks': {} }
      }
    }
  }
  const id = ++requestId
  const res = await httpRequest('post', serverUrl, {
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params
  }, baseHeaders(sid))
  assert.equal(res.status, 200)
  const jsonData = parseSseBody(res.data)
  assert.ok(jsonData, `No SSE data in response for ${toolName}`)
  assert.equal(jsonData.id, id)
  return jsonData
}

async function callMethod (sid, method, params) {
  const id = ++requestId
  const res = await httpRequest('post', serverUrl, {
    jsonrpc: '2.0',
    id,
    method,
    params
  }, baseHeaders(sid))
  assert.equal(res.status, 200)
  return parseSseBody(res.data)
}

// Parse the JSON payload of a successful tool result. Surfaces a clear
// message (instead of a cryptic SyntaxError) when a tool returns a plain
// string error or an isError envelope — common when the renderer can't
// satisfy a request (e.g. "Terminal not found").
function toolPayload (jsonData) {
  if (jsonData.error) {
    throw new Error(`JSON-RPC error from tool: ${JSON.stringify(jsonData.error)}`)
  }
  if (!jsonData.result) {
    throw new Error(`expected tool result, got: ${JSON.stringify(jsonData)}`)
  }
  if (jsonData.result.isError) {
    const txt = jsonData.result.content && jsonData.result.content[0] && jsonData.result.content[0].text
    throw new Error(`tool returned isError: ${txt || '(no text)'}`)
  }
  const text = jsonData.result.content && jsonData.result.content[0] && jsonData.result.content[0].text
  if (typeof text !== 'string') {
    throw new Error(`tool result has no text content: ${JSON.stringify(jsonData.result)}`)
  }
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`tool returned non-JSON content: ${text}`)
  }
}

// Poll tasks/get until the task reaches a terminal state (or deadline)
async function pollTask (sid, taskId, { timeoutMs = 45000, intervalMs = 1000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await callMethod(sid, 'tasks/get', { taskId })
    assert.ok(res.result, `tasks/get failed: ${JSON.stringify(res.error)}`)
    if (res.result.status !== 'working') {
      return res.result
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Task ${taskId} still working after ${timeoutMs}ms`)
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Read terminal output, tolerating the transient "Terminal not found"
// (isError) window right after a tab is opened but before its xterm ref is
// mounted — returns '' so the wait loops retry instead of choking.
async function getOutputTolerant (sid, tabId, lines) {
  const res = await callTool(sid, 'get_electerm_terminal_output', { tabId, lines })
  if (res.result && res.result.isError) {
    return ''
  }
  return (toolPayload(res).output || '')
}

// Wait until the terminal shows some content (SSH connected / shell booted).
async function waitForTerminalReady (sid, tabId, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const output = await getOutputTolerant(sid, tabId, 30)
    if (output.trim().length > 0) {
      return output
    }
    await sleep(1000)
  }
  throw new Error(`Terminal ${tabId} showed no content within ${timeoutMs}ms`)
}

// Poll terminal output until it contains the marker
async function waitForMarker (sid, tabId, marker, { timeoutMs = 60000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let lastOutput = ''
  while (Date.now() < deadline) {
    lastOutput = await getOutputTolerant(sid, tabId, 50)
    if (lastOutput.includes(marker)) {
      return lastOutput
    }
    await sleep(1000)
  }
  throw new Error(`Marker "${marker}" not seen within ${timeoutMs}ms. Last output: ${JSON.stringify(lastOutput.slice(-400))}`)
}

// Open an SSH tab against the in-process test server and wait until ready.
async function openSshTab (sid, title) {
  const opened = toolPayload(await callTool(sid, 'open_electerm_tab_ssh', {
    title,
    host: HOST,
    port: TEST_PORT,
    username: TEST_USERNAME,
    password: TEST_PASSWORD
  }))
  assert.equal(opened.success, true, `open SSH tab failed: ${JSON.stringify(opened)}`)
  await waitForTerminalReady(sid, opened.tabId)
  return opened.tabId
}

// ─────────────────────────────────────────────────────────────────────────────
// Global fixture
// ─────────────────────────────────────────────────────────────────────────────

let online = false
let sshServer = null
let sftpRoot = null

function skipOffline (t) {
  if (!online) {
    t.skip(`MCP server not reachable at ${HOST}:${PORT} — start the app with the MCP widget`)
    return true
  }
  return false
}

describe('MCP server integration (live app + in-process SSH server)', () => {
  before(async () => {
    // 1. Is the live MCP server reachable?
    try {
      const res = await httpRequest('options', serverUrl)
      online = res.status === 204
    } catch (_) {
      online = false
    }
    if (!online) {
      console.log('  MCP server offline — all integration tests will skip')
      return
    }

    // 2. Seed known_hosts for the fixed test host key (avoids UI prompts)
    ensureKnownHostsEntry(TEST_PORT, console.log)

    // 3. Start the in-process SSH server with a scratch SFTP root
    sftpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electerm-android-mcp-it-'))
    fs.writeFileSync(path.join(sftpRoot, 'hello.txt'), 'hello sftp world\n')
    fs.mkdirSync(path.join(sftpRoot, 'subdir'))
    fs.writeFileSync(path.join(sftpRoot, 'subdir', 'nested.txt'), 'nested file\n')
    try {
      sshServer = await startTestSshServer({ port: TEST_PORT, rootDir: sftpRoot })
    } catch (e) {
      console.log(`  Could not start in-process SSH server on ${TEST_PORT} (${e.message}). SSH/SFTP/Task tests will fail.`)
    }
  })

  after(async () => {
    if (sshServer) {
      // Drop any lingering SSH clients, then stop listening — otherwise the
      // open sockets keep the event loop alive and the process won't exit.
      sshServer.closeAllConnections?.()
      await new Promise(resolve => sshServer.close(resolve))
    }
    if (sftpRoot) {
      fs.rmSync(sftpRoot, { recursive: true, force: true })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 1. Protocol
  // ─────────────────────────────────────────────────────────────────────────

  test('OPTIONS /mcp returns 204 with CORS method headers', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const res = await httpRequest('options', serverUrl)
    assert.equal(res.status, 204)
    const methods = res.headers['access-control-allow-methods']
    assert.ok(methods && methods.includes('POST'))
    assert.ok(methods.includes('GET'))
    assert.ok(methods.includes('DELETE'))
    assert.ok(res.headers['access-control-allow-headers'].includes('mcp-session-id'))
  })

  test('initialize negotiates protocol version and returns server info', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const a = await initSession({ protocolVersion: '2024-11-05' })
    assert.equal(a.init.result.protocolVersion, '2024-11-05')
    assert.equal(a.init.result.serverInfo.name, 'electerm-mcp-server')
    assert.match(a.sid, /^[\w-]+$/)

    const b = await initSession({ protocolVersion: '2025-11-25' })
    assert.equal(b.init.result.protocolVersion, '2025-11-25')

    const c = await initSession({ protocolVersion: '1999-01-01' })
    assert.equal(c.init.result.protocolVersion, '2025-11-25', 'unknown version must fall back to newest supported')
  })

  test('initialize advertises the MCP Tasks extension', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const { init } = await initSession()
    const ext = init.result.capabilities.extensions
    assert.ok(ext, 'capabilities.extensions must exist (enableTasks defaults to true)')
    assert.ok('io.modelcontextprotocol/tasks' in ext)
  })

  test('tools/list exposes the Android tool set (no local-terminal / no legacy bg tools)', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const { sid } = await initSession()
    const res = await callMethod(sid, 'tools/list', {})
    const tools = res.result.tools
    const names = tools.map(tl => tl.name)

    for (const expected of [
      'list_electerm_tabs',
      'get_electerm_active_tab',
      'switch_electerm_tab',
      'close_electerm_tab',
      'reload_electerm_tab',
      'duplicate_electerm_tab',
      'send_electerm_terminal_command',
      'get_electerm_terminal_selection',
      'get_electerm_terminal_output',
      'wait_for_electerm_terminal_idle',
      'get_electerm_terminal_status',
      'cancel_electerm_terminal_command',
      'execute_electerm_command',
      'open_electerm_tab_ssh',
      'open_electerm_tab_telnet',
      'open_electerm_tab_serial',
      'list_electerm_bookmarks',
      'get_electerm_bookmark',
      'add_electerm_bookmark_ssh',
      'edit_electerm_bookmark',
      'delete_electerm_bookmark',
      'open_electerm_bookmark',
      'list_electerm_bookmark_groups',
      'electerm_sftp_list',
      'electerm_sftp_stat',
      'electerm_sftp_read_file',
      'electerm_sftp_del_file_or_folder',
      'electerm_sftp_upload',
      'electerm_sftp_download',
      'electerm_zmodem_upload',
      'electerm_zmodem_download',
      'electerm_sftp_transfer_list',
      'electerm_sftp_transfer_history'
    ]) {
      assert.ok(names.includes(expected), `Missing tool: ${expected}`)
    }

    // Android has no local terminal — these must be absent.
    for (const removed of [
      'open_electerm_local_terminal',
      'open_electerm_tab_local',
      'add_electerm_bookmark_local',
      // legacy background tools replaced by execute_electerm_command + Tasks
      'run_electerm_background_command',
      'get_electerm_background_task_status',
      'get_electerm_background_task_log',
      'cancel_electerm_background_task'
    ]) {
      assert.ok(!names.includes(removed), `Removed tool still present: ${removed}`)
    }

    const exec = tools.find(tl => tl.name === 'execute_electerm_command')
    const props = exec.inputSchema.properties
    assert.deepEqual(props.mode.enum, ['exec', 'pty'])
    assert.equal(props.wait.type, 'boolean')
  })

  test('unknown method returns -32601, ping returns empty result', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const { sid } = await initSession()
    const bad = await callMethod(sid, 'no_such_method', {})
    assert.equal(bad.error.code, -32601)
    const ping = await callMethod(sid, 'ping', {})
    assert.deepEqual(ping.result, {})
  })

  test('GET /mcp SSE stream lifecycle', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const { sid } = await initSession()

    const okRes = await streamGet(serverUrl, {
      Accept: 'text/event-stream',
      'Mcp-Session-Id': sid
    })
    assert.equal(okRes.status, 200)
    assert.equal(okRes.headers['content-type'], 'text/event-stream')
    assert.ok(okRes.data.includes(': ping'))

    // missing session id -> 400
    const missing = await httpRequest('get', serverUrl, null, { accept: 'text/event-stream' })
    assert.equal(missing.status, 400)

    // invalid session id -> 400
    const invalid = await httpRequest('get', serverUrl, null, {
      accept: 'text/event-stream',
      'mcp-session-id': 'invalid-session-id'
    })
    assert.equal(invalid.status, 400)
  })

  test('tasks method surface: get/cancel errors, list/update not implemented', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const { sid } = await initSession()

    const unknown = await callMethod(sid, 'tasks/get', { taskId: 'task-nope' })
    assert.equal(unknown.error.code, -32602)

    const missing = await callMethod(sid, 'tasks/get', {})
    assert.equal(missing.error.code, -32602)

    const cancelUnknown = await callMethod(sid, 'tasks/cancel', { taskId: 'task-nope' })
    assert.equal(cancelUnknown.error.code, -32602)

    const list = await callMethod(sid, 'tasks/list', {})
    assert.equal(list.error.code, -32601)

    const update = await callMethod(sid, 'tasks/update', { taskId: 'task-x' })
    assert.equal(update.error.code, -32601)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 2. SSH tab: exec mode (the primary Android path) + execute validation
  // ─────────────────────────────────────────────────────────────────────────

  test('SSH tab: exec mode with real stdout/stderr/exitCode', { timeout: 120000 }, async (t) => {
    if (skipOffline(t)) return
    assert.ok(sshServer, 'in-process SSH server did not start')
    const { sid } = await initSession()
    const tabId = await openSshTab(sid, `MCP_IT_SSH_${uid}`)

    try {
      const marker = `MCP_IT_SSH_EXEC_${uid}`
      const r = toolPayload(await callTool(sid, 'execute_electerm_command', {
        command: `echo "${marker}"`,
        tabId
      }))
      assert.equal(r.mode, 'exec', 'SSH tabs must use the exec channel')
      assert.equal(r.exitCode, 0)
      assert.equal(r.stderrMerged, false)
      assert.ok(r.stdout.includes(marker))

      // stdout and stderr are captured separately
      const r2 = toolPayload(await callTool(sid, 'execute_electerm_command', {
        command: 'echo SSH_OUT; echo SSH_ERR >&2',
        tabId
      }))
      assert.ok(r2.stdout.includes('SSH_OUT'))
      assert.ok(r2.stderr.includes('SSH_ERR'))
      assert.ok(!r2.stdout.includes('SSH_ERR'), 'stderr must not leak into stdout in exec mode')

      // real exit codes
      const r7 = toolPayload(await callTool(sid, 'execute_electerm_command', {
        command: 'exit 7',
        tabId
      }))
      assert.equal(r7.exitCode, 7)

      // explicit pty mode on an SSH tab still works (visible terminal)
      const rPty = toolPayload(await callTool(sid, 'execute_electerm_command', {
        command: 'echo PTY_MODE_OK',
        tabId,
        mode: 'pty'
      }))
      assert.equal(rPty.mode, 'pty')
      assert.ok(rPty.stdout.includes('PTY_MODE_OK'))

      // timeout returns partial result with timedOut
      const rTo = toolPayload(await callTool(sid, 'execute_electerm_command', {
        command: 'sleep 30',
        tabId,
        timeoutMs: 3000
      }))
      assert.equal(rTo.timedOut, true)
      assert.equal(rTo.exitCode, null)
      await callTool(sid, 'cancel_electerm_terminal_command', { tabId })

      // built-in blacklist still guards the exec path
      const blocked = await callTool(sid, 'execute_electerm_command', { command: 'rm -rf /', tabId })
      assert.equal(blocked.result.isError, true)

      // missing command errors
      const noCmd = await callTool(sid, 'execute_electerm_command', { tabId })
      assert.equal(noCmd.result.isError, true)

      // wait=false without a tasks-capable client errors (legacy tools removed)
      const noCaps = await callTool(sid, 'execute_electerm_command', {
        command: 'sleep 5',
        tabId,
        wait: false
      })
      assert.equal(noCaps.result.isError, true)
      assert.ok(/MCP Tasks extension/.test(noCaps.result.content[0].text))
    } finally {
      await callTool(sid, 'close_electerm_tab', { tabId })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 3. MCP Tasks end-to-end over SSH
  // ─────────────────────────────────────────────────────────────────────────

  test('MCP Tasks end-to-end: wait=false → tasks/get → completed', { timeout: 120000 }, async (t) => {
    if (skipOffline(t)) return
    assert.ok(sshServer, 'in-process SSH server did not start')
    const { sid } = await initSession({ withTasksCap: true })
    const tabId = await openSshTab(sid, `MCP_IT_SSH_TASK_${uid}`)

    try {
      const marker = `MCP_IT_TASK_DONE_${uid}`
      const created = await callTool(sid, 'execute_electerm_command', {
        command: `sleep 2 && echo "${marker}"`,
        tabId,
        wait: false
      }, { withTasksCap: true })

      const taskResult = created.result
      assert.equal(taskResult.resultType, 'task', `expected task handle, got: ${JSON.stringify(taskResult)}`)
      const task = taskResult.task
      assert.ok(task.taskId.startsWith('task-'))
      assert.equal(task.status, 'working')
      assert.ok(task.ttl > 0 && task.pollIntervalMs > 0)
      assert.ok(!('meta' in task), 'task wire shape must not leak server meta')

      const final = await pollTask(sid, task.taskId, { timeoutMs: 45000 })
      assert.equal(final.status, 'completed',
        `task must complete; got ${final.status}: ${JSON.stringify(final.error || final.result || final)}`)
      assert.ok(final.result.stdout.includes(marker), `expected "${marker}" in task result stdout`)
      assert.equal(final.result.exitCode, 0)
      assert.equal(typeof final.result.durationMs, 'number')
    } finally {
      await callTool(sid, 'close_electerm_tab', { tabId })
    }
  })

  test('MCP Tasks: tasks/cancel stops a long-running command', { timeout: 120000 }, async (t) => {
    if (skipOffline(t)) return
    assert.ok(sshServer, 'in-process SSH server did not start')
    const { sid } = await initSession({ withTasksCap: true })
    const tabId = await openSshTab(sid, `MCP_IT_SSH_CANCEL_${uid}`)

    try {
      const created = await callTool(sid, 'execute_electerm_command', {
        command: 'sleep 60',
        tabId,
        wait: false
      }, { withTasksCap: true })
      const task = created.result.task
      assert.equal(task.status, 'working')

      const cancelled = await callMethod(sid, 'tasks/cancel', { taskId: task.taskId })
      assert.equal(cancelled.result.status, 'cancelled')

      // terminal state is stable
      const again = await callMethod(sid, 'tasks/get', { taskId: task.taskId })
      assert.equal(again.result.status, 'cancelled')
    } finally {
      await callTool(sid, 'close_electerm_tab', { tabId })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 4. SSH interactive shell via send/read tools
  // ─────────────────────────────────────────────────────────────────────────

  test('SSH tab: interactive shell via send/read tools', { timeout: 120000 }, async (t) => {
    if (skipOffline(t)) return
    assert.ok(sshServer, 'in-process SSH server did not start')
    const { sid } = await initSession()
    const tabId = await openSshTab(sid, `MCP_IT_SSH_SHELL_${uid}`)

    try {
      const marker = `MCP_IT_SHELL_${uid}`
      await callTool(sid, 'send_electerm_terminal_command', {
        command: `echo "${marker}"`,
        tabId
      })
      const output = await waitForMarker(sid, tabId, marker)
      assert.ok(output.includes(marker))
    } finally {
      await callTool(sid, 'close_electerm_tab', { tabId })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 5. SFTP against the in-process server (needs the app's SFTP panel)
  // ─────────────────────────────────────────────────────────────────────────

  test('SFTP: list, stat, read, del on the test server', { timeout: 120000 }, async (t) => {
    if (skipOffline(t)) return
    assert.ok(sshServer, 'in-process SSH server did not start')
    const { sid } = await initSession()
    const tabId = await openSshTab(sid, `MCP_IT_SSH_SFTP_${uid}`)

    // The MCP sftp tools require the app's SFTP panel to be initialized for
    // the tab; tolerate the known "not initialized" error but verify shapes
    // when the panel is available.
    const tolerant = (jsonData, what) => {
      if (jsonData.result && jsonData.result.isError) {
        assert.ok(
          /SFTP not initialized|not an SSH\/SFTP tab/.test(jsonData.result.content[0].text),
          `unexpected ${what} error: ${jsonData.result.content[0].text}`
        )
        return null
      }
      return toolPayload(jsonData)
    }

    try {
      const list = tolerant(await callTool(sid, 'electerm_sftp_list', { tabId, remotePath: '/' }), 'sftp_list')
      if (list) {
        assert.ok(Array.isArray(list.list))
        assert.ok(list.list.some(f => f.name === 'hello.txt'), `expected hello.txt in / listing: ${JSON.stringify(list.list)}`)
      }

      const stat = tolerant(await callTool(sid, 'electerm_sftp_stat', { tabId, remotePath: '/hello.txt' }), 'sftp_stat')
      if (stat) {
        assert.ok(stat.stat, 'stat result expected')
      }

      const read = tolerant(await callTool(sid, 'electerm_sftp_read_file', { tabId, remotePath: '/hello.txt' }), 'sftp_read_file')
      if (read) {
        assert.ok(String(read.content).includes('hello sftp world'))
      }

      const delName = `/mcp-it-del-${uid}.txt`
      fs.writeFileSync(path.join(sftpRoot, `mcp-it-del-${uid}.txt`), 'delete me')
      const del = tolerant(await callTool(sid, 'electerm_sftp_del_file_or_folder', { tabId, remotePath: delName }), 'sftp_del')
      if (del) {
        assert.equal(del.success, true)
        assert.ok(
          !fs.existsSync(path.join(sftpRoot, `mcp-it-del-${uid}.txt`)),
          'deleted file must be gone from the SFTP root'
        )
      }

      // Upload: local scratch file → remote / (confined to sftpRoot)
      const localUp = path.join(os.tmpdir(), `mcp-it-up-${uid}.txt`)
      fs.writeFileSync(localUp, `upload content ${uid}`)
      const up = tolerant(await callTool(sid, 'electerm_sftp_upload', {
        tabId,
        localPath: localUp,
        remotePath: `/mcp-it-up-${uid}.txt`
      }), 'sftp_upload')
      if (up) {
        assert.equal(up.success, true)
        assert.ok(up.transferId)
        // The transfer panel uploads asynchronously — poll for arrival
        const upDeadline = Date.now() + 20000
        let arrived = false
        while (Date.now() < upDeadline && !arrived) {
          arrived = fs.existsSync(path.join(sftpRoot, `mcp-it-up-${uid}.txt`))
          if (!arrived) await sleep(500)
        }
        assert.ok(arrived, 'uploaded file must land in the confined SFTP root')
      }
      fs.rmSync(localUp, { force: true })

      // Download: remote hello.txt → local scratch path
      const localDown = path.join(os.tmpdir(), `mcp-it-down-${uid}.txt`)
      const down = tolerant(await callTool(sid, 'electerm_sftp_download', {
        tabId,
        remotePath: '/hello.txt',
        localPath: localDown
      }), 'sftp_download')
      if (down) {
        assert.equal(down.success, true)
        const downDeadline = Date.now() + 20000
        let arrived = false
        while (Date.now() < downDeadline && !arrived) {
          arrived = fs.existsSync(localDown)
          if (!arrived) await sleep(500)
        }
        if (arrived) {
          assert.ok(fs.readFileSync(localDown, 'utf8').includes('hello sftp world'))
          fs.rmSync(localDown, { force: true })
        } else {
          assert.fail('downloaded file never arrived locally')
        }
      }

      // Transfer list/history are readable regardless
      const transfers = toolPayload(await callTool(sid, 'electerm_sftp_transfer_list', {}))
      assert.ok(Array.isArray(transfers))
      const history = toolPayload(await callTool(sid, 'electerm_sftp_transfer_history', {}))
      assert.ok(Array.isArray(history))
    } finally {
      await callTool(sid, 'close_electerm_tab', { tabId })
    }
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Bookmarks CRUD (clean up after ourselves)
  // ─────────────────────────────────────────────────────────────────────────

  test('bookmarks: add, list, get, edit, delete', { timeout: 60000 }, async (t) => {
    if (skipOffline(t)) return
    const { sid } = await initSession()
    const title = `MCP_IT_BM_${uid}`

    const added = toolPayload(await callTool(sid, 'add_electerm_bookmark_ssh', {
      title,
      host: HOST,
      port: TEST_PORT,
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    }))
    assert.equal(added.success, true)
    const id = added.id

    try {
      const list = toolPayload(await callTool(sid, 'list_electerm_bookmarks', {}))
      const found = list.find(b => b.id === id)
      assert.ok(found, 'bookmark must appear in list')
      assert.equal(found.title, title)
      assert.ok(!('password' in found), 'bookmark list must not leak passwords')

      const got = toolPayload(await callTool(sid, 'get_electerm_bookmark', { id }))
      assert.equal(got.title, title)
      assert.ok(!('password' in got), 'bookmark get must not leak passwords')

      const edited = toolPayload(await callTool(sid, 'edit_electerm_bookmark', {
        id,
        updates: { title: `${title}_renamed` }
      }))
      assert.equal(edited.success, true)
      const got2 = toolPayload(await callTool(sid, 'get_electerm_bookmark', { id }))
      assert.equal(got2.title, `${title}_renamed`)
    } finally {
      const deleted = toolPayload(await callTool(sid, 'delete_electerm_bookmark', { id }))
      assert.equal(deleted.success, true)
      const list2 = toolPayload(await callTool(sid, 'list_electerm_bookmarks', {}))
      assert.ok(!list2.find(b => b.id === id), 'bookmark must be deleted')
    }

    const groups = toolPayload(await callTool(sid, 'list_electerm_bookmark_groups', {}))
    assert.ok(Array.isArray(groups))
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Argument validation
  // ─────────────────────────────────────────────────────────────────────────

  test('argument validation errors are reported as isError', { timeout: 30000 }, async (t) => {
    if (skipOffline(t)) return
    const { sid } = await initSession()

    const cases = [
      ['electerm_sftp_list', {}],
      ['electerm_sftp_del_file_or_folder', {}],
      ['electerm_sftp_upload', { remotePath: '/tmp/x' }],
      ['electerm_sftp_download', { localPath: '/tmp/x' }],
      ['electerm_zmodem_upload', {}],
      ['electerm_zmodem_download', { saveFolder: '/tmp' }]
    ]
    for (const [tool, args] of cases) {
      const res = await callTool(sid, tool, args)
      assert.ok(
        res.error || (res.result && res.result.isError),
        `${tool} with ${JSON.stringify(args)} must error`
      )
    }
  })
})
