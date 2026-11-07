# TruckersMP for macOS

![Latest Release](https://img.shields.io/github/v/release/nohero765/truckersmp-macos)
![License](https://img.shields.io/github/license/nohero765/truckersmp-macos)
![GitHub Stars](https://img.shields.io/github/stars/nohero765/truckersmp-macos)

A macOS launcher for [TruckersMP](https://truckersmp.com) the ETS2 multiplayer mod, built with Electron. Under the hood it wraps [truckersmp-cli](https://github.com/truckersmp-cli/truckersmp-cli) and can either use **CrossOver Wine** or a fully self-contained **Standalone Wine** build to launch the game.

> **Beta release (v2.4.1 Beta) — things are subject to change.**

<p align="center">
  <img src="icon.png" width="128" alt="App Icon">
</p>

---

> [!IMPORTANT]
> I’m currently rebuilding the entire app from the ground up as a native **Swift application**. Because of this, I won’t be releasing any more updates for the Electron build for now.
>
> Any bugs, missing features, or broken stuff in the Electron version will be fixed in the new Swift version instead.
>
> You can still report any issues you find though. It helps me make sure I don’t miss anything while working on **v3.0 Stable**.

---

Need a video tutorial? Here! ↴  
<a href="https://www.youtube.com/watch?v=zh7L3ah6Bvo">
<img src="imageyt.jpg" alt="TruckersMP on Apple Silicon" width="190">
</a>

---

## Compact launcher

The main window contains the essentials:

- Game status and detection for Wine, truckersmp-cli, Steam, ETS2, HaulLog, and TruckerSVN Tool. Installed companion versions appear in Detection; unavailable version information is marked explicitly.
- CrossOver / Standalone selection, Retina, and Metal HUD.
- Start / Stop Steam, Launch / Stop ETS2 MP, Install HaulLog, and Install / Open native macOS TruckerSVN Tool.
- Re-detect, a small Settings dialog for paths, and a collapsed troubleshooting log.

Standalone Wine is pinned to **11.11**. The exact archive and SHA-256 are defined in [`src/wine-release.js`](src/wine-release.js). Other standalone builds are not selected as fallbacks.

## Requirements

| Dependency                                                                                                | Notes                                                                      |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Apple Silicon Mac                                                                                         | Required for [DXMT](https://github.com/3Shain/dxmt)                        |
| [truckersmp-cli](https://github.com/truckersmp-cli/truckersmp-cli)                                        | Install via `pip3 install truckersmp-cli`                                  |
| Euro Truck Simulator 2                                                                                    | Must be installed via Steam inside a Wine bottle                           |
| **Either:** [CrossOver](https://www.codeweavers.com/crossover) (free trial available) **or nothing else** | Standalone manages its own Wine build — no CrossOver purchase/trial needed |

> [!WARNING]
> This app supports **macOS Sequoia and above**. **macOS Sonoma** may work but isn't guaranteed Older versions are not supported.

> As of [DXMT 0.72](https://github.com/3Shain/dxmt/releases#release-v0.72), experimental Intel Mac support was added — Apple Silicon is still recommended, but Intel Macs may work.

> Standalone Wine mode is pinned to **Wine development 11.11**. Other standalone Wine builds cannot be installed or selected, and the launcher will not fall back to them if 11.11 is missing.

---

## Setup

### Standalone Wine

1. Select **Standalone** on the main screen.
2. Open **Settings → Open setup wizard** to install Wine 11.11, initialize the bottle, and install DXMT.
3. Start Steam, sign in, and install the Windows version of ETS2 inside that bottle.
4. Click **Re-detect**, then **Launch ETS2 MP**.

### CrossOver

1. Select **CrossOver** on the main screen.
2. Open **Settings** and configure the Wine executable, bottle, Steam folder, and ETS2 folder.
3. Click **Save paths**, then **Start Steam** and **Launch ETS2 MP**.

### HaulLog

After ETS2 is installed and detected, click **Install HaulLog**. The launcher first checks for the Windows x64 .NET 8 Desktop Runtime in the selected bottle. If missing, it downloads Microsoft's installer, verifies its SHA-512 checksum, and waits for runtime setup to finish before opening the official HaulLog installer. Finish HaulLog setup in that window. The button changes to **Reinstall HaulLog** once the app is detected. Wine Mono and native macOS .NET do not replace this Windows runtime.

Steam status is checked every five seconds, including Steam started outside the launcher. HaulLog app and game plugin detection run in the background.

### TruckerSVN Tool

Click **Install TruckerSVN Tool** to install the native macOS app (HGL Portal Hub). The launcher downloads the official macOS bundle, checks its app identity and code signature, and verifies the published SHA-256 checksum when one is supplied. It installs the bundle in `~/Library/Application Support/TruckersMP-Launcher/tools/`; existing copies in Applications are also detected. Detection displays the installed version.

Click **Open TruckerSVN Tool** to open the native app and connect its game and save folders to the launcher’s selected Wine bottle. The launcher uses the Tool’s existing local configuration API and verifies that the native app owns that service before changing settings. Other Tool preferences and the game’s developer, console, and convoy settings are preserved. If ETS2 has no save profiles yet, open ETS2 once and create a profile, then reopen the Tool.

The native app uses macOS WebKit, avoiding the WebView2 graphics crash reproduced with Wine 11.11. Save editing and game data access use the selected Wine folders; features that require Windows process memory remain subject to the native Tool’s platform support. No WebView2 installation is needed. Previously installed Windows Tool files are left in the bottle.

Native app output is saved in `~/Library/Application Support/TruckersMP-Launcher/truckersvn-native.log`. If the local configuration service is occupied by another Tool instance, close that instance and retry **Open**.

### Installing truckersmp-cli

```bash
pip3 install truckersmp-cli
```

If `pip3` isn't available, install Python 3 from [python.org](https://www.python.org/downloads/) first.

---

## Troubleshooting

- If a launch fails, expand **Log** beneath Detection to read the error.
- If a path is missing, use **Settings** to set it, or click **Re-detect**.
- Steam must be installed inside the selected Wine bottle. Its running state appears on the Steam button.
- Wine installation checks require both 64-bit and 32-bit Windows DLLs. Run the setup wizard again if the bottle is incomplete.
- HaulLog installer output is saved in `~/Library/Application Support/TruckersMP-Launcher/haullog-installer.log`.
- HaulLog's .NET runtime setup output is saved alongside it in `haullog-dotnet-install.log`.

## Uninstalling

To remove the app and its saved setup, delete these locations:

1. **The app itself**
   - `/Applications/TruckersMP For macOS.app`

2. **App data** (Wine builds, bottles, DXMT)
   - `~/Library/Application Support/TruckersMP-Launcher`

3. **Launcher config** (settings, keybinds, saved paths)
   - `~/.config/truckersmp-launcher`

---

## Contributing

PRs and issues welcome. If you hit a crash or a path detection failure, please open an issue and include the contents of the collapsed Log section.

---

## Acknowledgements

This project was developed with AI assistance — what started as an idea became a reality with its help.
Inspired by [matyash12's unofficial TruckersMP macOS launcher](https://github.com/matyash12/unofficial-truckersmp-macos-launcher).

---

## Credits

this project uses the following tools:

- **[Wine](https://www.winehq.org/)** — Windows compatibility layer. (the project TruckersMP for macOS uses this custom built [Wine](https://github.com/nohero765/wine-builds-))
- **[CodeWeavers/CrossOver](https://www.codeweavers.com/crossover)** — This project's custom Wine build Uses CodeWeavers' CrossOver patches. Thank you for their years of upstream Wine contributions.
- **[DXMT](https://github.com/3Shain/dxmt)** — DirectX to Metal translation layer used in place of D3DMetal.
- **[truckersmp-cli](https://github.com/truckersmp-cli/truckersmp-cli)** — Used to launch TruckersMP and install TMP files.
- **[Funbit ETS2 Telemetry Server](https://github.com/Funbit/ets2-telemetry-server)** — Used for Telemetry Tab and exact coordinates of the truck/car

a big thank you for these developers who developed these tools the project wouldn't have been possible without their hard work.

---

## Disclaimer

This project is an independent, open-source launcher for TruckersMP on macOS. It is not affiliated with, endorsed by, or sponsored by TruckersMP or SCS Software. All trademarks and copyrights belong to their respective owners.

## License

GPL-3.0
