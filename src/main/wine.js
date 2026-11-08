const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')
const PINNED_WINE = require('../wine-release')
function createWineService(paths) {
  const { dataDir: SW_DIR, winesDir: SW_WINES_DIR } = paths
  function findBinary(dir, names, depth) {
    if (depth > 8) return null
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = findBinary(full, names, depth + 1)
        if (found) return found
      } else if (names.includes(entry.name)) {
        return full
      }
    }
    return null
  }

  // Use only the pinned installation. A missing pin must never select another build.
  function standaloneWineBin() {
    function findInRoot(rootDir) {
      if (!rootDir || !fs.existsSync(rootDir)) return null
      const srv = findBinary(rootDir, ['wineserver'], 0)
      if (srv) {
        const d = path.dirname(srv)
        for (const n of ['wine64', 'wine']) {
          const p = path.join(d, n)
          if (fs.existsSync(p)) return p
        }
      }
      return findBinary(rootDir, ['wine64', 'wine'], 0)
    }

    return findInRoot(path.join(SW_WINES_DIR, PINNED_WINE.slug))
  }

  function standaloneWineEnv(winePath, bottlePath, extra = {}) {
    const wineDir = path.dirname(winePath)
    // Standard lib dir alongside bin/
    const wineLib = path.join(wineDir, '..', 'lib')
    // Gcenx .app bundles may also ship frameworks in Contents/Frameworks
    const wineFrameworks = path.join(wineDir, '..', '..', '..', 'Frameworks')
    // Some builds put extra libs at Contents/Resources/lib or Contents/lib
    const wineResLib = path.join(wineDir, '..', '..', 'lib')
    const wineMacLib = path.join(wineDir, '..', '..', '..', 'lib')
    const dyldPaths = [
      wineLib,
      wineFrameworks,
      wineResLib,
      wineMacLib,
      process.env.DYLD_FALLBACK_LIBRARY_PATH || ''
    ]
      .filter(Boolean)
      .join(':')
    return {
      ...process.env,
      PATH: wineDir + ':' + (process.env.PATH || ''),
      DYLD_FALLBACK_LIBRARY_PATH: dyldPaths,
      WINEPREFIX: bottlePath,
      WINEMSYNC: '1',
      // WINEESYNC=1: required by YAAGL wine and improves stability on Wine-Staging
      // builds. Has no effect on builds that don't support it.
      WINEESYNC: '1',
      WINEDEBUG: '-all',
      // Force macOS-native window driver (winemac.drv). If DISPLAY is inherited
      // from the environment (e.g. XQuartz is installed), Wine switches to X11
      // mode and all windows silently fail to appear when XQuartz is not running.
      DISPLAY: undefined,
      // Ensure Wine and its helper processes can create Unix socket files.
      // Missing TMPDIR on macOS causes wineserver to fail to bind its socket,
      // which makes every spawned Wine process exit immediately without a window.
      TMPDIR: process.env.TMPDIR || os.tmpdir(),
      ...extra
    }
  }

  function prepareStandaloneWineSetup(wineBin) {
    const root = path.resolve(path.dirname(wineBin), '..')
    const infPath = path.join(root, 'share', 'wine', 'wine.inf')
    const peDir = path.join(root, 'lib', 'wine', 'x86_64-windows')
    if (!fs.existsSync(infPath) || !fs.existsSync(path.join(peDir, 'kernel32.dll'))) return false
    if (
      fs.existsSync(path.join(peDir, 'wineusb.sys')) ||
      fs.existsSync(path.join(root, 'lib', 'wine', 'x86_64-unix', 'wineusb.so'))
    )
      return false
    const content = fs.readFileSync(infPath, 'utf8')
    const patched = content.replace(
      /(^\[InfFiles\]\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/m,
      (section) => section.replace(/^wineusb\.inf,"@%12%\\wineusb\.sys,-1"\r?\n/gm, '')
    )
    if (patched === content) return false
    const backup = infPath + '.truckersmp-backup'
    if (!fs.existsSync(backup)) fs.copyFileSync(infPath, backup, fs.constants.COPYFILE_EXCL)
    fs.writeFileSync(infPath, patched, 'utf8')
    return true
  }

  // Steam's 32-bit installer also needs the WoW64 files in a 64-bit bottle.
  function standaloneBottleMissingFiles(bottlePath) {
    const required = [
      'system.reg',
      'drive_c/windows/system32/kernel32.dll',
      'drive_c/windows/system32/ntdll.dll',
      'drive_c/windows/syswow64/kernel32.dll',
      'drive_c/windows/syswow64/ntdll.dll'
    ]
    return required.filter((file) => !bottlePath || !fs.existsSync(path.join(bottlePath, file)))
  }

  function killWineserver(winePath, bottlePath) {
    if (!bottlePath) return
    const server = winePath ? path.join(path.dirname(winePath), 'wineserver') : null
    if (server && fs.existsSync(server)) {
      try {
        spawn(server, ['-k'], {
          env: { ...process.env, WINEPREFIX: bottlePath },
          detached: true,
          stdio: 'ignore'
        }).unref()
        return server
      } catch {}
    }
    return null
  }

  function selectedWineContext(s) {
    const standalone = s.wineMode === 'standalone'
    return {
      standalone,
      winePath: standalone ? standaloneWineBin() : s.winePath,
      bottlePath: standalone ? s.standalonBottlePath : s.bottlePath,
      steamDir: standalone ? s.standalonSteamDir : s.steamDir,
      gameDir: standalone ? s.standalonGameDir : s.gameDir
    }
  }

  return {
    findBinary,
    standaloneWineBin,
    standaloneWineEnv,
    prepareStandaloneWineSetup,
    standaloneBottleMissingFiles,
    killWineserver,
    selectedWineContext
  }
}
module.exports = { createWineService }
