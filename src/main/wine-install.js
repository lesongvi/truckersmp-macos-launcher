const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile, execFileSync, execSync} = require('child_process')
const PINNED_WINE = require('../wine-release')
function registerWineInstall({ipcMain, state, paths, settings, wine, downloads, sendLog}) {
const {dataDir:SW_DIR,winesDir:SW_WINES_DIR}=paths
const {loadSettings,saveSettings}=settings
const {findBinary,standaloneWineBin}=wine
const {downloadToFile}=downloads
ipcMain.handle('standalone:fetchWineRelease', async () => ({
  ok:true, versions:[{ ...PINNED_WINE }], wineTestVersions:[], useNohero:true,
}))

ipcMain.handle('standalone:setActiveWine', (_, slug) => {
  try {
    if (slug !== PINNED_WINE.slug) return { ok:false, error:'This project is pinned to Wine 11.11.' }
    const s = loadSettings(); s.standalonWineSlug = slug; saveSettings(s)
    return { ok:true }
  } catch(e) { return { ok:false, error: e.message } }
})

// Download + extract a Wine tarball into the pinned installation directory
ipcMain.handle('standalone:downloadWine', async (_, url, slug, releaseName) => {
  try {
    if (url !== PINNED_WINE.url) return { ok:false, error:'This project is pinned to Wine 11.11. Use the setup wizard to install that build.' }
    slug = PINNED_WINE.slug
    releaseName = PINNED_WINE.version
    const targetDir = path.join(SW_WINES_DIR, slug)
    if (slug) fs.mkdirSync(SW_WINES_DIR, { recursive:true })
    fs.mkdirSync(SW_DIR, { recursive:true })
    const tarPath = path.join(SW_DIR, PINNED_WINE.name)
    // Download
    await downloadToFile(url, tarPath, 'standalone:wineProgress')
    const digest = await new Promise((resolve, reject) => {
      const hash = require('crypto').createHash('sha256')
      const input = fs.createReadStream(tarPath)
      input.on('data', chunk => hash.update(chunk))
      input.on('end', () => resolve(hash.digest('hex')))
      input.on('error', reject)
    })
    if (digest !== PINNED_WINE.sha256) return { ok:false, error:'Wine 11.11 archive checksum does not match the pinned release. Download it again.' }
    // Clear old extraction for this slot
    if (fs.existsSync(targetDir)) fs.rmSync(targetDir, { recursive:true, force:true })
    fs.mkdirSync(targetDir, { recursive:true })
    // Extract — do NOT use --strip-components (archive layout varies between Gcenx and YAAGL)
    state.window?.webContents.send('standalone:wineProgress', { phase:'extracting' })
    await new Promise((resolve, reject) => {
      const proc = spawn('tar', ['xf', tarPath, '-C', targetDir])
      proc.stderr.on('data', d => console.warn('tar wine:', d.toString()))
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)))
      proc.on('error', reject)
    })
    fs.unlinkSync(tarPath)
    const wineBin = findBinary(targetDir, ['wine64', 'wine'], 0)
    if (!wineBin) return { ok:false, error:'Wine extracted but wine64/wine binary not found inside the archive. Please report this at github.com/nohero765.' }
    try { fs.chmodSync(wineBin, 0o755) } catch {}
    execFileSync('/usr/bin/xattr', ['-rc', targetDir], {timeout:30000})
    // Save metadata so the wine manager can show the correct release name
    try {
      fs.writeFileSync(path.join(targetDir, '.wine-meta.json'), JSON.stringify({
        slug,
        url,
        fileName:    url ? url.split('/').pop() : '',
        releaseName: releaseName || '',
        installedAt: Date.now()
      }), 'utf8')
    } catch {}
    // Set as the active wine
    if (slug) {
      const s = loadSettings(); s.standalonWineSlug = slug; saveSettings(s)
    }
    return { ok:true, wineBin }
  } catch(e) {
    return { ok:false, error: e.message }
  }
})

ipcMain.handle('standalone:listWines', () => {
 const bin=standaloneWineBin()
 return bin ? [{slug:PINNED_WINE.slug,version:PINNED_WINE.version,active:true,isPinned:true,bin,fileName:PINNED_WINE.fileName,releaseName:PINNED_WINE.name}] : []
})
}
module.exports={registerWineInstall}
