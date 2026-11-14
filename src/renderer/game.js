export function createGameController({ state, ui, api, collect, refreshHaulLogStatus }) {
  const { $, setStatus, showMessage, pushLog } = ui
  function setGameLaunchPhase(phase, pid = state.gameLaunchPid) {
    state.gameLaunchPhase = phase
    state.gameLaunchPid = phase === 'idle' ? null : pid
    $('game-startup').classList.toggle('hidden', phase === 'idle')
    if (phase === 'initializing') {
      setStatus('Initializing ETS2 MP…', 'launching', state.gameLaunchPid)
      $('game-startup-text').textContent =
        'Initializing ETS2 MP… Downloads and setup can take several minutes, especially on first launch. Please wait before stopping or restarting.'
    } else if (phase === 'started') {
      setStatus('ETS2 MP launched', 'running', state.gameLaunchPid)
      $('game-startup-text').textContent =
        'ETS2 MP has been launched. The game window may take a while to appear. Check Log below for progress before restarting.'
    }
  }
  function updateGameLaunchProgress(entry) {
    // This is emitted by truckersmp-cli after downloads finish, before it
    // starts Wine. It confirms a launch attempt, not a fully loaded game.
    if (state.gameLaunchPhase !== 'initializing' || entry.cat !== 'wine') return
    const text = (entry.text || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim()
    if (/^\*\*\s*INFO\s*\*\*\s+Starting game\s*$/i.test(text)) setGameLaunchPhase('started')
  }
  async function launchOrStopGame() {
    if (state.launching) return
    if (state.running) {
      setStatus('Stopping…', 'stopping')
      try {
        await api.stopGame()
      } catch (err) {
        pushLog({ kind: 'error', text: err.message })
      }
      return
    }
    collect()
    const request = ++state.gameLaunchRequest
    state.launching = true
    showMessage('')
    setGameLaunchPhase('initializing', null)
    updateLaunchBtn()
    try {
      const result = await api.launchGame(state.settings)
      if (request !== state.gameLaunchRequest) return
      if (!result.ok) throw new Error(result.error)
      state.running = true
      setGameLaunchPhase(state.gameLaunchPhase, result.pid)
    } catch (err) {
      if (request !== state.gameLaunchRequest) return
      state.running = false
      setGameLaunchPhase('idle')
      setStatus('Launch failed', 'error')
      pushLog({ kind: 'error', text: err.message })
    } finally {
      if (request === state.gameLaunchRequest) {
        state.launching = false
        updateLaunchBtn()
        refreshHaulLogStatus()
      }
    }
  }
  function updateLaunchBtn() {
    const button = $('btn-launch')
    const ready = Object.values(state.readiness).every(Boolean)
    button.disabled = state.launching || (!state.running && !ready)
    button.classList.toggle('stop', state.running)
    button.textContent = state.launching
      ? 'Launching…'
      : state.running
        ? 'Stop ETS2 MP'
        : 'Launch ETS2 MP'
    const warning = $('launch-warn')
    warning.classList.toggle('hidden', ready || state.running || state.launching)
    warning.textContent =
      !state.readiness.wine || !state.readiness.bottle
        ? 'Configure Wine in Settings.'
        : !state.readiness.cli
          ? 'Set the truckersmp-cli path in Settings.'
          : !state.readiness.steam
            ? 'Install Steam in the selected bottle.'
            : 'Install ETS2 in Steam, then click Re-detect.'
  }

  function wire() {
    ui.onLogEntry = updateGameLaunchProgress
    $('btn-launch').addEventListener('click', launchOrStopGame)
    $('btn-game-documents').addEventListener('click', async () => {
      collect()
      try {
        const result = await api.openGameDocuments(state.settings)
        if (!result.ok) throw new Error(result.error)
      } catch (err) {
        showMessage(err.message, true)
        pushLog({ kind: 'error', text: err.message })
      }
    })
    $('btn-startup-log').addEventListener('click', () => {
      const log = $('log-details')
      log.open = true
      log.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      log.querySelector('summary').focus({ preventScroll: true })
    })
    api.onLog(pushLog)
    api.onGameStopped(({ code }) => {
      ++state.gameLaunchRequest
      state.running = false
      state.launching = false
      setGameLaunchPhase('idle')
      setStatus(code === 0 ? 'Stopped' : 'Game exited', code === 0 ? 'idle' : 'error')
      if (code !== 0) {
        $('log-details').open = true
        // Spawn errors already provide a more specific message via onLog.
        if (code !== -1 || !$('action-message').textContent)
          showMessage(`ETS2 MP exited with code ${code}. Open Log for details.`, true)
      }
      updateLaunchBtn()
      refreshHaulLogStatus()
    })
  }
  return { wire, updateLaunchBtn, setGameLaunchPhase, updateGameLaunchProgress, launchOrStopGame }
}
