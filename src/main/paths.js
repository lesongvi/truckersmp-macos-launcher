const path = require('path')
const os = require('os')
function createPaths(home = os.homedir()) {
  const dataDir = path.join(home, 'Library', 'Application Support', 'TruckersMP-Launcher')
  return {
    home,
    dataDir,
    winesDir: path.join(dataDir, 'wines'),
    dxmtDir: path.join(dataDir, 'dxmt'),
    settingsPath: path.join(home, '.config', 'truckersmp-launcher', 'settings.json'),
    rootDir: path.resolve(__dirname, '../..')
  }
}
module.exports = { createPaths }
