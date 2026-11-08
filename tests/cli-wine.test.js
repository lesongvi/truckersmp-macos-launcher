const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { cliWineEnvironment } = require('../src/cli-wine')
const adapter = path.resolve(__dirname, '../src/compat/wine-cli.sh')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wine-adapter-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const bottle = path.join(root, 'Bottle with spaces')
  const system32 = path.join(bottle, 'drive_c/windows/system32')
  fs.mkdirSync(system32, { recursive: true })
  fs.writeFileSync(path.join(system32, 'tasklist.exe'), '')
  const real = path.join(root, 'real Wine')
  fs.writeFileSync(
    real,
    '#!' +
      process.execPath +
      `\nconst fs=require('fs');fs.writeFileSync(process.env.TEST_INVOCATION,JSON.stringify({args:process.argv.slice(2),prefix:process.env.WINEPREFIX,dyld:process.env.DYLD_FALLBACK_LIBRARY_PATH}));if(process.argv[2]==='tasklist.exe'){if(process.env.TEST_FAIL)process.exit(7);console.log('"steam.exe","123","Console","1","100 K"');console.log('"steamwebhelper.exe","124","Console","1","100 K"')}else console.log('delegated')\n`
  )
  fs.chmodSync(real, 0o755)
  const record = path.join(root, 'invocation.json')
  const env = cliWineEnvironment(real, bottle, {
    ...process.env,
    WINEPREFIX: bottle,
    TEST_INVOCATION: record,
    DYLD_FALLBACK_LIBRARY_PATH: '/wine libraries'
  })
  return { root, bottle, system32, real, record, env }
}
test('missing winedbg uses tasklist and emits the format expected by truckersmp-cli', (t) => {
  const f = fixture(t)
  const output = execFileSync(f.env.WINE, ['winedbg', '--command', 'info process'], {
    env: f.env,
    encoding: 'utf8'
  })
  assert.match(output, /'steam.exe'/)
  // Reproduce the installed Python CLI's quote-based extraction.
  const names = output
    .trim()
    .split('\n')
    .map((line) => {
      line = line.slice(0, -1)
      return line.slice(line.lastIndexOf("'") + 1)
    })
  assert.ok(names.includes('steam.exe'))
  const invocation = JSON.parse(fs.readFileSync(f.record))
  assert.deepEqual(invocation.args, ['tasklist.exe', '/FO', 'CSV', '/NH'])
  assert.equal(invocation.prefix, f.bottle)
  assert.equal(invocation.dyld, '/wine libraries')
})
test('all other Wine arguments pass through unchanged, including paths with spaces', (t) => {
  const f = fixture(t),
    args = ['Z:\\Game with spaces\\inject.exe', 'argument with spaces', '--literal=$not_a_variable']
  execFileSync(adapter, args, { env: f.env })
  assert.deepEqual(JSON.parse(fs.readFileSync(f.record)).args, args)
})
test('tasklist failure is propagated rather than falsely reporting an empty process list', (t) => {
  const f = fixture(t)
  assert.throws(
    () =>
      execFileSync(adapter, ['winedbg', '--command', 'info process'], {
        env: { ...f.env, TEST_FAIL: '1' },
        stdio: 'ignore'
      }),
    (error) => error.status === 7
  )
})
test('a real Wine debugger is preferred and missing helpers produce a repair instruction', (t) => {
  const f = fixture(t)
  fs.writeFileSync(path.join(f.system32, 'winedbg.exe'), '')
  assert.equal(cliWineEnvironment(f.real, f.bottle, {}).WINE, f.real)
  fs.unlinkSync(path.join(f.system32, 'winedbg.exe'))
  fs.unlinkSync(path.join(f.system32, 'tasklist.exe'))
  assert.throws(() => cliWineEnvironment(f.real, f.bottle, {}), /Repair the selected bottle/)
})
test('asar packaging explicitly unpacks the executable compatibility script', () => {
  const config = require('../package.json')
  assert.ok(config.build.asarUnpack.includes('src/compat/**'))
  fs.accessSync(adapter, fs.constants.X_OK)
})
