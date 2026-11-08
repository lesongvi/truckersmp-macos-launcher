const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const haulLog = require('../haullog')
const truckersvn = require('../truckersvn')
const { connectToolToBottle } = require('../truckersvn-context')
const { ensureDesktopRuntime } = require('../dotnet-runtime')
const { httpsGet } = require('./network')
const { createWineProgramRunner } = require('./wine-program')
function registerCompanionHandlers({ ipcMain, state, paths, wine }) {
  const { dataDir: SW_DIR } = paths
  const { selectedWineContext } = wine
  const launchWineProgram = createWineProgramRunner({
    paths,
    wine,
    defaultProgress: sendHaulLogProgress
  })
  let haulLogInstallerActive = false
  let truckersvnSetupActive = false
  function sendHaulLogProgress(data) {
    if (state.window && !state.window.isDestroyed())
      state.window.webContents.send('haullog:progress', data)
  }

  function launchHaulLogProgram(context, exePath, logName, onExit) {
    return launchWineProgram(context, exePath, logName, { onExit })
  }

  function sendTruckerSVNProgress(data) {
    if (state.window && !state.window.isDestroyed())
      state.window.webContents.send('truckersvn:progress', data)
  }

  ipcMain.handle('truckersvn:status', () => ({
    ...truckersvn.getToolStatus({ dataDir: SW_DIR }),
    installing: truckersvnSetupActive
  }))

  ipcMain.handle('truckersvn:install', async () => {
    if (truckersvnSetupActive) return { ok: false, error: 'TruckerSVN setup is already running.' }
    truckersvnSetupActive = true
    let folder
    try {
      fs.mkdirSync(SW_DIR, { recursive: true })
      let status = truckersvn.getToolStatus({ dataDir: SW_DIR })
      if (!status.installed) {
        folder = fs.mkdtempSync(path.join(SW_DIR, 'truckersvn-setup-'))
        sendTruckerSVNProgress({
          phase: 'downloading',
          message: 'Downloading native macOS TruckerSVN Tool…'
        })
        status = await truckersvn.installDesktop(
          { dataDir: SW_DIR },
          folder,
          httpsGet,
          sendTruckerSVNProgress
        )
      }
      sendTruckerSVNProgress({
        phase: 'finished',
        message: 'Native TruckerSVN Tool installed. Click Open to connect it to ETS2.'
      })
      return { ...status, ok: true, ready: true }
    } catch (err) {
      sendTruckerSVNProgress({ phase: 'error', message: err.message })
      return { ok: false, error: err.message }
    } finally {
      truckersvnSetupActive = false
      if (folder) fs.rmSync(folder, { recursive: true, force: true })
    }
  })

  ipcMain.handle('truckersvn:open', async (_, s) => {
    try {
      const status = truckersvn.getToolStatus({ dataDir: SW_DIR })
      if (!status.installed)
        return { ok: false, error: 'Install the native macOS TruckerSVN Tool first.' }
      fs.mkdirSync(SW_DIR, { recursive: true })
      const logPath = path.join(SW_DIR, 'truckersvn-native.log')
      await new Promise((resolve, reject) => {
        execFile(
          '/usr/bin/open',
          ['-a', status.appPath, '--stdout', logPath, '--stderr', logPath],
          { timeout: 10000 },
          (err) => (err ? reject(err) : resolve())
        )
      })
      sendTruckerSVNProgress({
        phase: 'connecting',
        message: 'Connecting TruckerSVN Tool to the selected Wine game…'
      })
      const connected = await connectToolToBottle(selectedWineContext(s), status)
      return { ok: true, launched: true, logPath, ...connected }
    } catch (err) {
      sendTruckerSVNProgress({ phase: 'error', message: err.message })
      return { ok: false, error: err.message }
    }
  })

  ipcMain.handle('haullog:status', (_, s) => ({
    ...haulLog.getHaulLogStatus(selectedWineContext(s)),
    installing: haulLogInstallerActive,
    gameRunning: !!state.gameProcess
  }))

  ipcMain.handle('haullog:install', async (_, s) => {
    if (truckersvnSetupActive) return { ok: false, error: 'Finish TruckerSVN Tool setup first.' }
    if (haulLogInstallerActive) return { ok: false, error: 'HaulLog setup is already open.' }
    if (state.gameProcess) return { ok: false, error: 'Close ETS2 before installing HaulLog.' }
    const context = selectedWineContext(s)
    if (!haulLog.getHaulLogStatus(context).canInstall)
      return {
        ok: false,
        error: 'Finish installing ETS2 and configure its game directory and Wine bottle first.'
      }
    haulLogInstallerActive = true
    try {
      fs.mkdirSync(SW_DIR, { recursive: true })
      const folder = fs.mkdtempSync(path.join(SW_DIR, 'haullog-setup-'))
      await ensureDesktopRuntime(context, folder, {
        getMetadata: httpsGet,
        launch: launchWineProgram,
        onProgress: sendHaulLogProgress
      })
      const archive = path.join(folder, 'HaulLog-Installer.zip')
      sendHaulLogProgress({ phase: 'downloading', received: 0, total: 0 })
      await haulLog.downloadArchive(archive, sendHaulLogProgress)
      sendHaulLogProgress({ phase: 'extracting' })
      const installer = await haulLog.extractInstaller(
        archive,
        path.join(folder, 'HaulLog-Installer.exe')
      )
      sendHaulLogProgress({ phase: 'launching' })
      const result = await launchHaulLogProgram(context, installer, 'haullog-installer.log', () => {
        haulLogInstallerActive = false
        sendHaulLogProgress({ phase: 'finished' })
      })
      if (!result.ok) haulLogInstallerActive = false
      return result
    } catch (err) {
      haulLogInstallerActive = false
      sendHaulLogProgress({ phase: 'error', message: err.message })
      return { ok: false, error: err.message }
    }
  })
}
module.exports = { registerCompanionHandlers }
