const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile, execFileSync, execSync} = require('child_process')
const {findSteamProcesses}=require('../steam-process')
const {patchCEFLocalState,clearCEFGpuCache}=require('./steam-patches')
function registerSteamHandlers({ipcMain,state,paths,wine,graphics,sendLog}) {
const {dataDir:SW_DIR}=paths
const {selectedWineContext,standaloneWineBin,standaloneWineEnv}=wine
const {ensureDxmtInBottle,patchWineMaxGL}=graphics
function checkSteamIpcSocket(bottlePath) {
  const usersDir = path.join(bottlePath, 'drive_c', 'users')
  if (!fs.existsSync(usersDir)) return false
  try {
    for (const user of fs.readdirSync(usersDir)) {
      if (user === 'Public') continue
      const steamLocal = path.join(usersDir, user, 'AppData', 'Local', 'Steam')
      if (!fs.existsSync(steamLocal)) continue
      // Steam writes registry.vdf and *.tmp socket markers when the UI is running
      if (fs.readdirSync(steamLocal).some(f => f === 'registry.vdf' || f.endsWith('.tmp')))
        return true
    }
  } catch {}
  return false
}

// Polls every 2 s for Steam's IPC socket.
// Guarded by _steamPollActive so beginSteamReadyPoll can be called again on self-restart
// without needing a live steamPid (the restarted process is detached with a new PID).
function beginSteamReadyPoll(bottlePath) {
  state.steamPollActive = true
  const started = Date.now()
  const TIMEOUT = 120_000
  const timer = setInterval(() => {
    if (!state.steamPollActive || Date.now() - started > TIMEOUT) { clearInterval(timer); return }
    if (checkSteamIpcSocket(bottlePath)) {
      clearInterval(timer)
      state.steamPollActive = false
      sendLog('success', '[Steam] Ready — IPC socket detected.')
      try { if (state.window && !state.window.isDestroyed()) state.window.webContents.send('steam:ready') } catch {}
    }
  }, 2000)
}

ipcMain.handle('game:steamStatus', async (_, s) => {
  try {
    const processes = await findSteamProcesses(selectedWineContext(s))
    return {ok:true, running:processes.length > 0}
  } catch (err) { return {ok:false, error:err.message} }
})

ipcMain.handle('game:startSteam', async (_, s) => {
  const isStandalone = s.wineMode === 'standalone'
  sendLog('info', `› Starting Steam via ${isStandalone ? 'standalone' : 'CrossOver'} Wine…`)

  let winePath, bottlePath, steamDir

  if (isStandalone) {
    winePath   = standaloneWineBin()
    bottlePath = s.standalonBottlePath
    steamDir   = s.standalonSteamDir
    if (!winePath)   return { ok:false, error:'Standalone Wine not installed. Complete the Setup Wizard (Step 1).' }
    if (!bottlePath || !fs.existsSync(path.join(bottlePath, 'drive_c')))
      return { ok:false, error:'Standalone bottle not found. Complete the Setup Wizard (Step 2).' }
    if (!steamDir)   return { ok:false, error:'Standalone Steam directory not set. Set it in Settings → Wine Mode → standalone paths.' }
  } else {
    winePath   = s.winePath
    bottlePath = s.bottlePath
    steamDir   = s.steamDir
    if (!winePath)   return { ok:false, error:'Wine path not set. Configure it in Settings.' }
    if (!bottlePath) return { ok:false, error:'CrossOver Bottle not set. Configure it in Settings.' }
    if (!steamDir)   return { ok:false, error:'Steam Directory not set. Configure it in Settings.' }
    if (!fs.existsSync(winePath))   return { ok:false, error:`Wine not found at: ${winePath}` }
    if (!fs.existsSync(bottlePath)) return { ok:false, error:`Bottle not found at: ${bottlePath}` }
  }

  const steamExe = path.join(steamDir, 'steam.exe')
  if (!fs.existsSync(steamExe)) return { ok:false, error:`steam.exe not found at: ${steamExe}\n\nMake sure Steam is installed inside the bottle.` }
  // Do not restart Wine or patch caches while externally launched Steam is active.
  try {
    const existing = await findSteamProcesses({bottlePath, steamDir})
    if (existing.length) return {ok:true, alreadyRunning:true, pid:existing[0].pid}
  } catch (err) {
    return {ok:false, error:`Could not check whether Steam is already running: ${err.message}`}
  }

  let env
  if (isStandalone) {
    env = standaloneWineEnv(winePath, bottlePath)

    if (s.standalonDxmtDir) {

      ensureDxmtInBottle(bottlePath, s.standalonDxmtDir)
      // DXMT DLLs synced (no log — technical detail)
    }
    // dcomp=d: disable Wine's DirectComposition. Without this, Steam's CEF login
    // window renders as a solid black rectangle on upstream Wine builds.
    // We use ONLY this override — no dxgi/d3d11 — so CEF's ANGLE GPU backend
    // uses Wine's builtin d3d11 (which ANGLE supports) rather than DXMT.
    env.WINEDLLOVERRIDES = 'dcomp=d'
    // WINEESYNC=1 floods macOS with eventfd emulation files per Wine process.
    // Steam's CEF architecture spawns dozens of browser helpers; each one adds
    // more eventfds, instantly exhausting the default macOS fd limit (~256-4800).
    // CEF then cannot open any new IPC sockets → steamwebhelper crash loop.
    delete env.WINEESYNC
    // WINE_DISABLE_KERNEL_WRITEWATCH disables the Win32 GetWriteWatch API.
    // Chromium's V8 GC relies on GetWriteWatch for memory page tracking during
    // concurrent garbage collection. Disabling it causes an instant memory panic
    // in steamwebhelper.exe, which is the crash Steam reports as "not responding".
    delete env.WINE_DISABLE_KERNEL_WRITEWATCH
    // MVK_CONFIG_* vars are only needed by the game renderer (Stage 2 — ETS2/truckersmp).
    // They have no benefit for Steam's CEF UI and add unnecessary env noise.
    delete env.MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS
    delete env.MVK_CONFIG_USE_METAL_PRIVATE_API
    // LC_ALL: prevents chrome_elf.dll locale-initialisation failures on Wine.
    env.LC_ALL = 'en_US.UTF-8'

  } else {
    // CrossOver mode — replicate what CrossOver's own cxstart sets so that
    // CrossOver-patched wine can find its own support libraries and configs.
    const cxSupport = '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver'
    const cxLibPath = `${cxSupport}/lib`
    const existingDyld = process.env.DYLD_FALLBACK_LIBRARY_PATH || ''
    env = {
      ...process.env,
      WINE:        winePath,
      WINEPREFIX:  bottlePath,
      WINEDEBUG:   '-all',
      WINEMSYNC:   '1',
      CX_BOTTLE:   path.basename(bottlePath),
      CX_ROOT:     cxSupport,
      DYLD_FALLBACK_LIBRARY_PATH: existingDyld ? `${cxLibPath}:${existingDyld}` : cxLibPath,
    }
  }

  // (Full launch config logged to console for debugging, not surfaced to the user)

  if (isStandalone) {
    try {
      const wsPath = path.join(path.dirname(winePath), 'wineserver')
      if (fs.existsSync(wsPath)) {
        try {
          spawn(wsPath, ['-k'], { env: { ...env, WINEPREFIX: bottlePath }, stdio: 'ignore', detached: true }).unref()
        } catch {}
        // Give wineserver 1.5s to shut down gracefully (increased from 800ms — Wine 11.x
        // can take >1s to release its socket file after a Steam session ends)
        await new Promise(r => setTimeout(r, 1500))
        // Final 500ms for the OS to release socket file handles
        await new Promise(r => setTimeout(r, 500))
      }
    } catch {}
    for (const lf of [path.join(steamDir, 'steam.pid'), path.join(steamDir, '.steam', 'steam.pid')]) {
      try { if (fs.existsSync(lf)) { fs.unlinkSync(lf); console.log('[Steam] Cleaned lockfile:', lf) } } catch {}
    }
  }

  if (isStandalone) {
    patchWineMaxGL(bottlePath)
    const cefLogs = patchCEFLocalState(steamDir, bottlePath)
    for (const msg of cefLogs) console.log('[CEF]', msg)
    const gpuLogs = clearCEFGpuCache(bottlePath)
    for (const msg of gpuLogs) console.log('[CEF-GPU]', msg)
  }

  // Open a log file when the Wine debug log toggle is enabled.
  // Only log in standalone mode — CrossOver already manages its own logs.
  let logFd = null
  if (s.standalonWineDebugLog && isStandalone) {
    try {
      fs.mkdirSync(SW_DIR, { recursive: true })
      logFd = fs.openSync(path.join(SW_DIR, isStandalone ? 'steam-wine.log' : 'crossover-steam.log'), 'w')
      env.WINEDEBUG = 'warn+wgl,warn+d3d11,warn+dxgi,err+loader,err+module'
    } catch {}
  }

  try {

    const cefGpuFlags = ['-cef-disable-gpu', '-cef-disable-d3d11']

    const proc = spawn('/bin/bash', [
      '-c', 'ulimit -n 10240; exec "$0" "$@"',
      winePath, steamExe, '-no-cef-sandbox', ...cefGpuFlags,
    ], {
      env,
      stdio: logFd !== null ? ['ignore', logFd, logFd] : 'ignore',
      detached: true,
    })
    if (logFd !== null) try { fs.closeSync(logFd) } catch {}
    state.steamPid = proc.pid
    proc.on('exit', () => {
      state.steamPid = null
      // If the user explicitly requested a stop, send steam:stopped immediately.
      if (state.steamStopRequested) {
        state.steamStopRequested = false
        state.steamPollActive = false
        try { if (state.window && !state.window.isDestroyed()) state.window.webContents.send('steam:stopped') } catch {}
        return
      }
      // Natural exit — Steam may be self-restarting (e.g. during an update).
      // Poll for up to 2.5 s for a surviving steam.exe Wine process before declaring stopped.
      let checks = 0
      let checking = false
      const watchdog = setInterval(async () => {
        if (checking) return
        checking = true
        checks++
        let alive = false
        try { alive = (await findSteamProcesses({bottlePath, steamDir})).length > 0 } catch {}
        checking = false
        if (alive) {
          clearInterval(watchdog)
          try { if (state.window && !state.window.isDestroyed()) state.window.webContents.send('steam:restarting') } catch {}
          // Stop any prior ready-poll (its detected files are stale from session 1).
          // Wait 4 s for session 2 to initialise before starting a fresh poll.
          state.steamPollActive = false
          setTimeout(() => beginSteamReadyPoll(bottlePath), 4000)
        } else if (checks >= 5) {
          clearInterval(watchdog)
          state.steamPollActive = false
          try { if (state.window && !state.window.isDestroyed()) state.window.webContents.send('steam:stopped') } catch {}
        }
      }, 500)
    })
    proc.unref()
    sendLog('success', `Steam launched (PID ${proc.pid})`)
    // Wine debug log path available in Settings → Wine Log
    if (isStandalone) beginSteamReadyPoll(bottlePath)
    return { ok:true, pid: proc.pid }
  } catch(e) {
    if (logFd !== null) try { fs.closeSync(logFd) } catch {}
    return { ok:false, error: e.message }
  }
})

ipcMain.handle('game:stopSteam', async (_, s) => {
  const context = selectedWineContext(s)
  try {
    const processes = await findSteamProcesses(context)
    if (!processes.length) return {ok:true}
    if (!context.winePath || !context.steamDir) return {ok:false, error:'Configure the Steam and Wine paths first.'}
    const env = context.standalone
      ? standaloneWineEnv(context.winePath, context.bottlePath)
      : {...process.env, WINEPREFIX:context.bottlePath, CX_BOTTLE:path.basename(context.bottlePath)}
    // Ask Steam to exit; never kill other Wine bottles or an active game.
    await new Promise((resolve, reject) => {
      execFile(context.winePath, [path.join(context.steamDir, 'steam.exe'), '-shutdown'],
        {env, timeout:10000, killSignal:'SIGKILL'}, err => err ? reject(err) : resolve())
    })
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!(await findSteamProcesses(context)).length) {
        state.steamPid = null
        state.steamPollActive = false
        state.window?.webContents.send('steam:stopped')
        return {ok:true}
      }
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    return {ok:false, error:'Steam is still running. Close it from the Steam menu, then try again.'}
  } catch (err) { return {ok:false, error:err.message} }
})

}
module.exports={registerSteamHandlers}
