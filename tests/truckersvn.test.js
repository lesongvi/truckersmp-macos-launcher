const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { loadModule, registry } = require('./helpers/modules')
const { rendererFixture } = require('./helpers/renderer')
const crypto = require('node:crypto')
const tool = require('../src/truckersvn')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'truckersvn-native-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const context = {
    dataDir: path.join(root, 'launcher'),
    homeDir: path.join(root, 'home'),
    applicationsDir: path.join(root, 'Applications')
  }
  const write = (file, data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, data)
  }
  const bundle = (app, version = '1.0.57.0') => {
    write(
      path.join(app, 'Contents/Info.plist'),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${tool.BUNDLE_ID}</string><key>CFBundleExecutable</key><string>truckersvn-desktop</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`
    )
    const binary = path.join(app, 'Contents/MacOS/truckersvn-desktop')
    write(binary, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]))
    fs.chmodSync(binary, 0o755)
    return binary
  }
  const folder = path.join(root, 'download')
  fs.mkdirSync(folder)
  const payload = Buffer.from('download fixture')
  const metadata = {
    version: '1.0.70',
    sha256: crypto.createHash('sha256').update(payload).digest('hex')
  }
  const getMetadata = async (url) => {
    assert.equal(url, tool.VERSION_URL)
    return Buffer.from(JSON.stringify(metadata))
  }
  const download = async (url, file) => {
    assert.equal(url, tool.DOWNLOAD_URL)
    write(file, payload)
  }
  const signed = []
  const run = async (cmd, args) => {
    if (cmd.endsWith('/unzip'))
      return { stdout: 'HGL Portal Hub.app/\nHGL Portal Hub.app/Contents/Info.plist\n' }
    if (cmd.endsWith('/ditto')) {
      bundle(path.join(args.at(-1), tool.APP_NAME))
      return {}
    }
    if (cmd.endsWith('/codesign')) {
      signed.push(args)
      return {}
    }
    throw new Error('Unexpected tool ' + cmd)
  }
  return {
    root,
    context,
    folder,
    write,
    bundle,
    payload,
    metadata,
    getMetadata,
    download,
    run,
    signed
  }
}

test('native detection reports bundle versions and ignores the old Windows installation', (t) => {
  const { context, write, bundle } = fixture(t)
  write(
    path.join(
      context.dataDir,
      'old-bottle/drive_c/Program Files/TruckerSVN Tool/truckersvn-desktop.exe'
    ),
    'MZ'
  )
  assert.equal(tool.getToolStatus(context).installed, false)
  assert.equal(tool.getToolStatus(context).canInstall, true)
  const app = path.join(context.applicationsDir, tool.APP_NAME)
  bundle(app)
  const status = tool.getToolStatus(context)
  assert.equal(status.installed, true)
  assert.equal(status.ready, true)
  assert.equal(status.native, true)
  assert.equal(status.version, '1.0.57.0')
  assert.equal(status.appPath, app)
})

test('native bundle validation rejects Windows binaries and the wrong application identity', (t) => {
  const { root, bundle, write } = fixture(t)
  const app = path.join(root, tool.APP_NAME)
  const binary = bundle(app)
  write(binary, 'MZ Windows program')
  assert.equal(tool.readAppBundle(app), null)
  bundle(app)
  const plist = path.join(app, 'Contents/Info.plist')
  write(plist, fs.readFileSync(plist, 'utf8').replace(tool.BUNDLE_ID, 'other.application'))
  assert.equal(tool.readAppBundle(app), null)
})

test('official release metadata accepts the known surplus brace but rejects other trailing data', () => {
  assert.equal(tool.parseRelease('{"version":"1.0.70"}}').version, '1.0.70')
  assert.equal(tool.parseRelease('{"version":"1.0.70"}').version, '1.0.70')
  assert.throws(() => tool.parseRelease('{"version":"1.0.70"}junk'))
})

test('archive paths must stay within a single macOS application bundle', () => {
  assert.equal(
    tool.selectAppArchive(['HGL Portal Hub.app/', 'HGL Portal Hub.app/Contents/Info.plist']),
    tool.APP_NAME
  )
  for (const files of [
    [],
    ['../app.app/'],
    ['/app.app/'],
    ['app.app/../escape'],
    ['app.app/a\\b'],
    ['a.app/', 'b.app/'],
    ['truckersvn-desktop.exe']
  ])
    assert.throws(() => tool.selectAppArchive(files))
})

test('native installation uses macOS endpoints, verifies signature and records the release version against the installed executable', async (t) => {
  const f = fixture(t)
  const status = await tool.installDesktop(
    f.context,
    f.folder,
    f.getMetadata,
    () => {},
    f.download,
    f.run
  )
  assert.equal(status.ready, true)
  assert.equal(status.version, '1.0.70')
  assert.match(tool.DOWNLOAD_URL, /platform=macos$/)
  assert.equal(f.signed.length, 1)
  assert.deepEqual(f.signed[0].slice(0, 3), ['--verify', '--deep', '--strict'])
  // A self-update invalidates the old recorded release version.
  f.write(status.executable, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 1, 2, 3, 4]))
  assert.equal(tool.getToolStatus(f.context).version, '1.0.57.0')
})

test('failed checksum or signature validation leaves the installed native bundle intact', async (t) => {
  const f = fixture(t)
  const installed = path.join(tool.managedDirectory(f.context.dataDir), tool.APP_NAME)
  f.bundle(installed, '1.0.69')
  f.metadata.sha256 = '0'.repeat(64)
  await assert.rejects(
    tool.installDesktop(f.context, f.folder, f.getMetadata, () => {}, f.download, f.run),
    /checksum/
  )
  assert.equal(tool.readAppBundle(installed).version, '1.0.69')
  f.metadata.sha256 = crypto.createHash('sha256').update(f.payload).digest('hex')
  await assert.rejects(
    tool.installDesktop(
      f.context,
      f.folder,
      f.getMetadata,
      () => {},
      f.download,
      async (cmd, args) => {
        if (cmd.endsWith('/codesign')) throw new Error('Invalid signature')
        return f.run(cmd, args)
      }
    ),
    /Invalid signature/
  )
  assert.equal(tool.readAppBundle(installed).version, '1.0.69')
})

test('the compact button installs then opens the native app without a Wine runtime step', async () => {
  const { fields, state, companions } = await rendererFixture()
  state.truckersvnStatus = { canInstall: true }
  companions.renderTruckerSVNButton()
  assert.equal(fields['btn-truckersvn'].textContent, 'Install TruckerSVN Tool')
  state.truckersvnStatus.installed = true
  companions.renderTruckerSVNButton()
  assert.equal(fields['btn-truckersvn'].textContent, 'Open TruckerSVN Tool')
  assert.match(fields['btn-truckersvn'].title, /Native macOS/)
  state.truckersvnStatus.installing = true
  companions.renderTruckerSVNButton()
  assert.equal(fields['btn-truckersvn'].disabled, true)
})
test('opening the native tool uses Launch Services and connects the selected bottle without Wine', async (t) => {
  const f = fixture(t)
  const { handlers, ipcMain } = registry()
  let opened, connected
  const selected = { standalone: true, gameDir: '/selected/game', bottlePath: '/selected/bottle' }
  const native = {
    installed: true,
    appPath: '/native/HGL Portal Hub.app',
    executable: '/native/tool'
  }
  const { registerCompanionHandlers } = loadModule('src/main/companions.js', {
    child_process: {
      execFile: (...args) => {
        opened = args
        args.at(-1)(null)
      }
    },
    '../truckersvn': { getToolStatus: () => native },
    '../truckersvn-context': {
      connectToolToBottle: async (...args) => {
        connected = args
        return { configured: true, message: 'Connected' }
      }
    }
  })
  registerCompanionHandlers({
    ipcMain,
    state: {},
    paths: { dataDir: f.root },
    wine: { selectedWineContext: () => selected }
  })
  const result = await handlers.get('truckersvn:open')(null, {})
  assert.equal(result.ok, true)
  assert.equal(result.configured, true)
  assert.equal(opened[0], '/usr/bin/open')
  assert.equal(opened[1][1], native.appPath)
  assert.equal(connected[0], selected)
  assert.equal(connected[1], native)
})
