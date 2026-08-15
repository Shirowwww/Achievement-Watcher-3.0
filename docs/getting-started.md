# Getting started

AW Next is a Windows desktop application. Packaged releases include their own runtime, so Node.js is required only when building from source.

## Install

1. Open the [latest release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest).
2. Download `Achievement.Watcher.Setup.<version>.exe`.
3. Run the installer and choose an installation folder.
4. Open AW Next from the Start menu or desktop shortcut.

> [!WARNING]
> The installer is self-signed by `CN=Shirow`. You do not need to install its certificate, and
> in-app updates accept it on a fresh PC while still checking the release SHA-512. Windows
> SmartScreen may nevertheless ask for confirmation because the certificate is not publicly trusted.

## First launch

<div align="center">
<img src="../screenshot/onboarding.png" width="600" alt="First-run guide"><br>
<sub>The first-run guide walks through language, sources, folders and notifications</sub>
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

- **Simple** shows the everyday tabs: General, Theme, Controller, Notification, Sources, Folders
  and Help.
- **Advanced** adds the Steam emulator and diagnostics tabs, plus the deeper options inside the
  tabs Simple already shows.

**Simple hides controls, it never turns anything off.** Tracking, scanning and notifications work
the same either way, and every value you set is still there when you switch back.

Per-game **Game Health** follows the same idea: Simple says *Achievement data found* or *Tracking
active*, Advanced gives the exact counts, files and process names. **Technical details** at the
bottom of the panel has the raw values in both.

Upgrading an existing installation lands on **Advanced**, so nothing you were using disappears.

In **Settings → Sources**, the shield marks the official desktop libraries supported directly:
Steam, Ubisoft Connect, GOG Galaxy, Epic Games and Xbox PC. Enable the relevant row and refresh the
library; only libraries detected on the current PC are displayed. The EA row is different: it reads
EA Desktop achievement logs for non-launcher-managed installs and does not import the regular
official EA library.

The Sources list adapts to you. In Simple mode, a handful of niche rows (GreenLuma, LumaPlay, the
Nemirtingas emulators, Goldberg SocialClub and the notification-cache import) stay out of the way
while they are untouched and no game in your library came from them. Turn one off, or own a game it
detected, and its row comes back - so the switch is always there when it matters. Advanced always
lists all of them.

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

No Steam Web API key or connected account is used: each game's schema is fetched automatically
with a fast keyless chain. In order, AW Next tries the official
`IPlayerService/GetGameAchievements` endpoint (which includes hidden descriptions, icons and global
rarity), then the SteamHunters public JSON API enriched with the SteamCommunity page (icons and
hidden status), then SteamCommunity alone, and finally a browser scrape as a last resort. Results
are cached per language in `%APPDATA%\Achievement Watcher Next\steam_cache\schema`.

DLC and update achievements are tagged with their owning group (e.g. "The Witcher 3: Wild Hunt -
Hearts of Stone") under the achievement title in the detail view. The groups come from the same
keyless SteamHunters lookup, so no account is needed either.

Steam never announces when a game update adds achievements, so a cached schema re-checks itself
against Steam every 3 days and picks up anything new without ever deleting an achievement you
already have cached. To check right away instead of waiting, use **Settings → Advanced → Recheck
achievement lists**.

## Find games and saves

Open **Settings → Folders** and choose one of these paths:

- **Smart Find** checks common launcher, emulator, save and game-library locations.
- **Add a Folder** watches a location you select.
- **Generate configs** performs a fuller scan and can apply enabled emulator setup options.

If a folder is rejected, select the directory that directly contains the supported save folders, AppID folders, `steam_settings`, or the relevant emulator configuration. The [troubleshooting guide](troubleshooting.md#a-game-is-missing) lists the first checks to make.

## Configure notifications

Open **Settings → Notification** and choose a delivery mode:

- **Automatic** (default) uses the in-game overlay when it can be shown, and a Windows notification
  when it cannot — for example while a game holds exclusive fullscreen, where an overlay popup would
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

## Reset a game's achievements

To play a game through again from zero, use **Reset achievements** — on the game's page, beside the
playtime, or from its right-click menu. It puts every achievement back to locked so the game can
unlock them again, and so AW Next announces them as new when it does.

Nothing is deleted without a copy. Every file involved is backed up first to
`%APPDATA%\Achievement Watcher Next\backups\achievements\<appid>\<date>\`, and the confirmation lists
the exact files before anything is touched. **Restore an achievement backup** in the same right-click
menu puts them all back where they came from.

| Source | What a reset does |
|---|---|
| Steam emulators (Goldberg/GBE, CODEX, RUNE, RLD!, OnlineFix, SKIDROW, SmartSteamEmu, EMPRESS, CreamAPI, 3DM, ALI213, Hoodlum, TENOKE, UniverseLAN, Nemirtingas, Goldberg SocialClub, Uplay R2…) | Removes the achievement save. The emulator writes a fresh one at the next unlock. |
| RPCS3 | Removes `TROPUSR.DAT`. The trophy list (`TROPCONF.SFM`) is left alone. |
| ShadPS4 | Relocks the trophies inside `TROP*.XML`, which also holds the trophy list — so the file is edited, never removed. |
| Xenia | Clears the earned flag inside the `.gpd`, which also holds the achievement list — same reason. |
| Steam, GOG Galaxy, Ubisoft Connect, EA, Epic, Xbox | **Not possible.** These keep unlocks on your account and re-synchronise them; only the account itself can clear them. AW Next says so instead of appearing to work. |

Progress counters stored beside the achievements (`stats.ini`, `stats.bin`, …) are reset too: for a
"travel 1000 km" style achievement the counter *is* the progress, and leaving it full would make the
achievement either fire instantly or never again. They are in the backup like everything else.

> [!NOTE]
> AW Next's own record of what was already unlocked is cleared at the same time, including in the
> running background tracker. Without that, a re-earned achievement would be compared against a
> record that still had it and would never be announced again.

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

**Next:** [Notifications](notifications.md) - choose how unlocks are announced and
test them before you launch a game.

*Jump ahead if you already know what you need: [Goldberg / GBE setup](emulator-setup.md) ·
[Uplay R2 setup](uplay-r2.md) · [Troubleshooting](troubleshooting.md)*

<p align="center"><a href="README.md">← Documentation</a> · <a href="../README.md">Project home</a></p>
