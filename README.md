<div align="center">

# 🏆 Achievement Watcher Next

<p><strong>Every achievement. One experience.</strong></p>

Track achievements, rarity and playtime across launchers, local saves and supported emulators - with
live Windows notifications or an in-game overlay.

[![Latest release](https://img.shields.io/github/v/release/Shirowwww/Achievement-Watcher-Next?display_name=tag&sort=semver&style=flat-square)](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Shirowwww/Achievement-Watcher-Next/total?style=flat-square)](https://github.com/Shirowwww/Achievement-Watcher-Next/releases)
![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&style=flat-square)
[![License](https://img.shields.io/badge/license-LGPL--3.0-green?style=flat-square)](LICENSE)

**[Download](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/latest)** ·
[Documentation](https://shirowwww.github.io/Achievement-Watcher-Next/) ·
[Changelog](CHANGELOG.md) ·
[Issues](https://github.com/Shirowwww/Achievement-Watcher-Next/issues)

<table>
<tr>
<td align="center"><img src="docs/screenshot/home.png" width="440" alt="Unified game library"><br><sub>One library for every supported source</sub></td>
<td align="center"><img src="docs/screenshot/achievements.png" width="440" alt="Achievement progress and rarity"><br><sub>Progress, rarity and unlock history</sub></td>
</tr>
</table>

</div>

> **AW Next** is the next generation of Achievement Watcher. It continues
> [Xan105's original](https://github.com/xan105/Achievement-Watcher) and
> [darktakayanagi's 2.x branch](https://github.com/darktakayanagi/Achievement-Watcher) with a modern
> runtime and a large compatibility, reliability and feature pass.

---

## What it does

- **One library for every source.** Launcher data, Steam-compatible saves and console emulators in a
  single list, with search, filters, rarity tiers, progress achievements and covers.
- **Notifications that choose their own transport.** Leave delivery on **Automatic** and each unlock
  arrives through the in-game overlay when it can be seen, and as a Windows notification when it
  cannot - never both.
- **A popup you can actually design.** Nine bundled presets, a no-code **Preset Designer** that
  previews the real popup, and one-file `.awpreset` sharing.
- **An in-game overlay list.** The running game's full achievement list on `Ctrl+Shift+K`, with
  search, filters and rarity badges - drivable entirely from a gamepad.
- **Answers when something is wrong.** Each game has a **Game Health** panel that says whether it is
  tracked, why not, and offers only the repairs that genuinely apply.
- **Repair tools for local setups.** Read-only diagnosis, `steam_settings` repair, matched GBE Fork
  runtime install, Uplay R2 support, backups and restore.
- **Yours to shape.** Simple and Advanced interface modes, built-in themes plus a custom one, full
  controller navigation, and 18 bundled interface languages.
- **Local-first.** No Steam Web API key, no required account, its own data directory, and caches that
  keep the library working offline.

<div align="center">
<table>
<tr>
<td align="center"><img src="docs/screenshot/onboarding.png" width="290" alt="First-run guide"><br><sub>Guided first-run setup</sub></td>
<td align="center"><img src="docs/screenshot/notification-preset.png" width="290" alt="Preset Designer"><br><sub>Design the popup, previewed live</sub></td>
<td align="center"><img src="docs/screenshot/game-health.png" width="290" alt="Game Health panel"><br><sub>Per-game health and guided repairs</sub></td>
</tr>
</table>
</div>

→ [How AW Next compares to Achievement Watcher 2.x and Achievements](https://shirowwww.github.io/Achievement-Watcher-Next/comparison.html)

---

## Install

1. Download `Achievement.Watcher.Setup.<version>.exe` from the
   [latest release](https://github.com/Shirowwww/Achievement-Watcher-Next/releases/latest).
2. Install and open AW Next, then follow the first-run guide.
3. Run **Settings → Folders → Smart Find**, and add any custom game or save location.
4. Leave the app in the system tray for live notifications and playtime tracking.

Settings, caches, playtime and achievement data live in `%APPDATA%\Achievement Watcher Next`.
Upgrading preserves them, and the first launch after an upgrade imports an older Achievement Watcher
folder without ever modifying it.

→ [Getting started](https://shirowwww.github.io/Achievement-Watcher-Next/getting-started.html) for the full first-run, discovery and update guide.

---

## Supported sources

| Source | Support |
|---|---|
| **Steam** | Local appcache state, public-profile data, achievement lists (including DLC/update tags) and cached product metadata |
| **Steam-compatible saves** | Goldberg, GBE Fork, GreenLuma, SmartSteamEmu, CreamAPI, Nemirtingas and compatible layouts |
| **GOG Galaxy** | Native local Galaxy databases and compatible legacy saves |
| **Epic Games** | Local installations, and official achievement state after an optional account connection |
| **Ubisoft Connect** | Native local data, legacy Uplay formats and compatible Uplay R2 setups |
| **EA Desktop** | The local achievement log, for installs outside EA's managed folders |
| **Console emulators** | RPCS3, ShadPS4 and Xenia, each watched live |
| **Xbox PC** | Local Game Pass / Microsoft Store installs, plus imported Xbox Network state |

Each source is an individual switch, and no Steam Web API key is used: achievement lists come from
public endpoints and are cached locally.

→ [Compatible sources](https://shirowwww.github.io/Achievement-Watcher-Next/sources.html) · [Goldberg / GBE setup](https://shirowwww.github.io/Achievement-Watcher-Next/emulator-setup.html) ·
[Uplay R2 setup](https://shirowwww.github.io/Achievement-Watcher-Next/uplay-r2.html)

> [!WARNING]
> Reading achievements is read-only. The emulator repair tools do modify game files - always after a
> confirmation and always with a backup. Use them only with games you own.

---

## Documentation

Start at the **[documentation site](https://shirowwww.github.io/Achievement-Watcher-Next/)**, which explains what each guide covers.

[Getting started](https://shirowwww.github.io/Achievement-Watcher-Next/getting-started.html) ·
[Sources](https://shirowwww.github.io/Achievement-Watcher-Next/sources.html) ·
[Notifications](https://shirowwww.github.io/Achievement-Watcher-Next/notifications.html) ·
[Presets](https://shirowwww.github.io/Achievement-Watcher-Next/presets.html) ·
[Overlay](https://shirowwww.github.io/Achievement-Watcher-Next/overlay.html) ·
[Controller](https://shirowwww.github.io/Achievement-Watcher-Next/controller.html) ·
[Game Health](https://shirowwww.github.io/Achievement-Watcher-Next/game-health.html) ·
[Troubleshooting](https://shirowwww.github.io/Achievement-Watcher-Next/troubleshooting.html) ·
[FAQ](https://shirowwww.github.io/Achievement-Watcher-Next/faq.html) ·
[Advanced tools](https://shirowwww.github.io/Achievement-Watcher-Next/advanced.html)

For contributors: [Contributing](CONTRIBUTING.md) · [Build guide](BUILD.md) ·
[Architecture](https://shirowwww.github.io/Achievement-Watcher-Next/architecture.html) ·
[Release workflow](https://shirowwww.github.io/Achievement-Watcher-Next/RELEASE_WORKFLOW.html)

## Build from source

Requires Windows and Node.js `22.22.2+` or `24.15+`. The app and the background Watchdog are separate
npm workspaces; `npm run build` writes the installer and updater files to `app\dist`. See
[BUILD.md](BUILD.md) for setup, packaging details and known constraints.

## Security and support

Found a problem, have an idea, or simply want something improved?
[Open an issue](https://github.com/Shirowwww/Achievement-Watcher-Next/issues) - reports and
suggestions are what help AW Next get better. For a vulnerability, use the private process in the
[security policy](SECURITY.md) rather than a public issue.

Download builds only from the
[official releases page](https://github.com/Shirowwww/Achievement-Watcher-Next/releases); `latest.yml`
carries the installer's SHA-512 digest. Installers use the project's self-signed `CN=Shirow`
certificate, which you do not need to install or trust - SmartScreen or antivirus warnings remain
possible because it is not issued by a publicly trusted authority. Sensitive settings and
connected-account tokens are encrypted before local storage, and the project contains no game files
and does not bypass online ownership checks.

For a bug report, include the app version, Windows version, affected source and the relevant files
from `%APPDATA%\Achievement Watcher Next\logs`. The issue tracker cannot provide games, credentials
or piracy support.

## Credits and license

Created by [Xan105](https://github.com/xan105/Achievement-Watcher), continued by
[darktakayanagi](https://github.com/darktakayanagi/Achievement-Watcher), and maintained here by
Shirowwww and project contributors. Redistributions of this fork must retain the project attribution
in [NOTICE](NOTICE).

Licensed under [LGPL-3.0](LICENSE). This project is not affiliated with Valve, Sony, Microsoft, GOG,
Epic Games, Electronic Arts or Ubisoft.
