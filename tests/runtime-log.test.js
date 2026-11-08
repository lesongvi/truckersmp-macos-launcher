const test = require('node:test')
const assert = require('node:assert/strict')
const { PassThrough } = require('node:stream')
const { runtimeLogKind, readRuntimeLines } = require('../src/runtime-log')

test('asset names are informational even when they contain severity words', () => {
  for (const line of [
    '/files/data/shared/ui/error.png',
    'error.png',
    'Downloading /files/data/shared/ui/error.png',
    'C:\\game\\fatal_error.png',
    '/files/warning.png',
    '** INFO ** Checking for errors',
    '** DEBUG ** /files/data/shared/ui/error.png'
  ])
    assert.equal(runtimeLogKind(line), 'info', line)
})

test('explicit CLI and Wine severities and real failures remain identifiable', () => {
  for (const line of [
    '** ERROR ** Cannot download /files/data/shared/ui/error.png',
    '** CRITICAL ** Startup failed',
    '\x1b[31m** ERROR ** Failed\x1b[0m',
    '0024:err:module:import_dll Library not found',
    '[ERROR] Steam failed to start',
    'FATAL: Launch failed',
    'ModuleNotFoundError: No module named requests',
    'Unhandled exception in game'
  ])
    assert.equal(runtimeLogKind(line), 'error', line)
  for (const line of [
    '** WARNING ** Download retrying',
    '0024:warn:module:Retrying',
    '[WARNING] Retrying'
  ])
    assert.equal(runtimeLogKind(line), 'warn', line)
  assert.equal(runtimeLogKind('0024:fixme:example:Unsupported operation'), 'info')
})

test('pipe chunk boundaries do not create partial filenames or broken severity prefixes', async () => {
  const stream = new PassThrough()
  const received = []
  const reader = readRuntimeLines(stream, (line) =>
    received.push({ line, kind: runtimeLogKind(line) })
  )
  const closed = new Promise((resolve) => reader.once('close', resolve))
  stream.write('/files/data/shared/ui/err')
  stream.write('or.png\r\n** ERR')
  assert.deepEqual(received, [{ line: '/files/data/shared/ui/error.png', kind: 'info' }])
  stream.end('OR ** Launch failed')
  await closed
  assert.deepEqual(received, [
    { line: '/files/data/shared/ui/error.png', kind: 'info' },
    { line: '** ERROR ** Launch failed', kind: 'error' }
  ])
})

test('multibyte text split between chunks survives intact', async () => {
  const stream = new PassThrough()
  const lines = []
  const reader = readRuntimeLines(stream, (line) => lines.push(line))
  const closed = new Promise((resolve) => reader.once('close', resolve))
  const text = Buffer.from('Đang tải\n')
  stream.write(text.subarray(0, 1))
  stream.end(text.subarray(1))
  await closed
  assert.deepEqual(lines, ['Đang tải'])
})
