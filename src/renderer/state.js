export function createState() {
  return {
    settings: {},
    detected: {},
    running: false,
    launching: false,
    gameLaunchPhase: 'idle',
    gameLaunchPid: null,
    gameLaunchRequest: 0,
    steamRunning: false,
    steamOperation: false,
    steamStatusBusy: false,
    haulLogStatus: null,
    haulLogBusy: false,
    truckersvnStatus: null,
    truckersvnBusy: false,
    readiness: { wine: false, cli: false, steam: false, game: false, bottle: false },
    logs: []
  }
}
