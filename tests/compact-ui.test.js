const test = require('node:test')
const assert = require('node:assert/strict')
const { rendererFixture } = require('./helpers/renderer')

test('runtime diagnostics stay in Log while launcher failures remain visible', async () => {
  const { ui, fields } = await rendererFixture()
  ui.pushLog({ kind: 'info', text: '/files/data/shared/ui/error.png', cat: 'wine' })
  ui.pushLog({ kind: 'error', text: '0024:err:module:diagnostic', cat: 'wine' })
  assert.match(fields['log-body'].textContent, /error\.png/)
  assert.match(fields['log-body'].textContent, /diagnostic/)
  assert.equal(fields['log-details'].open, false)
  assert.equal(fields['action-message'].textContent, '')
  ui.pushLog({ kind: 'error', text: 'Could not start the launcher process' })
  assert.equal(fields['log-details'].open, true)
  assert.equal(fields['action-message'].textContent, 'Could not start the launcher process')
})
test('a failed game exit opens Log and reports its exit code while preserving spawn errors', async () => {
  const { game, state, fields, callbacks } = await rendererFixture()
  game.wire()
  state.running = true
  callbacks.stopped({ code: 1 })
  assert.equal(state.running, false)
  assert.equal(fields['log-details'].open, true)
  assert.match(fields['action-message'].textContent, /exited with code 1/)
  fields['action-message'].textContent = 'Python interpreter was not found'
  callbacks.stopped({ code: -1 })
  assert.equal(fields['action-message'].textContent, 'Python interpreter was not found')
})
test('companion badges distinguish installed versions, unavailable versions, and missing apps', async () => {
  const { ui, fields } = await rendererFixture()
  ui.setBadge('badge-truckersvn', true, '1.0.70')
  assert.equal(fields['badge-truckersvn'].textContent, 'v1.0.70')
  ui.setBadge('badge-haullog', true, '')
  assert.equal(fields['badge-haullog'].textContent, 'Found · version unknown')
  ui.setBadge('badge-haullog', false, 'stale')
  assert.equal(fields['badge-haullog'].textContent, 'Not found')
  ui.setBadge('badge-cli', true)
  assert.equal(fields['badge-cli'].textContent, 'Found')
})
test('saving paths preserves stored options outside the compact UI', async () => {
  const { state, settings, fields } = await rendererFixture()
  state.settings = {
    wineMode: 'standalone',
    standalonWineSlug: 'wine-devel-11.11',
    standalonBottlePath: '/existing/bottle',
    extraArgs: '--existing-option',
    other: { keep: true }
  }
  settings.populatePaths()
  fields['s-cli'].value = '/new/cli'
  fields['s-metal-hud-sw'].checked = true
  fields['s-retina-mode'].checked = true
  settings.collect()
  assert.equal(state.settings.cliPath, '/new/cli')
  assert.equal(state.settings.standalonBottlePath, '/existing/bottle')
  assert.equal(state.settings.extraArgs, '--existing-option')
  assert.deepEqual(state.settings.other, { keep: true })
  assert.equal(state.settings.metalHud, true)
})
test('launch stays disabled until the actual Windows game executable exists', async () => {
  let installed = false
  const { settings, state, fields } = await rendererFixture({
    swGetStatus: async () => ({ wineInstalled: true }),
    pathExists: async (file) => (file.endsWith('eurotrucks2.exe') ? installed : true)
  })
  state.settings = {
    wineMode: 'standalone',
    cliPath: '/cli',
    standalonBottlePath: '/bottle',
    standalonSteamDir: '/steam',
    standalonGameDir: '/game'
  }
  await settings.refreshDetection()
  assert.equal(fields['btn-launch'].disabled, true)
  installed = true
  await settings.refreshDetection()
  assert.equal(fields['btn-launch'].disabled, false)
})
