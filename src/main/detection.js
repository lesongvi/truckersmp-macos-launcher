const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile, execFileSync, execSync} = require('child_process')
const CX_APP  = '/Applications/CrossOver.app'
// Node's spawn() can fail with ENOEXEC (-8) when trying to execute a Python
// script directly if the shebang interpreter is not in the expected location.
// We read the shebang and try each candidate interpreter ourselves so Node
// always spawns a real binary, not a script.
function resolveInterpreter(cliPath) {
  // Read shebang line (#! /usr/bin/env python3  or  #!/opt/homebrew/bin/python3 etc.)
  let shebangInterp = null
  try {
    const firstLine = fs.readFileSync(cliPath, { encoding: 'utf8', flag: 'r' })
      .split('\n')[0] || ''
    if (firstLine.startsWith('#!')) {
      // Strip #! and split on whitespace; handle "#!/usr/bin/env python3"
      const parts = firstLine.replace('#!', '').trim().split(/\s+/)
      if (parts[0] === '/usr/bin/env') {
        shebangInterp = parts[1] || null   // e.g. "python3"
      } else {
        shebangInterp = parts[0] || null   // e.g. "/opt/homebrew/bin/python3"
      }
    }
  } catch {}

  // Candidate Python interpreters to try, in priority order
  const candidates = [
    shebangInterp,                           // whatever the script's shebang says
    '/opt/homebrew/bin/python3',             // Homebrew (Apple Silicon default)
    '/usr/local/bin/python3',                // Homebrew (Intel)
    '/usr/bin/python3',                      // macOS system Python
    'python3',                               // whatever is in PATH
    'python',
  ].filter(Boolean)

  // Also scan ~/Library/Python/ for any version's python3 binary
  const libPy = path.join(os.homedir(), 'Library', 'Python')
  if (fs.existsSync(libPy)) {
    let vers = []
    try { vers = fs.readdirSync(libPy) } catch {}
    vers.sort((a, b) => {
      const [,ai] = a.split('.').map(Number)
      const [,bi] = b.split('.').map(Number)
      return (bi||0) - (ai||0)
    })
    for (const v of vers) {
      candidates.push(path.join(libPy, v, 'bin', 'python3'))
    }
  }

  for (const c of candidates) {
    if (!c) continue
    // Absolute paths: check existence + executable bit
    if (c.startsWith('/')) {
      try { fs.accessSync(c, fs.constants.X_OK); return c } catch {}
    } else {
      // Name only — use `which` to resolve it
      try {
        const w = execFileSync('which', [c], { timeout: 2000 }).toString().trim()
        if (w && fs.existsSync(w)) return w
      } catch {}
    }
  }

  // No interpreter found — return null and let spawn() try directly
  return null
}
const HOME = os.homedir()

const CX_WINE = [
  '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine64',
  '/Applications/CrossOver.app/Contents/SharedSupport/CrossOver/bin/wine'
]
// Static candidate list — covers all common macOS Python install locations.
const CLI_PATHS_STATIC = [
  '/opt/homebrew/bin/truckersmp-cli',
  '/usr/local/bin/truckersmp-cli',
  '/usr/bin/truckersmp-cli',
  `${HOME}/.local/bin/truckersmp-cli`,
  `${HOME}/bin/truckersmp-cli`,
  // pipx installs
  `${HOME}/.local/pipx/venvs/truckersmp-cli/bin/truckersmp-cli`,
  // python.org user installs in ~/Library/Python/3.x — 3.8 through 3.15 covered
  ...[8,9,10,11,12,13,14,15].map(v => `${HOME}/Library/Python/3.${v}/bin/truckersmp-cli`),
  // python.org system-level installs in /Library/Frameworks/Python.framework
  ...[8,9,10,11,12,13,14,15].map(v => `/Library/Frameworks/Python.framework/Versions/3.${v}/bin/truckersmp-cli`),
]
const CX_BOTTLES = `${HOME}/Library/Application Support/CrossOver/Bottles`
// Scans ~/Library/Python/ and /Library/Frameworks/Python.framework/ for any
// installed Python version and checks for truckersmp-cli. Also tries `which`.
function sortVersionsDesc(versions) {
  return versions.slice().sort((a, b) => {
    const parse = s => s.split('.').map(Number)
    const av = parse(a), bv = parse(b)
    for (let i = 0; i < Math.max(av.length, bv.length); i++) {
      const diff = (bv[i] || 0) - (av[i] || 0)
      if (diff !== 0) return diff
    }
    return 0
  })
}

