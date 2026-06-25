# Emulator setup (Goldberg / GBE)

Games that run through a Steam emulator (Goldberg, GBE Fork, and similar repacks)
keep their achievements in local save files instead of on Steam. Achievement Watcher
reads those saves and can also set up or repair the emulator for a game so its
achievements are detected and pop up in-game.

> Use these tools only on games you own, for personal achievement tracking. They
> modify game files (backups are made automatically), so use them at your own risk.

## The two `achievements.json` files

This trips up almost every "achievements stay locked" report. There are **two**
unrelated files with the same name:

| | **Schema** | **Save** |
|---|---|---|
| Where | game folder → `steam_settings/` | `%APPDATA%\GSE Saves\<appid>\` (GBE) or `Goldberg SteamEmu Saves\<appid>\` |
| Written by | the cracker/repacker at setup | the emulator at runtime, as you unlock |
| Purpose | *defines* which achievements exist + text/icons | *records* which ones you unlocked |
| If missing | nothing pops in-game; the app falls back to the online Steam schema | the game is simply at 0% — everything shows locked, and that is correct |

If you've launched a game but unlocked nothing, 0% / all-locked is the **expected**
state, not a bug.

## Right-click actions (game → *Emulator & tools*)

- **Diagnose** — reports the emulator type, where `steam_settings` lives, schema vs.
  save counts, and any missing icons, blank descriptions or app-id mismatch.
- **Repair `steam_settings`** — writes a correct, schema-matching `achievements.json`,
  downloads icons, creates `steam_appid.txt` if missing, enables DLCs and stamps your
  identity/language. Previous files are snapshotted under `steam_settings/.aw-backups/`.
- **Apply emulator fix (GBE Fork)** — installs the maintained
  [GBE Fork](https://github.com/Detanup01/gbe_fork) `steam_api(64).dll` (original kept
  as `*.bak`), writes `steam_settings`, and creates the `GSE Saves\<appid>` folder so the
  game appears immediately at 0%.
- **Remove Steam DRM (Steamless)** — strips Valve's SteamStub from the executable when a
  plain DLL swap won't load (original kept as `*.steamstub.bak`). A no-op for games with
  no stub.
- **Back up / Restore configuration** — snapshot the emulator files before a change, and
  roll back a bad fix from the saved backup.

New emulated games can also be fixed **automatically in the background** — toggle it in
**Settings → Emulator**.

## Conditions for a game to show unlocked achievements

1. The emulator has run at least once, so a save folder exists (this is how the app finds
   the app id — there is no install-dir scan on the normal path).
2. The save's achievement names match the schema names the app gets from Steam.
3. For in-game pop-ups, `steam_settings/achievements.json` must list every achievement with
   valid icon paths.

## "Achievements stay locked even though the files are there"

In order of likelihood:

1. **Nothing unlocked yet** → no/empty save → all locked. Correct.
2. **Schema mismatch** → a hand-made `achievements.json` whose names don't match Steam's.
   Run **Repair**.
3. **Wrong save folder** → a customised save path sends unlocks somewhere the app doesn't
   watch. Re-run the emulator fix (it clears stray placeholder paths) or add that folder.
4. **App-id mismatch** → `steam_appid.txt` ≠ the real app id. **Repair** resolves it.

## PlayStation-PSPC ports

Some Steam ports (e.g. *The Last of Us Part II*, *God of War*) route trophies through
Sony's PSPC SDK and never call the Steam API, so **no Steam emulator can track them**.
The only thing that works is a **RUNE** release — Achievement Watcher monitors
`%PUBLIC%\Documents\Steam\RUNE` out of the box, so those unlocks are picked up
automatically once a RUNE version is installed.
