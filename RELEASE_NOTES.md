# Achievement Watcher Next 3.9.0

Achievement Watcher is now **Achievement Watcher Next** - **AW Next**. This release consolidates the
work of the whole 3.x cycle behind a new name, a new icon set and an interface you can scale to how
much control you actually want.

## Highlights

- **Notifications that pick their own transport.** The new **Automatic** mode shows the in-game
  overlay when it can be seen and a Windows notification when it cannot - never both, and never a
  silent miss. Overlay, Windows notification and Both are still there if you prefer to decide.

- **Game Health.** Every game now answers the question "why isn't this tracking?" itself: one clear
  state, the checks behind it, and only the repairs that genuinely apply to that game - locating it,
  rewriting its achievement data, restoring an emulator file or correcting a mismatched game ID.

- **A new preset library and a real Preset Designer.** Nine redesigned popups replace the old
  seventeen, each with a proper 100% completion state. The designer builds your own with ordinary
  controls and previews the *real* notification - same page, same engine a game gets - at any screen
  size. Share the result as a single `.awpreset` file.

- **Simple and Advanced modes.** Pick one during setup. Simple keeps the everyday settings; Advanced
  restores the full control panel. Nothing is hidden that would explain a missing game.

- **Reset and restore achievements.** Replay a game from zero across every local source, always with
  a backup taken first, and put it back with one action.

- **Faster where you feel it.** The library no longer refreshes itself minutes after launch, each
  achievement folder is watched once instead of twice, and startup does markedly less blocking work.

## Upgrading from 3.8.x

Install over your existing version - nothing else to do.

Your settings, presets, themes, covers, backups, souvenir screenshots and playtime history are
carried across to the new `%APPDATA%\Achievement Watcher Next` folder on first launch. The previous
folder is left completely intact, so you can still go back. Shortcuts, the "start with Windows"
entry and automatic updates continue to work unchanged.

## Install

Download `Achievement.Watcher.Setup.3.9.0.exe` from the
[v3.9.0 release](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/tag/v3.9.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates.

> The project repository is now **Achievement-Watcher-Next**. Existing installs update normally -
> GitHub redirects the previous address permanently.

---

[Full changelog](https://github.com/Shirowwww/Achievement-Watcher-Next/blob/main/CHANGELOG.md#390---2026-08-18) ·
[Documentation](https://shirowwww.github.io/Achievement-Watcher-Next/) ·
[Troubleshooting](https://shirowwww.github.io/Achievement-Watcher-Next/troubleshooting.html)
