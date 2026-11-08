const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadModule, registry } = require('./helpers/modules')
const { rendererFixture } = require('./helpers/renderer')
const {
  findSteamProcesses,
  matchesBottleEnvironment,
  parseProcesses,
  isSteamProcess
} = require('../src/steam-process')
function handler(name, context) {
  const { handlers, ipcMain } = registry()
  const { registerSteamHandlers } = loadModule('src/main/steam.js', {
    fs: context.fs || require('fs'),
    child_process: { spawn: context.spawn, execFile: context.execFile },
    '../steam-process': { findSteamProcesses: context.findSteamProcesses }
  })
  registerSteamHandlers({
    ipcMain,
    state: {},
    paths: { dataDir: '/data' },
    wine: {
      standaloneWineBin: context.standaloneWineBin,
      selectedWineContext: context.selectedWineContext,
      standaloneWineEnv: context.standaloneWineEnv
    },
    graphics: {},
    sendLog() {}
  })
  return handlers.get(name)
}

test('recognizes Steam executable but excludes helpers, shells and native macOS Steam', () => {
  const processes = parseProcesses(
    ' 42 1 C:\\Program Files (x86)\\Steam\\steam.exe\n43 42 steamwebhelper.exe\n44 1 /Applications/Steam.app/Contents/MacOS/steam_osx\n45 1 /bin/bash -c wine steam.exe\n'
  )
  assert.deepEqual(
    processes.filter(isSteamProcess).map((p) => p.pid),
    [42]
  )
})

test('bottle matching handles spaces without matching another bottle with a longer name', () => {
  const env = 'steam.exe WINEPREFIX=/Users/test/Application Support/Bottle Other PATH=/usr/bin'
  assert.equal(matchesBottleEnvironment(env, '/Users/test/Application Support/Bottle'), false)
  assert.equal(matchesBottleEnvironment(env, '/Users/test/Application Support/Bottle Other'), true)
})

test('detects installer-started Steam by WINEPREFIX and ignores Steam in another bottle', async () => {
  const run = async (_cmd, args) => ({
    stdout:
      args[0] === '-axo'
        ? '10 1 C:\\Program Files (x86)\\Steam\\steam.exe\n20 1 C:\\Program Files (x86)\\Steam\\steam.exe'
        : `steam.exe WINEPREFIX=/bottles/${args[2] === '10' ? 'selected' : 'other'} PATH=/usr/bin`
  })
  const result = await findSteamProcesses({ bottlePath: '/bottles/selected' }, run)
  assert.deepEqual(
    result.map((p) => p.pid),
    [10]
  )
})

test('recognizes a Unix Steam executable path without inspecting process environments', async () => {
  let calls = 0
  const result = await findSteamProcesses(
    { bottlePath: '/bottle', steamDir: '/bottle/drive_c/Program Files (x86)/Steam' },
    async () => {
      calls++
      return { stdout: '10 1 /bottle/drive_c/Program Files (x86)/Steam/steam.exe -silent' }
    }
  )
  assert.equal(result.length, 1)
  assert.equal(calls, 1)
})

test('process inspection failures remain unknown rather than falsely reporting stopped', async () => {
  await assert.rejects(
    findSteamProcesses({ bottlePath: '/bottle' }, async () => {
      throw new Error('permission denied')
    }),
    /permission/
  )
})

test('starting an already running Steam never spawns Wine or resets its bottle', async () => {
  const start = handler('game:startSteam', {
    path,
    fs: { existsSync: () => true },
    sendLog() {},
    standaloneWineBin: () => '/wine',
    findSteamProcesses: async () => [{ pid: 42 }],
    spawn() {
      assert.fail('must not spawn or reset a running Steam session')
    }
  })
  const result = await start(null, {
    wineMode: 'standalone',
    standalonBottlePath: '/bottle',
    standalonSteamDir: '/bottle/Steam'
  })
  assert.equal(result.alreadyRunning, true)
  assert.equal(result.pid, 42)
})

test('stops externally started Steam with its shutdown command, without killing Wine', async () => {
  let queried = 0,
    invocation
  const stop = handler('game:stopSteam', {
    path,
    process: { env: {} },
    steamPid: null,
    _steamPollActive: false,
    mainWindow: null,
    selectedWineContext: () => ({
      standalone: true,
      winePath: '/wine',
      bottlePath: '/bottle',
      steamDir: '/bottle/Steam'
    }),
    standaloneWineEnv: () => ({ WINEPREFIX: '/bottle' }),
    findSteamProcesses: async () => (queried++ === 0 ? [{ pid: 42 }] : []),
    execFile: (cmd, args, opts, done) => {
      invocation = { cmd, args, opts }
      done(null)
    }
  })
  const result = await stop(null, {})
  assert.equal(result.ok, true)
  assert.deepEqual(Array.from(invocation.args), ['/bottle/Steam/steam.exe', '-shutdown'])
  assert.equal(invocation.opts.env.WINEPREFIX, '/bottle')
})

test('Steam UI ignores replies for a previously selected bottle', async () => {
  const f = await rendererFixture({ getSteamStatus: async () => ({ ok: true, running: true }) })
  f.state.settings = { wineMode: 'standalone', standalonBottlePath: '/one' }
  await f.steam.refreshSteamStatus()
  assert.equal(f.state.steamRunning, true)
  let respond
  f.api.getSteamStatus = () =>
    new Promise((resolve) => {
      respond = resolve
    })
  const pending = f.steam.refreshSteamStatus()
  f.state.settings.standalonBottlePath = '/two'
  f.state.steamRunning = false
  respond({ ok: true, running: true })
  await pending
  assert.equal(f.state.steamRunning, false)
})
