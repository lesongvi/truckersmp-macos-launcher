const { downloadFile } = require('../download-file')

function createSetupDownloads({ ipcMain, state }) {
  let active = null
  async function downloadToFile(url, destination, event) {
    if (active) throw new Error('Another setup download is already in progress.')
    const controller = new AbortController()
    active = controller
    try {
      await downloadFile(
        url,
        destination,
        (progress) => {
          if (event && state.window && !state.window.isDestroyed())
            state.window.webContents.send(event, progress)
        },
        'Setup download',
        { signal: controller.signal }
      )
    } catch (error) {
      throw controller.signal.aborted ? new Error('cancelled') : error
    } finally {
      if (active === controller) active = null
    }
  }
  ipcMain.handle('standalone:cancelWineDownload', () => {
    if (!active) return { ok: false }
    active.abort()
    return { ok: true }
  })
  return { downloadToFile }
}
module.exports = { createSetupDownloads }
