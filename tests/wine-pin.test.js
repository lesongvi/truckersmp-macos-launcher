const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { loadModule, registry } = require('./helpers/modules')
const { createWineService } = require('../src/main/wine')
const { createSettingsStore } = require('../src/main/settings')
const PINNED_WINE = require('../src/wine-release')
function root(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wine-pin-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
function fixture(t, overrides = {}) {
  const dataDir = root(t),
    paths = { dataDir, winesDir: path.join(dataDir, 'wines') },
    settings = createSettingsStore(path.join(dataDir, 'settings.json'))
  const { handlers, ipcMain } = registry()
  const { registerWineInstall } = loadModule('src/main/wine-install.js', {
    '../wine-release': overrides.pin || PINNED_WINE,
    child_process: overrides.childProcess || require('child_process')
  })
  registerWineInstall({
    ipcMain,
    state: {},
    paths,
    settings,
    wine: createWineService(paths),
    downloads: { downloadToFile: overrides.download || async function () {} },
    sendLog() {}
  })
  return { dataDir, paths, settings, handlers }
}
test('wizard offers only pinned metadata without network access', async (t) => {
  const f = fixture(t)
  const result = await f.handlers.get('standalone:fetchWineRelease')()
  assert.equal(result.versions.length, 1)
  assert.equal(result.versions[0].url, PINNED_WINE.url)
  assert.equal(result.versions[0].isPinned, true)
  assert.equal(f.handlers.has('standalone:setActiveWine'), false)
  assert.equal(f.handlers.has('standalone:deleteWine'), false)
})
test('missing Wine 11.11 never falls back to an old or legacy installation', (t) => {
  const dataDir = root(t),
    winesDir = path.join(dataDir, 'wines'),
    wine = createWineService({ dataDir, winesDir })
  for (const dir of [path.join(winesDir, 'wine-11.0/bin'), path.join(dataDir, 'wine/bin')]) {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'wine'), '')
  }
  assert.equal(wine.standaloneWineBin(), null)
  const dir = path.join(winesDir, PINNED_WINE.slug, 'wine/bin')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'wine'), '')
  fs.writeFileSync(path.join(dir, 'wineserver'), '')
  assert.equal(wine.standaloneWineBin(), path.join(dir, 'wine'))
})
test('saved old selections migrate to the pin without losing other preferences', (t) => {
  const file = path.join(root(t), 'settings.json')
  fs.writeFileSync(file, JSON.stringify({ standalonWineSlug: 'old', other: 'keep' }))
  const store = createSettingsStore(file),
    settings = store.loadSettings()
  assert.equal(settings.standalonWineSlug, PINNED_WINE.slug)
  store.saveSettings({ ...settings, standalonWineSlug: 'different' })
  const saved = JSON.parse(fs.readFileSync(file))
  assert.equal(saved.standalonWineSlug, PINNED_WINE.slug)
  assert.equal(saved.other, 'keep')
})
test('custom archives are rejected before download', async (t) => {
  const f = fixture(t, { download: () => assert.fail('Must not download') })
  assert.match(
    (
      await f.handlers.get('standalone:downloadWine')(
        null,
        'https://example.com/wine.tar.gz',
        'other'
      )
    ).error,
    /pinned to Wine 11.11/
  )
})
test('a bad checksum cannot replace the existing pin', async (t) => {
  const f = fixture(t, { download: async (_url, file) => fs.writeFileSync(file, 'wrong archive') })
  const marker = path.join(f.paths.winesDir, PINNED_WINE.slug, 'keep.txt')
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  fs.writeFileSync(marker, 'existing')
  const result = await f.handlers.get('standalone:downloadWine')(
    null,
    PINNED_WINE.url,
    'untrusted-slot'
  )
  assert.match(result.error, /checksum/)
  assert.equal(fs.readFileSync(marker, 'utf8'), 'existing')
  assert.equal(fs.existsSync(path.join(f.paths.winesDir, 'untrusted-slot')), false)
})
test('verified downloads install to the pinned slot regardless of the caller slug', async (t) => {
  const payload = Buffer.from('test archive'),
    pin = { ...PINNED_WINE, sha256: crypto.createHash('sha256').update(payload).digest('hex') }
  const f = fixture(t, {
    pin,
    download: async (_url, file) => fs.writeFileSync(file, payload),
    childProcess: {
      execFileSync() {},
      spawn: (_cmd, args) => {
        assert.equal(args[3], path.join(f.paths.winesDir, pin.slug))
        const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() })
        queueMicrotask(() => {
          fs.writeFileSync(path.join(args[3], 'wine'), 'binary')
          child.emit('close', 0)
        })
        return child
      }
    }
  })
  const result = await f.handlers.get('standalone:downloadWine')(null, pin.url, 'custom-slot')
  assert.equal(result.ok, true)
  assert.equal(f.settings.loadSettings().standalonWineSlug, pin.slug)
  assert.equal(fs.existsSync(path.join(f.paths.winesDir, 'custom-slot')), false)
})
