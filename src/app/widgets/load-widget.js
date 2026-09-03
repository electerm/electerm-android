// load-widget.js

// Static imports so bundlers can include all widget modules in a single output file
import * as widgetBatchOp from './widget-batch-op.js'
import * as widgetLocalFileServer from './widget-local-file-server.js'
import * as widgetLocalFtpServer from './widget-local-ftp-server.js'
import * as widgetMcpServer from './widget-mcp-server.js'
import * as widgetRename from './widget-rename.js'
import * as widgetSshServer from './widget-ssh-server.js'

// Registry maps widget ID → module. Add new widgets here.
const widgetRegistry = {
  'batch-op': widgetBatchOp,
  'local-file-server': widgetLocalFileServer,
  'local-ftp-server': widgetLocalFtpServer,
  'mcp-server': widgetMcpServer,
  rename: widgetRename,
  'ssh-server': widgetSshServer
}

const widgetIdPattern = /^[a-z0-9-]+$/

// Store running widget instances
const runningInstances = new Map()

async function listWidgets () {
  return Object.entries(widgetRegistry).map(([id, mod]) => ({
    id,
    info: mod.widgetInfo
  }))
}

function hasRunningInstance (widgetId) {
  for (const [, instance] of runningInstances) {
    if (instance.widgetId === widgetId) {
      return true
    }
  }
  return false
}

async function runWidget (widgetId, config) {
  if (typeof widgetId !== 'string' || !widgetIdPattern.test(widgetId)) {
    throw new Error(`Invalid widget ID: ${widgetId}`)
  }
  const widget = widgetRegistry[widgetId]
  if (!widget) {
    throw new Error(`Widget not found: ${widgetId}`)
  }

  const { type, singleInstance } = widget.widgetInfo
  if (type !== 'instance') {
    return widget.widgetRun(config)
  }

  // Check if singleInstance widget already has a running instance
  if (singleInstance && hasRunningInstance(widgetId)) {
    return Promise.reject(new Error(`Widget ${widgetId} already has a running instance. Only one instance is allowed.`))
  }

  const instance = widget.widgetRun(config)
  instance.widgetId = widgetId
  runningInstances.set(instance.instanceId, instance)

  return instance.start()
    .then((result) => {
      return {
        instanceId: instance.instanceId,
        widgetId,
        singleInstance: !!singleInstance,
        ...result
      }
    })
    .catch((err) => {
      runningInstances.delete(instance.instanceId)
      return instance.stop().catch(() => {}).then(() => { throw err })
    })
}

function stopWidget (instanceId) {
  const instance = runningInstances.get(instanceId)
  if (!instance) {
    console.error(`No running instance found for instanceId: ${instanceId}`)
    return
  }

  return instance.stop()
    .then(() => {
      runningInstances.delete(instanceId)
      return { instanceId, status: 'stopped' }
    })
}

async function runWidgetFunc (instanceId, funcName, ...args) {
  const instance = runningInstances.get(instanceId)
  if (!instance) {
    throw new Error(`No running instance found for instanceId: ${instanceId}`)
  }

  if (typeof instance[funcName] !== 'function') {
    throw new Error(`Function ${funcName} not found in widget instance`)
  }

  try {
    const result = await instance[funcName](...args)
    return result
  } catch (error) {
    console.error(`Error executing ${funcName} on widget instance ${instanceId}:`, error)
    throw error
  }
}

async function cleanup () {
  if (runningInstances.size === 0) {
    return
  }

  const stopPromises = []

  for (const [instanceId, instance] of runningInstances) {
    console.log(`Stopping widget instance: ${instanceId}`)
    try {
      const stopPromise = instance.stop()
        .then(() => {
          console.log(`Successfully stopped widget instance: ${instanceId}`)
        })
        .catch(err => {
          console.error(`Error stopping widget instance ${instanceId}:`, err)
        })
      stopPromises.push(stopPromise)
    } catch (err) {
      console.error(`Error initiating stop for widget instance ${instanceId}:`, err)
    }
  }

  try {
    await Promise.allSettled(stopPromises)
    runningInstances.clear()
    console.log('All widget instances have been stopped')
  } catch (err) {
    console.error('Error during cleanup:', err)
  }
}

// Register cleanup handlers only for process exit signals
function registerCleanupHandlers () {
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, cleaning up widgets...')
    await cleanup()
  })
}

// Initialize cleanup handlers
registerCleanupHandlers()

export {
  listWidgets,
  runWidget,
  stopWidget,
  runWidgetFunc
}
