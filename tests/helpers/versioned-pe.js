function versionedPE(version = [1, 2, 3, 4], pe64 = true) {
  const file = Buffer.alloc(1024)
  const optionalSize = pe64 ? 240 : 224
  const optional = 128 + 24
  const directories = optional + (pe64 ? 112 : 96)
  file.write('MZ')
  file.writeUInt32LE(128, 60)
  file.writeUInt32LE(0x4550, 128)
  file.writeUInt16LE(pe64 ? 0x8664 : 0x14c, 132)
  file.writeUInt16LE(1, 134)
  file.writeUInt16LE(optionalSize, 148)
  file.writeUInt16LE(pe64 ? 0x20b : 0x10b, optional)
  file.writeUInt32LE(16, directories - 4)
  file.writeUInt32LE(0x1000, directories + 16)
  file.writeUInt32LE(256, directories + 20)
  const section = optional + optionalSize
  file.write('.rsrc', section)
  file.writeUInt32LE(256, section + 8)
  file.writeUInt32LE(0x1000, section + 12)
  file.writeUInt32LE(256, section + 16)
  file.writeUInt32LE(512, section + 20)
  const resource = file.subarray(512, 768)
  resource.writeUInt16LE(1, 14)
  resource.writeUInt32LE(16, 16)
  resource.writeUInt32LE(0x80000018, 20)
  resource.writeUInt16LE(1, 24 + 14)
  resource.writeUInt32LE(1, 24 + 16)
  resource.writeUInt32LE(0x80000030, 24 + 20)
  resource.writeUInt16LE(1, 48 + 14)
  resource.writeUInt32LE(1033, 48 + 16)
  resource.writeUInt32LE(72, 48 + 20)
  resource.writeUInt32LE(0x1000 + 88, 72)
  resource.writeUInt32LE(92, 76)
  resource.writeUInt16LE(92, 88)
  resource.writeUInt16LE(52, 90)
  Buffer.from('VS_VERSION_INFO\0', 'utf16le').copy(resource, 94)
  const fixed = 128
  resource.writeUInt32LE(0xfeef04bd, fixed)
  resource.writeUInt32LE(0x10000, fixed + 4)
  for (const at of [8, 16]) {
    resource.writeUInt32LE(version[0] * 65536 + version[1], fixed + at)
    resource.writeUInt32LE(version[2] * 65536 + version[3], fixed + at + 4)
  }
  return file
}
module.exports = { versionedPE }
