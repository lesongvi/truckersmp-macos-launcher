const fs = require('fs')
const crypto = require('crypto')

const cache = new Map()
const stamp = (stat) => `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`

function isWindowsExecutable(file, machines = [0x8664]) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const dos = Buffer.alloc(64)
    if (
      fs.readSync(fd, dos, 0, dos.length, 0) !== dos.length ||
      dos.toString('ascii', 0, 2) !== 'MZ'
    )
      return false
    const pe = Buffer.alloc(6)
    if (fs.readSync(fd, pe, 0, pe.length, dos.readUInt32LE(60)) !== pe.length) return false
    return pe.readUInt32LE(0) === 0x4550 && machines.includes(pe.readUInt16LE(4))
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

// Read RT_VERSION/VS_FIXEDFILEINFO directly, without launching a Windows process.
// Layout: learn.microsoft.com/windows/win32/debug/pe-format and verrsrc.h.
function readPEVersion(file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const read = (offset, length) => {
      if (
        !Number.isInteger(offset) ||
        offset < 0 ||
        length < 0 ||
        length > 8 * 1024 * 1024 ||
        offset + length > size
      )
        throw new Error('Invalid PE range')
      const buffer = Buffer.alloc(length)
      if (fs.readSync(fd, buffer, 0, length, offset) !== length)
        throw new Error('Incomplete PE data')
      return buffer
    }
    const dos = read(0, 64)
    if (dos.toString('ascii', 0, 2) !== 'MZ') return ''
    const peOffset = dos.readUInt32LE(60)
    const header = read(peOffset, 24)
    if (header.readUInt32LE(0) !== 0x4550) return ''
    const sectionCount = header.readUInt16LE(6)
    if (!sectionCount || sectionCount > 96) return ''
    const optionalSize = header.readUInt16LE(20)
    const optional = read(peOffset + 24, optionalSize)
    const magic = optional.readUInt16LE(0)
    const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0
    if (
      !directories ||
      optional.length < directories + 24 ||
      optional.readUInt32LE(directories - 4) < 3
    )
      return ''
    const resourceRVA = optional.readUInt32LE(directories + 16)
    const resourceSize = optional.readUInt32LE(directories + 20)
    if (!resourceRVA || !resourceSize) return ''
    const sections = read(peOffset + 24 + optionalSize, sectionCount * 40)
    const offsetOf = (rva, length) => {
      for (let i = 0; i < sectionCount; i++) {
        const at = i * 40
        const start = sections.readUInt32LE(at + 12)
        const rawSize = sections.readUInt32LE(at + 16)
        if (rva >= start && rva + length <= start + rawSize)
          return sections.readUInt32LE(at + 20) + rva - start
      }
      throw new Error('Resource outside PE sections')
    }
    const resources = read(offsetOf(resourceRVA, resourceSize), resourceSize)
    const visited = new Set()
    const walk = (offset, depth) => {
      if (depth > 3 || visited.has(offset) || offset + 16 > resources.length) return ''
      visited.add(offset)
      const count = resources.readUInt16LE(offset + 12) + resources.readUInt16LE(offset + 14)
      if (count > 4096 || offset + 16 + count * 8 > resources.length) return ''
      for (let i = 0; i < count; i++) {
        const entry = offset + 16 + i * 8
        if (depth === 0 && resources.readUInt32LE(entry) !== 16) continue
        const target = resources.readUInt32LE(entry + 4)
        if (target & 0x80000000) {
          const version = walk(target & 0x7fffffff, depth + 1)
          if (version) return version
        } else if (target + 16 <= resources.length) {
          const rva = resources.readUInt32LE(target)
          const length = resources.readUInt32LE(target + 4)
          if (length < 6 || length > 65535) continue
          const value = read(offsetOf(rva, length), length)
          const key = Buffer.from('VS_VERSION_INFO\0', 'utf16le')
          if (
            value.readUInt16LE(0) > length ||
            value.readUInt16LE(2) < 52 ||
            !value.subarray(6, 6 + key.length).equals(key)
          )
            continue
          const fixed = (6 + key.length + 3) & ~3
          if (fixed + 52 > value.readUInt16LE(0) || value.readUInt32LE(fixed) !== 0xfeef04bd)
            continue
          const productMS = value.readUInt32LE(fixed + 16),
            productLS = value.readUInt32LE(fixed + 20)
          const ms = productMS || productLS ? productMS : value.readUInt32LE(fixed + 8)
          const ls = productMS || productLS ? productLS : value.readUInt32LE(fixed + 12)
          if (ms || ls) return [ms >>> 16, ms & 0xffff, ls >>> 16, ls & 0xffff].join('.')
        }
      }
      return ''
    }
    return walk(0, 0)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function getInstalledVersion(file, metadataPath = '') {
  if (!file) return ''
  try {
    const stat = fs.statSync(file)
    let metadataStamp = ''
    try {
      if (metadataPath) metadataStamp = stamp(fs.statSync(metadataPath))
    } catch {}
    const key = `${file}:${metadataPath}`,
      fingerprint = stamp(stat) + ':' + metadataStamp
    const cached = cache.get(key)
    if (cached?.fingerprint === fingerprint) return cached.version
    let version = ''
    if (metadataStamp && stat.size <= 256 * 1024 * 1024) {
      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        if (
          /^\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?$/.test(metadata.version) &&
          /^[a-f0-9]{64}$/i.test(metadata.sha256 || '')
        ) {
          const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
          if (actual === metadata.sha256.toLowerCase()) version = metadata.version
        } else if (
          /^\d+(?:\.\d+){1,3}$/.test(metadata.version) &&
          !metadata.sha256 &&
          Number.isFinite(metadata.installedAt)
        ) {
          // Older launcher records predate hashes. Accept only the original
          // copy's timestamps; a self-update invalidates this fallback.
          const copiedAt = Math.max(stat.mtimeMs, stat.ctimeMs)
          if (copiedAt <= metadata.installedAt + 1 && copiedAt >= metadata.installedAt - 10000)
            version = metadata.version
        }
      } catch {}
    }
    if (!version) version = readPEVersion(file)
    if (cache.size >= 64) cache.delete(cache.keys().next().value)
    cache.set(key, { fingerprint, version })
    return version
  } catch {
    return ''
  }
}

module.exports = { readPEVersion, getInstalledVersion, isWindowsExecutable }
