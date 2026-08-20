# Achievement Watcher Next 3.9.2

A bug-fix release. Thanks to everyone who filed a report - several of these came straight from an
issue.

## Highlights

- **A wedged Watchdog monitor is detected.** The old check only proved the monitor process still
  existed, not that it was doing anything - a blocking call or a runaway loop kept it looking alive
  while it tracked nothing. The monitor now reports a heartbeat, and the title bar shows starting,
  running, unresponsive or stopped; a manual restart repaints it immediately.

- **A portable release with no emulator config is discovered.** The 3.9.1 portable probing was
  anchored on the emulator ini, so a release that ships none - or whose ini was deleted - fell
  outside it. Known save-tree layouts are walked directly instead, so the game is found without any
  config, and a refused folder now says which kind of folder it is instead of just "invalid". (#32)

- **The Steam API check bypass no longer breaks achievements on games that don't need it.** It is
  meant to redirect a SteamStub integrity re-check back to the original DLL; without a re-check to
  absorb that redirect it landed on the game's real runtime load instead, and Steam's own "no
  license" prompt won before the GBE Fork DLL could. It now only runs when a SteamStub was actually
  detected.

- **RLD! saves that record an unlock through Time alone are read correctly**, instead of every
  achievement in that save reading as locked.

- **Icon downloads used during a repair or a background re-check try the same CDN mirrors as a
  normal icon fetch**, instead of giving up and marking the art unobtainable the moment the raw
  schema URL 404s - routine for a new appid whose achievement art isn't on Steam's primary CDN yet.

- **A Goldberg save no longer loses progress to its own unwritten twin folder.** The automatic
  emulator fix pre-creates both the GBE Fork and classic Goldberg save roots, since it can't know in
  advance which one the installed build will write to; whichever folder actually holds
  `achievements.json` is now the one that's kept.

- **Clicking an achievement toast lands on that achievement's row**, and the cover picker keeps the
  schema's default cover as its own tile once a per-game override is set.

- **Autoscroll on a game page is smooth again**, without the per-frame viewport cost the 3.9.1 fix
  for #35 introduced.

## Install

Download `Achievement.Watcher.Setup.3.9.2.exe` from the
[v3.9.2 release](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/tag/v3.9.2), or let
the app update itself.

The `.blockmap` and `latest.yml` assets are used by automatic updates.

---

[Full changelog](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/CHANGELOG.md#392---2026-08-20) ·
[Documentation](https://shirowwww.github.io/Achievement-Watcher-Next/) ·
[Troubleshooting](https://shirowwww.github.io/Achievement-Watcher-Next/troubleshooting.html)
