import { exec } from 'child_process'
import {
  isWin,
  isMac
} from '../common/runtime-constants.js'
import { dirname, resolve } from 'path'

export async function showItemInFolder (filePath) {
  const itemPath = resolve(filePath)
  const folderPath = dirname(itemPath)
  let command = ''

  if (isWin) {
    // For Windows
    command = `explorer.exe /select,"${itemPath}"`
  } else if (isMac) {
    // For macOS
    command = `open -R "${folderPath}"`
  } else {
    // For Linux or other Unix-like systems
    command = `xdg-open "${folderPath}"`
  }

  return new Promise((resolve) => {
    // Best-effort: the file manager may be unavailable (e.g. Android, headless
    // Linux). Never reject — "show in folder" is purely cosmetic and a missing
    // handler must not crash or surface an unhandled rejection.
    exec(command, (error, _stdout, stderr) => {
      if (error) {
        resolve('no file manager available')
        return
      }
      if (stderr) {
        console.warn('showItemInFolder stderr:', stderr.toString())
      }
      resolve('Item shown in folder successfully.')
    })
  })
}
