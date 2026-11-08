const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const bridge = require('../src/truckersvn-context')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truckersvn-bridge-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const context = { bottlePath: path.join(root, 'bottle'), gameDir: path.join(root, 'game') }
  const documents = path.join(context.bottlePath, 'drive_c/users/driver/Documents')
  const write = (file, data = '') => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
  }
  write(path.join(context.gameDir, 'bin/win_x64/eurotrucks2.exe'))
  write(path.join(context.gameDir, 'base.scs'))
  const profiles = () => {
    fs.mkdirSync(path.join(documents, 'Euro Truck Simulator 2/profiles/driver/save/autosave'), {
      recursive: true
    })
    write(
      path.join(documents, 'Euro Truck Simulator 2/config.cfg'),
      'uset g_developer "1"\nuset g_console "0"\nuset g_max_convoy_size "128"\n'
    )
  }
  return { root, context, documents, write, profiles }
}

test('Wine paths map through their selected bottle without traversal', (t) => {
  const { context } = fixture(t)
  assert.equal(
    bridge.winePathToHost(context.bottlePath, 'C:\\users\\driver\\Documents'),
    path.join(context.bottlePath, 'drive_c/users/driver/Documents')
  )
  assert.equal(
    bridge.winePathToHost(context.bottlePath, 'Z:\\Users\\driver\\Documents'),
    '/Users/driver/Documents'
  )
  assert.equal(bridge.winePathToHost(context.bottlePath, 'C:\\..\\escape'), '')
  assert.equal(bridge.winePathToHost(context.bottlePath, 'D:\\unmapped'), '')
})

test('documents discovery honours the bottle registry and follows Wine Documents symlinks', (t) => {
  const { context, documents, profiles, write, root } = fixture(t)
  profiles()
  assert.equal(bridge.findWineDocuments(context.bottlePath), documents)
  const custom = path.join(root, 'custom-documents')
  fs.renameSync(documents, custom)
  fs.symlinkSync(custom, documents)
  assert.equal(bridge.findWineDocuments(context.bottlePath), documents)
  write(
    path.join(context.bottlePath, 'user.reg'),
    '[Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Explorer\\\\Shell Folders] 123\n"Personal"=' +
      JSON.stringify('Z:' + custom.replaceAll('/', '\\')) +
      '\n'
  )
  assert.equal(bridge.findWineDocuments(context.bottlePath), custom)
  assert.equal(bridge.findWineDocuments(context.bottlePath + '-other'), '')
})

test('configuration changes only the selected game paths and preserves actual game flags and other preferences', (t) => {
  const { context, documents, profiles } = fixture(t)
  profiles()
  const current = {
    documentPath: '/native/docs',
    ets2GamePath: '/native/game',
    atsGamePath: '/other/ats',
    backupBeforeEdit: false,
    developerMode: false,
    consoleMode: true,
    maxConvoySize128: false,
    customPreference: { keep: true }
  }
  const updated = bridge.configurationForBottle(context, current)
  assert.equal(updated.documentPath, documents)
  assert.equal(updated.ets2GamePath, context.gameDir)
  assert.equal(updated.selectedGame, 'ets2')
  assert.equal(updated.atsGamePath, '/other/ats')
  assert.equal(updated.developerMode, true)
  assert.equal(updated.consoleMode, false)
  assert.equal(updated.maxConvoySize128, true)
  assert.equal(updated.backupBeforeEdit, false)
  assert.deepEqual(updated.customPreference, { keep: true })
  assert.equal(current.documentPath, '/native/docs')
})

test('a game without a profile is left untouched and gets a useful next step', async (t) => {
  const { context } = fixture(t)
  const result = await bridge.connectToolToBottle(
    context,
    {},
    {
      ownsServer: () => {
        throw new Error('Must not contact another app')
      }
    }
  )
  assert.equal(result.configured, false)
  assert.match(result.message, /create a profile/)
})

test('only the matching native process may receive configuration, including immediately before the write', async (t) => {
  const { context, profiles } = fixture(t)
  profiles()
  const app = { executable: '/native/tool' }
  let reads = 0,
    writes = 0,
    checks = 0
  const request = async (method, config, endpoint) => {
    if (endpoint === '/api/profiles?reload=true') return { success: true, profileCount: 2 }
    if (method === 'GET') {
      reads++
      return { backupBeforeEdit: true }
    }
    writes++
    assert.equal(config.ets2GamePath, context.gameDir)
    return { success: true }
  }
  const noWait = async () => {}
  await assert.rejects(
    bridge.connectToolToBottle(context, app, {
      ownsServer: async () => false,
      request,
      sleep: noWait,
      attempts: 1
    }),
    /service is unavailable/
  )
  assert.equal(reads, 0)
  assert.equal(writes, 0)
  await assert.rejects(
    bridge.connectToolToBottle(context, app, {
      ownsServer: async () => ++checks === 1,
      request,
      sleep: noWait,
      attempts: 1
    }),
    /closed before/
  )
  assert.equal(writes, 0)
  const result = await bridge.connectToolToBottle(context, app, {
    ownsServer: async (exe) => exe === app.executable,
    request,
    sleep: noWait
  })
  assert.equal(result.configured, true)
  assert.equal(result.profileCount, 2)
  assert.equal(writes, 1)
})

test('process ownership requires the exact native executable, not just an application name', async (t) => {
  const { root, write } = fixture(t)
  const executable = path.join(root, 'tool')
  write(executable)
  let calls = 0
  assert.equal(
    await bridge.ownsConfigServer(executable, async () => ({
      stdout: ++calls === 1 ? 'p123\n' : 'n' + executable + '\n'
    })),
    true
  )
  calls = 0
  assert.equal(
    await bridge.ownsConfigServer(executable, async () => ({
      stdout: ++calls === 1 ? 'p123\n' : 'n/other/tool\n'
    })),
    false
  )
})

test('local configuration requests use JSON on loopback and handle rejected writes', async (t) => {
  let received
  const server = http.createServer((req, res) => {
    assert.equal(req.url, '/api/tool-config')
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      if (req.method === 'GET') res.end(JSON.stringify({ backupBeforeEdit: true }))
      else {
        received = JSON.parse(body)
        res.writeHead(400)
        res.end('{}')
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())
  const port = server.address().port
  assert.equal((await bridge.requestConfig('GET', undefined, port)).backupBeforeEdit, true)
  await assert.rejects(
    bridge.requestConfig('PUT', { documentPath: '/selected/docs' }, port),
    /HTTP 400/
  )
  assert.equal(received.documentPath, '/selected/docs')
})
