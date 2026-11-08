const STEAM_ICON_SVG = '<img src="logo2.png" class="button-icon" alt=""/>'
const dbg = (message) => console.debug('[Steam]', message)
export function createSteamController({ state, ui, api, collect, wineContextKey }) {
  const { $, showMessage, pushLog } = ui
  function updateSteamBtn() {
    const btn = $('btn-steam')
    if (!btn) return
    const isStandalone = state.settings.wineMode === 'standalone'
    // Simple rule: light up if the relevant steam directory is known, grey if not.
    const ready = isStandalone
      ? !!state.settings.standalonSteamDir
      : !!(state.settings.steamDir || state.detected.steamDir)
    btn.disabled = !state.steamRunning && !ready
    if (state.steamRunning) {
      btn.classList.add('steam-running')
    } else {
      btn.classList.remove('steam-running')
    }
    btn.innerHTML = STEAM_ICON_SVG + (state.steamRunning ? 'Steam Running · Stop' : 'Start Steam')
  }

  async function refreshSteamStatus() {
    if (state.steamOperation || state.steamStatusBusy) return
    state.steamStatusBusy = true
    const context = wineContextKey()
    try {
      const status = await api.getSteamStatus(state.settings)
      if (status.ok && !state.steamOperation && context === wineContextKey()) {
        state.steamRunning = status.running
        updateSteamBtn()
      }
    } catch (err) {
      dbg('Steam status check failed: ' + err.message)
    } finally {
      state.steamStatusBusy = false
    }
  }

  function wire() {
    $('btn-steam').addEventListener('click', async () => {
      if (state.steamOperation) return
      collect()
      const wasRunning = state.steamRunning
      state.steamOperation = true
      const button = $('btn-steam')
      button.disabled = true
      button.textContent = state.steamRunning ? 'Stopping Steam…' : 'Starting Steam…'
      try {
        const result = await (wasRunning
          ? api.stopSteam(state.settings)
          : api.startSteam(state.settings))
        if (!result.ok) throw new Error(result.error)
        state.steamRunning = !wasRunning
        updateSteamBtn()
      } catch (err) {
        showMessage(err.message, true)
        pushLog({ kind: 'error', text: err.message })
      } finally {
        state.steamOperation = false
        await refreshSteamStatus()
        updateSteamBtn()
      }
    })
    api.onSteamStopped(() => {
      state.steamRunning = false
      updateSteamBtn()
      refreshSteamStatus()
    })
    api.onSteamRestarting(refreshSteamStatus)
    api.onSteamReady(refreshSteamStatus)
  }
  return { wire, updateSteamBtn, refreshSteamStatus }
}
