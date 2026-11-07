const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {downloadFile} = require('./download-file')
const {isWindowsExecutable} = require('./windows-version')

const RELEASES_URL = 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/8.0/releases.json'
const stable8 = version => /^8\.0\.\d+$/.test(version)
const newestFirst = (a, b) => b.localeCompare(a, undefined, {numeric:true})

// Check the Windows x64 installation in this bottle, never the Mac's .NET or Mono.
function findDesktopRuntime(bottlePath) {
  if (!bottlePath) return null
  const root = path.join(bottlePath, 'drive_c', 'Program Files', 'dotnet')
  if (!isWindowsExecutable(path.join(root, 'dotnet.exe'))) return null
  const versions = folder => {
    try { return fs.readdirSync(folder).filter(stable8).sort(newestFirst) } catch { return [] }
  }
  const host = versions(path.join(root, 'host', 'fxr')).find(version => isWindowsExecutable(path.join(root, 'host', 'fxr', version, 'hostfxr.dll')))
  const core = versions(path.join(root, 'shared', 'Microsoft.NETCore.App')).find(version => isWindowsExecutable(path.join(root, 'shared', 'Microsoft.NETCore.App', version, 'coreclr.dll')))
  const desktop = versions(path.join(root, 'shared', 'Microsoft.WindowsDesktop.App')).find(version => {
    const folder = path.join(root, 'shared', 'Microsoft.WindowsDesktop.App', version)
    try { return fs.statSync(path.join(folder, 'PresentationFramework.dll')).size > 0 && isWindowsExecutable(path.join(folder, 'wpfgfx_cor3.dll')) } catch { return false }
  })
  return host && core && desktop ? {root, version:desktop} : null
}

function selectDesktopRelease(metadata) {
  const releases = metadata.releases?.map(release => release.windowsdesktop).filter(release => release && stable8(release.version))
    .sort((a, b) => newestFirst(a.version, b.version)) || []
  for (const release of releases) {
    const file = release.files?.find(file => file.rid === 'win-x64' && file.name === 'windowsdesktop-runtime-win-x64.exe')
    if (!file) continue
    const url = new URL(file.url)
    if (url.protocol !== 'https:' || !['builds.dotnet.microsoft.com', 'download.visualstudio.microsoft.com', 'dotnetcli.azureedge.net'].includes(url.hostname) || !/^[a-f0-9]{128}$/i.test(file.hash || ''))
      throw new Error('Microsoft returned invalid .NET Desktop Runtime download metadata.')
    return {...file, version:release.version}
  }
  throw new Error('No Windows x64 .NET 8 Desktop Runtime was found in Microsoft release metadata.')
}

async function ensureDesktopRuntime(context, folder, {getMetadata, launch, onProgress = () => {}, download = downloadFile}) {
  const existing = findDesktopRuntime(context.bottlePath)
  if (existing) return existing
  onProgress({phase:'runtime', message:'Preparing Windows .NET 8 Desktop Runtime…'})
  const release = selectDesktopRelease(JSON.parse((await getMetadata(RELEASES_URL)).toString()))
  const installer = path.join(folder, 'windowsdesktop-runtime-win-x64.exe')
  await download(release.url, installer, data => onProgress({...data, message:'Downloading Windows .NET 8 Desktop Runtime…'}), '.NET Desktop Runtime download')
  const hash = crypto.createHash('sha512').update(fs.readFileSync(installer)).digest('hex')
  if (hash !== release.hash.toLowerCase() || !isWindowsExecutable(installer, [0x14c, 0x8664]))
    throw new Error('.NET Desktop Runtime download did not match Microsoft’s checksum or Windows installer format.')
  onProgress({phase:'runtime', message:'Installing Windows .NET 8 Desktop Runtime. Please wait…'})
  // Await the installer exit, rather than treating a running installer as ready.
  const result = await launch(context, installer, 'haullog-dotnet-install.log', {
    label:'.NET Desktop Runtime setup', args:['/install', '/quiet', '/norestart'],
    // Wine exposes Windows' reboot-required code 3010 as Unix status 194.
    waitForExit:true, successCodes:[0, 3010, 3010 & 0xff], progress:onProgress,
  })
  if (!result.ok) throw new Error(result.error || '.NET Desktop Runtime setup failed. See haullog-dotnet-install.log.')
  const runtime = findDesktopRuntime(context.bottlePath)
  if (!runtime) throw new Error('.NET 8 Desktop Runtime is still missing from this Wine bottle. See haullog-dotnet-install.log, then retry Install HaulLog.')
  return runtime
}

module.exports = {RELEASES_URL, findDesktopRuntime, selectDesktopRelease, ensureDesktopRuntime}
