# 3.0.0

First public release of the modernized 3.0 fork — a refreshed interface, improved
setup flow, better game/emulator handling, updated documentation and many stability fixes.

## Highlights

- Modern platform: Electron 42 (Chromium 148, Node 24) with every major dependency updated and Windows 11 24H2+ support.
- Reworked notifications: Windows toasts, an in-game overlay (presets + sounds), or both, with "Rare · X%" labels.
- Goldberg / GBE tooling: Diagnose, Repair `steam_settings`, and a one-click GBE Fork `steam_api(64).dll` install.
- New sources: ShadPS4 (PS4, with live toasts) and Xenia (Xbox 360).
- Smarter detection: "installed games only" filter, rewritten per-game executable detection, automatic new-game detection.

## Improvements

- Faster, lighter library loading and a roughly halved emulator scan.
- More resilient Watchdog that auto-launches at sign-in and tracks playtime from a game's first launch.
- Persistent rarity and advanced cover management; modern dark UI; broader FR/EN localization.

## Fixes

- WMIC removed everywhere for Windows 11 24H2+ compatibility.
- Hidden achievement descriptions resolve correctly; stale blanks repaired in place.
- GreenLuma / Uplay / RPCS3 / Epic first-load failures fixed; no more permanent blacklisting after a transient error.
- Several CPU and memory-leak fixes.

## Download & verification

- Install only from this Releases page. Download `Achievement.Watcher.Setup.3.0.0.exe`.
- Verify the published SHA-256 checksum before installing.

## Notes

- Some unsigned Electron builds and Steam-emulator helper DLLs may trigger false positives on Windows Defender or other antivirus tools. This is a known issue and not evidence of malware — download only from the official release.
