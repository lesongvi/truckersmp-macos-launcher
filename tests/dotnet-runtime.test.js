const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { loadModule, registry } = require('./helpers/modules')
const { EventEmitter } = require('node:events')
const { versionedPE } = require('./helpers/versioned-pe')
const {
  RELEASES_URL,
  findDesktopRuntime,
  selectDesktopRelease,
  ensureDesktopRuntime
} = require('../src/dotnet-runtime')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haullog-dotnet-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const context = {
    bottlePath: path.join(root, 'bottle'),
    winePath: '/selected/wine',
    standalone: true
  }
  const write = (file, content = versionedPE([8, 0, 33, 0])) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  const runtime = (
    version = '8.0.33',
    base = path.join(context.bottlePath, 'drive_c/Program Files/dotnet')
  ) => {
    for (const file of [
      'dotnet.exe',
      `host/fxr/${version}/hostfxr.dll`,
      `shared/Microsoft.NETCore.App/${version}/coreclr.dll`,
      `shared/Microsoft.WindowsDesktop.App/${version}/PresentationFramework.dll`,
      `shared/Microsoft.WindowsDesktop.App/${version}/wpfgfx_cor3.dll`
    ])
      write(path.join(base, file))
    return base
  }
  const payload = versionedPE([8, 0, 33, 0])
  const release = {
    version: '8.0.33',
    files: [
      {
        name: 'windowsdesktop-runtime-win-x64.exe',
        rid: 'win-x64',
        url: 'https://builds.dotnet.microsoft.com/dotnet/WindowsDesktop/8.0.33/windowsdesktop-runtime-8.0.33-win-x64.exe',
        hash: crypto.createHash('sha512').update(payload).digest('hex')
      }
    ]
  }
  const metadata = { releases: [{ windowsdesktop: release }] }
  const options = {
    getMetadata: async (url) => {
      assert.equal(url, RELEASES_URL)
      return Buffer.from(JSON.stringify(metadata))
    },
    download: async (url, file) => {
      assert.equal(url, release.files[0].url)
      write(file, payload)
    },
    launch: async (selected, _file, _log, args) => {
      assert.equal(selected, context)
      assert.equal(args.waitForExit, true)
      runtime()
      return { ok: true }
    }
  }
  return { root, context, runtime, write, payload, release, metadata, options }
}

test('runtime detection requires complete Windows x64 core and desktop frameworks in the selected bottle', (t) => {
  const { context, runtime, write } = fixture(t)
  assert.equal(findDesktopRuntime(context.bottlePath), null)
  runtime('9.0.1')
  assert.equal(findDesktopRuntime(context.bottlePath), null)
  const base = runtime()
  assert.equal(findDesktopRuntime(context.bottlePath).version, '8.0.33')
  assert.equal(findDesktopRuntime(context.bottlePath + '-other'), null)
  const core = path.join(base, 'shared/Microsoft.NETCore.App/8.0.33/coreclr.dll')
  write(core, 'incomplete')
  assert.equal(findDesktopRuntime(context.bottlePath), null)
  // An x86 core cannot satisfy the x64 HaulLog installer.
  const x86 = versionedPE([8, 0, 33, 0], false)
  write(core, x86)
  assert.equal(findDesktopRuntime(context.bottlePath), null)
})

test('release selection uses latest stable 8.0 desktop installer for Windows x64', (t) => {
  const { release, metadata } = fixture(t)
  metadata.releases.unshift(
    { windowsdesktop: { ...release, version: '9.0.1' } },
    { windowsdesktop: { ...release, version: '8.0.34-preview.1' } },
    { windowsdesktop: { ...release, version: '8.0.9' } }
  )
  assert.equal(selectDesktopRelease(metadata).version, '8.0.33')
  for (const url of [
    'http://builds.dotnet.microsoft.com/runtime.exe',
    'https://example.com/runtime.exe'
  ]) {
    assert.throws(
      () =>
        selectDesktopRelease({
          releases: [{ windowsdesktop: { ...release, files: [{ ...release.files[0], url }] } }]
        }),
      /invalid/
    )
  }
  assert.throws(() => selectDesktopRelease({ releases: [] }), /No Windows x64/)
})

