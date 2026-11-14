const test = require('node:test')
const assert = require('node:assert/strict')
const { rendererFixture } = require('./helpers/renderer')
async function fixture() {
  const calls = { launch: 0, stop: 0 }
  let finish
  const f = await rendererFixture({
    launchGame: () => {
      calls.launch++
      return new Promise((resolve) => {
        finish = resolve
      })
    },
    stopGame: async () => {
      calls.stop++
    }
  })
  Object.keys(f.state.readiness).forEach((key) => {
    f.state.readiness[key] = true
  })
  f.game.wire()
  const context = new Proxy(f.state, {
    get(target, key) {
      if (key === 'onStopped') return f.callbacks.stopped
      return f.game[key] || f.ui[key] || target[key]
    }
  })
  return { ...f, context, calls, finish: (value) => finish(value) }
}

test('launch immediately explains the wait and prevents duplicate launches while IPC is pending', async () => {
  const { context, fields, calls, finish } = await fixture()
  const pending = context.launchOrStopGame()
  assert.equal(fields['status-label'].textContent, 'Initializing ETS2 MP…')
  assert.equal(fields['game-startup'].classList.hidden, false)
  assert.match(fields['game-startup-text'].textContent, /several minutes/)
  assert.match(fields['game-startup-text'].textContent, /before stopping or restarting/)
  await context.launchOrStopGame()
  assert.equal(calls.launch, 1)
  finish({ ok: true, pid: 123 })
  await pending
  assert.equal(fields['status-label'].textContent, 'Initializing ETS2 MP…')
  assert.equal(fields['status-pid'].textContent, 'PID 123')
  assert.equal(fields['btn-launch'].textContent, 'Stop ETS2 MP')
  assert.equal(fields['btn-launch'].disabled, false)
})

test('downloads keep initialization visible; only the actual CLI start marker advances the status', async () => {
  const { context, fields, finish } = await fixture()
  const pending = context.launchOrStopGame()
  context.pushLog({
    cat: 'wine',
    kind: 'info',
    text: '49.5M / 279.5M [=>     ] [107/125] Get: hvt_tourvego.mp'
  })
  assert.equal(context.gameLaunchPhase, 'initializing')
  context.pushLog({ kind: 'success', text: 'Process started — PID 123' })
  assert.equal(context.gameLaunchPhase, 'initializing')
  // Log output may reach the renderer before the launch IPC reply.
  context.pushLog({ cat: 'wine', kind: 'info', text: '** INFO **  Starting game' })
  assert.equal(context.gameLaunchPhase, 'started')
  finish({ ok: true, pid: 123 })
  await pending
  assert.equal(fields['status-label'].textContent, 'ETS2 MP launched')
  assert.match(fields['game-startup-text'].textContent, /game window may take a while/)
  assert.equal(fields['game-startup'].classList.hidden, false)
})

test('users can stop initialization and the notice clears when the session ends', async () => {
  const { context, fields, calls, finish } = await fixture()
  const pending = context.launchOrStopGame()
  finish({ ok: true, pid: 123 })
  await pending
  await context.launchOrStopGame()
  assert.equal(calls.stop, 1)
  context.onStopped({ code: 0 })
  assert.equal(fields['game-startup'].classList.hidden, true)
  assert.equal(fields['status-label'].textContent, 'Stopped')
  assert.equal(fields['btn-launch'].textContent, 'Launch ETS2 MP')
})

test('failed or prematurely exited launches cannot leave a stale initialization notice or resurrect a session', async () => {
  const { context, fields, finish } = await fixture()
  let pending = context.launchOrStopGame()
  finish({ ok: false, error: 'Wine was not found' })
  await pending
  assert.equal(fields['game-startup'].classList.hidden, true)
  assert.equal(fields['status-label'].textContent, 'Launch failed')
  assert.equal(fields['action-message'].textContent, 'Wine was not found')
  pending = context.launchOrStopGame()
  context.onStopped({ code: 1 })
  finish({ ok: true, pid: 123 })
  await pending
  assert.equal(context.running, false)
  assert.equal(fields['game-startup'].classList.hidden, true)
  assert.equal(fields['status-label'].textContent, 'Game exited')
  assert.match(fields['action-message'].textContent, /exited with code 1/)
})

test('ATS selection updates launch labels, documents and locks selection during launch', async () => {
  const f = await fixture()
  f.state.settings.game = 'ats'
  f.game.updateLaunchBtn()
  assert.equal(f.fields['btn-launch'].textContent, 'Launch ATS MP')
  assert.equal(f.fields['btn-game-documents'].textContent, 'Open ATS Documents')
  const pending = f.game.launchOrStopGame()
  assert.equal(f.fields['game-select'].disabled, true)
  assert.equal(f.fields['status-label'].textContent, 'Initializing ATS MP…')
  f.finish({ ok: true, pid: 123 })
  await pending
  assert.equal(f.fields['btn-launch'].textContent, 'Stop ATS MP')
})
