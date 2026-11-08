export function createSettingsController({ state, ui, api, updateButtons, refreshServices }) {
  const { $, getField, fillField, setBadge, showMessage } = ui
  function collect() {
    for (const [id, key] of Object.entries({
      's-cli': 'cliPath',
      's-wine': 'winePath',
      's-bottle': 'bottlePath',
      's-steam': 'steamDir',
      's-game': 'gameDir',
      'sw-bottle-path': 'standalonBottlePath',
      'sw-steam-dir': 'standalonSteamDir',
      'sw-game-dir': 'standalonGameDir'
    }))
      if ($(id)) state.settings[key] = getField(id)
    state.settings.metalHud = $('s-metal-hud-sw').checked
    state.settings.standalonRetinaMode = $('s-retina-mode').checked
  }
  function populatePaths() {
    for (const [id, key] of Object.entries({
      's-cli': 'cliPath',
      's-wine': 'winePath',
      's-bottle': 'bottlePath',
      's-steam': 'steamDir',
      's-game': 'gameDir',
      'sw-bottle-path': 'standalonBottlePath',
      'sw-steam-dir': 'standalonSteamDir',
      'sw-game-dir': 'standalonGameDir'
    }))
      fillField(id, state.settings[key])
  }
  function activePaths() {
    const standalone = state.settings.wineMode === 'standalone'
    return {
      bottle: standalone ? state.settings.standalonBottlePath : state.settings.bottlePath,
      steam: standalone ? state.settings.standalonSteamDir : state.settings.steamDir,
      game: standalone ? state.settings.standalonGameDir : state.settings.gameDir
    }
  }
  async function refreshDetection() {
    const context = wineContextKey()
    const paths = activePaths()
    const exists = (value) => (value ? api.pathExists(value) : Promise.resolve(false))
    const standalone = state.settings.wineMode === 'standalone'
    const [cli, wine, bottle, steam, game] = await Promise.all([
      exists(state.settings.cliPath),
      standalone
        ? api.swGetStatus().then((st) => st.wineInstalled)
        : exists(state.settings.winePath),
      exists(paths.bottle && paths.bottle + '/drive_c'),
      exists(paths.steam && paths.steam + '/steam.exe'),
      exists(paths.game && paths.game + '/bin/win_x64/eurotrucks2.exe')
    ])
    if (context !== wineContextKey()) return
    state.readiness = { cli, wine, bottle, steam, game }
    setBadge('badge-cli', cli)
    setBadge('badge-crossover', wine)
    setBadge('badge-steam', steam)
    setBadge('badge-game', game)
    updateButtons()
  }

  async function detectStandaloneBottlePaths(bottlePath) {
    if (!bottlePath) return
    const results = await Promise.allSettled([
      api.swAutoDetectSteamPath(bottlePath),
      api.swAutoDetectGamePath(bottlePath)
    ])
    let changed = false
    for (const [index, key, field, resultKey] of [
      [0, 'standalonSteamDir', 'sw-steam-dir', 'steamDir'],
      [1, 'standalonGameDir', 'sw-game-dir', 'gameDir']
    ]) {
      const result = results[index]
      if (!state.settings[key] && result.status === 'fulfilled' && result.value.ok) {
        state.settings[key] = result.value[resultKey]
        fillField(field, state.settings[key])
        changed = true
      }
    }
    if (changed) await api.saveSettings(state.settings)
    if (state.settings.wineMode === 'standalone') {
      setBadge('badge-steam', !!state.settings.standalonSteamDir)
      setBadge('badge-game', !!state.settings.standalonGameDir)
      updateButtons()
    }
  }
  function wineContextKey() {
    return JSON.stringify([
      state.settings.wineMode,
      state.settings.standalonBottlePath,
      state.settings.bottlePath,
      state.settings.standalonSteamDir,
      state.settings.steamDir,
      state.settings.standalonGameDir,
      state.settings.gameDir
    ])
  }

  async function redetectPaths() {
    const button = $('btn-detect')
    button.disabled = true
    button.textContent = 'Detecting…'
    try {
      state.detected = await api.detectPaths()
      if (state.detected.cliPath) {
        state.settings.cliPath = state.detected.cliPath
        fillField('s-cli', state.settings.cliPath)
      }
      if (state.settings.wineMode === 'standalone') {
        await detectStandaloneBottlePaths(state.settings.standalonBottlePath)
      } else {
        for (const key of ['winePath', 'bottlePath', 'steamDir', 'gameDir'])
          if (!state.settings[key] && state.detected[key]) state.settings[key] = state.detected[key]
        populatePaths()
      }
      await api.saveSettings(state.settings)
      await refreshDetection()
      await refreshServices()
    } catch (err) {
      showMessage(err.message, true)
    } finally {
      button.disabled = false
      button.textContent = 'Re-detect'
    }
  }
  function wire() {
    $('btn-header-settings').addEventListener('click', () => $('panel-settings').showModal())
    $('close-settings-popup').addEventListener('click', () => $('panel-settings').close())
    $('btn-save').addEventListener('click', async () => {
      collect()
      try {
        await api.saveSettings(state.settings)
        await refreshDetection()
        await refreshServices()
        $('panel-settings').close()
        showMessage('Paths saved.')
      } catch (err) {
        showMessage(err.message, true)
      }
    })
    $('btn-detect').addEventListener('click', redetectPaths)
    $('btn-clear-log').addEventListener('click', () => {
      state.logs = []
      $('log-body').textContent = ''
    })
    for (const button of ui.document.querySelectorAll('.s-browse')) {
      button.addEventListener('click', async () => {
        const result = await api.browse({ folder: button.dataset.folder === 'true' })
        if (result) fillField(button.dataset.target, result)
      })
    }
    $('s-metal-hud-sw').addEventListener('change', async () => {
      state.settings.metalHud = $('s-metal-hud-sw').checked
      await api.saveSettings(state.settings)
    })
    $('s-retina-mode').addEventListener('change', async () => {
      state.settings.standalonRetinaMode = $('s-retina-mode').checked
      try {
        const result = await api.swSetRetinaMode(
          state.settings.standalonBottlePath,
          state.settings.standalonRetinaMode
        )
        if (!result.ok) throw new Error(result.error)
        await api.saveSettings(state.settings)
      } catch (err) {
        showMessage(err.message, true)
      }
    })
    for (const [id, mode] of [
      ['cwt-cx', 'crossover'],
      ['cwt-sw', 'standalone']
    ])
      $(id).addEventListener('click', async () => {
        applyWineMode(mode)
        collect()
        await api.saveSettings(state.settings)
      })
    ui.document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        $('panel-settings').showModal()
      }
    })
  }
  function applyWineMode(mode) {
    state.settings.wineMode = mode === 'standalone' ? 'standalone' : 'crossover'
    const standalone = state.settings.wineMode === 'standalone'
    for (const [id, active] of [
      ['cwt-cx', !standalone],
      ['cwt-sw', standalone]
    ]) {
      $(id).classList.toggle('active', active)
      $(id).setAttribute('aria-pressed', String(active))
    }
    $('cx-paths').classList.toggle('hidden', standalone)
    $('wm-standalone-paths').classList.toggle('hidden', !standalone)
    $('s-retina-mode').disabled = !standalone
    $('det-label-wine').textContent = standalone ? 'Standalone Wine' : 'CrossOver Wine'
    $('wine-card-badge').textContent = standalone ? 'Wine 11.11' : ''
    $('wine-card-badge').classList.toggle('hidden', !standalone)
    return refreshServices().catch((error) => showMessage(error.message, true))
  }
  return {
    wire,
    collect,
    populatePaths,
    activePaths,
    refreshDetection,
    detectStandaloneBottlePaths,
    wineContextKey,
    applyWineMode,
    redetectPaths
  }
}