test('an existing runtime skips all downloads and setup', async (t) => {
  const { context, root, runtime } = fixture(t)
  runtime()
  const fail = () => {
    throw new Error('Setup must not run')
  }
  assert.equal(
    (await ensureDesktopRuntime(context, root, { getMetadata: fail, download: fail, launch: fail }))
      .version,
    '8.0.33'
  )
})

test('runtime setup waits for exit, uses the selected bottle, and verifies installation before returning', async (t) => {
  const { context, root, runtime, options } = fixture(t)
  let finish,
    done = false
  options.launch = async (selected, file, log, args) => {
    assert.equal(selected, context)
    assert.equal(log, 'haullog-dotnet-install.log')
    assert.equal(args.waitForExit, true)
    assert.deepEqual(args.args, ['/install', '/quiet', '/norestart'])
    assert.ok(args.successCodes.includes(194))
    await new Promise((resolve) => {
      finish = resolve
    })
    runtime()
    return { ok: true }
  }
  const installing = ensureDesktopRuntime(context, root, options).then((result) => {
    done = true
    return result
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(done, false)
  assert.equal(findDesktopRuntime(context.bottlePath), null)
  finish()
  assert.equal((await installing).version, '8.0.33')
})

test('checksum mismatch or an unsuccessful runtime install stops before HaulLog', async (t) => {
  const { context, root, options, write } = fixture(t)
  let launched = false
  const launch = async () => {
    launched = true
    return { ok: true }
  }
  await assert.rejects(
    ensureDesktopRuntime(context, root, {
      ...options,
      launch,
      download: async (_url, file) => write(file, 'tampered')
    }),
    /checksum/
  )
  assert.equal(launched, false)
  await assert.rejects(
    ensureDesktopRuntime(context, root, {
      ...options,
      launch: async () => ({ ok: false, error: 'Wine setup failed' })
    }),
    /Wine setup failed/
  )
  await assert.rejects(ensureDesktopRuntime(context, root, { ...options, launch }), /still missing/)
})

test('Wine runner waits for prerequisite installers instead of using the launch timer', async (t) => {
  const f = fixture(t)
  const child = new EventEmitter()
  let unrefs = 0,
    invocation
  child.unref = () => {
    unrefs++
  }
  const { createWineProgramRunner } = loadModule('src/main/wine-program.js', {
    child_process: {
      spawn: (...args) => {
        invocation = args
        return child
      }
    }
  })
  const launch = createWineProgramRunner({
    paths: { dataDir: f.root },
    wine: { standaloneWineEnv: (_wine, bottle) => ({ WINEPREFIX: bottle }) }
  })
  let done = false
  const pending = launch(
    { winePath: '/wine', bottlePath: '/selected/bottle', standalone: true },
    '/setup.exe',
    'runtime.log',
    { waitForExit: true, successCodes: [0, 194] }
  ).then((result) => {
    done = true
    return result
  })
  child.emit('spawn')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(done, false)
  assert.equal(unrefs, 0)
  assert.equal(invocation[2].env.WINEPREFIX, '/selected/bottle')
  child.emit('exit', 194)
  assert.equal((await pending).ok, true)
})
test('HaulLog prerequisite failure blocks its installer and permits a retry', async (t) => {
  const f = fixture(t)
  const { handlers, ipcMain } = registry()
  let attempts = 0,
    launches = 0
  const { registerCompanionHandlers } = loadModule('src/main/companions.js', {
    '../haullog': {
      getHaulLogStatus: () => ({ canInstall: true }),
      downloadArchive: async () => {},
      extractInstaller: async () => '/installer.exe'
    },
    '../dotnet-runtime': {
      ensureDesktopRuntime: async (selected) => {
        assert.equal(selected, f.context)
        if (++attempts === 1) throw new Error('Runtime missing')
      }
    },
    './wine-program': {
      createWineProgramRunner: () => async () => {
        launches++
        return { ok: true }
      }
    }
  })
  registerCompanionHandlers({
    ipcMain,
    state: {},
    paths: { dataDir: f.root },
    wine: { selectedWineContext: () => f.context }
  })
  const install = handlers.get('haullog:install')
  assert.equal((await install(null, {})).error, 'Runtime missing')
  assert.equal(launches, 0)
  assert.equal((await install(null, {})).ok, true)
  assert.equal(launches, 1)
})
