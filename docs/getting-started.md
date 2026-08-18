# Getting started

AW Next is a Windows desktop application. Packaged releases include their own runtime, so Node.js is required only when building from source.

## Install

1. Open the [latest release](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/latest).
2. Download `Achievement.Watcher.Setup.<version>.exe`.
3. Run the installer and choose an installation folder.
4. Open AW Next from the Start menu or desktop shortcut.

> [!WARNING]
> The installer is self-signed by `CN=Shirow`. You do not need to install its certificate, and
> in-app updates accept it on a fresh PC while still checking the release SHA-512. Windows
> SmartScreen may nevertheless ask for confirmation because the certificate is not publicly trusted.

## First launch

<div align="center">
<img src="screenshot/onboarding.png" width="620" alt="First-run guide, choosing between the Simple and Advanced interface"><br>
<sub>Six steps: language, how it works, interface, account, games and settings</sub>
</div>

The first-run guide asks for the main choices needed to populate the library:

- **Language** controls the interface and the preferred language for game metadata when the source provides it.
- **Interface** chooses between Simple and Advanced (see below). The guide will not move past this
  step until you pick one - neither is preselected.
- **Sources** enables launcher, local-save and emulator integrations.
- **Folders** tells AW Next where to look for game libraries and achievement saves.
- **Notifications** chooses how unlocks are announced. **Automatic** is the default and needs no
  decision: it uses the in-game overlay when it can be shown and a Windows notification when it cannot.

You can revisit every option later from **Settings**.

## Simple and Advanced

The interface comes in two sizes. Pick one in the first-run guide, and change it whenever you like
from the **Interface** control at the top of **Settings**.

<div align="center">
<img src="screenshot/settings.png" width="620" alt="AW Next settings"><br>
<sub>The Interface control sits beside the panel title; the search field filters every tab at once</sub>
</div>

- **Simple** shows the everyday tabs: General, Theme, Controller, Notification, Presets, Sources,
  Folders and Help.
- **Advanced** adds the Steam emulator and Advanced tabs, plus the deeper options inside the
  tabs Simple already shows.

**Simple hides controls, it never turns anything off.** Tracking, scanning and notifications work
the same either way, and every value you set is still there when you switch back.

Per-game **Game Health** follows the same idea: Simple says *Achievement data found* or *Tracking
active*, Advanced gives the exact counts, files and process names. **Technical details** at the
bottom of the panel has the raw values in both.

Upgrading an existing installation lands on **Advanced**, so nothing you were using disappears.

In **Settings → Sources**, the shield marks the official desktop libraries supported directly:
Steam, Ubisoft Connect, GOG Galaxy, Epic Games and Xbox PC. Enable the relevant row and refresh the
library; only libraries detected on the current PC are displayed. Simple mode folds away a few niche
rows while they are unused, and brings them straight back the moment they matter. Every source and
what it needs is listed in [Compatible sources](sources.md).

The search field at the top of **Settings** filters every tab at once, and the side menu shows how many options each tab matches - useful when you remember what an option does but not where it lives. It matches labels, descriptions, the values an option offers and its internal name, so `hideZero` finds the same row in any interface language. Press `Ctrl+F` to jump to it and `Esc` to clear it.

## Help & tips adapts to your setup

The **Settings → Help** tab is a live reference, not a static page:

- The strip at the top shows your current theme, notification mode, controller
  state, overlay hotkey and how many sources are enabled.
- Controller instructions follow the selected layout (**Xbox**, **PlayStation**
  or **Switch**) and show your real bindings, including the three-button
  open/close combo.
- Keyboard-shortcut entries show the hotkey actually saved instead of a
  hard-coded default.
- The topic search ignores case and accents. Several matches stay as a compact
  list; a single match opens immediately.
- Every topic is available in both interface modes: reading about a feature
  never requires switching modes first.

The panel refreshes immediately as you change settings, so it doubles as a
preview before you press **Save**.

## Steam metadata, keyless by design

