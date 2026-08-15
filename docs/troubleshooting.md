# Troubleshooting

Start with the checks below. If a problem remains, include the app version, Windows version, source involved, exact reproduction steps and relevant logs in the bug report.

## Open logs and local data

<div align="center">
<img src="../screenshot/diagnostic.png" width="560" alt="Settings - Advanced Diagnostics"><br>
<sub>App/runtime versions and quick access to logs, data and update checks</sub>
</div>

The **Advanced** tab only exists while the interface is in Advanced mode. If you do not see it,
switch the **Interface** control at the top of **Settings** from Simple to Advanced first - nothing
is lost by switching back afterwards (see [getting-started.md](getting-started.md#simple-and-advanced)).

Use **Settings → Advanced → Diagnostics** to open the log or data directory. The default log path is:

```text
%APPDATA%\Achievement Watcher Next\logs
```

The most useful files are usually `Achievement Watcher.log`, `renderer.log`, `parser.log` and the Watchdog logs created for the affected source. Zip several files when the failure crosses scanning, UI and notification behavior.

Logs are appended, never truncated, so a crash survives the next launch. Each run starts with a marker, which is how you tell one launch from the next:

```text
===== session 2026-08-11T00:53:31.890Z pid=19276 =====
```

Right after it, a `[diag]` block records everything a bug report needs and nobody should have to collect by hand - versions, install and data paths, how the app was started, the active language and theme, and the geometry of every display:

```text
[diag] app: Achievement Watcher 3.8.6 (packaged)
[diag] runtime: electron 43.4.0 · chrome 150.0.7871.224 · node 24.18.1
[diag] display: 3056414223 1080x1920 @1x work=1080x1872 rotation=270
[diag] display: 3933707034 (primary) 2048x1152 @1.25x work=2048x1104 rotation=0
```

Paste that block into an issue. Window size and placement problems are almost always a display-scaling or multi-monitor story, and the `[MainWindow]` lines that follow record the window's bounds every time it is shown, moved, resized or closed - including which display it was on.

Each log file rotates to `<name>.log.1` past 2 MB, so one older generation is always kept.

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

DLC and update achievements show their owning group under the title (e.g. a "Hearts of Stone"
tag) when SteamHunters knows the groups; games without groups are left untagged.

Hidden achievement descriptions may stay hidden when every available source intentionally omits them.

## A game update added achievements that aren't showing up

A cached schema re-checks itself against Steam every 3 days, since Steam never announces when an
update adds achievements. To pick them up immediately instead of waiting, use **Settings → Advanced
→ Recheck achievement lists**. Existing achievements and unlocks are never removed by this check.

## An update is stuck on the same file

Downloaded update files are kept between runs. If a download keeps failing on the same file, use
**Settings → Advanced → Clear caches** and check for updates again. Only re-downloadable caches
are deleted - settings, game data and logs are untouched.

## Notifications do not appear

1. Confirm the background tracker is running.
2. Open the game and read the Notifications row of its **Game Health** panel: it names the transport
   that actually delivered the last notification for that game, and why.
3. Use the normal, rare and overlay tests under **Settings → Notification**.
4. Confirm the delivery mode and selected preset. On **Automatic**, a missing overlay popup is often
   the intended fallback rather than a fault — see [Notifications](notifications.md#how-automatic-decides).
5. Check Windows notification permissions for AW Next.
6. If the issue happens only while playing or in full screen, turn on **Priority notifications** under
   **Settings → Notification** and accept the Windows permission prompt.
7. Test the overlay outside exclusive fullscreen mode.
8. Review the logs immediately after a failed test or unlock.

If the library updates but no notification appears, the source watcher works and the problem is likely in the selected notification transport. If the library also stays unchanged, diagnose the source or save path first.

## Playtime is not tracked

AW Next follows the configured game executable and its process lifetime. If a launcher, helper or differently named binary starts instead:

- right-click the game and open its configuration;
- select the executable that remains active while playing;
- avoid launcher and crash-handler processes;
- restart the game after saving the change.

## Ubisoft or Uplay R2 uses the wrong action

Ubisoft games should receive Ubisoft-specific metadata and the Uplay R2 repair action, not the Steam GBE action. Run a fresh folder scan and check the source icon. If the game is still misidentified, attach `parser.log`, the displayed source/IDs and the game directory name to a report.

## Antivirus or SmartScreen warning

Packaged releases are signed with the project's self-signed publisher certificate, not a publicly
trusted commercial certificate, so Windows SmartScreen may still warn. You never need to install
the certificate: the in-app updater accepts the exact `CN=Shirow` identity even when Windows does
not trust its root, and independently checks the SHA-512 release manifest. Optional emulator DLLs
can also trigger heuristic detections. Download only from the [official Releases page](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases) and compare the installer against the SHA-512 value stored in the matching `latest.yml`.

Do not disable system-wide protection. Submit a false-positive report to the antivirus vendor when a file from the official release is incorrectly quarantined.

## The window does not open

- Use the tray icon in case the app started hidden.
- End a stuck AW Next process, then launch it once more.
- Remove `ELECTRON_RUN_AS_NODE` from the environment if it was set for development; that variable makes Electron start as plain Node.
- Check `renderer.log` and the main app log for the first error.
- Try **Settings → General → Disable hardware acceleration** if the UI is visible long enough to change it.

## Start with a fresh profile

Use this only after backing up data you want to keep:

1. Exit AW Next fully from the tray.
2. Rename `%APPDATA%\Achievement Watcher Next` to `Achievement Watcher Next.backup`.
3. Start the app and reproduce the issue with the new profile.

If the issue disappears, restore only the data you need or attach the relevant configuration files to the report. Renaming is safer than deleting because it keeps a rollback path.

## Report the problem

Search the [existing issues](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues) first. If no report matches, open a bug using the repository template and attach logs after removing any information you do not want to share publicly.

---

**That's the end of the user path.** From here the documentation turns technical:
[Goldberg/GBE reference](goldberg-gbe.md) for file formats and detection rules, and
[Architecture](architecture.md) for the app / renderer / Watchdog boundaries.

<p align="center"><a href="README.md">← Documentation</a> · <a href="getting-started.md">Getting started</a> · <a href="../README.md">Project home</a></p>
