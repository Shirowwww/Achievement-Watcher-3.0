# Achievement Watcher Next 3.9.1

A bug-fix release built from the reports that came in after 3.9.0. Thanks to everyone who took the
time to file one - each of these came from a detailed issue.

## Highlights

- **Your library is the same on every scan again.** A game whose metadata lookup failed or timed out
  was dropped from the list entirely, so the same disk produced a different handful of games each
  time and a missing card looked exactly like a game that was never installed. What is on disk now
  decides that a game exists; the online lookup only decorates it. An entry that could not be
  described yet is listed anyway and fills itself in on a later scan. (#33)

- **No more cards titled with a number.** When the name lookup came back empty, the bare Steam AppID
  became the title even though the real name was usually already in hand - in the app-list response,
  in the cache from the previous scan, or in the game's own install folder. All of those are asked
  first now, and a nameless record is never cached or handed to the Watchdog, so one bad response
  cannot keep a numeric title alive scan after scan. (#34)

- **Middle-button autoscroll is smooth.** A rare achievement row runs an animation that Chromium
  cannot composite, so every rare row in a game's list repainted on the main thread every frame,
  on screen or not. Off-screen rows are skipped now. (#35)

- **Updates install again when you ask for them.** A finished download was held back whenever a game
  was running, and a permanently resident Steam app (a controller utility like DSX, an overlay tool)
  counts as a running game for as long as the machine is on. On those setups every check downloaded
  the update, none of them installed it, and nothing said why. An update you explicitly ask for now
  installs regardless, and one genuinely held back for a game announces itself.

- **Portable and repack releases are found.** A CODEX/RUNE/CPY release installed the usual way
  writes its saves to a shared public folder, which was scanned. A portable one keeps that same tree
  next to the game instead, which was not, so the game had no card at all and looked exactly like a
  game that was never installed. Those layouts are checked now. (#32)

- **Changing a setting no longer interrupts achievement watching.** The Settings tabs save on every
  keystroke, and each save restarted the Watchdog - a dozen restarts for one gesture, with an unlock
  landing in one of the gaps getting missed. A burst of changes is now a single restart.

- **"Choose another cover" opens in about half a second** and offers up to 48 covers instead of 8,
  including Steam's own store artwork, with the landscape gallery finally populated.

- **Lighter in the tray.** Playtime tracking no longer spawns a process every three seconds: idle
  CPU use drops from about 7% of a core to 0.4%.

## Install

Download `Achievement.Watcher.Setup.3.9.1.exe` from the
[v3.9.1 release](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/tag/v3.9.1), or let
the app update itself.

The `.blockmap` and `latest.yml` assets are used by automatic updates.

---

[Full changelog](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/CHANGELOG.md#391---2026-08-18) ·
[Documentation](https://shirowwww.github.io/Achievement-Watcher-Next/) ·
[Troubleshooting](https://shirowwww.github.io/Achievement-Watcher-Next/troubleshooting.html)
