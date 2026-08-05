# Achievement Watcher 3.5.3

Maintenance release that fixes the four reported issues (toasts, data isolation, Ubisoft
identity, Goldberg SocialClub) with real root-cause fixes instead of per-game patches.

## Highlights

- **Windows notifications actually appear.** The toast payload used the wrong AUMID key and the
  fallback identity (classic Xbox app) no longer ships on Windows 11, so Windows silently
  discarded every achievement toast while the controller still rumbled. Toasts now use an app id
  that is verified to exist, appear under Achievement Watcher's own name, render the correct
  timestamp/art/progress payload, and open the game page when clicked (even from a cold start).
- **3.x data is isolated from the original 1.6.8.** Data now lives in
  `%APPDATA%\Achievement Watcher 3.0`; the legacy folder is imported once (selectively, with hard
  links for large caches), so uninstalling 1.6.8 can no longer wipe 3.x settings, caches or
  playtime.
- **Ubisoft Connect games are identified generically.** Storefront-only blocks ("Steam") are
  merged per achievements spec instead of picked by file order, and the Steam release is resolved
  from the installed Steam library, the catalog, or a confident name match — no per-game mapping
  (Far Cry 4 / uplay-971 is resolved without any asset edit).
- **New Goldberg SocialClub source.** `%APPDATA%\Goldberg SocialClub Emu Saves` is accepted in
  Settings, auto-scanned and live-monitored. Games are discovered from their real profile layout
  (hex profiles, Rockstar save/profile files) and labelled "Goldberg SocialClub". Note: Rockstar's
  proprietary save files cannot be decoded by any local tracker yet; such games are listed
  honestly until a sample of the save format can be confirmed.
- **Game uninstall from the right-click menu** and the full translation/terminology cleanup are
  included.

## Install

Download `Achievement.Watcher.Setup.3.5.3.exe` from the
[v3.5.3 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.5.3).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data:
the first launch imports the legacy `%APPDATA%\Achievement Watcher` folder once into
`%APPDATA%\Achievement Watcher 3.0` (copied/hard-linked, never moved or deleted).

See the [changelog](CHANGELOG.md#353---2026-08-05) for the full list of changes.
