# Getting started

Achievement Watcher is a Windows desktop application. Packaged releases include their own runtime, so Node.js is required only when building from source.

## Install

1. Open the [latest release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest).
2. Download `Achievement.Watcher.Setup.<version>.exe`.
3. Run the installer and choose an installation folder.
4. Open Achievement Watcher from the Start menu or desktop shortcut.

The installer is currently unsigned. Windows SmartScreen may therefore ask for confirmation even when the file came from the official Releases page.

## First launch

The first-run guide asks for the main choices needed to populate the library:

- **Language** controls the interface and the preferred language for game metadata when the source provides it.
- **Sources** enables launcher, local-save and emulator integrations.
- **Folders** tells Achievement Watcher where to look for game libraries and achievement saves.
- **Notifications** chooses Windows toasts, the in-game overlay, or both.

You can revisit every option later from **Settings**.

## Find games and saves

Open **Settings → Folders** and choose one of these paths:

- **Smart Find** checks common launcher, emulator, save and game-library locations.
- **Add folder** watches a location you select.
- **Generate configs** performs a fuller scan and can apply enabled emulator setup options.

If a folder is rejected, select the directory that directly contains the supported save folders, AppID folders, `steam_settings`, or the relevant emulator configuration. The [troubleshooting guide](troubleshooting.md#a-game-is-missing) lists the first checks to make.

## Configure notifications

Open **Settings → Notification** and choose a delivery mode:

- **Toast** uses native Windows notifications.
- **Overlay** displays a styled popup over the running game.
- **Both** enables both transports.

Use the test buttons before launching a game. Presets, sounds, volume, duration and position can all be changed later. See [Notifications](notifications.md) for details.

## Tray and startup behavior

Closing the main window normally keeps Achievement Watcher in the system tray. The background tracker continues watching supported files and processes for playtime and unlocks.

Starting with Windows and closing to the tray can be changed under **Settings → General**. To exit fully, use the tray menu.

## Updates and existing data

Installed releases check the project's GitHub release feed for a newer version. When an update finishes downloading, the app asks before restarting.

Installing a newer build over an older one replaces program files but preserves user data in:

```text
%APPDATA%\Achievement Watcher
```

This directory contains settings, watched folders, caches, playtime, logs, notification assets and local account data. Uninstalling does not remove it by default. Delete it manually only when you intentionally want a completely fresh profile.

## Next steps

- [Configure notifications](notifications.md)
- [Set up Goldberg or GBE Fork](emulator-setup.md)
- [Set up Goldberg Uplay R2](uplay-r2.md)
- [Troubleshoot a problem](troubleshooting.md)
- [Return to the documentation index](README.md)
