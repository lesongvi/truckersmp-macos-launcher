import('./renderer/app.js').then(({ createRenderer }) => {
  const renderer = createRenderer({ api: window.api, document })
  window.addEventListener('unload', () => renderer.dispose(), { once: true })
  renderer.init().catch((error) => {
    renderer.ui.setStatus('Setup error', 'error')
    renderer.ui.pushLog({ kind: 'error', text: error.message })
  })
})
