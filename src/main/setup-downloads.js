const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile, execFileSync, execSync} = require('child_process')
function createSetupDownloads({ipcMain, state}) {
let _activeWineDownloadReq = null

// Stream a URL to a file, sending progress events to renderer
function downloadToFile(url, dest, progressEvent) {
  return new Promise((resolve, reject) => {
    const doGet = (u, depth) => {
      if (depth > 5) return reject(new Error('Too many redirects'))
      const mod = u.startsWith('https') ? require('https') : require('http')
      const req = mod.get(u, { headers: { 'User-Agent': 'TruckersMP-Launcher' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return doGet(res.headers.location, depth + 1)
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
        const total = parseInt(res.headers['content-length'] || '0', 10)
        let received = 0
        const out = fs.createWriteStream(dest)
        _activeWineDownloadReq = { cancel: () => { req.destroy(); out.destroy(); reject(new Error('cancelled')) } }
        res.on('data', chunk => {
          received += chunk.length
          out.write(chunk)
          if (progressEvent && state.window) {
            state.window.webContents.send(progressEvent, { received, total })
          }
        })
        res.on('end', () => { _activeWineDownloadReq = null; out.end(resolve) })
        out.on('error', err => { _activeWineDownloadReq = null; req.destroy(); reject(err) })
        res.on('error', err => { _activeWineDownloadReq = null; out.destroy(); reject(err) })
      }).on('error', reject)
      _activeWineDownloadReq = { cancel: () => { req.destroy(); reject(new Error('cancelled')) } }
    }
    doGet(url, 0)
  })
}

ipcMain.handle('standalone:cancelWineDownload', () => {
  if (_activeWineDownloadReq) {
    _activeWineDownloadReq.cancel()
    _activeWineDownloadReq = null
    return { ok: true }
  }
  return { ok: false }
})

return {downloadToFile}
}
module.exports={createSetupDownloads}
