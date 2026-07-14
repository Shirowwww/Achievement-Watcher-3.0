<div align="center">

# 📚 Achievement Watcher documentation

User guides, troubleshooting and technical references for Achievement Watcher 3.0.

[Main README](../README.md) · [Latest release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest) · [Changelog](../CHANGELOG.md) · [Open an issue](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues)

</div>

## 🚀 Start here

| I want to… | Read |
|---|---|
| Install the app and find my games | [Getting started](getting-started.md) |
| Configure toasts or the in-game overlay | [Notifications](notifications.md) |
| Fix a missing game, locked achievement or playtime problem | [Troubleshooting](troubleshooting.md) |
| Set up or repair Goldberg / GBE Fork | [Goldberg and GBE Fork setup](emulator-setup.md) |
| Configure a compatible Ubisoft Uplay R2 game | [Goldberg Uplay R2 setup](uplay-r2.md) |

## 🎮 User guides

### [Getting started](getting-started.md)

Installation, first launch, sources, watched folders, tray behavior, updates and the `%APPDATA%\Achievement Watcher` data directory.

### [Notifications](notifications.md)

Windows toasts, the in-game overlay, preset selection, the custom builder, sounds, volume, positions, per-game behavior and test paths.

### [Troubleshooting](troubleshooting.md)

Missing games, 0% progress, absent metadata, notification failures, playtime, Ubisoft identification, SmartScreen, logs and safe profile reset.

## 🧩 Emulator guides

### [Goldberg and GBE Fork setup](emulator-setup.md)

Explains the difference between schema and runtime saves, the recommended diagnosis/repair path, backups, files that may change and common compatibility limits.

### [Goldberg Uplay R2 setup](uplay-r2.md)

Covers the one-time loader cache, Ubisoft-to-Steam achievement mapping, the repair action, generated files and unsupported naming schemes.

### [Goldberg/GBE technical reference](goldberg-gbe.md)

The implementation-level reference for JSON formats, discovery, emulator detection, INI updates, runtime installation, backup behavior and safety invariants.

> Emulator setup actions are optional and may modify a game directory. Use them only with games you own, read the diagnosis first and keep backups of anything important.

## 🛠️ Contributor documentation

| Document | Purpose |
|---|---|
| [Contributing](../CONTRIBUTING.md) | Development setup, change rules, translations, tests, commits and pull requests |
| [Build guide](../BUILD.md) | Development run, unpacked app, NSIS installer and packaging constraints |
| [Architecture](architecture.md) | Main/renderer/Watchdog boundaries, parser flow, local data and important invariants |
| [Release workflow](RELEASE_WORKFLOW.md) | Versioning, validation, artifacts, CI, publication and auto-update proof |

Release history is maintained in [CHANGELOG.md](../CHANGELOG.md). [RELEASE_NOTES.md](../RELEASE_NOTES.md) contains the text used for the current packaged release.

## 🗂️ Useful locations

| Data | Default path |
|---|---|
| Settings, cache and user assets | `%APPDATA%\Achievement Watcher` |
| Logs | `%APPDATA%\Achievement Watcher\logs` |
| GBE Fork saves | `%APPDATA%\GSE Saves` |
| Classic Goldberg saves | `%APPDATA%\Goldberg SteamEmu Saves` |
| Uplay R2 loader cache | `%APPDATA%\Achievement Watcher\cache\uplayR2` |

When reporting a problem, open **Settings → Advanced → Diagnostics**, reproduce the issue once and attach the relevant logs after removing private data.
