import { createState } from './state.js'
import { createUI } from './ui.js'
import { createGameController } from './game.js'
import { createSteamController } from './steam.js'
import { createCompanionController } from './companions.js'
import { createSettingsController } from './settings.js'
import { createSetupWizard } from './setup-wizard.js'

export function createRenderer({ api, document }) {
  const state = createState()
  const ui = createUI(document, state)
  const timers = []
  let settings, game, steam, companions, wizard
  const updateButtons = () => {
    game?.updateLaunchBtn()
    steam?.updateSteamBtn()
  }
  const refreshServices = async () => {
    await Promise.all([
      settings.refreshDetection(),
      steam.refreshSteamStatus(),
      companions.refresh(),
      wizard?.refresh()
    ])
  }
  settings = createSettingsController({ state, ui, api, updateButtons, refreshServices })
  const collect = () => settings.collect()
  const wineContextKey = () => settings.wineContextKey()
  steam = createSteamController({ state, ui, api, collect, wineContextKey })
  companions = createCompanionController({ state, ui, api, collect, wineContextKey })
  game = createGameController({
    state,
    ui,
    api,
    collect,
    refreshHaulLogStatus: () => companions.refreshHaulLogStatus()
  })

  async function init() {
    state.settings = await api.loadSettings()
    state.detected = await api.detectPaths()
    for (const key of ['cliPath', 'winePath', 'bottlePath', 'steamDir', 'gameDir'])
      if (!state.settings[key] && state.detected[key]) state.settings[key] = state.detected[key]
    settings.populatePaths()
    ui.$('s-retina-mode').checked = !!state.settings.standalonRetinaMode
    ui.$('s-metal-hud-sw').checked = !!state.settings.metalHud
    settings.wire()
    steam.wire()
    game.wire()
    companions.wire()
    wizard = createSetupWizard({ state, ui, api, settingsController: settings, updateButtons })
    if (state.settings.wineMode === 'standalone')
      await settings.detectStandaloneBottlePaths(state.settings.standalonBottlePath)
    await settings.applyWineMode(state.settings.wineMode)
    timers.push(
      setInterval(() => {
        if (!document.hidden) steam.refreshSteamStatus()
      }, 5000)
    )
    timers.push(
      setInterval(() => {
        if (!document.hidden) companions.refresh()
      }, 10000)
    )
    document.addEventListener('visibilitychange', onVisible)
  }
  function onVisible() {
    if (!document.hidden) refreshServices().catch((error) => ui.showMessage(error.message, true))
  }
  function dispose() {
    timers.forEach(clearInterval)
    document.removeEventListener('visibilitychange', onVisible)
  }
  return {
    init,
    dispose,
    state,
    ui,
    game,
    steam,
    companions,
    settings,
    get wizard() {
      return wizard
    }
  }
}
