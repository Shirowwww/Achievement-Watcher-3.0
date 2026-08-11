# Achievement Watcher 3.8.4

A patch release: "Recently played" sorting works again, reloading the library no longer flashes a
single fast-loading game before the rest arrive, the notification overlay sits closer to the screen
edge, the automatic emulator fix leaves uninstalled games alone, and RLD!/CreamAPI save roots are
watched out of the box.

## Highlights

- **"Recently played" sorting is fixed.** The Watchdog crashed while saving playtime to the
  registry — after writing total time, but before writing the last-played timestamp — and was
  silently restarted. Games played since 3.8.3 had no last-played date, so they sorted to the
  bottom. Playtime now uses the stable registry path and the sort is correct again.
- **Library reloads are smoother.** Skeleton tiles fill the grid while games stream in, instead of
  one fast-loading game sitting alone for a few seconds, the folder scan that resolves installs by
  name now runs once per reload instead of once per game, and the shimmer stays fluid on every
  theme.
- **Notification overlay hugs the edge.** The popup's default margin is halved (12 px to 6 px) for
  every corner, edge and centered position.
- **More emulator saves are watched automatically.** RLD! roots in Public Documents and AppData
  plus the AppData CreamAPI root are detected out of the box, and user-added folders are classified
  by file signature so GOG `.info` and UniverseLAN installs keep their dedicated watchers.
- **Uninstalled games are left alone.** The automatic emulator fix no longer applies to a folder
  that no longer contains a real game executable, so a background repair cannot recreate an
  uninstalled game's folder or announce a misleading "ready" notification.

## Install

Download `Achievement.Watcher.Setup.3.8.4.exe` from the
[v3.8.4 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.4).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#384---2026-08-11) for the full list of changes.
