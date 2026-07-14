# Troubleshooting

Start with the checks below. If a problem remains, include the app version, Windows version, source involved, exact reproduction steps and relevant logs in the bug report.

## Open logs and local data

Use **Settings → Advanced → Diagnostics** to open the log or data directory. The default log path is:

```text
%APPDATA%\Achievement Watcher\logs
```

The most useful files are usually `Achievement Watcher.log`, `renderer.log`, `parser.log` and the Watchdog logs created for the affected source. Zip several files when the failure crosses scanning, UI and notification behavior.

## A game is missing

1. Open **Settings → Sources** and confirm the relevant integration is enabled.
2. Open **Settings → Folders**, run **Smart Find**, then use **Generate configs** for a full scan.
3. Add the actual game library or save root manually if it uses a custom location.
4. Turn off **Installed games only** temporarily to see whether the game is known but no longer considered installed.
5. For emulator saves, launch the game once so it creates a runtime folder.

If only old save residue remains and the game files are gone, the installed-only filter is expected to hide the entry.

## Achievements stay locked or show 0%

No runtime unlock file means 0%, even when a complete schema is present. If an achievement has definitely unlocked:

- right-click the game and run the available diagnosis;
- verify that the detected AppID or platform ID belongs to the correct game;
- check for a custom save path;
- repair a mismatched `steam_settings` schema only after reviewing the report.

See [Goldberg and GBE Fork setup](emulator-setup.md#common-problems) or [Goldberg Uplay R2 setup](uplay-r2.md#achievements-remain-at-0) for source-specific steps.

## Names, descriptions or artwork are missing

- Refresh while online so the app can retry its metadata sources.
- Confirm the game's platform identity is correct; a wrong Steam AppID can return convincing but unrelated metadata.
- For Goldberg/GBE, a valid local schema can fill some missing text offline.
- Use the game's cover actions to retry or choose local artwork when automatic sources fail.

Hidden achievement descriptions may stay hidden when every available source intentionally omits them.

## Notifications do not appear

1. Confirm the background tracker is running.
2. Use the normal, rare and overlay tests under **Settings → Notification**.
3. Confirm the delivery mode and selected preset.
4. Check Windows notification permissions for Achievement Watcher.
5. Test the overlay outside exclusive fullscreen mode.
6. Review the logs immediately after a failed test or unlock.

If the library updates but no notification appears, the source watcher works and the problem is likely in the selected notification transport. If the library also stays unchanged, diagnose the source or save path first.

## Playtime is not tracked

Achievement Watcher follows the configured game executable and its process lifetime. If a launcher, helper or differently named binary starts instead:

- right-click the game and open its configuration;
- select the executable that remains active while playing;
- avoid launcher and crash-handler processes;
- restart the game after saving the change.

## Ubisoft or Uplay R2 uses the wrong action

Ubisoft games should receive Ubisoft-specific metadata and the Uplay R2 repair action, not the Steam GBE action. Run a fresh folder scan and check the source icon. If the game is still misidentified, attach `parser.log`, the displayed source/IDs and the game directory name to a report.

## Antivirus or SmartScreen warning

Packaged releases are currently unsigned, and optional emulator DLLs may also trigger heuristic detections. Download only from the [official Releases page](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases) and compare the installer against the SHA-512 value stored in the matching `latest.yml`.

Do not disable system-wide protection. Submit a false-positive report to the antivirus vendor when a file from the official release is incorrectly quarantined.

## The window does not open

- Use the tray icon in case the app started hidden.
- End a stuck Achievement Watcher process, then launch it once more.
- Remove `ELECTRON_RUN_AS_NODE` from the environment if it was set for development; that variable makes Electron start as plain Node.
- Check `renderer.log` and the main app log for the first error.
- Try **Settings → General → Disable hardware acceleration** if the UI is visible long enough to change it.

## Start with a fresh profile

Use this only after backing up data you want to keep:

1. Exit Achievement Watcher fully from the tray.
2. Rename `%APPDATA%\Achievement Watcher` to `Achievement Watcher.backup`.
3. Start the app and reproduce the issue with the new profile.

If the issue disappears, restore only the data you need or attach the relevant configuration files to the report. Renaming is safer than deleting because it keeps a rollback path.

## Report the problem

Search the [existing issues](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues) first. If no report matches, open a bug using the repository template and attach logs after removing any information you do not want to share publicly.

[Back to the documentation index](README.md)
