const fs = require('fs')
const os = require('os')
const path = require('path')
const PINNED_WINE = require('../wine-release')
function createSettingsStore(settingsPath) {
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
      s.standalonWineSlug = PINNED_WINE.slug
      // Migrate: remove legacy --verbose / -v from extraArgs since it's now always added internally
      if (s.extraArgs) {
        s.extraArgs = s.extraArgs.replace(/--verbose|-v\b/g, '').replace(/\s+/g, ' ').trim()
      }
      return s
    }
  } catch {}
  return { cliPath:'', winePath:'', bottlePath:'', steamDir:'', gameDir:'',
           ets2mpLogsDir:'',
           extraArgs:'', discordIPC:true, singlePlayer:false,
           launchMode:'macos',
           wineMode:'crossover',
           standalonBottlePath: path.join(os.homedir(), 'Library', 'Application Support', 'TruckersMP-Launcher', 'TruckersmpBottle'),
           standalonSteamDir:'', standalonGameDir:'', standalonDxmtDir:'', standalonDxmtVersion:'',
           standalonWineSlug: PINNED_WINE.slug,
           standaloneWizardDone: false,
           standalonWineDebugLog: true,
           standalonRetinaMode: false,
           }
}

function saveSettings(s) {
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(settingsPath, JSON.stringify({ ...s, standalonWineSlug:PINNED_WINE.slug }, null, 2))
}

return {loadSettings, saveSettings}
}
module.exports = {createSettingsStore}
