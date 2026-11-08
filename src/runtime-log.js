const { createInterface } = require('readline')

function runtimeLogKind(line) {
  const text = line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim()
  // truckersmp-cli logs progress (including asset filenames) to stderr.
  // Honour its explicit level before examining the message itself.
  const level = /^\*\*\s*(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s*\*\*/i
    .exec(text)?.[1]
    .toUpperCase()
  if (level)
    return {
      DEBUG: 'info',
      INFO: 'info',
      WARNING: 'warn',
      WARN: 'warn',
      ERROR: 'error',
      CRITICAL: 'error'
    }[level]
  const wineLevel = /^(?:[0-9a-f]+:)*(err|warn|fixme|trace):/i.exec(text)?.[1].toLowerCase()
  if (wineLevel) return { err: 'error', warn: 'warn', fixme: 'info', trace: 'info' }[wineLevel]
  // Match severity words, not the same characters inside paths or filenames.
  if (
    /(?:^|[\s\[])(?:error|fatal|critical|exception)(?=$|[\s:\]])/i.test(text) ||
    /\b\w*(?:Error|Exception):/.test(text)
  )
    return 'error'
  if (/(?:^|[\s\[])warn(?:ing)?(?=$|[\s:\]])/i.test(text)) return 'warn'
  if (/\b(?:success|done|started)\b/i.test(text)) return 'success'
  return 'info'
}

function readRuntimeLines(stream, onLine) {
  // A pipe chunk can split a filename, severity prefix, or UTF-8 character.
  // readline retains partial lines and emits the final line at EOF.
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  lines.on('line', (line) => {
    if (line.trim()) onLine(line)
  })
  return lines
}

module.exports = { runtimeLogKind, readRuntimeLines }
