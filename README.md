# TruckersMP for macOS

An unofficial Electron launcher for playing Euro Truck Simulator 2 multiplayer through [TruckersMP](https://truckersmp.com) on macOS. It uses [truckersmp-cli](https://github.com/truckersmp-cli/truckersmp-cli) to launch multiplayer and runs the Windows game through either standalone Wine or CrossOver.

This repository continues an inherited launcher project. This README describes the implementation in this checkout; instructions and release information from deprecated repositories may differ.

## What the launcher does

- Detects Wine, truckersmp-cli, Steam, ETS2, and optional companion tools.
- Sets up standalone Wine, a Windows bottle, Steam, and DXMT.
- Starts and stops Steam and ETS2 multiplayer in the selected bottle.
- Provides Retina and Metal HUD controls, editable paths, and a troubleshooting log.
- Installs HaulLog and installs or opens the native macOS TruckerSVN Tool.

A bottle is a directory containing a Wine Windows environment, including its installed applications and settings. Steam and ETS2 must be installed in the bottle selected in the launcher.

## Before you start

You will need:

- A Mac capable of running your chosen Wine and graphics setup. Apple Silicon is the primary target; the default app build targets arm64.
- A Steam account with Euro Truck Simulator 2 and a TruckersMP account.
- The Windows version of Steam and ETS2 installed in your Wine bottle.
- Python 3 and truckersmp-cli.
- Either the standalone Wine setup managed by the launcher or an existing CrossOver installation.

Install truckersmp-cli in your preferred Python environment:

```sh
python3 -m pip install truckersmp-cli
```

If your Python installation requires an isolated environment, use a virtual environment or pipx. Set the path to the resulting `truckersmp-cli` executable in the launcher's **Settings** if automatic detection does not find it.

The macOS version of ETS2 and native Steam do not replace the Windows installations inside Wine. Game compatibility also depends on the versions supported by TruckersMP and the selected Wine/graphics stack.

## Set up and play

### Standalone Wine

This mode does not require CrossOver. It uses the custom Wine development **11.11** build pinned in [src/wine-release.js](src/wine-release.js), including its download URL and SHA-256 checksum. The launcher does not select another Wine build as a fallback.

1. Select **Standalone** in the main window.
2. Open **Settings → Open setup wizard**.
3. Download and install Wine, then create a bottle and finish the Windows Steam installer.
4. Install DXMT through the wizard, either automatically from GitHub or from a downloaded archive.
5. Start Steam, sign in, and install the Windows version of ETS2 in that bottle.
6. Return to the launcher and click **Re-detect**. Check the detected paths in **Settings** and use **Save paths** after any changes.
7. With Steam running, click **Launch ETS2 MP**.

The default standalone bottle is located at:

```text
~/Library/Application Support/TruckersMP-Launcher/TruckersmpBottle
```

### CrossOver

1. Install Windows Steam and ETS2 in a CrossOver bottle.
2. Select **CrossOver** in the launcher.
3. Open **Settings** and select the CrossOver Wine executable, bottle directory, Steam folder, and ETS2 folder. Set the truckersmp-cli path if needed.
4. Click **Save paths**, then **Re-detect** to check the configuration.
5. Click **Start Steam**, sign in, and then click **Launch ETS2 MP**.

## Optional companion tools

### HaulLog

Once ETS2 is detected, click **Install HaulLog** and finish the installer in its Windows setup window. The launcher checks for the Windows x64 .NET 8 Desktop Runtime first and installs it if missing, verifying Microsoft's installer checksum. Native macOS .NET and Wine Mono do not replace this runtime.

The button changes to **Reinstall HaulLog** when an installation is detected. Application and game plugin detection run in the background.

### TruckerSVN Tool

Click **Install TruckerSVN Tool** to install the native macOS app, also known as HGL Portal Hub. The launcher checks the downloaded app's identity and code signature, and verifies a published SHA-256 checksum when available. Existing installations in Applications are also detected.

Click **Open TruckerSVN Tool** to open the app and connect its game and save folders to the selected Wine bottle. If there are no ETS2 profiles yet, start the game and create one first. Close other Tool instances if its local configuration service is already occupied.

The native app uses macOS WebKit and does not require WebView2. Features that depend on Windows process memory are subject to the native Tool's platform support.

## Troubleshooting

- **Missing dependency or incorrect path:** click **Re-detect**, then review **Settings** and save the correct paths.
- **Steam or ETS2 is not detected:** confirm that the Windows versions are installed in the selected bottle.
- **Multiplayer does not launch:** expand **Log** below Detection and review the error. Confirm Steam is running and your game version is supported by TruckersMP.
- **Incomplete standalone setup:** reopen the setup wizard. Wine validation checks for both 64-bit and 32-bit Windows DLLs.
- **Companion installation fails:** inspect the relevant log in the application data directory.

Application data and installer logs are stored under:

```text
~/Library/Application Support/TruckersMP-Launcher/
```

Useful logs include `steam-installer.log`, `haullog-installer.log`, `haullog-dotnet-install.log`, and `truckersvn-native.log`. When reporting a problem, include your macOS version, hardware, selected Wine mode, and relevant log entries. Remove personal information from logs before sharing them.

## Development

Use Node.js **22.12 or newer** and npm. From the repository root:

```sh
npm ci
npm start
```

Available commands:

| Command                | Purpose                                      |
| ---------------------- | -------------------------------------------- |
| `npm start`            | Generate the UI and run Electron             |
| `npm test`             | Run the Node.js test suite                   |
| `npm run format:check` | Check source and README formatting           |
| `npm run format`       | Apply formatting                             |
| `npm run ui:build`     | Generate `src/index.html` from EJS templates |
| `npm run build`        | Build a macOS arm64 DMG                      |
| `npm run build:x64`    | Build for macOS x64                          |

Build output is written to `dist/`. An x64 package does not by itself establish compatibility with Intel Macs or the standalone Wine build.

Edit the templates in `src/views/` rather than the generated `src/index.html`. EJS runs at build time, not inside the Electron renderer. Starting or packaging the app regenerates the HTML automatically.

### Project layout

| Path                     | Responsibility                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `main.js`                | Electron entry point                                                                |
| `preload.js`             | Renderer IPC bridge                                                                 |
| `src/main/`              | Application lifecycle, detection, Wine setup, game sessions, and companion services |
| `src/renderer/`          | UI state, controls, settings, and setup wizard                                      |
| `src/views/`             | EJS layout and partials                                                             |
| `src/wine-release.js`    | Pinned standalone Wine download recipe                                              |
| `src/compat/wine-cli.sh` | Wine compatibility adapter for truckersmp-cli                                       |
| `scripts/build-ui.js`    | UI template compilation                                                             |
| `tests/`                 | Service, controller, IPC, template, and compatibility tests                         |

The pinned Wine build omits `winedbg.exe`, which truckersmp-cli normally uses to detect Steam. The compatibility adapter handles that process-list request through `tasklist.exe` and forwards other arguments to Wine. It does not modify the installed Python package. The adapter must remain executable and outside `app.asar`; the packaging configuration unpacks `src/compat/` for this purpose.

## Remove the launcher

Delete the application from wherever you installed it. To remove saved settings and managed runtime data as well, delete:

```text
~/Library/Application Support/TruckersMP-Launcher
~/.config/truckersmp-launcher
```

The application data directory can contain your standalone bottle, installed games, and saves. Back up anything you want to keep before deleting it. Bottles or companion apps installed elsewhere must be managed separately.

## Credits and license

This project builds on earlier macOS launcher work, including [matyash12's unofficial launcher](https://github.com/matyash12/unofficial-truckersmp-macos-launcher), and uses:

- [truckersmp-cli](https://github.com/truckersmp-cli/truckersmp-cli) for TruckersMP installation and launching.
- [Wine](https://www.winehq.org/) and the [custom Wine builds](https://github.com/nohero765/wine-builds-) referenced by the standalone setup.
- [CrossOver](https://www.codeweavers.com/crossover) and CodeWeavers' Wine contributions.
- [DXMT](https://github.com/3Shain/dxmt) for Direct3D-to-Metal translation.
- [Electron](https://www.electronjs.org/) for the desktop application.

See [LICENSE](LICENSE) for the repository's GNU General Public License v3 text. The `license` field in `package.json` currently says MIT and is inconsistent with that file.

This is an independent project and is not affiliated with or endorsed by TruckersMP, SCS Software, or CodeWeavers. Product names and trademarks belong to their respective owners.
