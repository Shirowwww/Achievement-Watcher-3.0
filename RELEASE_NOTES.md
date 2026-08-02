# Achievement Watcher 3.3.1

Version 3.3.1 fixes the 3.3.0 startup regression that left the main window blank, and makes automatic updates fully user-controlled: the app now asks before downloading anything, then asks again before restarting to install.

## Highlights

- **Fix: the app opens and loads again.** 3.3.0 could show an empty window because the renderer script crashed on a duplicate `userThemes` declaration before the library could load. That crash is gone — the library, settings and onboarding all initialize normally.
- **Xbox PC source repaired.** The Settings > Sources Xbox card no longer crashes with `fr is not defined`, and the Xbox PC parser is loaded from the correct path again.
- **Ask before download**: when a new version is found, a "Download & Install" prompt appears — nothing is downloaded without your OK.
- **Ask before install**: once the download completes, the app asks whether to restart and install now, later, or skip that version entirely.

See the [changelog](CHANGELOG.md#331---2026-08-03) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.3.1.exe` from the [v3.3.1 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.3.1).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
