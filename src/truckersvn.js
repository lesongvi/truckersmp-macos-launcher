const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const {execFile, execFileSync} = require('child_process')
const {promisify} = require('util')
const {downloadFile} = require('./download-file')
const execute = promisify(execFile)

const VERSION_URL = 'https://api.lsv.vn/data/1.0/truckersvn-tool/d-version?platform=macos'
const DOWNLOAD_URL = 'https://api.lsv.vn/data/1.0/truckersvn-tool/d-download-new-version?platform=macos'
const BUNDLE_ID = 'vn.truckers.hglportalhub'
const APP_NAME = 'HGL Portal Hub.app'
const cache = new Map()
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const fingerprint = file => {const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`}

function managedDirectory(dataDir) { return path.join(dataDir, 'tools') }

function readAppBundle(appPath) {
  try {
    const plist = path.join(appPath, 'Contents', 'Info.plist')
    const stamp = fingerprint(plist)
    const old = cache.get(appPath)
    const info = old?.stamp === stamp ? old.info : JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plist], {encoding:'utf8', timeout:5000}))
    const name = info.CFBundleExecutable
    if (info.CFBundleIdentifier !== BUNDLE_ID || typeof name !== 'string' || path.basename(name) !== name || name === '..') return null
    const executable = path.join(appPath, 'Contents', 'MacOS', name)
    fs.accessSync(executable, fs.constants.X_OK)
    const fd = fs.openSync(executable, 'r')
    const header = Buffer.alloc(4)
    try { if (fs.readSync(fd, header, 0, 4, 0) !== 4 || ![0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(header.readUInt32BE())) return null }
    finally { fs.closeSync(fd) }
    const binaryStamp = fingerprint(executable)
    const metadata = path.join(path.dirname(appPath), '.truckersvn-install.json')
    let metadataStamp = ''
    try { metadataStamp = fingerprint(metadata) } catch {}
    if (old?.stamp === stamp && old.binaryStamp === binaryStamp && old.metadataStamp === metadataStamp) return old.result
    let version = info.CFBundleShortVersionString || info.CFBundleVersion || ''
    if (metadataStamp) {
      try {
        const record = JSON.parse(fs.readFileSync(metadata, 'utf8'))
        if (record.bundleName === path.basename(appPath) && typeof record.version === 'string' && record.binarySha256 === sha256(executable)) version = record.version
      } catch {}
    }
    const result = {appPath, executable, version:String(version)}
    if (cache.size > 16) cache.clear()
    cache.set(appPath, {stamp, info, binaryStamp, metadataStamp, result})
    return result
  } catch { return null }
}

function getToolStatus({dataDir, homeDir = os.homedir(), applicationsDir = '/Applications'}) {
  const candidates = [path.join(managedDirectory(dataDir), APP_NAME), path.join(homeDir, 'Applications', APP_NAME), path.join(applicationsDir, APP_NAME)]
  const app = candidates.map(readAppBundle).find(Boolean)
  return {ok:true, native:true, installed:!!app, ready:!!app, canInstall:true, appPath:app?.appPath || '', executable:app?.executable || '', version:app?.version || ''}
}

function parseRelease(body) {
  const text = body.toString().trim()
  try { return JSON.parse(text) } catch (err) {
    // The official endpoint currently emits one surplus closing brace.
    // Accept that exact response defect, never arbitrary trailing content.
    if (text.endsWith('}}')) return JSON.parse(text.slice(0, -1))
    throw err
  }
}

function selectAppArchive(entries) {
  const roots = new Set()
  for (const entry of entries) {
    if (entry.startsWith('/') || /[\\\0:]/.test(entry) || entry.split('/').includes('..')) throw new Error('TruckerSVN archive contains an invalid path.')
    if (entry.startsWith('__MACOSX/')) continue
    const root = entry.split('/')[0]
    if (root.endsWith('.app')) roots.add(root)
    else if (root) throw new Error('The macOS download is not an application bundle archive.')
  }
  if (roots.size !== 1) throw new Error('The macOS download must contain exactly one application bundle.')
  return [...roots][0]
}

async function installDesktop(context, folder, getMetadata, onProgress = () => {}, download = downloadFile, run = execute) {
  const release = parseRelease(await getMetadata(VERSION_URL))
  if (typeof release.version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(release.version)) throw new Error('TruckerSVN Tool returned invalid macOS release metadata.')
  const archive = path.join(folder, 'TruckerSVN-Tool.app.zip')
  await download(DOWNLOAD_URL, archive, onProgress, 'Native TruckerSVN Tool download')
  if (release.sha256 && (!/^[a-f0-9]{64}$/i.test(release.sha256) || sha256(archive) !== release.sha256.toLowerCase())) throw new Error('TruckerSVN macOS download checksum does not match its release.')
  onProgress({phase:'extracting', message:'Preparing native TruckerSVN Tool…'})
  const {stdout} = await run('/usr/bin/unzip', ['-Z1', archive], {encoding:'utf8', timeout:10000})
  const bundleName = selectAppArchive(stdout.split(/\r?\n/).filter(Boolean))
  const stage = path.join(folder, 'unpacked')
  await run('/usr/bin/ditto', ['-x', '-k', archive, stage], {timeout:60000})
  const app = readAppBundle(path.join(stage, bundleName))
  if (!app) throw new Error('The download is not the native macOS TruckerSVN Tool.')
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app.appPath], {timeout:30000})
  const target = managedDirectory(context.dataDir)
  fs.mkdirSync(target, {recursive:true})
  const installed = path.join(target, APP_NAME)
  const previous = installed + '.previous'
  if (fs.existsSync(previous)) throw new Error('A previous TruckerSVN installation backup needs review before retrying.')
  if (fs.existsSync(installed)) fs.renameSync(installed, previous)
  try {
    fs.renameSync(app.appPath, installed)
    const info = readAppBundle(installed)
    fs.writeFileSync(path.join(target, '.truckersvn-install.json'), JSON.stringify({version:release.version, bundleName:APP_NAME, binarySha256:sha256(info.executable)}))
  } catch (err) {
    if (fs.existsSync(installed)) fs.renameSync(installed, path.join(stage, 'failed.app'))
    if (fs.existsSync(previous)) fs.renameSync(previous, installed)
    throw err
  }
  if (fs.existsSync(previous)) fs.rmSync(previous, {recursive:true})
  return getToolStatus(context)
}

module.exports = {VERSION_URL, DOWNLOAD_URL, BUNDLE_ID, APP_NAME, managedDirectory, readAppBundle, getToolStatus, parseRelease, selectAppArchive, installDesktop}
