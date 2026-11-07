const fs = require('fs')
const path = require('path')
const {spawn:defaultSpawn} = require('child_process')
const {runtimeLogKind, readRuntimeLines} = require('../runtime-log')
const {cliWineEnvironment} = require('../cli-wine')
const {RUNTIME_HINTS, EXIT_HINTS} = require('./game-hints')

function buildArgs(settings) {
  const args = ['-w', '-g', settings.gameDir, '-x', settings.bottlePath, '--wine-steam-dir', settings.steamDir,
    '--without-wine-discord-ipc-bridge', '-r', 'dx11', 'start', 'ets2mp']
  const extra = (settings.extraArgs || '').trim().split(/\s+/).filter(Boolean)
  if (!extra.includes('-v') && !extra.includes('--verbose')) extra.push('-v')
  return [...args, ...extra]
}

function createGameController({state, wine, graphics, detection, sendLog, sendEvent, spawn = defaultSpawn, adaptWine = cliWineEnvironment}) {
  function environment(context, settings) {
    let env = context.standalone ? wine.standaloneWineEnv(context.winePath, context.bottlePath) : {
      ...process.env, WINEPREFIX:context.bottlePath, CX_BOTTLE:path.basename(context.bottlePath),
    }
    env.WINE = context.winePath
    env.WINEDEBUG = '-all'
    env.MTL_HUD_ENABLED = settings.metalHud ? '1' : '0'
    if (context.standalone) {
      if (settings.standalonDxmtDir) {
        graphics.ensureDxmtInBottle(context.bottlePath, settings.standalonDxmtDir, null, context.winePath)
        env.WINEDLLOVERRIDES = 'dxgi=n,b;d3d11=n,b;d3d10core=n,b;d3d10=n,b;d3d10_1=n,b'
      }
      env.WINE_DISABLE_KERNEL_WRITEWATCH = '1'
      env.MVK_CONFIG_USE_METAL_ARGUMENT_BUFFERS = '1'
      env.MVK_CONFIG_USE_METAL_PRIVATE_API = '1'
    }
    return adaptWine(context.winePath, context.bottlePath, env)
  }

  async function launch(settings) {
    if (state.gameProcess) return {ok:false, error:'Game is already running. Stop the current session before launching again.'}
    try {
      if (!settings.cliPath || !fs.existsSync(settings.cliPath)) throw new Error('truckersmp-cli was not found. Set its path in Settings or click Re-detect.')
      fs.accessSync(settings.cliPath, fs.constants.X_OK)
      const context = wine.selectedWineContext(settings)
      if (!context.winePath || !fs.existsSync(context.winePath)) throw new Error('Wine was not found. Complete the setup wizard or configure Wine in Settings.')
      if (!context.bottlePath || !fs.existsSync(path.join(context.bottlePath, 'drive_c'))) throw new Error('The selected Wine bottle was not found. Complete the setup wizard first.')
      if (!context.steamDir || !fs.existsSync(path.join(context.steamDir, 'steam.exe'))) throw new Error('Steam Directory is not set or Steam is missing from this bottle. Install Steam and click Re-detect.')
      if (!context.gameDir || !fs.existsSync(path.join(context.gameDir, 'bin/win_x64/eurotrucks2.exe'))) throw new Error('ETS2 is not installed in the selected bottle. Finish installing it in Steam, then click Re-detect.')
      const env = environment(context, settings)
      const args = buildArgs({...settings, ...context})
      const python = detection.resolveInterpreter(settings.cliPath)
      const command = python || settings.cliPath
      const commandArgs = python ? [settings.cliPath, ...args] : args
      sendLog('system', `Launching ETS2 MP using ${context.standalone ? 'Standalone Wine' : 'CrossOver'}…`)
      sendLog('info', `Wine: ${context.winePath}`, 'wine')
      if (env.WINE !== context.winePath) sendLog('info', 'Using tasklist.exe for the CLI Steam process check; this Wine build has no winedbg.', 'wine')
      const child = spawn(command, commandArgs, {env})
      state.gameProcess = child
      state.launchSettings = {...settings, winePath:context.winePath, bottlePath:context.bottlePath}
      let stopping = false
      const onLine = line => {
        const kind = runtimeLogKind(line)
        sendLog(kind, line, 'wine')
        if (kind === 'error' || kind === 'warn') {
          const hint = RUNTIME_HINTS.find(entry => entry.pat.test(line.toLowerCase()))
          if (hint) sendLog('warn', '  → ' + hint.hint, 'wine')
        }
      }
      readRuntimeLines(child.stdout, onLine)
      readRuntimeLines(child.stderr, onLine)
      child.once('close', code => {
        if (state.gameProcess !== child) return
        const stoppedCode = stopping || state.gameStopping ? 0 : code
        sendLog(stoppedCode === 0 ? 'success' : 'error', stoppedCode === 0 ? 'Session ended.' : `Process exited with code ${code}.`, 'wine')
        if (stoppedCode !== 0 && EXIT_HINTS[code]) sendLog('warn', EXIT_HINTS[code], 'wine')
        state.gameProcess = null
        state.launchSettings = null
        state.gameStopping = false
        sendEvent('game:stopped', {code:stoppedCode})
      })
      return await new Promise(resolve => {
        child.once('spawn', () => resolve({ok:true, pid:child.pid}))
        child.once('error', error => {
          if (state.gameProcess === child) {
            state.gameProcess = null
            state.launchSettings = null
            sendLog('error', `Could not start truckersmp-cli: ${error.message}`)
            sendEvent('game:stopped', {code:-1})
          }
          resolve({ok:false, error:`Could not start truckersmp-cli: ${error.message}`})
        })
      })
    } catch (error) { return {ok:false, error:error.message} }
  }

  function stop() {
    const child = state.gameProcess
    if (!child) return {ok:true}
    state.gameStopping = true
    sendLog('system', 'Stopping the selected game session…')
    const settings = state.launchSettings
    try { child.kill('SIGTERM') } catch {}
    // Prefix-scoped cleanup replaces the old system-wide pkill/killall sweeps.
    if (settings) wine.killWineserver(settings.winePath, settings.bottlePath)
    return {ok:true}
  }

  return {launch, stop, environment}
}

function registerGameHandlers({ipcMain, ...dependencies}) {
  const game = createGameController(dependencies)
  ipcMain.handle('game:launch', (_, settings) => game.launch(settings))
  ipcMain.handle('game:stop', () => game.stop())
  return game
}

module.exports = {buildArgs, createGameController, registerGameHandlers}
