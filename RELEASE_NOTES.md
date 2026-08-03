# Achievement Watcher 3.4.3

Version 3.4.3 is a reliability and maintenance release: the background monitor and the automatic
updater are hardened, the dependency tree is clean, and a batch of broken context-menu icons is fixed.

## Highlights

- **Resilient background monitor.** The Watchdog is supervised with an exponential respawn backoff
  (3 s → 60 s), a failed spawn can no longer leave it dead for the whole session, manual restarts
  wait for the real process exit instead of a fixed delay, and uncaught exceptions restart it cleanly
  instead of leaving it half-initialized.
- **Self-healing automatic updates.** Failed update checks retry after 30 minutes and a healthy
  install re-checks every 6 hours while it stays resident; errors surface as a tray notification,
  overlapping prompts are ignored, and the dependency tree is pinned so `npm audit` reports zero
  vulnerabilities.
- **Restored game-list context-menu icons** (they referenced image files that no longer existed) and
  removed the unused @1x/@4x icon scales.
- **Leaner packages.** Dropped the unused `sound-play` dependency from the app and the Watchdog, and
  removed stale local build output.

See the [changelog](CHANGELOG.md#343---2026-08-03) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.4.3.exe` from the
[v3.4.3 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.4.3).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked
data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
