class Element {
  constructor() {
    this.textContent = ''
    this.value = ''
    this.checked = false
    this.style = {}
    this.dataset = {}
    this.open = false
    this.listeners = new Map()
    this.classList = {
      toggle(name, value) {
        this[name] = value === undefined ? !this[name] : value
        return this[name]
      },
      add(...names) {
        names.forEach((name) => {
          this[name] = true
        })
      },
      remove(...names) {
        names.forEach((name) => {
          this[name] = false
        })
      },
      contains(name) {
        return !!this[name]
      }
    }
  }
  addEventListener(name, callback) {
    this.listeners.set(name, callback)
  }
  async click() {
    return this.listeners.get('click')?.({ preventDefault() {} })
  }
  setAttribute(name, value) {
    this[name] = value
  }
  querySelector() {
    return this
  }
  querySelectorAll() {
    return []
  }
  showModal() {
    this.open = true
  }
  close() {
    this.open = false
  }
  focus() {}
  scrollIntoView() {}
}
async function rendererFixture(overrides = {}) {
  const [
    { createState },
    { createUI },
    { createGameController },
    { createSettingsController },
    { createSteamController },
    { createCompanionController }
  ] = await Promise.all([
    import('../../src/renderer/state.js'),
    import('../../src/renderer/ui.js'),
    import('../../src/renderer/game.js'),
    import('../../src/renderer/settings.js'),
    import('../../src/renderer/steam.js'),
    import('../../src/renderer/companions.js')
  ])
  const fields = new Proxy(
    {},
    {
      get(target, key) {
        return (target[key] ||= new Element())
      }
    }
  )
  const document = {
    getElementById: (id) => fields[id],
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  }
  const state = createState(),
    ui = createUI(document, state),
    callbacks = {}
  const api = {
    saveSettings: async () => {},
    onLog: (fn) => {
      callbacks.log = fn
    },
    onGameStopped: (fn) => {
      callbacks.stopped = fn
    },
    onSteamStopped() {},
    onSteamRestarting() {},
    onSteamReady() {},
    ...overrides
  }
  let game, steam
  const settings = createSettingsController({
    state,
    ui,
    api,
    updateButtons: () => {
      game?.updateLaunchBtn()
      steam?.updateSteamBtn()
    },
    refreshServices: async () => {}
  })
  const shared = {
    state,
    ui,
    api,
    collect: settings.collect,
    wineContextKey: settings.wineContextKey
  }
  const companions = createCompanionController(shared)
  game = createGameController({ ...shared, refreshHaulLogStatus: async () => {} })
  steam = createSteamController(shared)
  return { fields, document, state, ui, api, settings, game, steam, companions, callbacks }
}
module.exports = { rendererFixture, Element }
