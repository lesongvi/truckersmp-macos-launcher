export function createSetupWizard({ state, ui, api, settingsController, updateButtons }) {
  const { $, fillField } = ui

  const wizard = $('sw-wizard')
  let swRelease = null // pinned release recipe from the main process
  let swDefaultBottlePath = '' // resolved from swGetStatus on first badge refresh
  function fmt(bytes) {
    if (!bytes) return ''
    return bytes > 1024 * 1024
      ? (bytes / 1024 / 1024).toFixed(1) + ' MB'
      : (bytes / 1024).toFixed(0) + ' KB'
  }
  function setErr(id, msg) {
    const el = $(id)
    if (!el) return
    el.textContent = msg
    el.classList.toggle('visible', !!msg)
  }
  function setStepDots(step) {
    for (let i = 1; i <= 4; i++) {
      const d = $('swdot-' + i)
      if (!d) continue
      d.classList.remove('active', 'done')
      if (i < step) {
        d.classList.add('done')
        d.style.cursor = 'pointer'
        d.title = 'Go back to step ' + i
      } else if (i === step) {
        d.classList.add('active')
        d.style.cursor = ''
        d.title = ''
      } else {
        d.style.cursor = ''
        d.title = ''
      }
    }
  }
  function refreshDxmtSkipGlow() {
    const btn = $('sw-skip-dxmt')
    if (!btn) return
    api.swGetStatus().then((st) => {
      if (st.dxmtExists) {
        btn.style.color = 'var(--green)'
        btn.style.borderColor = 'var(--green)'
        btn.style.boxShadow = '0 0 8px rgba(74,222,128,0.45), 0 0 0 1px rgba(74,222,128,0.18)'
        btn.textContent = '✓ DXMT installed → Skip'
      } else {
        btn.style.color = 'var(--text-muted)'
        btn.style.borderColor = 'rgba(235,235,245,0.15)'
        btn.style.boxShadow = 'none'
        btn.textContent = 'Skip for now'
      }
    })
  }

  function showStep(n) {
    if (n === 1 && !swRelease) fetchWineRelease()
    for (let i = 1; i <= 4; i++) {
      const p = $('swp-' + i)
      if (p) p.classList.toggle('active', i === n)
    }
    setStepDots(n)
    // Always refresh the DXMT skip glow when step 3 becomes visible,
    // regardless of which navigation path brought us here.
    if (n === 3) refreshDxmtSkipGlow()
  }
  // Click on a completed (done) step dot to jump back to that step
  for (let i = 1; i <= 4; i++) {
    const dot = $('swdot-' + i)
    if (dot)
      dot.addEventListener('click', () => {
        if (dot.classList.contains('done')) showStep(i)
      })
  }

  async function openWizard() {
    $('panel-settings').close()
    wizard.classList.remove('hidden')
    try {
      const st = await api.swGetStatus()
      swDefaultBottlePath = st.defaultBottlePath || ''
      const bp = state.settings.standalonBottlePath || swDefaultBottlePath
      const steam = bp ? await api.swAutoDetectSteamPath(bp) : { ok: false }
      if (!st.wineInstalled) {
        showStep(1)
      } else if (!st.bottleExists || !steam.ok) {
        showStep(2)
        prefillBottlePath()
      } else if (!st.dxmtExists) showStep(3)
      else showStep(4)
    } catch (err) {
      showStep(1)
      setErr('sw-wine-err', 'Could not check setup: ' + err.message)
    }
  }
  function closeWizard() {
    wizard.classList.add('hidden')
  }
  // The backend provides only the project's pinned Wine release.

  async function fetchWineRelease() {
    const info = $('sw-wine-release-info')
    info.textContent = 'Loading Wine 11.11…'
    try {
      const release = await api.swFetchWineRelease()
      if (!release.ok) throw new Error(release.error)
      swRelease = release.versions.find((version) => version.isPinned)
      if (!swRelease) throw new Error('The pinned Wine release is unavailable.')
      info.textContent = swRelease.version + ' · Pinned · ' + fmt(swRelease.size)
    } catch (error) {
      setErr('sw-wine-err', error.message)
    }
  }

  api.onWineProgress((data) => {
    const wrap = $('sw-wine-prog-wrap')
    const fill = $('sw-wine-prog-fill')
    const label = $('sw-wine-prog-label')
    const cancel = $('sw-cancel-wine-dl')
    if (!wrap) return
    wrap.classList.add('visible')
    if (cancel) cancel.style.display = data.phase === 'extracting' ? 'none' : ''
    if (data.phase === 'extracting') {
      if (label) label.textContent = 'Extracting…'
      if (fill) fill.style.width = '100%'
      return
    }
    if (data.total) {
      const pct = Math.round((data.received / data.total) * 100)
      if (fill) fill.style.width = pct + '%'
      if (label)
        label.textContent = `Downloading… ${fmt(data.received)} / ${fmt(data.total)} (${pct}%)`
    } else {
      if (label) label.textContent = `Downloading… ${fmt(data.received)}`
    }
  })

  // Cancel button — aborts the active wine download
  const btnCancelWineDl = $('sw-cancel-wine-dl')
  if (btnCancelWineDl) {
    btnCancelWineDl.style.display = 'none'
    btnCancelWineDl.addEventListener('click', async () => {
      btnCancelWineDl.disabled = true
      btnCancelWineDl.textContent = 'Cancelling…'
      await api.swCancelWineDownload().catch(() => {})
    })
  }

  const btnDlWine = $('sw-dl-wine')
  if (btnDlWine)
    btnDlWine.addEventListener('click', async () => {
      setErr('sw-wine-err', '')
      if (!swRelease) {
        setErr('sw-wine-err', 'Release info not loaded yet. Wait a moment and try again.')
        return
      }
      btnDlWine.disabled = true
      btnDlWine.textContent = 'Downloading…'
      if (btnCancelWineDl) {
        btnCancelWineDl.style.display = ''
        btnCancelWineDl.disabled = false
        btnCancelWineDl.textContent = '✕ Cancel'
      }
      const slug = swRelease.slug
      const res = await api.swDownloadWine(
        swRelease.url,
        slug,
        swRelease.name || swRelease.version || ''
      )
      btnDlWine.disabled = false
      btnDlWine.textContent = 'Download & Install Wine'
      if (btnCancelWineDl) {
        btnCancelWineDl.style.display = 'none'
        btnCancelWineDl.disabled = false
        btnCancelWineDl.textContent = '✕ Cancel'
      }
      const wrap = $('sw-wine-prog-wrap')
      if (wrap) wrap.classList.remove('visible')
      if (!res.ok) {
        const msg =
          res.error === 'cancelled' ? 'Download cancelled.' : 'Download failed: ' + res.error
        setErr('sw-wine-err', msg)
        return
      }
      swRefreshStatusBadges()
      showStep(2)
      prefillBottlePath()
    })

  const swClose1 = $('sw-close-1')
  if (swClose1) swClose1.addEventListener('click', closeWizard)

  // "Already installed → Skip" — jump straight to step 2 without GitHub fetch
  const swSkipWine = $('sw-skip-wine')
  if (swSkipWine)
    swSkipWine.addEventListener('click', () => {
      showStep(2)
      prefillBottlePath()
    })

  function prefillBottlePath() {
    const inp = $('sw-wiz-bottle')
    if (inp && !inp.value) {
      inp.value = state.settings.standalonBottlePath || swDefaultBottlePath || ''
    }
  }

  api.onSteamProgress((data) => {
    const wrap = $('sw-steam-prog-wrap')
    const fill = $('sw-steam-prog-fill')
    const label = $('sw-steam-prog-label')
    if (!wrap) return
    wrap.classList.add('visible')
    if (data.total) {
      const pct = Math.round((data.received / data.total) * 100)
      if (fill) fill.style.width = pct + '%'
      if (label)
        label.textContent = `Downloading Steam… ${fmt(data.received)} / ${fmt(data.total)} (${pct}%)`
    } else {
      if (label) label.textContent = `Downloading Steam… ${fmt(data.received)}`
    }
  })

  const btnCreateBottle = $('sw-create-bottle')
  const btnNext2 = $('sw-next-2')
  if (btnCreateBottle)
    btnCreateBottle.addEventListener('click', async () => {
      setErr('sw-bottle-err', '')
      const inp = $('sw-wiz-bottle')
      // Auto-fill default if field is blank (backend will also use same default if still empty)
      if (inp && !inp.value.trim()) inp.value = swDefaultBottlePath || ''
      const bottlePath = (inp || {}).value?.trim() || ''
      btnCreateBottle.disabled = true
      btnCreateBottle.textContent = 'Creating bottle…'
      const cr = await api.swCreateBottle(bottlePath)
      if (!cr.ok) {
        setErr('sw-bottle-err', 'Bottle creation failed: ' + cr.error)
        btnCreateBottle.disabled = false
        btnCreateBottle.textContent = 'Create Bottle & Launch Steam'
        return
      }
      // Use the actual resolved path returned from the backend (handles empty-input default)
      const resolvedBottlePath = cr.bottlePath || bottlePath
      if (inp) inp.value = resolvedBottlePath
      state.settings.standalonBottlePath = resolvedBottlePath
      fillField('sw-bottle-path', resolvedBottlePath)
      btnCreateBottle.textContent = 'Downloading Steam…'
      btnCreateBottle.disabled = true
      const dl = await api.swDownloadSteam()
      if (!dl.ok) {
        setErr('sw-bottle-err', 'Steam download failed: ' + dl.error)
        btnCreateBottle.disabled = false
        btnCreateBottle.textContent = 'Create Bottle & Launch Steam'
        return
      }
      // Run the installer
      const run = await api.swRunExe({ exePath: dl.exePath, bottlePath: resolvedBottlePath })
      if (!run.ok) {
        setErr('sw-bottle-err', 'Failed to launch Steam installer: ' + run.error)
        btnCreateBottle.disabled = false
        btnCreateBottle.textContent = 'Create Bottle & Launch Steam'
        return
      }
      btnCreateBottle.disabled = false
      btnCreateBottle.textContent = 'Relaunch Steam Installer'
      // Auto-detect Steam & ETS2 paths in the bottle right after Steam installer launches
      if (resolvedBottlePath) {
        try {
          const stRes = await api.swAutoDetectSteamPath(resolvedBottlePath)
          if (stRes.ok && stRes.steamDir) {
            state.settings.standalonSteamDir = stRes.steamDir
            fillField('sw-steam-dir', stRes.steamDir)
          }
        } catch {}
      }
      if (btnNext2) btnNext2.style.display = ''
    })

  const btnBack2 = $('sw-back-2')
  const btnSkip2 = $('sw-skip-2')
  if (btnBack2) btnBack2.addEventListener('click', () => showStep(1))
  async function finishSteamSetup() {
    setErr('sw-bottle-err', '')
    const bp = ($('sw-wiz-bottle') || {}).value?.trim() || state.settings.standalonBottlePath
    if (!bp) {
      setErr('sw-bottle-err', 'Choose a bottle location and install Steam first.')
      return
    }
    try {
      const steam = await api.swAutoDetectSteamPath(bp)
      if (!steam.ok) {
        setErr(
          'sw-bottle-err',
          'Steam is not installed in this bottle yet. Launch the Steam installer and finish its installation, then try Next again.'
        )
        return
      }
      state.settings.standalonBottlePath = bp
      fillField('sw-bottle-path', bp)
      state.settings.standalonSteamDir = steam.steamDir
      fillField('sw-steam-dir', steam.steamDir)
      await settingsController.detectStandaloneBottlePaths(bp)
      await api.saveSettings(state.settings)
      settingsController.applyWineMode(state.settings.wineMode)
      showStep(3)
    } catch (err) {
      setErr('sw-bottle-err', 'Could not check Steam installation: ' + err.message)
    }
  }
  if (btnSkip2) btnSkip2.addEventListener('click', finishSteamSetup)
  if (btnNext2) btnNext2.addEventListener('click', finishSteamSetup)
  // Auto-install DXMT from GitHub
  const btnAutoInstallDxmt = $('sw-auto-install-dxmt')
  if (btnAutoInstallDxmt) {
    btnAutoInstallDxmt.addEventListener('click', async () => {
      const statusEl = $('sw-dxmt-auto-status')
      btnAutoInstallDxmt.disabled = true
      btnAutoInstallDxmt.textContent = 'Working…'
      if (statusEl) {
        statusEl.textContent = 'Starting…'
        statusEl.style.color = 'var(--text-secondary)'
      }
      api.onDxmtStatus((msg) => {
        if (statusEl) {
          statusEl.textContent = msg
          statusEl.style.color = 'var(--text-secondary)'
        }
      })
      const res = await api.swAutoInstallDxmt()
      btnAutoInstallDxmt.disabled = false
      btnAutoInstallDxmt.textContent = '⬇ Auto-install latest DXMT from GitHub'
      if (res.ok) {
        state.settings.standalonDxmtDir = res.dxmtDir
        if (res.dxmtFileVersion) state.settings.standalonDxmtVersion = res.dxmtFileVersion
        if (statusEl) {
          statusEl.textContent = `✓ DXMT ${res.dxmtFileVersion || 'latest'} installed successfully`
          statusEl.style.color = '#4ade80'
        }
        showStep(4)
        swRefreshStatusBadges()
      } else {
        if (statusEl) {
          statusEl.textContent = '✗ ' + res.error
          statusEl.style.color = 'var(--accent, #f87171)'
        }
      }
    })
  }

  const btnInstallDxmt = $('sw-install-dxmt')
  if (btnInstallDxmt)
    btnInstallDxmt.addEventListener('click', async () => {
      setErr('sw-dxmt-err', '')
      const tarPath = ($('sw-wiz-dxmt') || {}).value?.trim()
      if (!tarPath) {
        setErr('sw-dxmt-err', 'Please browse to a DXMT .tar.gz file first.')
        return
      }
      btnInstallDxmt.disabled = true
      btnInstallDxmt.textContent = 'Installing…'
      const res = await api.swInstallDxmt(tarPath)
      btnInstallDxmt.disabled = false
      btnInstallDxmt.textContent = 'Install DXMT →'
      if (!res.ok) {
        setErr('sw-dxmt-err', 'DXMT install failed: ' + res.error)
        return
      }
      state.settings.standalonDxmtDir = res.dxmtDir
      if (res.dxmtFileVersion) state.settings.standalonDxmtVersion = res.dxmtFileVersion
      showStep(4)
      swRefreshStatusBadges()
    })

  const btnBack3 = $('sw-back-3')
  const btnSkipDxmt = $('sw-skip-dxmt')
  if (btnBack3) btnBack3.addEventListener('click', () => showStep(2))
  if (btnSkipDxmt) btnSkipDxmt.addEventListener('click', () => showStep(4))
  const btnFinish = $('sw-finish')
  if (btnFinish)
    btnFinish.addEventListener('click', () => {
      const steamVal = ($('sw-wiz-steam') || {}).value?.trim()
      if (steamVal) {
        state.settings.standalonSteamDir = steamVal
        fillField('sw-steam-dir', steamVal)
      }
      // Auto-detect bottle paths (steam + ETS2 game dir) if bottle is known
      if (state.settings.standalonBottlePath)
        settingsController.detectStandaloneBottlePaths(state.settings.standalonBottlePath)
      state.settings.standaloneWizardDone = true
      settingsController.collect()
      api.saveSettings(state.settings)
      closeWizard()
      swRefreshStatusBadges()
    })

  async function swRefreshStatusBadges() {
    const st = await api.swGetStatus()
    function set(indId, lblId, ok, okText, missText) {
      const ind = $(indId)
      const lbl = $(lblId)
      if (!ind || !lbl) return
      ind.textContent = ok ? '✓' : '○'
      ind.className = 'sw-status-icon ' + (ok ? 'sw-status-ok' : 'sw-status-miss')
      lbl.textContent = ok ? okText : missText
      lbl.className = ok ? 'sw-status-ok' : 'sw-status-miss'
    }
    set('sw-ind-wine', 'sw-lbl-wine', st.wineInstalled, 'Wine installed ✓', 'Wine not installed')
    set('sw-ind-bottle', 'sw-lbl-bottle', st.bottleExists, 'Bottle ready ✓', 'Bottle not created')
    // DXMT badge: show version from filename if available
    const dxmtOk = st.dxmtExists && !st.dxmtArchWarning
    const dxmtDisplayVer = st.dxmtFileVersion || ''
    const dxmtLabel = st.dxmtArchWarning
      ? 'DXMT ⚠ reinstall needed (32-bit path)'
      : dxmtOk
        ? dxmtDisplayVer
          ? `DXMT ${dxmtDisplayVer} ✓`
          : 'DXMT installed ✓'
        : 'DXMT not installed'
    set('sw-ind-dxmt', 'sw-lbl-dxmt', dxmtOk, dxmtLabel, dxmtLabel)
    if (st.defaultBottlePath) swDefaultBottlePath = st.defaultBottlePath
  }

  const btnOpenWiz = $('btn-open-sw-wizard')
  if (btnOpenWiz) btnOpenWiz.addEventListener('click', openWizard)

  $('sw-close-wizard')?.addEventListener('click', closeWizard)
  return { openWizard, closeWizard, showStep, refresh: swRefreshStatusBadges }
}
