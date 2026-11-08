const test = require('node:test')
const assert = require('node:assert/strict')
const { loadModule, registry } = require('./helpers/modules')

test('setup cancellation aborts the active transfer, rejects concurrent transfers and permits retry', async () => {
  const { handlers, ipcMain } = registry()
  let transfer
  const events = []
  const { createSetupDownloads } = loadModule('src/main/setup-downloads.js', {
    '../download-file': {
      downloadFile: (url, destination, progress, label, { signal }) =>
        new Promise((resolve, reject) => {
          transfer = { url, destination, progress, signal, resolve }
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    }
  })
  const state = {
    window: {
      isDestroyed: () => false,
      webContents: { send: (...args) => events.push(args) }
    }
  }
  const downloads = createSetupDownloads({ ipcMain, state })
  const cancel = handlers.get('standalone:cancelWineDownload')
  assert.equal(cancel().ok, false)
  const first = downloads.downloadToFile('https://example.test/wine', '/tmp/wine', 'wine:progress')
  const rejection = assert.rejects(first, /^Error: cancelled$/)
  transfer.progress({ received: 20, total: 100 })
  assert.deepEqual(events, [['wine:progress', { received: 20, total: 100 }]])
  await assert.rejects(
    downloads.downloadToFile('https://example.test/other', '/tmp/other'),
    /already in progress/
  )
  assert.equal(cancel().ok, true)
  assert.equal(transfer.signal.aborted, true)
  await rejection
  const retry = downloads.downloadToFile('https://example.test/wine', '/tmp/wine')
  assert.equal(transfer.signal.aborted, false)
  transfer.resolve()
  await retry
  assert.equal(cancel().ok, false)
})
