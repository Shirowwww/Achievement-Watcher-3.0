# Achievement Watcher 3.8.5

A feature release: full gamepad control for the app and overlay, layer-based themes with ten new
palettes, playtime tracking for non-Steam games, faster library scans, and a batch of controller,
detection and appearance fixes.

## Highlights

- **Control the whole app with a controller.** Beyond the overlay, a gamepad can now navigate the
  library, game details, settings and searches. Controller settings moved to their own tab with a
  button-layout selector (Auto/Xbox/PlayStation/Switch), fully configurable bindings, and a
  **Focus overlay when it opens** option for games that pause on focus loss. Settings can also send
  Escape to the game when opening the overlay with a controller, so many games pause automatically.
- **New layer-based theme system.** Ten new built-in themes - Catppuccin Mocha, Rosé Pine,
  Synthwave '84, Everforest, Cyberpunk, Ember, Ocean, Hacker, Burgundy and Champagne - replace the
  earlier Solarized/One Dark/Monokai set, and the theme picker gained a dropdown alongside the
  arrow controls.
- **Non-Steam playtime.** Ubisoft Connect, Uplay R2, Epic, GOG, EA, Xbox PC and standalone installs
  now show tracked playtime and last-played date on the achievements page, matching Steam games.
- **Faster, smoother library.** The overlay window stays hidden and reused for five minutes so
  reopening it is near-instant; the first scan of a session serves cached data immediately; off-screen
  tiles skip image decoding; skeleton shimmer is GPU-composited; and locating an emulator's local
  achievement schema no longer walks the whole game install on every scan.
- **Stale "installed" state fixed.** A Steam game left "installed" after being uninstalled (a stale
  registry flag, or a folder-name substring match) is now cross-checked against Steam's own library
  manifests, and Source-engine SDK tools are no longer mistaken for the game's real executable.
- **Controller-binding fixes.** The default overlay combo is now Back + Start + LB (harder to trigger
  by accident), the overlay-control and move/scroll combos no longer conflict when held together, a
  duplicated button in a custom binding is now rejected consistently, and DualShock 4 stick correction
  now applies on the XInput backend too.
- **Security:** the Epic account login no longer injects the redirect URL into an
  `executeJavaScript` script body, closing a CodeQL "improper code sanitization" finding.

## Install

Download `Achievement.Watcher.Setup.3.8.5.exe` from the
[v3.8.5 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.5).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#385---2026-08-13) for the full list of changes.
