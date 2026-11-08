const fs = require('fs')
const path = require('path')
const { createPaths } = require('./paths')
const { createSettingsStore } = require('./settings')
const detection = require('./detection')
const { createWineService } = require('./wine')
const { createWineGraphics } = require('./wine-graphics')
const { createSetupDownloads } = require('./setup-downloads')
const { registerWineInstall } = require('./wine-install')
const { registerBottleHandlers } = require('./bottle')
const { registerDxmtHandlers } = require('./dxmt-install')
const { registerSteamHandlers } = require('./steam')
const { registerGameHandlers } = require('./game')
const { registerCompanionHandlers } = require('./companions')

function createApplication({ app, BrowserWindow, ipcMain, dialog }, paths = createPaths()) {
  const state = {
    window: null,
    gameProcess: null,
    gameStopping: false,
    launchSettings: null,
    steamPid: null,
    steamPollActive: false,
    steamStopRequested: false
  }
  const sendEvent = (name, value) => {
    if (state.window && !state.window.isDestroyed()) state.window.webContents.send(name, value)
  }
  const sendLog = (kind, text, cat) => sendEvent('log:line', { kind, text, cat, ts: Date.now() })
  const settings = createSettingsStore(paths.settingsPath)
  const wine = createWineService(paths)
  const graphics = createWineGraphics(wine)
  const common = { ipcMain, state, paths, settings, wine, graphics, sendLog, sendEvent, detection }
  const downloads = createSetupDownloads(common)
  registerWineInstall({ ...common, downloads })
  registerBottleHandlers({ ...common, downloads })
  registerDxmtHandlers({ ...common, downloads })
  registerSteamHandlers(common)
  const game = registerGameHandlers(common)
  registerCompanionHandlers(common)
  ipcMain.handle('settings:load', () => settings.loadSettings())
  ipcMain.handle('settings:save', (_, value) => {
    settings.saveSettings(value)
    return true
  })
  ipcMain.handle('settings:detect', () => detection.runAutoDetect())
  ipcMain.handle('fs:exists', (_, value) => !!value && fs.existsSync(value))
  ipcMain.handle('dialog:browse', async (_, options = {}) => {
    const result = await dialog.showOpenDialog(state.window, {
      properties: [options.folder ? 'openDirectory' : 'openFile'],
      defaultPath: paths.home,
      message: options.message || 'Select'
    })
    return result.canceled ? null : result.filePaths[0]
  })

  function createWindow() {
    state.window = new BrowserWindow({
      width: 460,
      height: 650,
      minWidth: 400,
      minHeight: 560,
      title: 'TruckersMP for macOS',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 18 },
      backgroundColor: '#101113',
      webPreferences: {
        preload: path.join(paths.rootDir, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    state.window.loadFile(path.join(paths.rootDir, 'src/index.html'))
    state.window.once('closed', () => {
      state.window = null
    })
    if (process.platform === 'darwin') app.dock?.setIcon(path.join(paths.rootDir, 'icon.png'))
  }

  function start() {
    app.setPath('userData', paths.dataDir)
    app.setName('TruckersMP for macOS')
    app.whenReady().then(createWindow)
    app.on('activate', () => {
      if (!state.window) createWindow()
    })
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })
    // Closing the launcher must not kill unrelated Wine bottles or native apps.
    app.on('before-quit', () => {
      state.steamPollActive = false
      game.stop()
    })
  }
  return { start, state, settings, wine, game }
}
module.exports = { createApplication }
