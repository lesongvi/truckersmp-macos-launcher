const { selectedGame } = require('../games')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, execFile } = require('child_process')
const { getInstalledVersion, isWindowsExecutable } = require('../windows-version')
function registerBottleHandlers({
  ipcMain,
  state,
  paths,
  settings,
  wine,
  graphics,
  downloads,
  sendLog
}) {
  const { dataDir: SW_DIR } = paths
  const { loadSettings } = settings
  const {
    standaloneWineBin,
    standaloneWineEnv,
    prepareStandaloneWineSetup,
    standaloneBottleMissingFiles
  } = wine
  const { patchRetinaMode } = graphics
  const { downloadToFile } = downloads
  ipcMain.handle('standalone:createBottle', async (_, bottlePath) => {
    try {
      const wineBin = standaloneWineBin()
      if (!wineBin)
        return { ok: false, error: 'Standalone Wine not installed. Complete Step 1 first.' }
      // Use a sensible default if caller did not provide a path
      if (!bottlePath || !bottlePath.trim()) bottlePath = path.join(SW_DIR, 'TruckersmpBottle')
      if (prepareStandaloneWineSetup(wineBin))
        sendLog(
          'info',
          '[Wine] Skipped setup entry for wineusb.sys, which is not included in this Wine build. Original wine.inf backed up.',
          'wine'
        )
      // 1. Create the folder
      fs.mkdirSync(bottlePath, { recursive: true })
      // Initialize services as well as updating the files in an existing prefix.
      // Avoid optional Mono/Gecko installers blocking prefix creation. This override
      // applies only to wineboot; Steam and the game keep their normal DLL settings.
      const wineEnv = standaloneWineEnv(wineBin, bottlePath, {
        WINEARCH: 'win64',
        WINEDLLOVERRIDES: 'mscoree,mshtml='
      })
      try {
        await new Promise((resolve, reject) => {
          execFile(
            wineBin,
            ['wineboot.exe', '--init', '--update'],
            {
              env: wineEnv,
              timeout: 180000,
              killSignal: 'SIGKILL',
              maxBuffer: 8 * 1024 * 1024
            },
            (err, stdout, stderr) => {
              if (err) {
                err.stderr = stderr
                reject(err)
              } else resolve()
            }
          )
        })
      } catch (initErr) {
        const raw = initErr.stderr?.toString() || initErr.message || String(initErr)
        const lines = raw
          .split('\n')
          .filter((l) => l.trim() && !/\[mvk-info\]|VK_[A-Z_]+|Vulkan version|MoltenVK/i.test(l))
        const meaningful =
          lines.find((l) => /could not|failed|error|err:/i.test(l)) || lines[0] || raw.slice(0, 300)
        return { ok: false, error: `Wine bottle initialization failed: ${meaningful}` }
      }
      // 3. Final verification
      const missing = standaloneBottleMissingFiles(bottlePath)
      if (missing.length)
        return {
          ok: false,
          error: `Wine bottle is incomplete. Missing: ${missing.join(', ')}. The Wine build must support both 64-bit and 32-bit Windows programs.`
        }
      return { ok: true, bottlePath }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // Kill wineserver for a given bottle so Wine stops reopening windows
  ipcMain.handle('standalone:downloadSteam', async () => {
    try {
      const dest = path.join(os.tmpdir(), 'SteamSetup.exe')
      const url = 'https://cdn.fastly.steamstatic.com/client/installer/SteamSetup.exe'
      await downloadToFile(url, dest, 'standalone:steamProgress')
      return { ok: true, exePath: dest }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // Run an .exe (SteamSetup.exe or user-provided) inside the standalone bottle via wine
  ipcMain.handle('standalone:runExe', async (_, { exePath, bottlePath }) => {
    try {
      const wineBin = standaloneWineBin()
      if (!wineBin) return { ok: false, error: 'Standalone Wine not installed.' }
      if (!fs.existsSync(exePath)) return { ok: false, error: `Installer not found: ${exePath}` }
      if (standaloneBottleMissingFiles(bottlePath).length)
        return {
          ok: false,
          error:
            'Wine bottle is incomplete. Run Create Bottle & Launch Steam to initialize or repair its Windows files first.'
        }

      const env = standaloneWineEnv(wineBin, bottlePath, { WINEDEBUG: 'err+all' })
      fs.mkdirSync(SW_DIR, { recursive: true })
      const logPath = path.join(SW_DIR, 'steam-installer.log')
      const logFd = fs.openSync(logPath, 'w')

      return await new Promise((resolve) => {
        let child
        try {
          child = spawn(wineBin, [exePath], {
            env,
            detached: true,
            stdio: ['ignore', logFd, logFd]
          })
        } finally {
          fs.closeSync(logFd)
        }
        let startupTimer

        child.once('error', (err) => {
          clearTimeout(startupTimer)
          resolve({ ok: false, error: `Failed to launch Wine: ${err.message}` })
        })

        child.once('spawn', () => {
          child.unref()
          startupTimer = setTimeout(() => resolve({ ok: true, logPath }), 1500)
        })
        child.once('exit', (code, signal) => {
          clearTimeout(startupTimer)
          if (code !== 0) {
            const error = `Steam installer exited ${signal ? 'with signal ' + signal : 'with code ' + code}. See ${logPath}`
            sendLog('error', error, 'wine')
            resolve({ ok: false, error })
          } else {
            resolve({ ok: true, logPath })
          }
        })
      })
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('standalone:getStatus', () => {
    const s = loadSettings()
    const wineBin = standaloneWineBin()
    const dxmtVersion = getInstalledVersion(
      s.standalonDxmtDir ? path.join(s.standalonDxmtDir, 'dxgi.dll') : ''
    )

    const dxmtDll = s.standalonDxmtDir ? path.join(s.standalonDxmtDir, 'dxgi.dll') : ''
    const dxmtArchWarning = !!dxmtDll && fs.existsSync(dxmtDll) && !isWindowsExecutable(dxmtDll)

    return {
      wineInstalled: !!wineBin,
      wineBin: wineBin || '',
      activeSlug: s.standalonWineSlug || '',
      defaultBottlePath: path.join(SW_DIR, 'TruckersmpBottle'),
      bottlePath: s.standalonBottlePath || '',
      bottleExists: standaloneBottleMissingFiles(s.standalonBottlePath).length === 0,
      dxmtDir: s.standalonDxmtDir || '',
      dxmtExists: !!(
        s.standalonDxmtDir && fs.existsSync(path.join(s.standalonDxmtDir, 'dxgi.dll'))
      ),
      dxmtVersion,
      dxmtFileVersion: s.standalonDxmtVersion || '',
      dxmtArchWarning,
      steamDir: s.standalonSteamDir || '',
      gameDir: s.standalonGameDir || '',
      wizardDone: !!s.standaloneWizardDone
    }
  })

  // Auto-detect ETS2 game dir inside a bottle after Steam installs it.
  // Walks bottle/drive_c/Program Files (x86)/Steam/steamapps/common/Euro Truck Simulator 2
  ipcMain.handle('standalone:autoDetectGamePath', (_, bottlePath, gameId) => {
    const game = selectedGame({ game: gameId })
    if (!bottlePath) return { ok: false, error: 'No bottle path' }
    const candidates = [
      path.join(
        bottlePath,
        'drive_c',
        'Program Files (x86)',
        'Steam',
        'steamapps',
        'common',
        game.folder
      ),
      path.join(bottlePath, 'drive_c', 'Program Files', 'Steam', 'steamapps', 'common', game.folder)
    ]
    for (const p of candidates) {
      if (fs.existsSync(path.join(p, 'bin', 'win_x64', game.exe))) return { ok: true, gameDir: p }
    }
    return {
      ok: false,
      error: `${game.name} not found — make sure Steam has finished installing it.`
    }
  })

  ipcMain.handle('standalone:setRetinaMode', (_, { bottlePath, enabled }) => {
    patchRetinaMode(bottlePath, enabled)
    return { ok: true }
  })

  // Auto-detect Steam dir inside a bottle
  ipcMain.handle('standalone:autoDetectSteamPath', (_, bottlePath) => {
    if (!bottlePath) return { ok: false, error: 'No bottle path' }
    const candidates = [
      path.join(bottlePath, 'drive_c', 'Program Files (x86)', 'Steam'),
      path.join(bottlePath, 'drive_c', 'Program Files', 'Steam')
    ]
    for (const p of candidates) {
      if (fs.existsSync(path.join(p, 'steam.exe'))) return { ok: true, steamDir: p }
    }
    return { ok: false, error: 'steam.exe not found in the bottle.' }
  })
}
module.exports = { registerBottleHandlers }
