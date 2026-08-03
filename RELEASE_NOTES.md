# Achievement Watcher 3.4.1

Version 3.4.1 fixes the real cause of the library reloading itself every few minutes, and updates two dependencies that were pinned at vulnerable versions.

## Highlights

- **The library stops reloading itself, for good.** 3.4.0 capped how often an unrecognised game could trigger a refresh; this release fixes why it happened at all. Each loaded game was handed to the interface from inside a frame callback, which the browser engine only delivers to a **visible** window — and Achievement Watcher normally sits in the tray with its window hidden. A background scan therefore finished having added nothing to the on-screen list, so the periodic check saw the whole library as newly installed and started a full refresh, every three minutes, indefinitely. Real logs showed `54 new game(s) detected` on every tick for a 52-game library. That also explains scans feeling slow: the app was continuously rescanning in the background.
- **Two vulnerable dependencies updated.** `protobufjs` 7.6.4 → 7.6.5 (denial of service via `.proto` option parsing) and `adm-zip` 0.5.18 → 0.6.0 (a crafted ZIP triggering a 4 GB allocation). `npm audit --omit=dev` now reports no vulnerabilities.

See the [changelog](CHANGELOG.md#341---2026-08-03) for the full list of changes, and [3.4.0](CHANGELOG.md#340---2026-08-03) for the Ubisoft achievement fixes and the Settings search field released alongside it.

## Install

Download `Achievement.Watcher.Setup.3.4.1.exe` from the [v3.4.1 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.4.1).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
