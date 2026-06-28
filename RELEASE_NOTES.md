# 3.0.5

Stability and emulator compatibility release focused on GBE Fork progress tracking, safer repairs and smoother first-run recovery.

## Changes

- Added support for `stats.json` progress mappings used by newer GBE Fork / Steamworks games.
- Preserved rich generated `achievements.json` schemas during repairs instead of replacing them with simpler schemas.
- Seeded missing GBE runtime achievement state so repaired games can start tracking from a clean 0% baseline without overwriting existing progress.
- Improved live watchdog mapping for stat-backed achievements and limited first-observation notification bursts to the newest unlocks.
- Improved executable detection when launcher/helper variants sit beside the real game executable.
- Made the settings button for reopening the first-run guide more reliable.

## Download

Download `Achievement.Watcher.Setup.3.0.5.exe` from this release.
