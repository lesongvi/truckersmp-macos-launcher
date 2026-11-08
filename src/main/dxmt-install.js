const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const { httpsGet } = require('./network')
function registerDxmtHandlers({ ipcMain, state, paths, downloads }) {
  const { dxmtDir: SW_DXMT_DIR } = paths
  const { downloadToFile } = downloads
  async function installDxmtFromTar(tarPath) {
    if (fs.existsSync(SW_DXMT_DIR)) fs.rmSync(SW_DXMT_DIR, { recursive: true, force: true })
    fs.mkdirSync(SW_DXMT_DIR, { recursive: true })
    await new Promise((resolve, reject) => {
      const flag = tarPath.endsWith('.tar.xz') ? 'xJf' : 'xzf'
      const proc = spawn('tar', [flag, tarPath, '-C', SW_DXMT_DIR])
      proc.stderr.on('data', (d) => console.warn('tar dxmt:', d.toString()))
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
      proc.on('error', reject)
    })
    function findAllFiles(dir, name, depth) {
      if (depth > 6) return []
      const results = []
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return results
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isFile() && entry.name.toLowerCase() === name) results.push(full)
        else if (entry.isDirectory()) results.push(...findAllFiles(full, name, depth + 1))
      }
      return results
    }
    const allDxgi = findAllFiles(SW_DXMT_DIR, 'dxgi.dll', 0)
    if (!allDxgi.length)
      throw new Error(
        'dxgi.dll not found inside the archive. Make sure this is a DXMT release tarball.'
      )
    const is64Seg = (seg) => /^(x86.?64|x64|win64)/i.test(seg)
    const dxgiPath = allDxgi.find((p) => p.split(/[/\\]/).some(is64Seg)) || allDxgi[0]
    const dxmtDir = path.dirname(dxgiPath)
    const bridgeNames = ['winemetal.so', 'winemetal.dylib', 'libdxmtapi.dylib']
    let winemetalPath = null
    const findWinemetal = (dir, depth) => {
      if (depth > 6 || winemetalPath) return
      let entries
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.isFile() && bridgeNames.includes(entry.name.toLowerCase())) {
          winemetalPath = path.join(dir, entry.name)
          return
        }
        if (entry.isDirectory()) findWinemetal(path.join(dir, entry.name), depth + 1)
        if (winemetalPath) return
      }
    }
    findWinemetal(SW_DXMT_DIR, 0)
    if (winemetalPath) console.log('[DXMT] Found macOS bridge library:', winemetalPath)
    else
      console.log(
        '[DXMT] No winemetal bridge library in this archive (Wine package is expected to supply it)'
      )
    const tarFileName = path.basename(tarPath)
    const verMatch = tarFileName.match(/(\d+\.\d+(?:\.\d+)?)/)
    const dxmtFileVersion = verMatch ? verMatch[1] : ''
    return { ok: true, dxmtDir, winemetalPath, dxmtFileVersion }
  }

  // Accept a DXMT .tar.gz, extract it, find the DLLs, store their parent dir
  ipcMain.handle('standalone:installDxmt', async (_, tarPath) => {
    try {
      if (!fs.existsSync(tarPath)) return { ok: false, error: `File not found: ${tarPath}` }
      return await installDxmtFromTar(tarPath)
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // Fetch the latest DXMT release from GitHub, download and install automatically
  ipcMain.handle('standalone:autoInstallDxmt', async () => {
    try {
      const sendDxmtStatus = (msg) => {
        if (state.window && !state.window.isDestroyed())
          state.window.webContents.send('standalone:dxmtStatus', msg)
      }
      sendDxmtStatus('Fetching release info from GitHub…')
      const apiData = await httpsGet('https://api.github.com/repos/3Shain/dxmt/releases/latest')
      const release = JSON.parse(apiData.toString())
      const assets = release.assets || []
      const asset =
        assets.find((a) => a.name.includes('arm64') && a.name.endsWith('.tar.gz')) ||
        assets.find((a) => a.name.endsWith('.tar.gz'))
      if (!asset) return { ok: false, error: 'No .tar.gz asset found in the latest release' }
      const sizeMB = (asset.size / 1024 / 1024).toFixed(1)
      sendDxmtStatus(`Downloading ${asset.name} (${sizeMB} MB)…`)
      const tmpPath = path.join(os.tmpdir(), asset.name)
      await downloadToFile(asset.browser_download_url, tmpPath, null)
      sendDxmtStatus('Extracting archive…')
      const result = await installDxmtFromTar(tmpPath)
      try {
        fs.unlinkSync(tmpPath)
      } catch {}
      return result
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
}
module.exports = { registerDxmtHandlers }
