const fs = require('fs')
const path = require('path')
const os = require('os')
const {spawn, execFile, execFileSync, execSync} = require('child_process')
function createWineProgramRunner({paths,wine,defaultProgress=()=>{}}) {
const {dataDir:SW_DIR}=paths
const {standaloneWineEnv}=wine
async function launchWineProgram(context, exePath, logName, options = {}) {
  const {label = 'HaulLog', onExit = () => {}, progress = defaultProgress, args = [], extraEnv = {}, waitForExit = false, successCodes = [0]} = options
  const {winePath, bottlePath, standalone} = context
  const env = standalone
    ? standaloneWineEnv(winePath, bottlePath, {WINEDEBUG:'err+all'})
    : {...process.env, WINEPREFIX:bottlePath, CX_BOTTLE:path.basename(bottlePath), WINEDEBUG:'err+all'}
  Object.assign(env, extraEnv)
  const logPath = path.join(SW_DIR, logName)
  fs.mkdirSync(SW_DIR, {recursive:true})
  const fd = fs.openSync(logPath, 'w')
  let child
  try {
    child = spawn(winePath, [exePath, ...args], {env, cwd:path.dirname(exePath), detached:true, stdio:['ignore', fd, fd]})
  } finally { fs.closeSync(fd) }
  return await new Promise(resolve => {
    let timer
    child.once('error', err => {
      clearTimeout(timer); onExit()
      const error = `Could not launch ${label}: ${err.message}`
      progress({phase:'error', message:error})
      resolve({ok:false, error})
    })
    child.once('spawn', () => {
      if (!waitForExit) {
        child.unref()
        timer = setTimeout(() => resolve({ok:true, launched:true, logPath}), 1200)
      }
    })
    child.once('exit', code => {
      clearTimeout(timer); onExit()
      if (successCodes.includes(code)) resolve({ok:true, launched:true, logPath})
      else {
        const error = `${label} exited with code ${code}. See ${logPath}`
        progress({phase:'error', message:error})
        resolve({ok:false, error})
      }
    })
  })
}

return launchWineProgram
}
module.exports={createWineProgramRunner}
