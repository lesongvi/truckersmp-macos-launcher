const fs = require('fs')
const path = require('path')
const {downloadFile} = require('./download-file')
const {getInstalledVersion} = require('./windows-version')
const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const { pipeline } = require('stream/promises')
const execute = promisify(execFile)

const ARCHIVE_URL = 'https://files.haullog.com/HaulLog-Installer.zip'

function registryInstallPath(bottlePath) {
  try {
    const lines = fs.readFileSync(path.join(bottlePath, 'user.reg'), 'utf8').split(/\r?\n/)
    let inSection = false
    for (const line of lines) {
      if (line.startsWith('[')) {
        inSection = line.slice(1, line.indexOf(']')).replace(/\\\\/g, '\\') === 'Software\\TruckerSVN\\Haul Log'
      } else if (inSection && line.startsWith('"InstallPath"=')) {
        const windowsPath = JSON.parse(line.slice(line.indexOf('=') + 1))
        const parts = windowsPath.replace(/\\/g, '/').split('/')
        if (!/^c:$/i.test(parts.shift()) || parts.includes('..')) return null
        return path.join(bottlePath, 'drive_c', ...parts)
      }
    }
  } catch {}
  return null
}

function getHaulLogStatus({bottlePath, gameDir, winePath}) {
  const gameReady = !!gameDir && fs.existsSync(path.join(gameDir, 'bin', 'win_x64', 'eurotrucks2.exe'))
  const pluginPath = gameDir ? path.join(gameDir, 'bin', 'win_x64', 'plugins', 'haullog.dll') : ''
  const candidates = []
  if (bottlePath) {
    const registered = registryInstallPath(bottlePath)
    if (registered) candidates.push(path.join(registered, 'haullog.exe'))
    const users = path.join(bottlePath, 'drive_c', 'users')
    try {
      for (const user of fs.readdirSync(users, {withFileTypes:true})) {
        if (user.isDirectory()) candidates.push(path.join(users, user.name, 'AppData', 'Local', 'haullog', 'haullog.exe'))
      }
    } catch {}
  }
  const appPath = candidates.find(file => fs.existsSync(file)) || ''
  return {
    ok:true, gameReady, appInstalled:!!appPath, appPath, version:getInstalledVersion(appPath),
    pluginInstalled:!!pluginPath && fs.existsSync(pluginPath), pluginPath,
    canInstall:gameReady && !!winePath && fs.existsSync(winePath) && !!bottlePath && fs.existsSync(path.join(bottlePath, 'drive_c')),
  }
}

function downloadArchive(dest, onProgress) {
  return downloadFile(ARCHIVE_URL, dest, onProgress, 'HaulLog download')
}

function selectInstaller(entries) {
  const installers = entries.filter(entry => /(?:^|\/)HaulLog-Installer\.exe$/i.test(entry))
  if (installers.length !== 1) throw new Error('HaulLog installer was not found in the archive.')
  const selected = installers[0]
  if (selected.startsWith('/') || selected.split('/').includes('..') || /[\\\0*?\[\]]/.test(selected))
    throw new Error('HaulLog archive contains an invalid installer path.')
  return selected
}

// Extract just the installer to a fixed path, rather than unpacking arbitrary ZIP paths.
async function extractInstaller(archivePath, destination) {
  const {stdout} = await execute('/usr/bin/unzip', ['-Z1', archivePath], {encoding:'utf8', timeout:10000})
  const entry = selectInstaller(stdout.split(/\r?\n/).filter(Boolean))
  const proc = spawn('/usr/bin/unzip', ['-p', archivePath, entry], {stdio:['ignore', 'pipe', 'pipe']})
  const exit = new Promise((resolve, reject) => {
    proc.once('error', reject)
    proc.once('close', code => code === 0 ? resolve() : reject(new Error(`HaulLog extraction failed (${code}).`)))
    proc.stderr.resume()
  })
  await Promise.all([pipeline(proc.stdout, fs.createWriteStream(destination)), exit])
  return destination
}

module.exports = {ARCHIVE_URL, registryInstallPath, getHaulLogStatus, downloadArchive, selectInstaller, extractInstaller}
