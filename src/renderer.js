'use strict'

let settings = {}, detected = {}, running = false, launching = false
let gameLaunchPhase = 'idle', gameLaunchPid = null, gameLaunchRequest = 0
let steamRunning = false, steamOperation = false, steamStatusBusy = false
let haulLogStatus = null, haulLogBusy = false
let truckersvnStatus = null, truckersvnBusy = false
let readiness = {wine:false, cli:false, steam:false, game:false, bottle:false}
let logs = []
const $ = id => document.getElementById(id)
const STEAM_ICON_SVG = '<img src="logo2.png" class="button-icon" alt=""/>'
const dbg = message => console.log('[Launcher]', message)
const getField = id => $(id)?.value.trim() || ''
function fillField(id, value) { if ($(id)) $(id).value = value || '' }
function setBadge(id, found, version) {
  const badge = $(id)
  if (!badge) return
  badge.textContent = !found ? 'Not found' : version === undefined ? 'Found' : version ? 'v' + version : 'Found · version unknown'
  badge.className = 'det-badge ' + (found ? 'found' : 'missing')
}
function setStatus(label, state, pid) {
  $('status-label').textContent = label
  $('status-dot').className = 'status-dot ' + state
  $('status-pid').textContent = pid ? 'PID ' + pid : ''
}
function showMessage(message, error = false) {
  const el = $('action-message')
  el.textContent = message
  el.classList.toggle('hidden', !message)
  el.classList.toggle('error', error)
}
function pushLog(entry) {
  updateGameLaunchProgress(entry)
  const line = `${new Date(entry.ts || Date.now()).toLocaleTimeString()} ${entry.text || ''}`
  logs.push(line)
  if (logs.length > 400) logs.shift()
  const body = $('log-body')
  body.textContent = logs.join('\n')
  body.scrollTop = body.scrollHeight
  if (entry.kind === 'error' && entry.cat !== 'wine') {
    $('log-details').open = true
    showMessage(entry.text, true)
  }
}
function setGameLaunchPhase(phase, pid = gameLaunchPid) {
  gameLaunchPhase = phase
  gameLaunchPid = phase === 'idle' ? null : pid
  $('game-startup').classList.toggle('hidden', phase === 'idle')
  if (phase === 'initializing') {
    setStatus('Initializing ETS2 MP…', 'launching', gameLaunchPid)
    $('game-startup-text').textContent = 'Initializing ETS2 MP… Downloads and setup can take several minutes, especially on first launch. Please wait before stopping or restarting.'
  } else if (phase === 'started') {
    setStatus('ETS2 MP launched', 'running', gameLaunchPid)
    $('game-startup-text').textContent = 'ETS2 MP has been launched. The game window may take a while to appear. Check Log below for progress before restarting.'
  }
}
function updateGameLaunchProgress(entry) {
  // This is emitted by truckersmp-cli after downloads finish, before it
  // starts Wine. It confirms a launch attempt, not a fully loaded game.
  if (gameLaunchPhase !== 'initializing' || entry.cat !== 'wine') return
  const text = (entry.text || '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim()
  if (/^\*\*\s*INFO\s*\*\*\s+Starting game\s*$/i.test(text)) setGameLaunchPhase('started')
}
async function launchOrStopGame() {
  if (launching) return
  if (running) {
    setStatus('Stopping…', 'stopping')
    try { await window.api.stopGame() }
    catch (err) { pushLog({kind:'error', text:err.message}) }
    return
  }
  collect()
  const request = ++gameLaunchRequest
  launching = true
  showMessage('')
  setGameLaunchPhase('initializing', null)
  updateLaunchBtn()
  try {
    const result = await window.api.launchGame(settings)
    if (request !== gameLaunchRequest) return
    if (!result.ok) throw new Error(result.error)
    running = true
    setGameLaunchPhase(gameLaunchPhase, result.pid)
  } catch (err) {
    if (request !== gameLaunchRequest) return
    running = false
    setGameLaunchPhase('idle')
    setStatus('Launch failed', 'error')
    pushLog({kind:'error', text:err.message})
  } finally {
    if (request === gameLaunchRequest) {
      launching = false
      updateLaunchBtn()
      refreshHaulLogStatus()
    }
  }
}
function collect() {
  for (const [id, key] of Object.entries({
    's-cli':'cliPath', 's-wine':'winePath', 's-bottle':'bottlePath', 's-steam':'steamDir', 's-game':'gameDir',
    'sw-bottle-path':'standalonBottlePath', 'sw-steam-dir':'standalonSteamDir', 'sw-game-dir':'standalonGameDir',
  })) if ($(id)) settings[key] = getField(id)
  settings.metalHud = $('s-metal-hud-sw').checked
  settings.standalonRetinaMode = $('s-retina-mode').checked
}
function populatePaths() {
  for (const [id, key] of Object.entries({
    's-cli':'cliPath', 's-wine':'winePath', 's-bottle':'bottlePath', 's-steam':'steamDir', 's-game':'gameDir',
    'sw-bottle-path':'standalonBottlePath', 'sw-steam-dir':'standalonSteamDir', 'sw-game-dir':'standalonGameDir',
  })) fillField(id, settings[key])
}
function activePaths() {
  const standalone = settings.wineMode === 'standalone'
  return {
    bottle:standalone ? settings.standalonBottlePath : settings.bottlePath,
    steam:standalone ? settings.standalonSteamDir : settings.steamDir,
    game:standalone ? settings.standalonGameDir : settings.gameDir,
  }
}
async function refreshDetection() {
  const context = wineContextKey()
  const paths = activePaths()
  const exists = value => value ? window.api.pathExists(value) : Promise.resolve(false)
  const standalone = settings.wineMode === 'standalone'
  const [cli, wine, bottle, steam, game] = await Promise.all([
    exists(settings.cliPath),
    standalone ? window.api.swGetStatus().then(st => st.wineInstalled) : exists(settings.winePath),
    exists(paths.bottle && paths.bottle + '/drive_c'),
    exists(paths.steam && paths.steam + '/steam.exe'),
    exists(paths.game && paths.game + '/bin/win_x64/eurotrucks2.exe'),
  ])
  if (context !== wineContextKey()) return
  readiness = {cli, wine, bottle, steam, game}
  setBadge('badge-cli', cli)
  setBadge('badge-crossover', wine)
  setBadge('badge-steam', steam)
  setBadge('badge-game', game)
  updateLaunchBtn()
  updateSteamBtn()
}

async function detectStandaloneBottlePaths(bottlePath) {
  if (!bottlePath) return
  const results = await Promise.allSettled([
    window.api.swAutoDetectSteamPath(bottlePath),
    window.api.swAutoDetectGamePath(bottlePath),
  ])
  let changed = false
  for (const [index, key, field, resultKey] of [
    [0, 'standalonSteamDir', 'sw-steam-dir', 'steamDir'],
    [1, 'standalonGameDir', 'sw-game-dir', 'gameDir'],
  ]) {
    const result = results[index]
    if (!settings[key] && result.status === 'fulfilled' && result.value.ok) {
      settings[key] = result.value[resultKey]
      fillField(field, settings[key])
      changed = true
    }
  }
  if (changed) await window.api.saveSettings(settings)
  if (settings.wineMode === 'standalone') {
    setBadge('badge-steam', !!settings.standalonSteamDir)
    setBadge('badge-game', !!settings.standalonGameDir)
    updateSteamBtn()
    updateLaunchBtn()
  }
}

// ── Steam Button ──────────────────────────────────────────────────────────────
function updateSteamBtn() {
  const btn=$('btn-steam'); if(!btn) return
  const isStandalone = settings.wineMode === 'standalone'
  // Simple rule: light up if the relevant steam directory is known, grey if not.
  const ready = isStandalone
    ? !!settings.standalonSteamDir
    : !!(settings.steamDir || detected.steamDir)
  btn.disabled = !steamRunning && !ready
  if (steamRunning) {
    btn.classList.add('steam-running')
  } else {
    btn.classList.remove('steam-running')
  }
  btn.innerHTML = STEAM_ICON_SVG + (steamRunning ? 'Steam Running · Stop' : 'Start Steam')
}

function wineContextKey() {
  return JSON.stringify([settings.wineMode, settings.standalonBottlePath, settings.bottlePath, settings.standalonSteamDir, settings.steamDir, settings.standalonGameDir, settings.gameDir])
}

async function refreshSteamStatus() {
  if (steamOperation || steamStatusBusy) return
  steamStatusBusy = true
  const context = wineContextKey()
  try {
    const status = await window.api.getSteamStatus(settings)
    if (status.ok && !steamOperation && context === wineContextKey()) {
      steamRunning = status.running
      updateSteamBtn()
    }
  } catch (err) { dbg('Steam status check failed: ' + err.message) }
  finally { steamStatusBusy = false }
}

function setHaulLogMessage(message, error = false) {
  const el = $('haullog-message')
  if (!el) return
  el.textContent = message
  el.classList.toggle('hidden', !message)
  el.classList.toggle('error', error)
}
function renderHaulLogWidget() {
  if (!haulLogStatus) return
  const status = haulLogStatus
  const button = $('btn-haullog-install')
  button.disabled = haulLogBusy || status.installing || !status.canInstall || status.gameRunning
  button.textContent = haulLogBusy || status.installing ? 'Installing HaulLog…' : status.appInstalled ? 'Reinstall HaulLog' : 'Install HaulLog'
  button.title = !status.gameReady ? 'Install ETS2 and re-detect its path first.' : status.gameRunning ? 'Close ETS2 first.' : 'Install in the selected Wine bottle.'
}
async function refreshHaulLogStatus() {
  const context = wineContextKey()
  try {
    const status = await window.api.getHaulLogStatus(settings)
    if (status.ok && context === wineContextKey()) {
      haulLogStatus = status
      setBadge('badge-haullog', status.appInstalled, status.version || '')
      renderHaulLogWidget()
    }
  } catch (err) { setHaulLogMessage(err.message, true) }
}
function wireHaulLogWidget() {
  $('btn-haullog-install').addEventListener('click', async () => {
    collect()
    haulLogBusy = true
    setHaulLogMessage('Downloading HaulLog…')
    renderHaulLogWidget()
    try {
      const result = await window.api.installHaulLog(settings)
      setHaulLogMessage(result.ok ? 'Finish setup in the HaulLog installer window.' : result.error, !result.ok)
    } catch (err) { setHaulLogMessage(err.message, true) }
    finally { haulLogBusy = false; await refreshHaulLogStatus() }
  })
  window.api.onHaulLogProgress(data => {
    const progress = $('haullog-progress')
    progress.classList.toggle('hidden', data.phase !== 'downloading')
    const pct = data.total ? Math.round(data.received / data.total * 100) : 0
    progress.setAttribute('aria-valuenow', String(pct))
    $('haullog-progress-fill').style.width = pct + '%'
    const messages = {extracting:'Preparing HaulLog…', launching:'Opening HaulLog setup…', finished:'Checking HaulLog installation…'}
    if (data.phase === 'error') setHaulLogMessage(data.message, true)
    else if (data.message || messages[data.phase]) setHaulLogMessage(data.message || messages[data.phase])
    if (data.phase === 'finished' || data.phase === 'error') refreshHaulLogStatus()
  })
}
function updateLaunchBtn() {
  const button = $('btn-launch')
  const ready = Object.values(readiness).every(Boolean)
  button.disabled = launching || (!running && !ready)
  button.classList.toggle('stop', running)
  button.textContent = launching ? 'Launching…' : running ? 'Stop ETS2 MP' : 'Launch ETS2 MP'
  const warning = $('launch-warn')
  warning.classList.toggle('hidden', ready || running || launching)
  warning.textContent = !readiness.wine || !readiness.bottle ? 'Configure Wine in Settings.'
    : !readiness.cli ? 'Set the truckersmp-cli path in Settings.'
      : !readiness.steam ? 'Install Steam in the selected bottle.'
        : 'Install ETS2 in Steam, then click Re-detect.'
}

function setTruckerSVNMessage(message, error = false) {
  const el = $('truckersvn-message')
  el.textContent = message
  el.classList.toggle('hidden', !message)
  el.classList.toggle('error', error)
}
function renderTruckerSVNButton() {
  if (!truckersvnStatus) return
  const status = truckersvnStatus
  const button = $('btn-truckersvn')
  button.disabled = truckersvnBusy || status.installing || !status.canInstall
  button.textContent = truckersvnBusy || status.installing ? 'Setting up TruckerSVN…'
    : status.installed ? 'Open TruckerSVN Tool' : 'Install TruckerSVN Tool'
  button.title = status.installed ? 'Native macOS app · uses the selected Wine game and profiles.' : 'Install the native macOS TruckerSVN Tool.'
}
async function refreshTruckerSVNStatus() {
  const context = wineContextKey()
  try {
    const status = await window.api.getTruckerSVNStatus(settings)
    if (status.ok && context === wineContextKey()) {
      truckersvnStatus = status
      setBadge('badge-truckersvn', status.installed, status.version || '')
      renderTruckerSVNButton()
    }
  } catch (err) { setTruckerSVNMessage(err.message, true) }
}
function wireTruckerSVNButton() {
  $('btn-truckersvn').addEventListener('click', async () => {
    if (truckersvnBusy) return
    collect()
    const opening = !!truckersvnStatus?.ready
    truckersvnBusy = true
    setTruckerSVNMessage(opening ? 'Opening TruckerSVN Tool…' : 'Preparing TruckerSVN Tool…')
    renderTruckerSVNButton()
    try {
      const result = await (opening ? window.api.openTruckerSVN(settings) : window.api.installTruckerSVN(settings))
      if (!result.ok) throw new Error(result.error)
      setTruckerSVNMessage(opening ? result.message || 'Native TruckerSVN Tool opened.'
        : 'Installed. Click Open to connect TruckerSVN Tool to ETS2.')
    } catch (err) { setTruckerSVNMessage(err.message, true) }
    finally { truckersvnBusy = false; await refreshTruckerSVNStatus() }
  })
  window.api.onTruckerSVNProgress(data => {
    const percentage = data.total ? ' ' + Math.round(data.received / data.total * 100) + '%' : ''
    const message = data.message || 'Downloading TruckerSVN Tool…'
    setTruckerSVNMessage(message + (data.phase === 'downloading' ? percentage : ''), data.phase === 'error')
    if (data.phase === 'error' || data.phase === 'finished') refreshTruckerSVNStatus()
  })
}
function swApplyWineMode(mode) {
  settings.wineMode = mode === 'standalone' ? 'standalone' : 'crossover'
  const standalone = settings.wineMode === 'standalone'
  for (const [id, active] of [['cwt-cx', !standalone], ['cwt-sw', standalone]]) {
    const button = $(id)
    button.classList.toggle('active', active)
    button.setAttribute('aria-pressed', String(active))
  }
  $('cx-paths').classList.toggle('hidden', standalone)
  $('wm-standalone-paths').classList.toggle('hidden', !standalone)
  $('s-retina-mode').disabled = !standalone
  $('det-label-wine').textContent = standalone ? 'Standalone Wine' : 'CrossOver Wine'
  const badge = $('wine-card-badge')
  badge.textContent = standalone ? 'Wine 11.11' : ''
  badge.classList.toggle('hidden', !standalone)
  refreshDetection().catch(err => showMessage(err.message, true))
  refreshSteamStatus()
  refreshHaulLogStatus()
  refreshTruckerSVNStatus()
  window._swRefreshStatusBadges?.()
}
async function redetectPaths() {
  const button = $('btn-detect')
  button.disabled = true
  button.textContent = 'Detecting…'
  try {
    detected = await window.api.detectPaths()
    if (detected.cliPath) { settings.cliPath = detected.cliPath; fillField('s-cli', settings.cliPath) }
    if (settings.wineMode === 'standalone') {
      await detectStandaloneBottlePaths(settings.standalonBottlePath)
    } else {
      for (const key of ['winePath', 'bottlePath', 'steamDir', 'gameDir'])
        if (!settings[key] && detected[key]) settings[key] = detected[key]
      populatePaths()
    }
    await window.api.saveSettings(settings)
    await refreshDetection()
    await refreshHaulLogStatus()
    await refreshTruckerSVNStatus()
    await refreshSteamStatus()
  } catch (err) { showMessage(err.message, true) }
  finally { button.disabled = false; button.textContent = 'Re-detect' }
}
function wireEvents() {
  $('btn-header-settings').addEventListener('click', () => $('panel-settings').showModal())
  $('close-settings-popup').addEventListener('click', () => $('panel-settings').close())
  $('btn-save').addEventListener('click', async () => {
    collect()
    try {
      await window.api.saveSettings(settings)
      await refreshDetection()
      await refreshHaulLogStatus()
      await refreshTruckerSVNStatus()
      $('panel-settings').close()
      showMessage('Paths saved.')
    } catch (err) { showMessage(err.message, true) }
  })
  $('btn-detect').addEventListener('click', redetectPaths)
  $('btn-clear-log').addEventListener('click', () => { logs = []; $('log-body').textContent = '' })
  for (const button of document.querySelectorAll('.s-browse')) {
    button.addEventListener('click', async () => {
      const result = await window.api.browse({folder:button.dataset.folder === 'true'})
      if (result) fillField(button.dataset.target, result)
    })
  }
  $('s-metal-hud-sw').addEventListener('change', async () => {
    settings.metalHud = $('s-metal-hud-sw').checked
    await window.api.saveSettings(settings)
  })
  $('s-retina-mode').addEventListener('change', async () => {
    settings.standalonRetinaMode = $('s-retina-mode').checked
    try {
      const result = await window.api.swSetRetinaMode(settings.standalonBottlePath, settings.standalonRetinaMode)
      if (!result.ok) throw new Error(result.error)
      await window.api.saveSettings(settings)
    } catch (err) { showMessage(err.message, true) }
  })
  $('btn-steam').addEventListener('click', async () => {
    if (steamOperation) return
    collect()
    const wasRunning = steamRunning
    steamOperation = true
    const button = $('btn-steam')
    button.disabled = true
    button.textContent = steamRunning ? 'Stopping Steam…' : 'Starting Steam…'
    try {
      const result = await (wasRunning ? window.api.stopSteam(settings) : window.api.startSteam(settings))
      if (!result.ok) throw new Error(result.error)
      steamRunning = !wasRunning
      updateSteamBtn()
    } catch (err) { showMessage(err.message, true); pushLog({kind:'error', text:err.message}) }
    finally { steamOperation = false; await refreshSteamStatus(); updateSteamBtn() }
  })
  $('btn-launch').addEventListener('click', launchOrStopGame)
  $('btn-startup-log').addEventListener('click', () => {
    const log = $('log-details')
    log.open = true
    log.scrollIntoView({behavior:'smooth', block:'nearest'})
    log.querySelector('summary').focus({preventScroll:true})
  })
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === ',') {
      event.preventDefault(); $('panel-settings').showModal()
    }
  })
}
function wireIPC() {
  window.api.onLog(pushLog)
  window.api.onGameStopped(({code}) => {
    ++gameLaunchRequest
    running = false; launching = false
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
  window.api.onSteamStopped(() => { steamRunning = false; updateSteamBtn(); refreshSteamStatus() })
  window.api.onSteamRestarting(() => refreshSteamStatus())
  window.api.onSteamReady(() => refreshSteamStatus())
}
async function init() {
  settings = await window.api.loadSettings()
  detected = await window.api.detectPaths()
  for (const key of ['cliPath', 'winePath', 'bottlePath', 'steamDir', 'gameDir'])
    if (!settings[key] && detected[key]) settings[key] = detected[key]
  populatePaths()
  $('s-retina-mode').checked = !!settings.standalonRetinaMode
  $('s-metal-hud-sw').checked = !!settings.metalHud
  wireEvents()
  wireIPC()
  wireHaulLogWidget()
  wireTruckerSVNButton()
  if (settings.wineMode === 'standalone') await detectStandaloneBottlePaths(settings.standalonBottlePath)
  swApplyWineMode(settings.wineMode || 'crossover')
  await refreshDetection()
  await refreshSteamStatus()
  await refreshHaulLogStatus()
  await refreshTruckerSVNStatus()
  setInterval(() => { if (!document.hidden) refreshSteamStatus() }, 5000)
  setInterval(() => {
    if (!document.hidden) { refreshHaulLogStatus(); refreshTruckerSVNStatus() }
  }, 10000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { refreshSteamStatus(); refreshHaulLogStatus(); refreshTruckerSVNStatus() }
  })
}

// ── Standalone Wine Setup Wizard ───────────────────────────────────────────────
;(function() {
  const wizard    = $('sw-wizard'); if (!wizard) return
  let swRelease   = null   // pinned release recipe from the main process
  let swWizStep   = 1
  let swDefaultBottlePath = ''  // resolved from swGetStatus on first badge refresh

  // ── helpers ────────────────────────────────────────────────────────────────
  function fmt(bytes) {
    if (!bytes) return ''
    return bytes > 1024*1024 ? (bytes/1024/1024).toFixed(1)+' MB' : (bytes/1024).toFixed(0)+' KB'
  }
  function setErr(id, msg) {
    const el=$(id); if(!el) return
    el.textContent = msg; el.classList.toggle('visible', !!msg)
  }
  function setStepDots(step) {
    for (let i=1; i<=4; i++) {
      const d = $('swdot-'+i); if (!d) continue
      d.classList.remove('active','done')
      if (i < step) { d.classList.add('done'); d.style.cursor='pointer'; d.title='Go back to step '+i }
      else if (i === step) { d.classList.add('active'); d.style.cursor=''; d.title='' }
      else { d.style.cursor=''; d.title='' }
    }
  }
  function refreshDxmtSkipGlow() {
    const btn = $('sw-skip-dxmt')
    if (!btn) return
    window.api.swGetStatus().then(st => {
      if (st.dxmtExists) {
        btn.style.color       = 'var(--green)'
        btn.style.borderColor = 'var(--green)'
        btn.style.boxShadow   = '0 0 8px rgba(74,222,128,0.45), 0 0 0 1px rgba(74,222,128,0.18)'
        btn.textContent       = '✓ DXMT installed → Skip'
      } else {
        btn.style.color       = 'var(--text-muted)'
        btn.style.borderColor = 'rgba(235,235,245,0.15)'
        btn.style.boxShadow   = 'none'
        btn.textContent       = 'Skip for now'
      }
    })
  }

  function showStep(n) {
    swWizStep = n
    for (let i=1; i<=4; i++) {
      const p=$('swp-'+i); if(p) p.classList.toggle('active', i===n)
    }
    setStepDots(n)
    // Always refresh the DXMT skip glow when step 3 becomes visible,
    // regardless of which navigation path brought us here.
    if (n === 3) refreshDxmtSkipGlow()
  }
  // Click on a completed (done) step dot to jump back to that step
  for (let i = 1; i <= 4; i++) {
    const dot = $('swdot-' + i)
    if (dot) dot.addEventListener('click', () => {
      if (dot.classList.contains('done')) showStep(i)
    })
  }

  async function openWizard() {
    $('panel-settings').close()
    wizard.classList.remove('hidden')
    try {
      const st = await window.api.swGetStatus()
      swDefaultBottlePath = st.defaultBottlePath || ''
      const bp = settings.standalonBottlePath || swDefaultBottlePath
      const steam = bp ? await window.api.swAutoDetectSteamPath(bp) : {ok:false}
      if (!st.wineInstalled) { showStep(1); fetchWineRelease() }
      else if (!st.bottleExists || !steam.ok) { showStep(2); prefillBottlePath() }
      else if (!st.dxmtExists) showStep(3)
      else showStep(4)
    } catch (err) {
      showStep(1)
      setErr('sw-wine-err', 'Could not check setup: ' + err.message)
    }
  }
  function closeWizard() { wizard.classList.add('hidden'); delete wizard.dataset.installOnly }

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  // The backend provides only the project's pinned Wine release.

  function renderVersionPicker(versions) {
    const info = $('sw-wine-release-info')
    if (!info) return

    const list = (versions || []).filter(v => v.isPinned)

    if (!list.length) {
      info.innerHTML = '<span style="color:var(--red)">Pinned Wine 11.11 release is unavailable.</span>'
      return
    }

    // Exactly one build is offered by the pinned release recipe.
    swRelease = list[0]

    const selStyle   = 'border-color:var(--accent);background:rgba(59,130,246,0.1)'
    const unselStyle = 'border-color:rgba(235,235,245,0.1);background:transparent'

    const rows = list.map((v, i) => {
      const isSelected = i === 0
      const badge = '<span style="color:#4ade80;font-size:10px;font-weight:700">Pinned</span>'
      const dot = isSelected
        ? `<span class="sw-ver-dot" style="width:14px;font-size:12px;color:var(--accent)">●</span>`
        : `<span class="sw-ver-dot" style="width:14px;font-size:12px;color:var(--text-muted)">○</span>`
      return `<div class="sw-ver-row"
        data-ver-url="${v.url}" data-ver-name="${v.name}" data-ver-size="${v.size || 0}"
        data-ver-version="${v.version || ''}" data-ver-major="${v.major || 0}" data-ver-minor="${v.minor || 0}"
        data-ver-dev="${v.isDevWine ? '1' : ''}" data-ver-slug="${v.slug}"
        style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid;border-radius:6px;cursor:pointer;${isSelected ? selStyle : unselStyle}">
        ${dot}
        <span style="font-size:12px;font-weight:600">${v.version || v.name}</span>
        ${badge}
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">${fmt(v.size)}</span>
      </div>`
    }).join('')

    info.innerHTML = `<div style="display:flex;flex-direction:column;gap:5px;margin-top:8px">${rows}</div>`

    // Update step 1 description to reflect selected version
    function updateStep1Desc(v) {
      const desc = $('sw-step1-desc')
      if (!desc) return
      const ver = v.version || v.name || ''
      desc.textContent = `This will install ${ver}`
    }
    updateStep1Desc(swRelease)

    // Click to select a different version — move dot to selected row
    info.querySelectorAll('.sw-ver-row').forEach(row => {
      row.addEventListener('click', () => {
        info.querySelectorAll('.sw-ver-row').forEach(r => {
          r.style.borderColor = 'rgba(235,235,245,0.1)'
          r.style.background  = 'transparent'
          const dot = r.querySelector('.sw-ver-dot')
          if (dot) { dot.textContent = '○'; dot.style.color = 'var(--text-muted)' }
        })
        row.style.borderColor = 'var(--accent)'
        row.style.background  = 'rgba(59,130,246,0.1)'
        const dot = row.querySelector('.sw-ver-dot')
        if (dot) { dot.textContent = '●'; dot.style.color = 'var(--accent)' }
        swRelease = {
          slug:      row.dataset.verSlug,
          url:       row.dataset.verUrl,
          name:      row.dataset.verName,
          size:      parseInt(row.dataset.verSize) || 0,
          version:   row.dataset.verVersion,
          major:     parseInt(row.dataset.verMajor) || 0,
          minor:     parseInt(row.dataset.verMinor) || 0,
          isDevWine: !!row.dataset.verDev,
        }
        updateStep1Desc(swRelease)
      })
    })
  }

  function fetchWineRelease() {
    const info = $('sw-wine-release-info')
    if (info) info.innerHTML = '<span style="color:var(--text-secondary)">Loading pinned Wine 11.11…</span>'
    window.api.swFetchWineRelease().then(res => {
      if (!res.ok) {
        if (info) {
          const error = document.createElement('span')
          error.style.color = 'var(--red)'
          error.textContent = `Failed to fetch: ${res.error}`
          info.replaceChildren(error)
        }
        return
      }
      renderVersionPicker(res.versions, res)
    })
  }

  window.api.onWineProgress(data => {
    const wrap   = $('sw-wine-prog-wrap')
    const fill   = $('sw-wine-prog-fill')
    const label  = $('sw-wine-prog-label')
    const cancel = $('sw-cancel-wine-dl')
    if (!wrap) return
    wrap.classList.add('visible')
    if (cancel) cancel.style.display = data.phase === 'extracting' ? 'none' : ''
    if (data.phase === 'extracting') {
      if (label) label.textContent = 'Extracting…'
      if (fill)  fill.style.width  = '100%'
      return
    }
    if (data.total) {
      const pct = Math.round(data.received / data.total * 100)
      if (fill)  fill.style.width  = pct + '%'
      if (label) label.textContent = `Downloading… ${fmt(data.received)} / ${fmt(data.total)} (${pct}%)`
    } else {
      if (label) label.textContent = `Downloading… ${fmt(data.received)}`
    }
  })

  // Cancel button — aborts the active wine download
  const btnCancelWineDl = $('sw-cancel-wine-dl')
  if (btnCancelWineDl) {
    btnCancelWineDl.style.display = 'none'
    btnCancelWineDl.addEventListener('click', async () => {
      btnCancelWineDl.disabled = true; btnCancelWineDl.textContent = 'Cancelling…'
      await window.api.swCancelWineDownload().catch(() => {})
    })
  }

  const btnDlWine = $('sw-dl-wine')
  if (btnDlWine) btnDlWine.addEventListener('click', async () => {
    setErr('sw-wine-err', '')
    if (!swRelease) { setErr('sw-wine-err', 'Release info not loaded yet. Wait a moment and try again.'); return }
    btnDlWine.disabled = true; btnDlWine.textContent = 'Downloading…'
    if (btnCancelWineDl) { btnCancelWineDl.style.display = ''; btnCancelWineDl.disabled = false; btnCancelWineDl.textContent = '✕ Cancel' }
    const slug = swRelease.slug
    const res = await window.api.swDownloadWine(swRelease.url, slug, swRelease.name || swRelease.version || '')
    btnDlWine.disabled = false; btnDlWine.textContent = 'Download & Install Wine'
    if (btnCancelWineDl) { btnCancelWineDl.style.display = 'none'; btnCancelWineDl.disabled = false; btnCancelWineDl.textContent = '✕ Cancel' }
    const wrap = $('sw-wine-prog-wrap'); if (wrap) wrap.classList.remove('visible')
    if (!res.ok) {
      const msg = res.error === 'cancelled' ? 'Download cancelled.' : ('Download failed: ' + res.error)
      setErr('sw-wine-err', msg)
      return
    }
    swRefreshStatusBadges()
    // Advance only if we got here via the full wizard (not the install-only overlay)
    if (!wizard.dataset.installOnly) { showStep(2); prefillBottlePath() }
    else { closeWizard(); delete wizard.dataset.installOnly }
  })

  const swClose1 = $('sw-close-1')
  if (swClose1) swClose1.addEventListener('click', closeWizard)

  // "Already installed → Skip" — jump straight to step 2 without GitHub fetch
  const swSkipWine = $('sw-skip-wine')
  if (swSkipWine) swSkipWine.addEventListener('click', () => { showStep(2); prefillBottlePath() })

  // "Check for release" — manually trigger the GitHub API fetch on demand.
  const swCheckWineRelease = $('sw-check-wine-release')
  if (swCheckWineRelease) swCheckWineRelease.addEventListener('click', () => {
    fetchWineRelease()
  })

  // ── Step 2 ─────────────────────────────────────────────────────────────────
  function prefillBottlePath() {
    const inp = $('sw-wiz-bottle')
    if (inp && !inp.value) {
      inp.value = settings.standalonBottlePath || swDefaultBottlePath || ''
    }
  }

  window.api.onSteamProgress(data => {
    const wrap  = $('sw-steam-prog-wrap')
    const fill  = $('sw-steam-prog-fill')
    const label = $('sw-steam-prog-label')
    if (!wrap) return
    wrap.classList.add('visible')
    if (data.total) {
      const pct = Math.round(data.received / data.total * 100)
      if (fill)  fill.style.width  = pct + '%'
      if (label) label.textContent = `Downloading Steam… ${fmt(data.received)} / ${fmt(data.total)} (${pct}%)`
    } else {
      if (label) label.textContent = `Downloading Steam… ${fmt(data.received)}`
    }
  })

  const btnCreateBottle = $('sw-create-bottle')
  const btnNext2        = $('sw-next-2')
  if (btnCreateBottle) btnCreateBottle.addEventListener('click', async () => {
    setErr('sw-bottle-err', '')
    const inp = $('sw-wiz-bottle')
    // Auto-fill default if field is blank (backend will also use same default if still empty)
    if (inp && !inp.value.trim()) inp.value = swDefaultBottlePath || ''
    const bottlePath = (inp || {}).value?.trim() || ''
    btnCreateBottle.disabled = true; btnCreateBottle.textContent = 'Creating bottle…'
    const cr = await window.api.swCreateBottle(bottlePath)
    if (!cr.ok) {
      setErr('sw-bottle-err', 'Bottle creation failed: ' + cr.error)
      btnCreateBottle.disabled = false; btnCreateBottle.textContent = 'Create Bottle & Launch Steam'
      return
    }
    // Use the actual resolved path returned from the backend (handles empty-input default)
    const resolvedBottlePath = cr.bottlePath || bottlePath
    if (inp) inp.value = resolvedBottlePath
    settings.standalonBottlePath = resolvedBottlePath
    fillField('sw-bottle-path', resolvedBottlePath)
    btnCreateBottle.textContent = 'Downloading Steam…'; btnCreateBottle.disabled = true
    const dl = await window.api.swDownloadSteam()
    if (!dl.ok) {
      setErr('sw-bottle-err', 'Steam download failed: ' + dl.error)
      btnCreateBottle.disabled = false; btnCreateBottle.textContent = 'Create Bottle & Launch Steam'
      return
    }
    // Run the installer
    const run = await window.api.swRunExe({ exePath: dl.exePath, bottlePath: resolvedBottlePath })
    if (!run.ok) {
      setErr('sw-bottle-err', 'Failed to launch Steam installer: ' + run.error)
      btnCreateBottle.disabled = false; btnCreateBottle.textContent = 'Create Bottle & Launch Steam'
      return
    }
    btnCreateBottle.disabled = false
    btnCreateBottle.textContent = 'Relaunch Steam Installer'
    // Auto-detect Steam & ETS2 paths in the bottle right after Steam installer launches
    if (resolvedBottlePath) {
      try {
        const stRes = await window.api.swAutoDetectSteamPath(resolvedBottlePath)
        if (stRes.ok && stRes.steamDir) {
          settings.standalonSteamDir = stRes.steamDir
          fillField('sw-steam-dir', stRes.steamDir)
        }
      } catch {}
    }
    if (btnNext2) btnNext2.style.display = ''
  })

  const btnBack2  = $('sw-back-2')
  const btnSkip2  = $('sw-skip-2')
  if (btnBack2) btnBack2.addEventListener('click', () => showStep(1))
  async function finishSteamSetup() {
    setErr('sw-bottle-err', '')
    const bp = ($('sw-wiz-bottle') || {}).value?.trim() || settings.standalonBottlePath
    if (!bp) { setErr('sw-bottle-err', 'Choose a bottle location and install Steam first.'); return }
    try {
      const steam = await window.api.swAutoDetectSteamPath(bp)
      if (!steam.ok) {
        setErr('sw-bottle-err', 'Steam is not installed in this bottle yet. Launch the Steam installer and finish its installation, then try Next again.')
        return
      }
      settings.standalonBottlePath = bp
      fillField('sw-bottle-path', bp)
      settings.standalonSteamDir = steam.steamDir
      fillField('sw-steam-dir', steam.steamDir)
      await detectStandaloneBottlePaths(bp)
      await window.api.saveSettings(settings)
      swApplyWineMode(settings.wineMode)
      showStep(3)
    } catch (err) {
      setErr('sw-bottle-err', 'Could not check Steam installation: ' + err.message)
    }
  }
  if (btnSkip2) btnSkip2.addEventListener('click', finishSteamSetup)
  if (btnNext2) btnNext2.addEventListener('click', finishSteamSetup)

  // ── Step 3 ─────────────────────────────────────────────────────────────────
  // Auto-install DXMT from GitHub
  const btnAutoInstallDxmt = $('sw-auto-install-dxmt')
  if (btnAutoInstallDxmt) {
    btnAutoInstallDxmt.addEventListener('click', async () => {
      const statusEl = $('sw-dxmt-auto-status')
      btnAutoInstallDxmt.disabled = true; btnAutoInstallDxmt.textContent = 'Working…'
      if (statusEl) { statusEl.textContent = 'Starting…'; statusEl.style.color = 'var(--text-secondary)' }
      window.api.onDxmtStatus(msg => {
        if (statusEl) { statusEl.textContent = msg; statusEl.style.color = 'var(--text-secondary)' }
      })
      const res = await window.api.swAutoInstallDxmt()
      btnAutoInstallDxmt.disabled = false; btnAutoInstallDxmt.textContent = '⬇ Auto-install latest DXMT from GitHub'
      if (res.ok) {
        settings.standalonDxmtDir = res.dxmtDir
        if (res.dxmtFileVersion) settings.standalonDxmtVersion = res.dxmtFileVersion
        if (statusEl) { statusEl.textContent = `✓ DXMT ${res.dxmtFileVersion || 'latest'} installed successfully`; statusEl.style.color = '#4ade80' }
        showStep(4); swRefreshStatusBadges()
      } else {
        if (statusEl) { statusEl.textContent = '✗ ' + res.error; statusEl.style.color = 'var(--accent, #f87171)' }
      }
    })
  }

  const btnInstallDxmt = $('sw-install-dxmt')
  if (btnInstallDxmt) btnInstallDxmt.addEventListener('click', async () => {
    setErr('sw-dxmt-err', '')
    const tarPath = ($('sw-wiz-dxmt') || {}).value?.trim()
    if (!tarPath) { setErr('sw-dxmt-err', 'Please browse to a DXMT .tar.gz file first.'); return }
    btnInstallDxmt.disabled = true; btnInstallDxmt.textContent = 'Installing…'
    const res = await window.api.swInstallDxmt(tarPath)
    btnInstallDxmt.disabled = false; btnInstallDxmt.textContent = 'Install DXMT →'
    if (!res.ok) { setErr('sw-dxmt-err', 'DXMT install failed: ' + res.error); return }
    settings.standalonDxmtDir = res.dxmtDir
    if (res.dxmtFileVersion) settings.standalonDxmtVersion = res.dxmtFileVersion
    showStep(4)
    swRefreshStatusBadges()
  })

  const btnBack3    = $('sw-back-3')
  const btnSkipDxmt = $('sw-skip-dxmt')
  if (btnBack3)    btnBack3.addEventListener('click',    () => showStep(2))
  if (btnSkipDxmt) btnSkipDxmt.addEventListener('click', () => showStep(4))

  // ── Step 4 ─────────────────────────────────────────────────────────────────
  const btnFinish = $('sw-finish')
  if (btnFinish) btnFinish.addEventListener('click', () => {
    const steamVal = ($('sw-wiz-steam') || {}).value?.trim()
    if (steamVal) { settings.standalonSteamDir = steamVal; fillField('sw-steam-dir', steamVal) }
    // Auto-detect bottle paths (steam + ETS2 game dir) if bottle is known
    if (settings.standalonBottlePath) detectStandaloneBottlePaths(settings.standalonBottlePath)
    settings.standaloneWizardDone = true
    collect(); window.api.saveSettings(settings)
    closeWizard()
    swRefreshStatusBadges()
  })

  // Expose for use by swApplyWineMode (called outside this IIFE)
  window._swRefreshStatusBadges = swRefreshStatusBadges

  // ── Status badges in settings panel ────────────────────────────────────────
  function swRefreshStatusBadges() {
    window.api.swGetStatus().then(st => {
      if (settings.wineMode === 'standalone') {
        setBadge('badge-crossover', st.wineInstalled)
        setBadge('badge-steam', !!settings.standalonSteamDir)
        setBadge('badge-game', !!settings.standalonGameDir)
        updateSteamBtn()
        updateLaunchBtn()
      }
      function set(indId, lblId, ok, okText, missText) {
        const ind=$( indId); const lbl=$(lblId); if(!ind||!lbl) return
        ind.textContent = ok ? '✓' : '○'
        ind.className   = 'sw-status-icon ' + (ok ? 'sw-status-ok' : 'sw-status-miss')
        lbl.textContent = ok ? okText : missText
        lbl.className   = ok ? 'sw-status-ok' : 'sw-status-miss'
      }
      set('sw-ind-wine',   'sw-lbl-wine',   st.wineInstalled, 'Wine installed ✓', 'Wine not installed')
      set('sw-ind-bottle', 'sw-lbl-bottle', st.bottleExists,  'Bottle ready ✓',   'Bottle not created')
      // DXMT badge: show version from filename if available
      const dxmtOk = st.dxmtExists && !st.dxmtArchWarning
      const dxmtDisplayVer = st.dxmtFileVersion || ''
      const dxmtLabel = st.dxmtArchWarning
        ? 'DXMT ⚠ reinstall needed (32-bit path)'
        : dxmtOk
          ? (dxmtDisplayVer ? `DXMT ${dxmtDisplayVer} ✓` : 'DXMT installed ✓')
          : 'DXMT not installed'
      set('sw-ind-dxmt', 'sw-lbl-dxmt', dxmtOk, dxmtLabel, dxmtLabel)
      if (st.defaultBottlePath) swDefaultBottlePath = st.defaultBottlePath
    })
  }

  // ── Card wine toggle (game card shortcut) ───────────────────────────────────
  const cwtCxBtn = $('cwt-cx'); const cwtSwBtn = $('cwt-sw')
  if (cwtCxBtn) cwtCxBtn.addEventListener('click', () => {
    swApplyWineMode('crossover'); collect(); window.api.saveSettings(settings)
  })
  if (cwtSwBtn) cwtSwBtn.addEventListener('click', () => {
    swApplyWineMode('standalone'); swRefreshStatusBadges(); collect(); window.api.saveSettings(settings)
  })

  // ── Wine manager buttons (Settings panel) ──────────────────────────────────
  const btnOpenWiz = $('btn-open-sw-wizard')
  if (btnOpenWiz) btnOpenWiz.addEventListener('click', openWizard)

  $('sw-close-wizard')?.addEventListener('click', closeWizard)
})()

init().catch(err => { setStatus("Setup error", "error"); pushLog({kind:"error", text:err.message}) })
