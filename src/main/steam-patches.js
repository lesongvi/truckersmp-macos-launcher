const fs = require('fs')
const path = require('path')

function patchCEFLocalState(steamDir, bottlePath) {
  const pathsToTry = []
  const log = []

  // Legacy / fallback: <steamDir>/config/cef_cache/Local State
  if (steamDir) pathsToTry.push(path.join(steamDir, 'config', 'cef_cache', 'Local State'))

  // Correct path: <bottle>/drive_c/users/<winuser>/AppData/Local/Steam/htmlcache/Local State
  // Steam passes this directory via -cachedir to steamwebhelper.exe.
  if (bottlePath) {
    const usersDir = path.join(bottlePath, 'drive_c', 'users')
    if (fs.existsSync(usersDir)) {
      const systemAccounts = new Set([
        'Public',
        'All Users',
        'Default',
        'Default User',
        'Default User.DEFAULT'
      ])
      try {
        // Use withFileTypes so we can skip macOS metadata files (.DS_Store, etc.)
        // that are not directories — treating them as usernames produces ENOTDIR errors.
        const entries = fs.readdirSync(usersDir, { withFileTypes: true })
        const userEntries = entries.filter((e) => e.isDirectory() && !systemAccounts.has(e.name))
        log.push(
          `[CEF] Bottle users found: ${userEntries.length ? userEntries.map((e) => e.name).join(', ') : '(none)'}`
        )
        for (const entry of userEntries) {
          pathsToTry.push(
            path.join(usersDir, entry.name, 'AppData', 'Local', 'Steam', 'htmlcache', 'Local State')
          )
        }
      } catch (e) {
        log.push(`[CEF] Could not scan users dir: ${e.message}`)
      }
    } else {
      log.push(`[CEF] ⚠ Bottle users dir not found: ${path.join(bottlePath, 'drive_c', 'users')}`)
    }
  }

  log.push(`[CEF] Patching ${pathsToTry.length} Local State path(s)…`)

  for (const localStatePath of pathsToTry) {
    // Un-lock in case we made it read-only on a previous launch
    try {
      fs.chmodSync(localStatePath, 0o644)
    } catch {}

    let state = {}
    const exists = fs.existsSync(localStatePath)
    if (exists) {
      try {
        state = JSON.parse(fs.readFileSync(localStatePath, 'utf8'))
      } catch {}
    } else {
      try {
        fs.mkdirSync(path.dirname(localStatePath), { recursive: true })
      } catch {}
    }

    // Root-level key — this is what Chromium/CEF actually reads to decide
    // whether to launch the GPU subprocess (hardware_acceleration_mode.enabled).
    // The gpu-nested path is kept for compatibility with older CEF builds that
    // may also check under gpu.hardware_acceleration_mode.enabled.
    if (!state.hardware_acceleration_mode) state.hardware_acceleration_mode = {}
    state.hardware_acceleration_mode.enabled = false
    if (!state.gpu) state.gpu = {}
    if (!state.gpu.hardware_acceleration_mode) state.gpu.hardware_acceleration_mode = {}
    state.gpu.hardware_acceleration_mode.enabled = false
    try {
      fs.writeFileSync(localStatePath, JSON.stringify(state, null, 2), 'utf8')
      // Lock read-only: prevents Steam from resetting hw-accel back to true
      // during its own startup before steamwebhelper reads this file.
      try {
        fs.chmodSync(localStatePath, 0o444)
      } catch {}
      log.push(
        `[CEF] ✓ hw-accel disabled + locked: …/${path.relative(bottlePath || steamDir || '', localStatePath)}`
      )
      console.log('[CEF] Patched + locked Local State →', localStatePath)
    } catch (e) {
      log.push(
        `[CEF] ✗ Failed to patch ${path.basename(path.dirname(localStatePath))}: ${e.message}`
      )
    }
  }

  return log
}

function clearCEFGpuCache(bottlePath) {
  const log = []
  if (!bottlePath) return log
  const usersDir = path.join(bottlePath, 'drive_c', 'users')
  if (!fs.existsSync(usersDir)) return log
  const systemAccounts = new Set([
    'Public',
    'All Users',
    'Default',
    'Default User',
    'Default User.DEFAULT'
  ])
  try {
    for (const entry of fs.readdirSync(usersDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || systemAccounts.has(entry.name)) continue
      const uname = entry.name
      const gpuCache = path.join(
        usersDir,
        uname,
        'AppData',
        'Local',
        'Steam',
        'htmlcache',
        'GPUCache'
      )
      if (fs.existsSync(gpuCache)) {
        try {
          fs.rmSync(gpuCache, { recursive: true, force: true })
          log.push(`[CEF] ✓ GPUCache cleared for user: ${uname}`)
          console.log('[CEF] Cleared GPUCache →', gpuCache)
        } catch (e) {
          log.push(`[CEF] ✗ Failed to clear GPUCache for ${uname}: ${e.message}`)
        }
      }
    }
    if (!log.length) log.push('[CEF] GPUCache: nothing to clear')
  } catch (e) {
    log.push(`[CEF] GPUCache scan error: ${e.message}`)
  }
  return log
}

// Check for files that Steam creates in AppData/Local/Steam when its UI is ready.
module.exports = { patchCEFLocalState, clearCEFGpuCache }
