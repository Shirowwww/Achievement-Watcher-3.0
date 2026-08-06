# Achievement Watcher 3.7.0

Custom theme gradients, a cover-art gallery, smarter installed-game detection and a batch of
stability fixes — including the in-app updater and a Far Cry 4 identity regression.

## Highlights

- **Per-layer theme gradients.** The Custom theme editor now has a Gradient editor for surface
  layers: pick two colors and a direction (0/45/90/135/180/270°) with a live preview, applied in
  the app and the in-game overlay. Older single-toggle gradients import automatically as a dark
  fade of the layer color.
- **Cover picker gallery.** Right-click a game → "Choose another cover…" opens a themed gallery
  with the current cover, SteamDB library assets and up to eight SteamGridDB community grids,
  matching the library's portrait/landscape orientation.
- **Cross-source duplicate merge.** A Ubisoft Connect product mapped to an already-listed Steam
  release is merged into one tile with both unlock sources instead of showing twice (for example
  the Steam-variant Far Cry 4 product 971 now resolves to Steam 298110 with its real cover).
- **Smarter install detection.** Per-user game libraries, nested library-like folders and
  launcher-managed installs are probed on every scan; unconfigured installs are named from the
  exe's own FileDescription/ProductName; known non-game executables no longer mark games installed.
- **Updater fixed for unsigned releases.** "Download && Install" no longer fails with
  "App is not signed": the verifier accepts intentionally unsigned release files (still
  authenticated by the feed's SHA-512) and only rejects signatures from another publisher.
- **Game-page artwork fix.** The header icon is reset to a neutral placeholder when a game has no
  artwork, so a page can never show the previous game's icon.

## Install

Download `Achievement.Watcher.Setup.3.7.0.exe` from the
[v3.7.0 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.7.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#370---2026-08-06) for the full list of changes.
