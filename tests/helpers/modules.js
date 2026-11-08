const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')

// Load an entire service with selected dependency replacements. Tests exercise
// its public exports, without extracting function text from another file.
function loadModule(relative, replacements = {}) {
  const filename = path.resolve(__dirname, '../..', relative)
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = loaded.require.bind(loaded)
  loaded.require = (name) =>
    Object.hasOwn(replacements, name) ? replacements[name] : original(name)
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename)
  return loaded.exports
}
function registry() {
  const handlers = new Map()
  return {
    handlers,
    ipcMain: {
      handle(name, callback) {
        if (handlers.has(name)) throw new Error('Duplicate IPC handler: ' + name)
        handlers.set(name, callback)
      }
    }
  }
}
module.exports = { loadModule, registry }
