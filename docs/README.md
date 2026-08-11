<div align="center">

# 📚 Documentation

Practical guides for setup, daily use and maintenance.

[🏠 Project home](../README.md) · [⬇️ Download](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest) · [📋 Changelog](../CHANGELOG.md) · [🔐 Security](../SECURITY.md) · [💬 Report an issue](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues)

</div>

## Start here

| Need | Guide |
|---|---|
| Install the app, choose sources and find games | [Getting started](getting-started.md) |
| Configure Windows notifications or the in-game overlay | [Notifications](notifications.md) |
| Use the overlay list, search, filters and rarity | [Overlay](overlay.md) |
| Fix discovery, progress, notification or playtime issues | [Troubleshooting](troubleshooting.md) |
| Diagnose or repair Goldberg / GBE Fork | [Goldberg / GBE setup](emulator-setup.md) |
| Configure a compatible Ubisoft Uplay R2 game | [Uplay R2 setup](uplay-r2.md) |

The in-app **Settings → Guide** tab is the quickest reference for normal use.

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
