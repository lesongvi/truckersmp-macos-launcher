const RUNTIME_HINTS = [
  // On CrossOver 26 ARM the only wine binary is "wine" (no wine64).
  // Error 193 is caused by a win32 (32-bit) CrossOver bottle. ETS2 and
  // truckersmp-cli.exe are 64-bit — they require a win64 bottle.
  {
    pat:/bad exe format|0xc000007b|error.*193|193.*bad exe|exe format|module not found.*wine/i,
    hint:'Error 193 (Bad EXE format) — the CrossOver bottle is 32-bit (win32).\n' +
         'ETS2 and truckersmp-cli.exe are 64-bit programs and need a 64-bit bottle.\n\n' +
         'FIX:\n' +
         '  1. Open CrossOver → click the + button to create a new bottle\n' +
         '  2. Name it "ETS2" (or anything you like)\n' +
         '  3. Set Windows version to "Windows 10" — this creates a 64-bit (win64) bottle\n' +
         '  4. Inside the new bottle, install Steam (search CrossOver\'s app library for Steam)\n' +
         '  5. Open Steam inside CrossOver → install Euro Truck Simulator 2\n' +
         '  6. In this launcher → Settings → update Bottle, Steam Dir, and Game Dir\n' +
         '     to point to the new bottle\n\n' +
         'You can verify the bottle architecture: a win64 bottle has\n' +
         '  drive_c/windows/syswow64/   inside it. A win32 bottle does not.'
  },
  // Python / CLI issues
  { pat:/no module named/,           hint:'A required Python module is missing. Try: pip3 install truckersmp-cli --upgrade' },
  { pat:/importerror|modulenotfound/, hint:'Python dependency missing. Try: pip3 install truckersmp-cli --upgrade' },
  { pat:/permission denied/,         hint:'Permission error. Try: chmod +x "$(which truckersmp-cli)"' },
  { pat:/command not found/,         hint:'A required command was not found. Verify your PATH and CLI path in Settings.' },
  // Wine / mode-aware hints
  { pat:/wine.*not found|no wine/,   hint:'Wine binary not found. Check the Wine path in Settings.' },
  { pat:/wineserver/,                hint:'wineserver error — try restarting your Wine session or running Force Kill.' },
  { pat:/err:.*d3d|dxgi.*failed/,    hint:'DirectX/D3D error. Try switching the Graphics Translator in Settings.' },
  { pat:/err:.*opengl|vulkan/,       hint:'OpenGL/Vulkan error. Try a different Graphics Translator (D3DMetal or DXVK).' },
  // TruckersMP auth / network
  { pat:/authentication failed|auth error/, hint:'TruckersMP authentication failed. Make sure you are logged into Steam and your game is up to date.' },
  { pat:/connection refused|etimedout|econnreset/, hint:'Cannot reach TruckersMP servers. Check your internet connection and firewall.' },
  { pat:/ssl.*error|certificate/,    hint:'SSL/TLS error. Your system clock may be wrong, or a firewall is blocking the connection.' },
  { pat:/outdated|update required/,  hint:'Your TruckersMP client or game version is outdated. Update ETS2 and truckersmp-cli.' },
  // Steam
  { pat:/steam.*not found|steamclient/, hint:'Steam not found inside the bottle. Make sure Steam is installed and the Steam Directory is correct in Settings.' },
  // ETS2
  { pat:/game.*not found|ets2.*missing/, hint:'ETS2 not found. Verify the Game Directory path in Settings.' },
]
const EXIT_HINTS = {
  1:   'Generic error — see the log above for details.',
  2:   'Incorrect usage of the CLI — an argument may be wrong.',
  126: 'Permission denied — truckersmp-cli is not executable. Try: chmod +x <path>',
  127: 'Command not found — the truckersmp-cli path is wrong or the file was deleted.',
}

module.exports={RUNTIME_HINTS,EXIT_HINTS}