No Steam Web API key and no connected Steam account are used: each game's achievement list is
fetched automatically from public endpoints and cached per language, so the library keeps working
offline afterwards. [Compatible sources](sources.md#steam-metadata-without-an-api-key) explains the
lookup chain, the DLC and update tags, and the 3-day recheck.

## Find games and saves

Open **Settings → Folders** and choose one of these paths:

- **Smart Find** checks common launcher, emulator, save and game-library locations.
- **Add a Folder** watches a location you select.
- **Generate configs** performs a fuller scan and can apply enabled emulator setup options.

If a folder is rejected, select the directory that directly contains the supported save folders, AppID folders, `steam_settings`, or the relevant emulator configuration. The [troubleshooting guide](troubleshooting.md#a-game-is-missing) lists the first checks to make.

## Configure notifications

Open **Settings → Notification** and choose a delivery mode:

- **Automatic** (default) uses the in-game overlay when it can be shown, and a Windows notification
  when it cannot - for example while a game holds exclusive fullscreen, where an overlay popup would
  not be visible. The same unlock is never announced twice.
- **In-game overlay** always displays a styled popup over the running game.
- **Windows notification** always uses native Windows notifications.
- **Both** enables both transports.

The [notifications guide](notifications.md#how-automatic-decides) explains what Automatic looks at,
and a game's **Game Health** panel reports which transport actually delivered its last notification.

If Windows Do Not Disturb normally hides desktop notifications while playing, enable **Priority
notifications** in the same section and approve the one-time Windows request. This affects achievement
unlocks, not progress or playtime updates.

Use the test buttons before launching a game. Presets, sounds, volume, duration and position can all be changed later. See [Notifications](notifications.md) for details.

## Check on a game

Every game tile has a **tools** button that opens its **Game Health** panel: whether AW Next can see
the game, read its achievements and announce its unlocks - and the repairs that genuinely apply to
that game. It is the fastest answer to "why is this one not working", and the first thing to open
before reporting a problem. See [Game Health](game-health.md).

Playing a game through again from zero is [Reset achievements](advanced.md#reset-a-games-achievements),
which backs everything up first.

## Tray and startup behavior

Closing the main window normally keeps AW Next in the system tray. The background tracker continues watching supported files and processes for playtime and unlocks.

Starting with Windows and closing to the tray can be changed under **Settings → General**. To exit fully, use the tray menu.

## Updates and existing data

Installed releases check the project's GitHub release feed for a newer version. When one is found, the app asks first whether you want to download and install it - nothing is downloaded without your OK. Once the download finishes, it asks again before restarting to apply the update.

Installing a newer build over an older one replaces program files but preserves user data in:

```text
%APPDATA%\Achievement Watcher Next
```

This directory contains settings, watched folders, caches, playtime, logs, notification assets and local account data.

On the first launch after upgrading, AW Next imports your existing data into it:

| You are coming from | Imported from | What happens |
|---|---|---|
| Achievement Watcher 3.x | `%APPDATA%\Achievement Watcher 3.0` | Settings, presets, themes, covers, caches, backups and logs are carried over |
| Achievement Watcher 1.6.8 | `%APPDATA%\Achievement Watcher` | Same, for anyone who skipped 3.x |
| A fresh machine | nothing | AW Next starts with defaults |

The import runs once, copies small files and hard-links the large write-once ones, and **never deletes or modifies the folder it read from** - if anything goes wrong, your old data is still exactly where it was. Playtime counters stored in the registry are carried across the same way. Screenshot souvenirs move to `Pictures\Achievement Watcher Next`, unless you chose your own souvenir folder, in which case it is left untouched.

Uninstalling does not remove the data directory by default. Delete it manually only when you intentionally want a completely fresh profile.

If an update keeps failing on the same downloaded file, **Settings → Advanced → Clear caches**
deletes only re-downloadable caches (update files, Steam/Ubisoft schema and icon cache, downloaded
emulator-fix tools) and lets everything re-fetch itself; settings, saves and backups are untouched.

---

**Next:** [Compatible sources](sources.md) - what AW Next can read, and what each source needs.

*Jump ahead if you already know what you need: [Notifications](notifications.md) ·
[Game Health](game-health.md) · [Goldberg / GBE setup](emulator-setup.md) ·
[Troubleshooting](troubleshooting.md)*

<div align="center">

[← Documentation](README.md) · [Project home](https://github.com/Shirowwww/Achievement-Watcher-Next)

</div>