# Achievement Watcher 3.8.2

A small fix release: nested Goldberg/GBE installs are detected correctly again, and a CodeQL
code-scanning pass hardened several sanitization paths.

## Highlights

- **Nested Goldberg/GBE installs no longer duplicate.** An install whose configuration lives in a
  nested engine folder (Unity's `_Data/Plugins/x86_64`, Unreal's `Binaries/Win64`, ...) no longer
  resurfaces as a second, artwork-less "Unconfigured" tile, and its real executable is now attached
  to the already-tracked game instead of being missed.
- **Loader executables no longer get mistaken for the game.** A same-folder loader or launcher (for
  example a second Uplay R2 loader shipped by a repack) can no longer outrank the actual game
  executable during automatic detection.
- **Hardened sanitization.** A stable tag-stripping pass now loops until the string stops changing,
  theme/preset CSS `url()` values are built through the shared backslash-safe helper everywhere, the
  Exophase image-proxy host check requires an exact or subdomain match, and line-separator
  characters are stripped before the Epic login redirect URL is spliced into injected page script.

## Install

Download `Achievement.Watcher.Setup.3.8.2.exe` from the
[v3.8.2 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.2).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#382---2026-08-11) for the full list of changes.
