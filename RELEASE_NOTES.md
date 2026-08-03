# Achievement Watcher 3.4.2

Version 3.4.2 reconciles achievement rarity across sources: games that are not running under a Steam emulator — Ubisoft/Uplay in particular — now show the same Steam community percentages as native Steam games.

## Highlights

- **Steam percentages for Uplay games.** The community % column was previously hidden for every Ubisoft/Uplay game, and there was no path to fetch Steam's global percentages for them. Uplay R2 games keep their mapped Steam AppID and now fetch them directly; official Ubisoft Connect games go through a Steam↔numeric-id bridge that translates Steam achievement names onto the game's native ids and caches the result like any other rarity. The column, the rare tiers and the percentage sort behave exactly like a Steam game's.
- **Epic installs with a known Steam release** borrow the Steam percentages instead of showing nothing, matching their Steam siblings.
- **No more wasted Steam lookups** for native non-Steam ids. Ubisoft Connect, GOG/Epic official, Lumaplay, EA and Xbox ids are never sent to Steam's percentages endpoint; those sources keep their own rarity (GOG/Epic sidecars, Exophase for console emulators, the Xbox import cache).

See the [changelog](CHANGELOG.md#342---2026-08-03) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.4.2.exe` from the [v3.4.2 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.4.2).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
