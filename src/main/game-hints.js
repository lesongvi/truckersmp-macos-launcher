const RUNTIME_HINTS = [
  {
    pat: /bad exe format|0xc000007b|error.*193/i,
    hint: 'Check that the bottle and its Wine DLLs support 64-bit Windows applications.'
  },
  {
    pat: /no module named|importerror|modulenotfound/i,
    hint: 'A Python dependency is missing. Reinstall truckersmp-cli in the selected Python environment.'
  },
  {
    pat: /failed to get wine process list/i,
    hint: 'The Steam process check failed. Restart the launcher to load its Wine compatibility adapter and verify that tasklist.exe exists in the selected bottle.'
  },
  {
    pat: /permission denied/i,
    hint: 'Check executable permissions for truckersmp-cli and the selected Wine binary.'
  },
  {
    pat: /command not found|wine.*not found|no wine/i,
    hint: 'Check the CLI and Wine executable paths in Settings.'
  },
  {
    pat: /err:.*d3d|dxgi.*failed|err:.*opengl|vulkan/i,
    hint: 'Check the graphics error in Log. For Standalone Wine, verify the DXMT setup in the wizard.'
  },
  {
    pat: /authentication failed|auth error/i,
    hint: 'Sign into Steam and verify that the game and TruckersMP client are up to date.'
  },
  {
    pat: /connection refused|etimedout|econnreset/i,
    hint: 'Cannot reach the server. Check the connection and retry.'
  },
  { pat: /ssl.*error|certificate/i, hint: 'Check the system clock and certificate error in Log.' },
  {
    pat: /outdated|update required/i,
    hint: 'Update ETS2 and the TruckersMP client before launching again.'
  },
  {
    pat: /steam.*not found|steamclient/i,
    hint: 'Check the Steam directory inside the selected bottle.'
  },
  { pat: /game.*not found|ets2.*missing/i, hint: 'Check the selected ETS2 folder in Settings.' }
]
const EXIT_HINTS = {
  1: 'See the preceding log entries for the cause of the failure.',
  2: 'The CLI rejected its arguments. Check the command in Log.',
  126: 'The selected CLI is not executable.',
  127: 'The selected command could not be found.'
}
module.exports = { RUNTIME_HINTS, EXIT_HINTS }
