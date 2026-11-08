const fs = require('fs')
const path = require('path')

function cliWineEnvironment(
  winePath,
  bottlePath,
  env,
  adapterPath = path
    .join(__dirname, 'compat', 'wine-cli.sh')
    .replace(/app\.asar(?=[/\\])/, 'app.asar.unpacked')
) {
  const debuggerPath = path.join(bottlePath, 'drive_c', 'windows', 'system32', 'winedbg.exe')
  if (fs.existsSync(debuggerPath)) return { ...env, WINE: winePath }
  const tasklist = path.join(bottlePath, 'drive_c', 'windows', 'system32', 'tasklist.exe')
  if (!fs.existsSync(tasklist))
    throw new Error(
      'Wine process-list helpers are missing. Repair the selected bottle in the setup wizard before launching ETS2 MP.'
    )
  fs.accessSync(adapterPath, fs.constants.X_OK)
  return {
    ...env,
    WINE: adapterPath,
    WINESERVER: path.join(path.dirname(winePath), 'wineserver'),
    TRUCKERSMP_WINE_BINARY: winePath,
    TRUCKERSMP_DYLD_LIBRARY_PATH: env.DYLD_FALLBACK_LIBRARY_PATH || ''
  }
}

module.exports = { cliWineEnvironment }
