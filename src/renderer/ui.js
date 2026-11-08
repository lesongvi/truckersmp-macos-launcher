export function createUI(document, state) {
  const $ = (id) => document.getElementById(id)
  const getField = (id) => $(id)?.value.trim() || ''
  const fillField = (id, value) => {
    if ($(id)) $(id).value = value || ''
  }
  function setBadge(id, found, version) {
    const badge = $(id)
    if (!badge) return
    badge.textContent = !found
      ? 'Not found'
      : version === undefined
        ? 'Found'
        : version
          ? 'v' + version
          : 'Found · version unknown'
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
    ui.onLogEntry?.(entry)
    const line = `${new Date(entry.ts || Date.now()).toLocaleTimeString()} ${entry.text || ''}`
    state.logs.push(line)
    if (state.logs.length > 400) state.logs.shift()
    const body = $('log-body')
    body.textContent = state.logs.join('\n')
    body.scrollTop = body.scrollHeight
    if (entry.kind === 'error' && entry.cat !== 'wine') {
      $('log-details').open = true
      showMessage(entry.text, true)
    }
  }
  const ui = {
    document,
    $,
    getField,
    fillField,
    setBadge,
    setStatus,
    showMessage,
    pushLog,
    onLogEntry: null
  }
  return ui
}
