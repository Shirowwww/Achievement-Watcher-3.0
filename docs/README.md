<div align="center">

# 📚 AW Next documentation

Practical guides for setup, daily use and maintenance.

[Project home](https://github.com/Shirowwww/Achievement-Watcher-Next) · [Download](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/latest) · [Changelog](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/CHANGELOG.md) · [Security](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/SECURITY.md) · [Report an issue](https://github.com/Shirowwww/Achievement-Watcher-Next/issues)

<img src="screenshot/home.png" width="620" alt="The AW Next library">

</div>

## Start here

Read in order, or jump to what you need - every page ends with a link to the next one.

| # | Guide | What it covers |
|---|---|---|
| 1 | [Getting started](getting-started.md) | Install, first run, Simple vs Advanced, finding games, updates |
| 2 | [Compatible sources](sources.md) | Every source AW Next can read, and what each one needs |
| 3 | [Notifications](notifications.md) | Delivery modes, Automatic, sounds, position, screenshot souvenirs |
| 4 | [Presets and the Preset Designer](presets.md) | The look of the popup, designing your own, sharing `.awpreset` files |
| 5 | [Overlay](overlay.md) | The in-game achievement list: search, filters, rarity, customization |
| 6 | [Controller](controller.md) | Drive the app and the overlay with a gamepad |
| 7 | [Game Health](game-health.md) | The per-game report and its guided repairs |
| 8 | [Troubleshooting](troubleshooting.md) | Discovery, progress, notification and playtime problems |

## When you need it

| Guide | What it covers |
|---|---|
| [FAQ](faq.md) | Short answers to the questions that come up most |
| [Advanced tools](advanced.md) | Maintenance, cache clearing, resets, manual games, diagnostics |
| [Goldberg / GBE setup](emulator-setup.md) | Diagnose or repair an emulated Steam game |
| [Uplay R2 setup](uplay-r2.md) | The Ubisoft equivalent, for compatible titles |
| [Comparison](comparison.md) | How AW Next differs from Achievement Watcher 2.x and Achievements |

The in-app **Settings → Help** tab is the quickest reference while you are using the app. It reflects
your actual configuration - overlay hotkey, controller layout and bindings, notification mode, theme,
enabled sources - and filters its topic cards as you type.

## Developer reference

Lower-level documentation for contributors and for anyone building AW Next from source.

| Topic | Reference |
|---|---|
| Contributing, branches, tests and commit style | [CONTRIBUTING.md](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/CONTRIBUTING.md) |
| Development setup, running and Windows packaging | [BUILD.md](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/BUILD.md) |
| App, renderer and Watchdog boundaries; the parser contract | [Architecture](architecture.md) |
| Goldberg / GBE file formats, detection and repair invariants | [Goldberg / GBE reference](goldberg-gbe.md) |
| Versioning, publishing, CI and auto-update validation | [Release workflow](RELEASE_WORKFLOW.md) |
| Locale files and the key-parity rules | [app/locale/README.md](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/app/locale/README.md) |

## Where your data lives

| Data | Default path |
|---|---|
| Settings, cache and user assets | `%APPDATA%\Achievement Watcher Next` |
| Logs | `%APPDATA%\Achievement Watcher Next\logs` |
| Presets you created or imported | `%APPDATA%\Achievement Watcher Next\presets\Users Presets` |
| Achievement backups | `%APPDATA%\Achievement Watcher Next\backups\achievements` |
| Screenshot souvenirs | `Pictures\Achievement Watcher Next` |
| GBE Fork saves | `%APPDATA%\GSE Saves` |
| Classic Goldberg saves | `%APPDATA%\Goldberg SteamEmu Saves` |

Before reporting a problem, use **Settings → Advanced → Diagnostics**, reproduce it once, then remove
private data from the relevant logs.
