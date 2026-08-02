# Achievement Watcher 3.3.0

Version 3.3.0 brings Xbox PC support (Game Pass / Microsoft Store), live unlock notifications, per-emulator presets, emulator rarity, user themes and a batch of reliability improvements.

## Highlights

- **Xbox PC**: connect a Microsoft / Xbox Network account, import your Game Pass / Microsoft Store library and read each title's achievements, unlock state and rarity from the local cache.
- **Live Xbox notifications**: while an Xbox PC title is running, the background Watchdog polls Xbox Network and fires a toast/overlay for each new unlock.
- **Manual unlock**: right-click any achievement to mark it as manually unlocked (or clear the override), stored locally without touching save files.
- **Per-emulator presets**: Xenia, RPCS3 and ShadPS4 notifications can each use their own overlay preset.
- **Emulator rarity**: RPCS3 / ShadPS4 / Xenia achievements show global unlock percentages fetched from Exophase; Xbox titles show the rarity captured at import.
- **User themes**: drop a `.css` file into `%APPDATA%\Achievement Watcher\themes` and pick it in Settings → General → Theme.
- **Process trail**: games already running when the Watchdog starts are tracked so their playtime is recorded on exit.
- **Notifications**: random sound option, FLAC/M4A/AAC support and a dedicated playtime scale.
- **Per-platform links**: Epic, GOG, EA, Ubisoft, RPCS3 and PCGamingWiki metadata links in the game right-click menu.

See the [changelog](CHANGELOG.md#330---2026-08-03) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.3.0.exe` from the [v3.3.0 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.3.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
