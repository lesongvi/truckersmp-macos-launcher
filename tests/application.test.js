const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { createApplication } = require('../src/main')
const { createPaths } = require('../src/main/paths')
const { registry } = require('./helpers/modules')
const { buildUI } = require('../scripts/build-ui')

test('the isolated preload exposes exactly the supported backend requests', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-contract-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { handlers, ipcMain } = registry()
  const electron = { ipcMain, app: {}, BrowserWindow() {}, dialog: {} }
  createApplication(electron, createPaths(root))
  let api
  const requested = []
  const bridge = {
    contextBridge: {
      exposeInMainWorld: (_name, value) => {
        api = value
      }
    },
    ipcRenderer: {
      invoke: (channel, ...args) => {
        requested.push({ channel, args })
      },
      on() {},
      removeListener() {}
    }
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8'), {
    require: (name) => {
      assert.equal(name, 'electron')
      return bridge
    }
  })
  for (const [name, fn] of Object.entries(api)) if (!name.startsWith('on')) fn('/test', true)
  for (const { channel } of requested)
    assert.ok(handlers.has(channel), 'Missing handler for ' + channel)
  assert.equal(requested.length, handlers.size)
  for (const removed of [
    'getTMPEvents',
    'getTMPServers',
    'lookupPlayer',
    'testRPC',
    'runWineCommand',
    'killAllWine',
    'checkUpdate',
    'swDeleteWine',
    'swSetActiveWine'
  ])
    assert.equal(api[removed], undefined)
})
test('application startup loads generated UI with context isolation and no Node integration', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-boot-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { ipcMain } = registry()
  let options, loaded
  class Window extends EventEmitter {
    constructor(value) {
      super()
      options = value
    }
    loadFile(file) {
      loaded = file
    }
  }
  const app = Object.assign(new EventEmitter(), {
    setPath() {},
    setName() {},
    whenReady: () => Promise.resolve(),
    dock: { setIcon() {} }
  })
  const application = createApplication(
    { app, BrowserWindow: Window, ipcMain, dialog: {} },
    createPaths(root)
  )
  application.start()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(options.webPreferences.contextIsolation, true)
  assert.equal(options.webPreferences.nodeIntegration, false)
  assert.equal(path.basename(loaded), 'index.html')
  assert.equal(application.state.gameProcess, null)
})
test('EJS partials produce complete static UI without runtime template evaluation', async () => {
  const html = await buildUI()
  for (const id of [
    'btn-launch',
    'game-startup',
    'panel-settings',
    'sw-wizard',
    'badge-haullog',
    'badge-truckersvn'
  ])
    assert.ok(html.includes('id="' + id + '"'))
  assert.ok(html.includes('type="module"'))
  assert.ok(!html.includes('<%'))
  assert.ok(!html.includes('unsafe-eval'))
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
  assert.equal(ids.length, new Set(ids).size)
  assert.ok(!html.includes('Mac login password'))
})

test('opens ETS2 documents from the selected bottle before a profile exists', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-documents-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bottle = path.join(root, 'bottle')
  const folder = path.join(bottle, 'drive_c/users/player/Documents/Euro Truck Simulator 2')
  fs.mkdirSync(folder, { recursive: true })
  const { handlers, ipcMain } = registry()
  const opened = []
  createApplication(
    {
      ipcMain,
      shell: {
        openPath: async (value) => {
          opened.push(value)
          return ''
        }
      }
    },
    createPaths(root)
  )
  const open = handlers.get('game:openDocuments')
  assert.equal((await open(null, { wineMode: 'standalone', standalonBottlePath: bottle })).ok, true)
  assert.deepEqual(opened, [folder])
  assert.equal(
    (await open(null, { wineMode: 'standalone', standalonBottlePath: path.join(root, 'missing') }))
      .ok,
    false
  )
  assert.equal(opened.length, 1)
})
