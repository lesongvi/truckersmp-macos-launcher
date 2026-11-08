const path = require('path')
const fs = require('fs')
const { execFile } = require('child_process')
const { promisify } = require('util')
const execute = promisify(execFile)

function parseProcesses(output) {
  return output.split('\n').flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
  })
}

function pathAliases(value) {
  if (!value) return []
  const aliases = [path.resolve(value)]
  try {
    aliases.push(fs.realpathSync(value))
  } catch {}
  return [...new Set(aliases)]
}

function isSteamProcess(proc) {
  return (
    /(?:^|[\\/\s"'])steam\.exe(?:$|[\s"'])/i.test(proc.command) &&
    !/(?:^|\/)(?:ps|pgrep|grep|bash|zsh|sh)\s/.test(proc.command)
  )
}

function matchesBottleEnvironment(environment, bottlePath) {
  return pathAliases(bottlePath).some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|\\s)WINEPREFIX=${escaped}(?=\\s+[A-Za-z_][A-Za-z0-9_]*=|$)`).test(
      environment
    )
  })
}

// A full Unix executable path identifies the installation. Windows C: paths
// require WINEPREFIX inspection because they are identical in different bottles.
async function findSteamProcesses({ bottlePath, steamDir }, run = execute) {
  if (!bottlePath) return []
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,command='], {
    encoding: 'utf8',
    timeout: 3000,
    maxBuffer: 4 * 1024 * 1024
  })
  const candidates = parseProcesses(stdout).filter(isSteamProcess)
  const aliases = pathAliases(steamDir)
  const matches = await Promise.all(
    candidates.map(async (proc) => {
      if (
        aliases.some((dir) =>
          proc.command.toLowerCase().includes((dir + '/steam.exe').toLowerCase())
        )
      )
        return proc
      try {
        const info = await run('/bin/ps', ['eww', '-p', String(proc.pid), '-o', 'command='], {
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 1024 * 1024
        })
        if (matchesBottleEnvironment(info.stdout, bottlePath)) return proc
      } catch (err) {
        // A process may exit between the list and environment queries.
        if (err.code !== 1) throw err
      }
      return null
    })
  )
  return matches.filter(Boolean)
}

module.exports = { parseProcesses, isSteamProcess, matchesBottleEnvironment, findSteamProcesses }
