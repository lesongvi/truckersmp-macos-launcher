const fs = require('fs')
const path = require('path')
const http = require('http')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execute = promisify(execFile)

function winePathToHost(bottlePath, windowsPath) {
  const match = /^([a-z]):[\\/](.*)$/i.exec(windowsPath)
  if (!match) return ''
  const parts = match[2].split(/[\\/]/)
  if (parts.includes('..') || parts.some((part) => part.includes('\0'))) return ''
  const drive = match[1].toLowerCase()
  if (drive === 'c') return path.join(bottlePath, 'drive_c', ...parts)
  if (drive === 'z') return path.join('/', ...parts)
  const mapped = path.join(bottlePath, 'dosdevices', drive + ':')
  return fs.existsSync(mapped) ? path.join(mapped, ...parts) : ''
}

function findWineDocuments(bottlePath, requiredEntry = 'profiles') {
  if (!bottlePath) return ''
  const candidates = []
  try {
    let shell = false
    for (const line of fs.readFileSync(path.join(bottlePath, 'user.reg'), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('['))
        shell = /\\\\Explorer\\\\(?:User Shell Folders|Shell Folders)\]/.test(line)
      else if (shell && line.startsWith('"Personal"="'))
        candidates.push(winePathToHost(bottlePath, JSON.parse(line.slice(line.indexOf('=') + 1))))
    }
  } catch {}
  const users = path.join(bottlePath, 'drive_c', 'users')
  try {
    for (const user of fs.readdirSync(users, { withFileTypes: true })) {
      if (!user.isDirectory() || /^(public|default|all users)$/i.test(user.name)) continue
      for (const name of ['Documents', 'My Documents'])
        candidates.push(path.join(users, user.name, name))
    }
  } catch {}
  return (
    candidates.find(
      (folder) =>
        folder && fs.existsSync(path.join(folder, 'Euro Truck Simulator 2', requiredEntry))
    ) || ''
  )
}

function configurationForBottle(context, current) {
  if (
    !context.bottlePath ||
    !context.gameDir ||
    !fs.existsSync(path.join(context.gameDir, 'bin', 'win_x64', 'eurotrucks2.exe')) ||
    !fs.existsSync(path.join(context.gameDir, 'base.scs'))
  )
    throw new Error(
      'Configure the selected Wine bottle and finish installing ETS2 before connecting TruckerSVN Tool.'
    )
  const documents = findWineDocuments(context.bottlePath)
  if (!documents) return null
  const configFile = path.join(documents, 'Euro Truck Simulator 2', 'config.cfg')
  let gameConfig
  try {
    gameConfig = fs.readFileSync(configFile, 'utf8')
  } catch {
    return null
  }
  const flag = (key) => new RegExp('\\b' + key + '\\s+"(\\d+)"').exec(gameConfig)?.[1]
  return {
    ...current,
    selectedGame: 'ets2',
    ets2GamePath: context.gameDir,
    documentPath: documents,
    // The Tool's config API writes these flags back to config.cfg. Preserve
    // the selected Wine game's values instead of copying another game's flags.
    developerMode: flag('g_developer') === '1',
    consoleMode: flag('g_console') === '1',
    maxConvoySize128: flag('g_max_convoy_size') === '128'
  }
}

function requestConfig(method, config, port = 18000, endpoint = '/api/tool-config') {
  return new Promise((resolve, reject) => {
    const body = config ? JSON.stringify(config) : ''
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: endpoint,
        method,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
          : {}
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => {
          text += chunk
          if (text.length > 1024 * 1024)
            response.destroy(new Error('TruckerSVN configuration response is too large.'))
        })
        response.on('error', reject)
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(
              new Error(
                `TruckerSVN Tool rejected its game configuration (HTTP ${response.statusCode}).`
              )
            )
            return
          }
          try {
            resolve(JSON.parse(text))
          } catch {
            reject(new Error('TruckerSVN Tool returned invalid configuration.'))
          }
        })
      }
    )
    request.setTimeout(2000, () =>
      request.destroy(new Error('TruckerSVN configuration request timed out.'))
    )
    request.on('error', reject)
    request.end(body)
  })
}

// Port 18000 can belong to the Windows tool, the headless tool, or another app.
// Only write configuration when this native bundle owns the listening process.
async function ownsConfigServer(executable, run = execute) {
  try {
    const { stdout } = await run(
      '/usr/sbin/lsof',
      ['-nP', '-a', '-iTCP:18000', '-sTCP:LISTEN', '-Fp'],
      { encoding: 'utf8', timeout: 3000 }
    )
    const pids = [
      ...new Set(
        stdout
          .split(/\r?\n/)
          .filter((line) => /^p\d+$/.test(line))
          .map((line) => line.slice(1))
      )
    ]
    if (pids.length !== 1) return false
    const { stdout: files } = await run(
      '/usr/sbin/lsof',
      ['-a', '-p', pids[0], '-d', 'txt', '-Fn'],
      { encoding: 'utf8', timeout: 3000, maxBuffer: 1024 * 1024 }
    )
    const actual = fs.realpathSync(executable)
    return files.split(/\r?\n/).some((line) => {
      if (!line.startsWith('n')) return false
      try {
        return fs.realpathSync(line.slice(1)) === actual
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

async function connectToolToBottle(
  context,
  app,
  {
    ownsServer = ownsConfigServer,
    request = (method, config, endpoint) => requestConfig(method, config, 18000, endpoint),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    attempts = 15
  } = {}
) {
  // Resolve paths before contacting the Tool. An uninitialised game should
  // leave its existing configuration intact and offer a useful next step.
  if (!configurationForBottle(context, {}))
    return {
      configured: false,
      message: 'Open ETS2 once and create a profile, then reopen TruckerSVN Tool to connect it.'
    }
  let ready = false
  for (let i = 0; i < attempts; i++) {
    if (await ownsServer(app.executable)) {
      ready = true
      break
    }
    await sleep(500)
  }
  if (!ready)
    throw new Error(
      'The native Tool opened, but its local configuration service is unavailable. Close other TruckerSVN Tool instances, then retry Open.'
    )
  const current = await request('GET')
  if (!current || typeof current !== 'object' || Array.isArray(current))
    throw new Error('TruckerSVN Tool returned invalid settings.')
  const updated = configurationForBottle(context, current)
  if (!updated)
    return {
      configured: false,
      message: 'ETS2 profiles are unavailable. Open ETS2 once, then reopen TruckerSVN Tool.'
    }
  if (!(await ownsServer(app.executable)))
    throw new Error(
      'TruckerSVN Tool closed before its game folders could be connected. Retry Open.'
    )
  const result = await request('PUT', updated)
  if (!result.success)
    throw new Error('TruckerSVN Tool did not accept the selected Wine game folders.')
  // Startup can cache native Steam profiles before the Wine folders are set.
  // Reload through the supported API so the app immediately uses this game.
  const profiles = await request('GET', undefined, '/api/profiles?reload=true')
  if (!profiles.success)
    throw new Error(
      'The game folders were connected, but TruckerSVN Tool could not reload their profiles.'
    )
  return {
    configured: true,
    profileCount: profiles.profileCount,
    message: 'Native TruckerSVN Tool connected to the selected Wine game and profiles.'
  }
}

module.exports = {
  winePathToHost,
  findWineDocuments,
  configurationForBottle,
  requestConfig,
  ownsConfigServer,
  connectToolToBottle
}
