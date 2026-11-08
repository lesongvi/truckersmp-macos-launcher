const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { readPEVersion, getInstalledVersion } = require('../src/windows-version')
const { getHaulLogStatus } = require('../src/haullog')
const { versionedPE } = require('./helpers/versioned-pe')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'windows-version-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, content)
  }
  return { root, write }
}

test('reads installed version resources from both 32-bit and 64-bit Windows files', (t) => {
  const { root, write } = fixture(t)
  for (const pe64 of [false, true]) {
    const file = path.join(root, pe64 ? 'app64.exe' : 'app32.exe')
    write(file, versionedPE([2, 3, 4, 5], pe64))
    assert.equal(readPEVersion(file), '2.3.4.5')
  }
})

test('missing and malformed version resources return unknown without executing the app', (t) => {
  const { root, write } = fixture(t)
  assert.equal(readPEVersion(path.join(root, 'missing.exe')), '')
  const file = path.join(root, 'broken.exe')
  for (const payload of [Buffer.from('MZ'), Buffer.alloc(100), versionedPE().subarray(0, 600)]) {
    write(file, payload)
    assert.equal(readPEVersion(file), '')
  }
  const cyclic = versionedPE()
  cyclic.writeUInt32LE(0x80000000, 512 + 20)
  write(file, cyclic)
  assert.equal(readPEVersion(file), '')
})

test('uses a recorded release version only while its executable checksum matches', (t) => {
  const { root, write } = fixture(t)
  const file = path.join(root, 'tool.exe'),
    metadata = path.join(root, '.launcher-install.json')
  const original = versionedPE([1, 0, 57, 0])
  write(file, original)
  write(
    metadata,
    JSON.stringify({
      version: '1.0.70',
      sha256: crypto.createHash('sha256').update(original).digest('hex')
    })
  )
  assert.equal(getInstalledVersion(file, metadata), '1.0.70')
  write(file, versionedPE([1, 0, 71, 0]))
  fs.utimesSync(file, new Date(2000, 0, 1), new Date(2000, 0, 1))
  assert.equal(getInstalledVersion(file, metadata), '1.0.71.0')
})

test('legacy install metadata is ignored after the original file is replaced', (t) => {
  const { root, write } = fixture(t)
  const file = path.join(root, 'tool.exe'),
    metadata = path.join(root, '.launcher-install.json')
  write(file, versionedPE([1, 0, 57, 0]))
  write(metadata, JSON.stringify({ version: '1.0.70', installedAt: Date.now() }))
  assert.equal(getInstalledVersion(file, metadata), '1.0.70')
  write(file, versionedPE([1, 0, 71, 0]))
  fs.utimesSync(file, new Date(2100, 0, 1), new Date(2100, 0, 1))
  assert.equal(getInstalledVersion(file, metadata), '1.0.71.0')
})

test('HaulLog status reports the version from its selected bottle', (t) => {
  const { root, write } = fixture(t)
  const bottlePath = path.join(root, 'bottle')
  write(
    path.join(bottlePath, 'drive_c/users/driver/AppData/Local/haullog/haullog.exe'),
    versionedPE([2, 4, 1, 0])
  )
  assert.equal(getHaulLogStatus({ bottlePath }).version, '2.4.1.0')
  assert.equal(getHaulLogStatus({ bottlePath: root + '/other' }).version, '')
})
