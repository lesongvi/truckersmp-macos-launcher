const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const {
  getHaulLogStatus,
  registryInstallPath,
  selectInstaller,
  extractInstaller
} = require('../src/haullog')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'haullog-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const context = {
    bottlePath: path.join(root, 'bottle'),
    gameDir: path.join(root, 'game'),
    winePath: path.join(root, 'wine')
  }
  const write = (file, content = '') => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  write(context.winePath)
  fs.mkdirSync(path.join(context.bottlePath, 'drive_c'), { recursive: true })
  return { root, context, write }
}

test('installation is disabled until the selected Windows game is installed', (t) => {
  const { context, write } = fixture(t)
  assert.equal(getHaulLogStatus(context).canInstall, false)
  write(path.join(context.gameDir, 'bin/win_x64/eurotrucks2.exe'))
  assert.equal(getHaulLogStatus(context).canInstall, true)
})

test('application and game plugin are checked separately in the selected bottle and game', (t) => {
  const { context, write } = fixture(t)
  write(path.join(context.gameDir, 'bin/win_x64/eurotrucks2.exe'))
  const exe = path.join(
    context.bottlePath,
    'drive_c/users/driver/AppData/Local/haullog/haullog.exe'
  )
  write(exe)
  let status = getHaulLogStatus(context)
  assert.equal(status.appInstalled, true)
  assert.equal(status.appPath, exe)
  assert.equal(status.pluginInstalled, false)
  write(path.join(context.gameDir, 'bin/win_x64/plugins/haullog.dll'))
  status = getHaulLogStatus(context)
  assert.equal(status.pluginInstalled, true)
})

test('custom HaulLog install locations are read from Wine registry', (t) => {
  const { context, write } = fixture(t)
  write(
    path.join(context.bottlePath, 'user.reg'),
    '[Software\\\\TruckerSVN\\\\Haul Log] 123\n"InstallPath"=' +
      JSON.stringify('C:\\Tools\\HaulLog') +
      '\n'
  )
  const installed = path.join(context.bottlePath, 'drive_c/Tools/HaulLog')
  write(path.join(installed, 'haullog.exe'))
  assert.equal(registryInstallPath(context.bottlePath), installed)
  assert.equal(getHaulLogStatus(context).appInstalled, true)
})

test('installer entry selection rejects ambiguous and escaping paths', () => {
  assert.equal(
    selectInstaller(['readme.txt', 'release/HaulLog-Installer.exe']),
    'release/HaulLog-Installer.exe'
  )
  for (const entries of [
    [],
    ['../HaulLog-Installer.exe'],
    ['/HaulLog-Installer.exe'],
    ['a/HaulLog-Installer.exe', 'b/HaulLog-Installer.exe']
  ])
    assert.throws(() => selectInstaller(entries))
})

test('ZIP extraction writes only the selected installer to the fixed output path', async (t) => {
  const { root, write } = fixture(t)
  const exe = path.join(root, 'HaulLog-Installer.exe')
  const other = path.join(root, 'unrelated.txt')
  write(exe, 'MZ installer fixture')
  write(other, 'unrelated content')
  const archive = path.join(root, 'installer.zip')
  execFileSync('/usr/bin/zip', ['-j', archive, exe, other], { stdio: 'ignore' })
  const target = path.join(root, 'extracted.exe')
  await extractInstaller(archive, target)
  assert.equal(fs.readFileSync(target, 'utf8'), 'MZ installer fixture')
})
