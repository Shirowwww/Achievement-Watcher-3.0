# Achievement Watcher 3.8.1

A quality pass over the interface and the things that interrupt you: settings sections that fold
away, an update prompt that remembers your answer and waits until you stop playing, and a log that
no longer erases itself right when you need it.

## Highlights

- **Settings sections fold away.** Every section closes under its own header — chevron down when
  open, sideways when closed — and remembers its state. The **Custom preset** builder, the largest
  and least often needed section, starts closed. Searching still looks inside closed sections.
- **The update prompt stops nagging.** **Later** recorded nothing at all, so the hourly re-check
  reopened the same dialog an hour later, and every hour after that. It now silences that version
  for a day, **Skip this version** stays permanent, and neither ever hides a newer release.
- **Updates never interrupt a game.** The prompt is a modal window with no parent, so it landed on
  top of whatever was on screen, fullscreen sessions included. While a game is running the check is
  skipped entirely; the offer comes back shortly after the session ends.
- **The preset builder works on an installed build at all, and is a real editor.** It wrote into the
  app's own folder, which is packed inside `app.asar` once installed — an archive file, not a
  directory — so Preview and Save failed with `ENOTDIR` and only a development run ever worked.
  Generated presets now live under `%APPDATA%`, beside imported sounds and user themes, where they
  also survive an update. Preview a design as an actual overlay popup before saving it, reopen a
  saved preset to change it, delete the ones you do not keep, set the popup width, and see every
  slider's value.
- **Hidden games are listed by name.** The blacklist showed bare App IDs. Names are resolved from
  the app's own game index and cached data first — the only local sources that cover non-Steam
  entries — then from Steam, and remembered.
- **Every theme carries its own palette.** The Steam-login and Epic-account cards were pinned to a
  fixed amber and stayed that way under OLED, Dracula, Nord, Gruvbox and Tokyo Night. They follow
  the accent now, along with the profile stat pills and the empty-library panel.
- **Logs survive.** They were opened truncating, so launching the app while it was already running
  emptied the running instance's log and left a hole of NUL bytes over everything before it — and a
  crash was erased by the next launch. Logs now append, mark each run, and rotate at 2 MB. Every
  launch also writes a `[diag]` block (versions, paths, displays) worth pasting into an issue.
- **Right-click fixes.** **Launch game** and **Configure executable…** were only offered for Ubisoft
  games; they are available for every source now. **Find a community fix** names its source
  (CrakFiles), is offered for Ubisoft installs too, and no longer proposes a different game from the
  same franchise. Uplay R2 setups can restore the snapshot taken before the last repair.
- **You can see updates and installs happening.** Downloading an update drives the taskbar progress
  bar (and the tray tooltip while no window is open), and the installer shows its status line and
  details pane again instead of a bare progress bar.
- **A manual unlock updates the library immediately**, and clearing one takes the unlock back.
- **The custom theme editor stops shifting.** Switching a layer effect on and off moved the whole
  colour / gradient / effect block 130px to the left.

## Install

Download `Achievement.Watcher.Setup.3.8.1.exe` from the
[v3.8.1 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.1).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#381---2026-08-11) for the full list of changes.
