# Achievement Watcher 3.5.0

Version 3.5.0 makes progress-type achievements work where they were stuck at 0%, and gives legacy
Epic installs the same rich, correctly-rated data as official Epic games.

## Highlights

- **Online-Fix stat support.** A sibling `Stats.ini` next to `achievements.ini` is now merged into
  the parsed save, so progress-type achievements (kill counters, distances, …) resolve through the
  local Goldberg/GBE schema instead of showing 0% forever.
- **Better TENOKE stats.** `user_stats.ini` `[STATS]` values are cross-referenced onto same-key
  achievements, and inline `progress=`/`value=` entries on the achievement itself are honored, so
  Tenoke progress-type achievements display real progress.
- **Epic appid detection.** Legacy NemirtingasEpicEmu installs (hex artifact ids) now resolve their
  real Epic namespace and title through egdata.app, reuse the same cached, localized,
  rarity-annotated schema as official Epic installs, and fetch their community rarity against the
  correct product id instead of the artifact id.
- **Progress no longer zeroed.** A save file without a `MaxProgress` no longer stamps `0` over the
  schema's own `max_progress`, so progress bars and percentages keep their real target.
- **Fixed update button label.** The "Download & Install" button shows its ampersand literally
  instead of letting Windows swallow it as a keyboard mnemonic.

See the [changelog](CHANGELOG.md#350---2026-08-04) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.5.0.exe` from the
[v3.5.0 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.5.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked
data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
