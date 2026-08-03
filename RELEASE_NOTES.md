# Achievement Watcher 3.4.0

Version 3.4.0 makes Ubisoft (Goldberg Uplay R2) achievements work reliably — including live notifications, which never fired for those games before — removes the long pause near the end of a library scan, stops the library refreshing itself every few minutes, and adds a search field to Settings.

## Highlights

- **Ubisoft achievements are read from wherever the emulator actually writes them.** Unlock state was only ever read from the folder the fix redirects to, so a game whose emulator saved elsewhere stayed at 0%. Every possible save folder is now read and merged, and the Ubisoft objective ids are translated back to the game's achievement names.
- **The Uplay R2 fix adapts to the loader you have.** Loader builds released before `AchSaveType`/`AchSavePath`/`AchKeyPrefix` existed ignored those settings entirely, so the configuration looked correct while nothing was ever recorded. Those builds now get a configuration they understand, and "Apply emulator fix (Uplay R2)" offers to update the loader when a newer one is available locally.
- **A game update no longer silently breaks a working Ubisoft setup.** Re-extracting a repack deletes `achievements_schema.json` and restores an ini with achievements switched off. That is now detected and re-applied automatically, and "Diagnose Uplay R2 setup" reports each fault explicitly.
- **Live notifications for Ubisoft games.** The background Watchdog never watched the Uplay emulator's save folder, so these unlocks only appeared after a manual refresh. They now pop while you play, like every other source.
- **No more stall near the end of a scan.** Folders named with a Ubisoft product id were being looked up as if they were Steam AppIDs, costing up to 30 seconds per scan on a lookup that could never succeed. Appids that genuinely resolve to nothing are also remembered for a few days instead of being re-fetched every time.
- **The library stops reloading on its own.** A game that discovery kept finding but that never reached the list — a failed load, a title hidden by "hide 0%", a disabled source — was treated as a brand-new install on every background check and triggered a full refresh each time.
- **Search in Settings.** Type in the field at the top of Settings to filter every tab at once; the side menu shows how many options each tab matches. It searches labels, descriptions, values and internal option names, so `hideZero` finds the same row in any language. `Ctrl+F` focuses it, `Esc` clears it. Section headers now stay pinned while a long tab scrolls.

See the [changelog](CHANGELOG.md#340---2026-08-03) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.4.0.exe` from the [v3.4.0 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.4.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