function findCLIPath() {
  // 1. Static candidates first
  for (const p of CLI_PATHS_STATIC) {
    if (fs.existsSync(p)) return p
  }

  // 2. Dynamically scan ~/Library/Python/ (pip3 --user installs)
  const libraryPython = path.join(HOME, 'Library', 'Python')
  if (fs.existsSync(libraryPython)) {
    let versions = []
    try { versions = fs.readdirSync(libraryPython) } catch {}
    for (const ver of sortVersionsDesc(versions)) {
      const p = path.join(libraryPython, ver, 'bin', 'truckersmp-cli')
      if (fs.existsSync(p)) return p
    }
  }

  // 3. Dynamically scan /Library/Frameworks/Python.framework/ (python.org installer)
  const frameworkPython = '/Library/Frameworks/Python.framework/Versions'
  if (fs.existsSync(frameworkPython)) {
    let versions = []
    try { versions = fs.readdirSync(frameworkPython) } catch {}
    for (const ver of sortVersionsDesc(versions)) {
      const p = path.join(frameworkPython, ver, 'bin', 'truckersmp-cli')
      if (fs.existsSync(p)) return p
    }
  }

  // 4. `which truckersmp-cli` — picks up any PATH-installed version
  try {
    const out = execFileSync('which', ['truckersmp-cli'], { timeout: 3000 }).toString().trim()
    if (out && fs.existsSync(out)) return out
  } catch {}

  // 4. Try common pip3 --user install output paths from `pip3 show`
  try {
    const pip = execFileSync('pip3', ['show', '-f', 'truckersmp-cli'], { timeout: 5000 }).toString()
    const locM  = pip.match(/^Location:\s*(.+)$/m)
    const fileM = pip.match(/^\s+(bin\/truckersmp-cli)\s*$/m)
    if (locM && fileM) {
      // Location is the site-packages dir; bin is one level up
      const candidate = path.resolve(locM[1].trim(), '..', fileM[1].trim())
      if (fs.existsSync(candidate)) return candidate
    }
  } catch {}

  return null
}

function runAutoDetect() {
  const r = {
    cliPath:'', winePath:'', bottlePath:'', steamDir:'', gameDir:'',
    crossoverFound:false, cliFound:false, bottleFound:false, steamFound:false, gameFound:false
  }

  for (const p of CX_WINE) {
    if (fs.existsSync(p)) { r.winePath = p; r.crossoverFound = true; break }
  }
  const cli = findCLIPath()
  if (cli) { r.cliPath = cli; r.cliFound = true }
  if (fs.existsSync(CX_BOTTLES)) {
    r.bottleFound = true
    try {
      const bottles = fs.readdirSync(CX_BOTTLES)
      for (const b of bottles) {
        const full   = path.join(CX_BOTTLES, b)
        const steam1 = path.join(full, 'drive_c', 'Program Files (x86)', 'Steam')
        const steam2 = path.join(full, 'drive_c', 'Program Files', 'Steam')
        const steam  = fs.existsSync(steam1) ? steam1 : fs.existsSync(steam2) ? steam2 : null
        if (steam) {
          r.bottlePath  = full
          r.steamDir    = steam
          r.steamFound  = true
          const ets2 = path.join(steam, 'steamapps', 'common', 'Euro Truck Simulator 2')
          if (fs.existsSync(ets2)) { r.gameDir = ets2; r.gameFound = true }
          break
        }
      }
      if (!r.bottlePath && bottles.length > 0)
        r.bottlePath = path.join(CX_BOTTLES, bottles[0])
    } catch(e) { console.error(e) }
  }
  return r
}

module.exports = {resolveInterpreter, runAutoDetect, findCLIPath, sortVersionsDesc}
