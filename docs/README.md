<div align="center">

# 📚 Documentation

Practical guides for setup, daily use and maintenance.

[🏠 Project home](../README.md) · [⬇️ Download](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest) · [📋 Changelog](../CHANGELOG.md) · [🔐 Security](../SECURITY.md) · [💬 Report an issue](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues)

<img src="../screenshot/home.png" width="560" alt="Achievement Watcher library">

</div>

## Start here

Read in order, or jump to what you need - every page ends with a link to the next one.

| # | Guide | What it covers |
|---|---|---|
| 1 | [Getting started](getting-started.md) | Install the app, choose sources, find games and saves |
| 2 | [Notifications](notifications.md) | Windows toasts, overlay popups, presets and sounds |
| 3 | [Overlay](overlay.md) | The in-game list: search, filters, rarity and customization |
| 4 | [Controller](controller.md) | Drive the app and the overlay with a gamepad |
| 5 | [Goldberg / GBE setup](emulator-setup.md) | Diagnose or repair an emulated Steam game |
| 6 | [Uplay R2 setup](uplay-r2.md) | The Ubisoft equivalent, for compatible titles |
| 7 | [Troubleshooting](troubleshooting.md) | Discovery, progress, notification and playtime issues |

The in-app **Settings → Help** tab is the quickest reference for normal use. It
reflects your actual configuration (overlay hotkey, controller layout and
bindings, notification mode, theme, enabled sources) and filters its compact
topic cards as you type.

Games with DLC or update achievements show the owning group (e.g. a "Hearts of
Stone" tag) under each achievement in the detail view; it is fetched keylessly
from SteamHunters and never affects games without groups.

## Build and reference

| Topic | Reference |
|---|---|
| Goldberg/GBE file formats and repair invariants | [Goldberg/GBE reference](goldberg-gbe.md) |
| App, renderer and Watchdog boundaries | [Architecture](architecture.md) |
| Development, builds and releases | [Contributing](../CONTRIBUTING.md) · [Build guide](../BUILD.md) · [Release workflow](RELEASE_WORKFLOW.md) |

## Data locations

| Data | Default path |
|---|---|
| Settings, cache and user assets | `%APPDATA%\Achievement Watcher 3.0` |
| Logs | `%APPDATA%\Achievement Watcher 3.0\logs` |
| GBE Fork saves | `%APPDATA%\GSE Saves` |
| Classic Goldberg saves | `%APPDATA%\Goldberg SteamEmu Saves` |

Before reporting a problem, use **Settings → Advanced → Diagnostics**, reproduce it once, then remove private data from the relevant logs.
