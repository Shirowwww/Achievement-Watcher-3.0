# Achievement Watcher 3.5.2

Small release focused on defaults and cleaner library detection: in-game overlay notifications are
now the default delivery mode with the Shirow preset, Steam library paths stay out of emulator
scans, and local builds can be signed with an optional self-signed certificate.

## What's new

- **Overlay notifications by default.** New installs get the in-game overlay with the Shirow preset
  instead of Windows toasts; your existing saved choice is preserved.
- **Cleaner Steam handling.** Smart Find no longer treats Steam/SteamLibrary folders as emulator
  game roots, Steam-sourced games stop showing redundant source/dll badges, and common `Games`
  folders (including `C:\Games` and Program Files subfolders) are discovered.
- **Local build signing.** `npm run build` signs automatically when a local self-signed certificate
  is present; without one the build stays unsigned.

See the [changelog](CHANGELOG.md#352---2026-08-04) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.5.2.exe` from the
[v3.5.2 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.5.2).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked
data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
