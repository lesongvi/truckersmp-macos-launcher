const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const { loadModule, registry } = require('./helpers/modules')
const { rendererFixture } = require('./helpers/renderer')
const { createWineService } = require('../src/main/wine')
const { createGameController } = require('../src/main/game')
function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'standalone-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function bottleHandlers(t, overrides = {}) {
  const dataDir = root(t),
    { handlers, ipcMain } = registry(),
    wine = createWineService({ dataDir, winesDir: path.join(dataDir, 'wines') })
  const { registerBottleHandlers } = loadModule('src/main/bottle.js', {
    child_process: overrides.childProcess || require('child_process')
  })
  registerBottleHandlers({
    ipcMain,
    state: {},
    paths: { dataDir },
    settings: { loadSettings: () => ({}) },
    wine: { ...wine, ...overrides.wine },
    graphics: { patchRetinaMode() {} },
    downloads: {},
    sendLog() {}
  })
  return { handlers, wine, dataDir }
}
test('an empty drive_c is not a healthy bottle', (t) => {
  const dir = root(t),
    wine = createWineService({})
  fs.mkdirSync(path.join(dir, 'drive_c'))
  assert.equal(wine.standaloneBottleMissingFiles(dir).length, 5)
  for (const file of wine.standaloneBottleMissingFiles(dir)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), '')
  }
  assert.equal(wine.standaloneBottleMissingFiles(dir).length, 0)
})
test('bottle setup runs wineboot update and surfaces failure before reporting readiness', async (t) => {
  let fail = true,
    invocation
  const f = bottleHandlers(t, {
    wine: {
      standaloneWineBin: () => '/wine/bin/wine',
      prepareStandaloneWineSetup: () => false,
      standaloneBottleMissingFiles: () => []
    },
    childProcess: {
      execFile: (...args) => {
        invocation = args
        args.at(-1)(
          fail ? new Error('failed') : null,
          '',
          fail ? 'wine: could not load kernel32.dll' : ''
        )
      }
    }
  })
  const handler = f.handlers.get('standalone:createBottle')
  let result = await handler(null, path.join(f.dataDir, 'bottle'))
  assert.equal(result.ok, false)
  assert.match(result.error, /could not load kernel32/)
  assert.deepEqual(invocation[1], ['wineboot.exe', '--init', '--update'])
  assert.equal(invocation[2].env.WINEDLLOVERRIDES, 'mscoree,mshtml=')
  fail = false
  result = await handler(null, path.join(f.dataDir, 'bottle'))
  assert.equal(result.ok, true)
})
test('USB workaround changes only a missing driver entry and preserves the original', (t) => {
  const dir = root(t),
    pe = path.join(dir, 'lib/wine/x86_64-windows'),
    inf = path.join(dir, 'share/wine/wine.inf')
  fs.mkdirSync(pe, { recursive: true })
  fs.mkdirSync(path.dirname(inf), { recursive: true })
  fs.writeFileSync(path.join(pe, 'kernel32.dll'), '')
  const original =
    '[InfFiles]\ninput.inf,"@%12%\\hidclass.sys,-1"\nwineusb.inf,"@%12%\\wineusb.sys,-1"\n\n[Other]\nkeep=this\n'
  fs.writeFileSync(inf, original)
  const wine = createWineService({})
  assert.equal(wine.prepareStandaloneWineSetup(path.join(dir, 'bin/wine')), true)
  assert.equal(fs.readFileSync(inf + '.truckersmp-backup', 'utf8'), original)
  assert.ok(fs.readFileSync(inf, 'utf8').includes('input.inf'))
  assert.equal(wine.prepareStandaloneWineSetup(path.join(dir, 'bin/wine')), false)
})
test('Steam and ETS2 detection require executable files in either Program Files directory', (t) => {
  const { handlers, dataDir } = bottleHandlers(t)
  for (const folder of ['Program Files (x86)', 'Program Files']) {
    const steam = path.join(dataDir, 'bottle/drive_c', folder, 'Steam'),
      game = path.join(steam, 'steamapps/common/Euro Truck Simulator 2')
    fs.mkdirSync(game, { recursive: true })
    assert.equal(
      handlers.get('standalone:autoDetectSteamPath')(null, path.join(dataDir, 'bottle')).ok,
      false
    )
    fs.writeFileSync(path.join(steam, 'steam.exe'), '')
    fs.mkdirSync(path.join(game, 'bin/win_x64'), { recursive: true })
    fs.writeFileSync(path.join(game, 'bin/win_x64/eurotrucks2.exe'), '')
    assert.equal(
      handlers.get('standalone:autoDetectGamePath')(null, path.join(dataDir, 'bottle')).gameDir,
      game
    )
    fs.rmSync(steam, { recursive: true })
  }
})
test('standalone detection preserves manual paths even when the other scan fails', async () => {
  let saved = 0
  const f = await rendererFixture({
    swAutoDetectSteamPath: async () => ({ ok: true, steamDir: '/bottle/Steam' }),
    swAutoDetectGamePath: async () => {
      throw new Error('scan failed')
    },
    saveSettings: async () => {
      saved++
    }
  })
  f.state.settings = { wineMode: 'standalone', standalonGameDir: '/manual/game' }
  await f.settings.detectStandaloneBottlePaths('/bottle')
  assert.equal(f.state.settings.standalonSteamDir, '/bottle/Steam')
  assert.equal(f.state.settings.standalonGameDir, '/manual/game')
  assert.equal(saved, 1)
})
test('wizard refuses to advance until Steam exists without killing Wine', async () => {
  let installed = false,
    saved = 0
  const f = await rendererFixture({
    swGetStatus: async () => ({ wineInstalled: true, bottleExists: true }),
    swAutoDetectSteamPath: async () =>
      installed ? { ok: true, steamDir: '/bottle/Steam' } : { ok: false },
    saveSettings: async () => {
      saved++
    },
    onWineProgress() {},
    onSteamProgress() {}
  })
  f.state.settings = { wineMode: 'standalone', standalonBottlePath: '/bottle' }
  f.fields['sw-wiz-bottle'].value = '/bottle'
  const { createSetupWizard } = await import('../src/renderer/setup-wizard.js')
  createSetupWizard({
    ...f,
    settingsController: {
      detectStandaloneBottlePaths: async () => {},
      applyWineMode() {},
      collect() {}
    },
    updateButtons() {}
  })
  await f.fields['sw-skip-2'].click()
  assert.match(f.fields['sw-bottle-err'].textContent, /Steam is not installed/)
  installed = true
  await f.fields['sw-skip-2'].click()
  assert.equal(saved, 1)
  assert.equal(f.state.settings.standalonSteamDir, '/bottle/Steam')
  assert.equal(f.fields['swp-3'].classList.active, true)
})
function gameFixture(t, overrides = {}) {
  const dir = root(t)
  const write = (file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
    fs.chmodSync(file, 0o755)
  }
  const selected = {
    standalone: true,
    winePath: path.join(dir, 'wine'),
    bottlePath: path.join(dir, 'bottle'),
    steamDir: path.join(dir, 'bottle/Steam'),
    gameDir: path.join(dir, 'game')
  }
  for (const file of [
    selected.winePath,
    path.join(dir, 'cli'),
    path.join(selected.steamDir, 'steam.exe'),
    path.join(selected.gameDir, 'bin/win_x64/eurotrucks2.exe')
  ])
    write(file)
  fs.mkdirSync(path.join(selected.bottlePath, 'drive_c'))
  const child = Object.assign(new EventEmitter(), {
      pid: 123,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill(signal) {
        child.signal = signal
      }
    }),
    state = {},
    logs = [],
    events = []
  let invocation
  const game = createGameController({
    state,
    wine: {
      selectedWineContext: () => selected,
      standaloneWineEnv: (_w, b) => ({ WINEPREFIX: b }),
      killWineserver: (...args) => {
        events.push({ kill: args })
      }
    },
    graphics: {},
    detection: { resolveInterpreter: () => '/python' },
    sendLog: (kind, text, cat) => logs.push({ kind, text, cat }),
    sendEvent: (name, data) => events.push({ name, data }),
    adaptWine: (w, _b, env) => ({ ...env, WINE: w }),
    spawn: (...args) => {
      invocation = args
      queueMicrotask(() => child.emit('spawn'))
      return child
    },
    ...overrides
  })
  return {
    game,
    state,
    child,
    selected,
    logs,
    events,
    settings: { cliPath: path.join(dir, 'cli'), wineMode: 'standalone' },
    invocation: () => invocation
  }
}
test('game launch validates missing Steam before starting the CLI', async (t) => {
  const f = gameFixture(t)
  f.selected.steamDir = ''
  assert.match((await f.game.launch(f.settings)).error, /Steam Directory/)
  assert.equal(f.invocation(), undefined)
})
test('game launch builds selected paths, records child lifecycle, and keeps progress filenames informational', async (t) => {
  const f = gameFixture(t)
  const result = await f.game.launch(f.settings)
  assert.equal(result.pid, 123)
  assert.equal(f.invocation()[2].env.WINEPREFIX, f.selected.bottlePath)
  assert.ok(f.invocation()[1].includes('--without-wine-discord-ipc-bridge'))
  f.child.stderr.end('/files/data/shared/ui/error.png\n** ERROR ** Steam failed\n')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(
    f.logs.find((entry) => entry.text === '/files/data/shared/ui/error.png').kind,
    'info'
  )
  assert.equal(f.logs.find((entry) => entry.text === '** ERROR ** Steam failed').kind, 'error')
  f.child.emit('close', 0)
  assert.equal(f.state.gameProcess, null)
  assert.equal(f.events.at(-1).name, 'game:stopped')
})
test('stopping a session uses its selected prefix rather than global process kills', async (t) => {
  const f = gameFixture(t)
  await f.game.launch(f.settings)
  f.game.stop()
  assert.equal(f.child.signal, 'SIGTERM')
  assert.deepEqual(f.events[0].kill, [f.selected.winePath, f.selected.bottlePath])
  f.child.emit('close', null)
  assert.equal(f.events.at(-1).data.code, 0)
})
