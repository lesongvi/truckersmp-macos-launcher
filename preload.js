const { contextBridge, ipcRenderer } = require('electron')

const requests = {
  loadSettings: 'settings:load',
  saveSettings: 'settings:save',
  detectPaths: 'settings:detect',
  browse: 'dialog:browse',
  pathExists: 'fs:exists',
  launchGame: 'game:launch',
  stopGame: 'game:stop',
  openGameDocuments: 'game:openDocuments',
  startSteam: 'game:startSteam',
  stopSteam: 'game:stopSteam',
  getSteamStatus: 'game:steamStatus',
  getHaulLogStatus: 'haullog:status',
  installHaulLog: 'haullog:install',
  getTruckerSVNStatus: 'truckersvn:status',
  installTruckerSVN: 'truckersvn:install',
  openTruckerSVN: 'truckersvn:open',
  swFetchWineRelease: 'standalone:fetchWineRelease',
  swDownloadWine: 'standalone:downloadWine',
  swCancelWineDownload: 'standalone:cancelWineDownload',
  swCreateBottle: 'standalone:createBottle',
  swDownloadSteam: 'standalone:downloadSteam',
  swRunExe: 'standalone:runExe',
  swAutoDetectGamePath: 'standalone:autoDetectGamePath',
  swAutoDetectSteamPath: 'standalone:autoDetectSteamPath',
  swInstallDxmt: 'standalone:installDxmt',
  swAutoInstallDxmt: 'standalone:autoInstallDxmt',
  swGetStatus: 'standalone:getStatus'
}
const events = {
  onLog: 'log:line',
  onGameStopped: 'game:stopped',
  onSteamStopped: 'steam:stopped',
  onSteamRestarting: 'steam:restarting',
  onSteamReady: 'steam:ready',
  onHaulLogProgress: 'haullog:progress',
  onTruckerSVNProgress: 'truckersvn:progress',
  onWineProgress: 'standalone:wineProgress',
  onSteamProgress: 'standalone:steamProgress',
  onDxmtStatus: 'standalone:dxmtStatus'
}
const api = Object.fromEntries(
  Object.entries(requests).map(([name, channel]) => [
    name,
    (...args) => ipcRenderer.invoke(channel, ...args)
  ])
)
api.swSetRetinaMode = (bottlePath, enabled) =>
  ipcRenderer.invoke('standalone:setRetinaMode', { bottlePath, enabled })
for (const [name, channel] of Object.entries(events)) {
  api[name] = (callback) => {
    const listener = (_, value) => callback(value)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}
contextBridge.exposeInMainWorld('api', api)
