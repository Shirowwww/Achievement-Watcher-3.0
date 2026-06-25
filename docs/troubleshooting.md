# Troubleshooting

Common issues and how to resolve them. Logs live in
`%AppData%\Achievement Watcher\logs` — attach them to any bug report.

## A game isn't showing up

- Add its folder in **Settings → Folders**, then use **Generate configs** to scan and
  configure everything immediately.
- Emulated games appear only after the emulator has run at least once (so a save folder
  exists), or after the emulator fix creates one. See [emulator-setup.md](emulator-setup.md).
- If only *installed* games should appear, the **"installed games only"** filter (on by
  default) hides owned-but-not-installed and orphaned entries. Toggle it off to see all
  known games.

## Achievements stay locked / at 0%

- If you haven't unlocked anything yet, 0% is correct.
- Otherwise it's usually a schema mismatch, a customised save path, or an app-id mismatch.
  Right-click the game → **Diagnose**, then **Repair**. Full details in
  [emulator-setup.md](emulator-setup.md#achievements-stay-locked-even-though-the-files-are-there).

## Descriptions show "…"

Hidden-achievement descriptions are fetched via Steam's `GetGameAchievements` endpoint and
repaired in place. If you're offline with no Steam Web API key, the app backfills text from
the game's local `steam_settings` schema when available.

## No notifications appear

- Make sure the background tracker is running (the title-bar banner shows its status; it
  auto-starts at sign-in).
- Test from **Settings → Notification** or the **Diagnostics** tab.
- For the in-game **overlay**, confirm the delivery mode is *overlay* or *both* and that a
  preset is selected.

## Playtime isn't tracked

Some games run under an executable name that differs from their store entry, or spawn
several processes. 3.0 tracks sessions by process id, so this is handled — if a specific
game still isn't tracked, set its executable from the game's configuration dialog.

## PlayStation-PSPC ports (TLOU II, God of War, …)

These never report through the Steam API, so no Steam emulator can track them. Use a
**RUNE** release; the app monitors `%PUBLIC%\Documents\Steam\RUNE` automatically.

## Antivirus flags the app or a downloaded DLL

Unsigned Electron builds and Steam-emulator DLLs are common false positives. Download only
from the [official Releases page](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases),
verify the published SHA-256, and report false positives to your AV vendor rather than
disabling protection. See the README's *Security & false positives* section.

## The window won't open / nothing happens

- If you launched it as plain Node (e.g. `ELECTRON_RUN_AS_NODE` set in your environment),
  remove that variable — it makes Electron run as Node and the app won't start.
- Renderer errors are logged to `logs/renderer.log`; attach it to a bug report.
