export function createCompanionController({ state, ui, api, collect, wineContextKey }) {
  const { $, setBadge } = ui
  function setHaulLogMessage(message, error = false) {
    const el = $('haullog-message')
    if (!el) return
    el.textContent = message
    el.classList.toggle('hidden', !message)
    el.classList.toggle('error', error)
  }
  function renderHaulLogWidget() {
    if (!state.haulLogStatus) return
    const status = state.haulLogStatus
    const button = $('btn-haullog-install')
    button.disabled =
      state.haulLogBusy || status.installing || !status.canInstall || status.gameRunning
    button.textContent =
      state.haulLogBusy || status.installing
        ? 'Installing HaulLog…'
        : status.appInstalled
          ? 'Reinstall HaulLog'
          : 'Install HaulLog'
    button.title = !status.gameReady
      ? 'Install ETS2 and re-detect its path first.'
      : status.gameRunning
        ? 'Close ETS2 first.'
        : 'Install in the selected Wine bottle.'
  }
  async function refreshHaulLogStatus() {
    const context = wineContextKey()
    try {
      const status = await api.getHaulLogStatus(state.settings)
      if (status.ok && context === wineContextKey()) {
        state.haulLogStatus = status
        setBadge('badge-haullog', status.appInstalled, status.version || '')
        renderHaulLogWidget()
      }
    } catch (err) {
      setHaulLogMessage(err.message, true)
    }
  }
  function wireHaulLogWidget() {
    $('btn-haullog-install').addEventListener('click', async () => {
      collect()
      state.haulLogBusy = true
      setHaulLogMessage('Downloading HaulLog…')
      renderHaulLogWidget()
      try {
        const result = await api.installHaulLog(state.settings)
        setHaulLogMessage(
          result.ok ? 'Finish setup in the HaulLog installer window.' : result.error,
          !result.ok
        )
      } catch (err) {
        setHaulLogMessage(err.message, true)
      } finally {
        state.haulLogBusy = false
        await refreshHaulLogStatus()
      }
    })
    api.onHaulLogProgress((data) => {
      const progress = $('haullog-progress')
      progress.classList.toggle('hidden', data.phase !== 'downloading')
      const pct = data.total ? Math.round((data.received / data.total) * 100) : 0
      progress.setAttribute('aria-valuenow', String(pct))
      $('haullog-progress-fill').style.width = pct + '%'
      const messages = {
        extracting: 'Preparing HaulLog…',
        launching: 'Opening HaulLog setup…',
        finished: 'Checking HaulLog installation…'
      }
      if (data.phase === 'error') setHaulLogMessage(data.message, true)
      else if (data.message || messages[data.phase])
        setHaulLogMessage(data.message || messages[data.phase])
      if (data.phase === 'finished' || data.phase === 'error') refreshHaulLogStatus()
    })
  }
  function setTruckerSVNMessage(message, error = false) {
    const el = $('truckersvn-message')
    el.textContent = message
    el.classList.toggle('hidden', !message)
    el.classList.toggle('error', error)
  }
  function renderTruckerSVNButton() {
    if (!state.truckersvnStatus) return
    const status = state.truckersvnStatus
    const button = $('btn-truckersvn')
    button.disabled = state.truckersvnBusy || status.installing || !status.canInstall
    button.textContent =
      state.truckersvnBusy || status.installing
        ? 'Setting up TruckerSVN…'
        : status.installed
          ? 'Open TruckerSVN Tool'
          : 'Install TruckerSVN Tool'
    button.title = status.installed
      ? 'Native macOS app · uses the selected Wine game and profiles.'
      : 'Install the native macOS TruckerSVN Tool.'
  }
  async function refreshTruckerSVNStatus() {
    const context = wineContextKey()
    try {
      const status = await api.getTruckerSVNStatus(state.settings)
      if (status.ok && context === wineContextKey()) {
        state.truckersvnStatus = status
        setBadge('badge-truckersvn', status.installed, status.version || '')
        renderTruckerSVNButton()
      }
    } catch (err) {
      setTruckerSVNMessage(err.message, true)
    }
  }
  function wireTruckerSVNButton() {
    $('btn-truckersvn').addEventListener('click', async () => {
      if (state.truckersvnBusy) return
      collect()
      const opening = !!state.truckersvnStatus?.ready
      state.truckersvnBusy = true
      setTruckerSVNMessage(opening ? 'Opening TruckerSVN Tool…' : 'Preparing TruckerSVN Tool…')
      renderTruckerSVNButton()
      try {
        const result = await (opening
          ? api.openTruckerSVN(state.settings)
          : api.installTruckerSVN(state.settings))
        if (!result.ok) throw new Error(result.error)
        setTruckerSVNMessage(
          opening
            ? result.message || 'Native TruckerSVN Tool opened.'
            : 'Installed. Click Open to connect TruckerSVN Tool to ETS2.'
        )
      } catch (err) {
        setTruckerSVNMessage(err.message, true)
      } finally {
        state.truckersvnBusy = false
        await refreshTruckerSVNStatus()
      }
    })
    api.onTruckerSVNProgress((data) => {
      const percentage = data.total
        ? ' ' + Math.round((data.received / data.total) * 100) + '%'
        : ''
      const message = data.message || 'Downloading TruckerSVN Tool…'
      setTruckerSVNMessage(
        message + (data.phase === 'downloading' ? percentage : ''),
        data.phase === 'error'
      )
      if (data.phase === 'error' || data.phase === 'finished') refreshTruckerSVNStatus()
    })
  }
  function wire() {
    wireHaulLogWidget()
    wireTruckerSVNButton()
  }
  async function refresh() {
    await Promise.all([refreshHaulLogStatus(), refreshTruckerSVNStatus()])
  }
  return {
    wire,
    refresh,
    refreshHaulLogStatus,
    refreshTruckerSVNStatus,
    renderHaulLogWidget,
    renderTruckerSVNButton
  }
}
