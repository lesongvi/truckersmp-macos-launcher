const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile, execFileSync, execSync} = require('child_process')
function createWineGraphics({standaloneWineEnv}) {
function patchWineMaxGL(bottlePath) {
  try {
    const userReg = path.join(bottlePath, 'user.reg')
    if (!fs.existsSync(userReg)) return
    let content = fs.readFileSync(userReg, 'utf8')
    let changed = false

    const fixed = content.replace(
      /(\[Software\\\\Wine\\\\Mac Driver\])\r?\n\d{9,}\r?\n/g,
      '$1\n'
    )
    if (fixed !== content) {
      content = fixed
      changed = true
      console.log('[WineGL] Removed malformed timestamp line from user.reg →', userReg)
    }

    const sectionHeader = '[Software\\\\Wine\\\\Mac Driver]'
    // Scope key-presence check to only the Mac Driver section so a matching
    // key in an unrelated section doesn't produce a false positive.
    const macDriverBlock = content.split(/(?=\[)/g)
      .find(s => s.startsWith('[Software\\\\Wine\\\\Mac Driver]')) || ''
    const hasMaxGL   = /MaxVersionGL/i.test(macDriverBlock)
    const hasMultiGL = /MultiThreadedGL/i.test(macDriverBlock)

    if (hasMaxGL && hasMultiGL) {
      // Both already present — ensure correct values
      let patched = content.replace(
        /"MultiThreadedGL"\s*=\s*"[^"]*"/i,
        '"MultiThreadedGL"="N"'
      )
      if (patched !== content) {
        content = patched
        changed = true
        console.log('[WineGL] Corrected MultiThreadedGL → N in user.reg')
      }
      // Also correct MaxVersionGL if it's not 4.1 (e.g. someone set 4.4 which fails on macOS)
      patched = content.replace(
        /"MaxVersionGL"\s*=\s*"(?!4\.1")[^"]*"/i,
        '"MaxVersionGL"="4.1"'
      )
      if (patched !== content) {
        content = patched
        changed = true
        console.log('[WineGL] Corrected MaxVersionGL → 4.1 in user.reg')
      }
      if (changed) fs.writeFileSync(userReg, content, 'utf8')
      return
    }

    // Build the entries to inject
    let entries = ''
    if (!hasMaxGL)   entries += '"MaxVersionGL"="4.1"\n'
    if (!hasMultiGL) entries += '"MultiThreadedGL"="N"\n'

    if (content.includes(sectionHeader)) {
      content = content.replace(sectionHeader, sectionHeader + '\n' + entries)
    } else {
      content += `\n${sectionHeader}\n${entries}\n`
    }
    fs.writeFileSync(userReg, content, 'utf8')
    console.log('[WineGL] Patched Mac Driver registry →', userReg,
                '| MaxVersionGL=4.1, MultiThreadedGL=N')
  } catch (e) {
    console.warn('[WineGL] Could not patch user.reg:', e.message)
  }
}

function patchRetinaMode(bottlePath, enabled) {
  try {
    const userReg = path.join(bottlePath, 'user.reg')
    if (!fs.existsSync(userReg)) return
    let content = fs.readFileSync(userReg, 'utf8')
    const retVal = enabled ? 'y' : 'n'

    // 1. Set RetinaMode in [Software\\Wine\\Mac Driver]
    const macSection = '[Software\\\\Wine\\\\Mac Driver]'
    const macBlock = content.split(/(?=\[)/g).find(s => s.startsWith('[Software\\\\Wine\\\\Mac Driver]')) || ''
    if (/"RetinaMode"/i.test(macBlock)) {
      content = content.replace(/"RetinaMode"\s*=\s*"[^"]*"/i, `"RetinaMode"="${retVal}"`)
    } else if (content.includes(macSection)) {
      content = content.replace(macSection, macSection + `\n"RetinaMode"="${retVal}"`)
    } else {
      content += `\n${macSection}\n"RetinaMode"="${retVal}"\n`
    }

    // 2. Set LogPixels DPI in [Software\\Fonts]
    // 192 DPI (0xc0) for Retina, 96 DPI (0x60) for standard — must match RetinaMode
    // or Windows apps will render at full 4K density with tiny UI elements.
    const dpiHex  = enabled ? '000000c0' : '00000060'
    const dpiVal  = `dword:${dpiHex}`
    const fontsSection = '[Software\\\\Fonts]'
    const fontsBlock = content.split(/(?=\[)/g).find(s => s.startsWith('[Software\\\\Fonts]')) || ''
    if (/"LogPixels"/i.test(fontsBlock)) {
      content = content.replace(/"LogPixels"\s*=\s*dword:[0-9a-fA-F]+/i, `"LogPixels"=${dpiVal}`)
    } else if (content.includes(fontsSection)) {
      content = content.replace(fontsSection, fontsSection + `\n"LogPixels"=${dpiVal}`)
    } else {
      content += `\n${fontsSection}\n"LogPixels"=${dpiVal}\n`
    }

    fs.writeFileSync(userReg, content, 'utf8')
    console.log(`[Retina] RetinaMode=${retVal} LogPixels=${dpiHex} written to`, userReg)
  } catch (e) {
    console.warn('[Retina] Could not patch user.reg:', e.message)
  }
}

function ensureDxmtInBottle(bottlePath, dxmtDir, winemetalPath, winePath) {
  if (!dxmtDir || !fs.existsSync(dxmtDir)) return
  const sys32    = path.join(bottlePath, 'drive_c', 'windows', 'system32')
  const syswow64 = path.join(bottlePath, 'drive_c', 'windows', 'syswow64')
  if (!fs.existsSync(sys32)) return

  // Copy 64-bit (or whatever dxmtDir contains) DLLs into system32
  const dlls = fs.readdirSync(dxmtDir).filter(f => f.toLowerCase().endsWith('.dll'))
  for (const dll of dlls) {
    try { fs.copyFileSync(path.join(dxmtDir, dll), path.join(sys32, dll)) } catch {}
  }

  // If dxmtDir is an x86_64/x64 directory, also copy its sibling x86 directory
  // into syswow64 so 32-bit Wine subprocesses (e.g. WoW64 helpers) also get DXMT.
  // DXMT uses "x86_64-windows" not bare "x86_64", so match the START of the name
  // only (no $ anchor). The 32-bit sibling is "i386-windows" in modern DXMT releases.
  const baseName = path.basename(dxmtDir).toLowerCase()
  const is64Dir  = /^(x86.?64|x64|win64)/i.test(baseName)
  if (is64Dir && fs.existsSync(syswow64)) {
    const parent = path.dirname(dxmtDir)
    const x86Dir = ['i386-windows', 'i386', 'x86', 'x32', 'win32']
      .map(n => path.join(parent, n))
      .find(d => fs.existsSync(d))
    if (x86Dir) {
      const x86Dlls = fs.readdirSync(x86Dir).filter(f => f.toLowerCase().endsWith('.dll'))
      for (const dll of x86Dlls) {
        try { fs.copyFileSync(path.join(x86Dir, dll), path.join(syswow64, dll)) } catch {}
      }
    }
  }
  // If winemetalPath was not explicitly provided by the caller, scan the parent
  // tree of dxmtDir (the extracted archive root) for known bridge library names.
  // This handles callers that don't thread the path through explicitly.
  if (!winemetalPath) {
    const bridgeNames = new Set(['winemetal.so', 'winemetal.dylib', 'libdxmtapi.dylib'])
    const scanForBridge = (dir, depth) => {
      if (depth > 4 || winemetalPath) return
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.isFile() && bridgeNames.has(e.name.toLowerCase())) {
          winemetalPath = path.join(dir, e.name); return
        }
        if (e.isDirectory()) scanForBridge(path.join(dir, e.name), depth + 1)
        if (winemetalPath) return
      }
    }
    // Start one level above dxmtDir (the x86_64/ sub-dir) to reach the archive root
    scanForBridge(path.dirname(dxmtDir), 0)
  }

  // Deploy the bridge library only when both the path is known and we have the
  // Wine binary so we can locate lib/wine/x86_64-unix/.
  if (winemetalPath && fs.existsSync(winemetalPath) && winePath) {
    // Wine lays out as: <root>/bin/wine, <root>/lib/wine/x86_64-unix/
    const wineUnixLib = path.resolve(path.dirname(winePath), '..', 'lib', 'wine', 'x86_64-unix')
    if (fs.existsSync(wineUnixLib)) {
      const destName = path.basename(winemetalPath)
      const dest = path.join(wineUnixLib, destName)
      try {
        // Back up the existing file before overwriting so a rollback is possible
        if (fs.existsSync(dest)) {
          try { fs.renameSync(dest, dest + '.bak') } catch {}
        }
        fs.copyFileSync(winemetalPath, dest)
        console.log('[DXMT] Deployed', destName, '→', dest)
      } catch(e) {
        console.warn('[DXMT] Could not deploy', destName, 'to Wine lib dir:', e.message)
      }
    } else {
      console.log('[DXMT] lib/wine/x86_64-unix not found alongside Wine binary — skipping winemetal deploy')
    }
  }
  // GitHub Actions DXMT artifacts are built with -Dwine_builtin_dll=true: the core
  // DLLs must live in <wine>/lib/wine/x86_64-windows/ to be treated as Wine builtins.
  // We deploy to BOTH system32 (native) and the wine lib dir (builtin) so the correct
  // path wins regardless of which DXMT build variant the user has downloaded.
  if (winePath && fs.existsSync(winePath)) {
    const wineLibWin = path.resolve(path.dirname(winePath), '..', 'lib', 'wine', 'x86_64-windows')
    if (fs.existsSync(wineLibWin)) {
      const coreNames = new Set(['dxgi.dll', 'd3d11.dll', 'd3d10core.dll', 'd3d10.dll', 'd3d10_1.dll', 'winemetal.dll'])
      for (const dll of dlls) {
        if (coreNames.has(dll.toLowerCase())) {
          try { fs.copyFileSync(path.join(dxmtDir, dll), path.join(wineLibWin, dll)) } catch {}
        }
      }
      console.log('[DXMT] Deployed core DLLs → lib/wine/x86_64-windows/ (builtin mode)')
    }
  }
  // ETS2 launched via Steam's Play button does NOT inherit WINEDLLOVERRIDES from the
  // launcher process. Writing overrides to user.reg makes them apply to ALL processes
  // in this WINEPREFIX — including games started from inside Steam — without any env var.
  setDxmtDllOverridesInRegistry(bottlePath)
}
// Writes dxgi/d3d11/d3d10core as "native,builtin" in the WINEPREFIX user.reg so
// Wine always loads DXMT for any process in this prefix — no env var required.
// Called every time DLLs are deployed so the registry stays in sync.
function setDxmtDllOverridesInRegistry(bottlePath) {
  const userRegPath = path.join(bottlePath, 'user.reg')
  if (!fs.existsSync(userRegPath)) {
    console.log('[DXMT] user.reg not found — DLL overrides will be applied after wineboot runs')
    return
  }
  const dllsToSet   = ['d3d10', 'd3d10_1', 'd3d10core', 'd3d11', 'dxgi']
  const overrideVal = 'native,builtin'
  try {
    let content = fs.readFileSync(userRegPath, 'utf8')
    const nl = content.includes('\r\n') ? '\r\n' : '\n'
    // Wine uses double-backslash as path separator in .reg key names
    const sectionMarker = '[Software\\\\Wine\\\\DllOverrides]'
    const sectionIdx = content.indexOf(sectionMarker)
    if (sectionIdx === -1) {
      // Section does not exist — append it
      const ts = Math.floor(Date.now() / 1000)
      const entries = dllsToSet.map(d => `"${d}"="${overrideVal}"`).join(nl)
      content = content.trimEnd() + `${nl}${nl}${sectionMarker}${nl}${ts}${nl}${entries}${nl}`
    } else {
      // Section exists — update or add each key without touching the rest of the file
      const nextSec = content.indexOf(`${nl}[`, sectionIdx + sectionMarker.length)
      const secEnd  = nextSec === -1 ? content.length : nextSec
      let section   = content.slice(sectionIdx, secEnd)
      for (const dll of dllsToSet) {
        const keyRe   = new RegExp(`^"${dll}"=.*`, 'mi')
        const keyLine = `"${dll}"="${overrideVal}"`
        if (keyRe.test(section)) {
          section = section.replace(keyRe, keyLine)
        } else {
          // Insert after the timestamp line (line 2 of the section block)
          const firstNl  = section.indexOf(nl)
          const secondNl = section.indexOf(nl, firstNl + nl.length)
          const at = secondNl !== -1 ? secondNl + nl.length : section.length
          section = section.slice(0, at) + keyLine + nl + section.slice(at)
        }
      }
      content = content.slice(0, sectionIdx) + section + content.slice(secEnd)
    }
    fs.writeFileSync(userRegPath, content, 'utf8')
    console.log('[DXMT] user.reg: dxgi/d3d11/d3d10core=native,builtin (persistent overrides)')
  } catch(e) {
    console.warn('[DXMT] Could not update user.reg:', e.message)
  }
}

// Build a correct env object for any standalone Wine spawn.
// Adds the wine bin dir to PATH so wine can find wineserver, wineloader, etc.
// Adds multiple candidate lib dirs so native macOS libs (Metal, MoltenVK) load correctly.
return {patchWineMaxGL, patchRetinaMode, ensureDxmtInBottle, setDxmtDllOverridesInRegistry}
}
module.exports={createWineGraphics}
