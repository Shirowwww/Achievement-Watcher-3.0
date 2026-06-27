# Achievement Watcher 3.0 — Documentation

Guides for installing, using and troubleshooting Achievement Watcher.

- [Emulator setup (Goldberg / GBE)](emulator-setup.md) — track achievements for cracked/emulated games.
- [Notifications](notifications.md) — toasts, in-game overlay, presets and sounds.
- [Troubleshooting](troubleshooting.md) — common issues and fixes.

## Installing Over An Older Build

The Windows setup uses the same product name and user-data folder as older Achievement Watcher builds.
Installing this fork over an older build replaces the program files in the install directory, but keeps
your settings, watched folders, cache, playtime and achievement data under `%APPDATA%\Achievement Watcher`.

Uninstalling or updating the app does not delete that AppData folder. Remove it manually only if you want
a fully fresh profile.

For build/development instructions see [BUILD.md](../BUILD.md). For the deep technical
reference on how the Steam-emulator achievement files are read, see
[GOLDBERG-GBE.md](../GOLDBERG-GBE.md).

> Reminder: Achievement Watcher tracks achievements for games you own. It does not
> provide game content or bypass ownership checks, and the issue tracker is not a
> piracy helpdesk.
