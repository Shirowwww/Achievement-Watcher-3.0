# Achievement Watcher 3.8.0

Per-source switches, a shortcut to each entry's achievement data, automatic launch-executable
detection and priority notifications — plus the fixes for the four open reports about missing
achievement toasts, the overlay opening by itself, and Far Cry 4 ignoring the Steam filter.

## Highlights

- **A switch for every source.** Ubisoft Connect, GOG Galaxy, Epic Games, the Nemirtingas GOG/Epic
  emulators, shadPS4 and Xenia were all read unconditionally, with no way to turn them off short of
  editing `options.ini` by hand. Each one now has its own toggle in the Sources tab.
- **Achievement data, one click away.** Right-click a game → **Folders → Achievement data** opens
  the folder an entry was actually read from, with one item per source on a merged card, plus
  **Copy achievement data path**. It is the fastest way to tell where a card came from.
- **Launch executables detected automatically.** After every scan the launch panel fills itself
  from Steam `appmanifest` folders, GOG launch tasks, Epic manifests, EA Desktop logs and Xbox
  configs, and from install folders behind a conservative confidence gate. Ambiguous folders stay
  empty for a manual pick, and a manually configured exe is never overwritten.
- **Achievement toasts actually appear.** Three separate faults were suppressing them while
  playtime notifications worked: the payload built an invalid toast group from a numeric appid and
  threw before display, the Settings test opened a fullscreen backdrop that switched Windows into
  do not disturb, and the fullscreen/quiet-hours probe silently returned "no" on every machine.
- **Priority notifications.** Optional, off by default: marks unlock toasts urgent so Windows 11
  shows them while Do Not Disturb is on — including the automatic "playing a game" and "app in full
  screen" rules. Windows asks once before honouring it.
- **The overlay stays put.** It no longer opens by itself after a game exits, it has a close (×)
  button and `Escape` closes it, and the hotkey stays in step however the window was dismissed.
- **Far Cry 4 respects the Steam filter.** A Steam purchase that launches Ubisoft Connect is read
  through the Ubisoft source, so no filter applied to it. Two generic signals now identify one, with
  no per-game data involved.

## Install

Download `Achievement.Watcher.Setup.3.8.0.exe` from the
[v3.8.0 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#380---2026-08-10) for the full list of changes.
