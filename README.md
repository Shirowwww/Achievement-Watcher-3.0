<div align="center">

# 🏆 Achievement Watcher 3.0

### All your PC achievements in one modern Windows library.

Track achievements, rarity and playtime across launchers, local saves and supported emulators — with live Windows notifications or an in-game overlay.

[![Latest release](https://img.shields.io/github/v/release/Shirowwww/Achievement-Watcher-3.0?display_name=tag&sort=semver&style=flat-square)](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Shirowwww/Achievement-Watcher-3.0/total?style=flat-square)](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases)
![Windows](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6?logo=windows&style=flat-square)
![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white&style=flat-square)
[![License](https://img.shields.io/badge/license-LGPL--3.0-green?style=flat-square)](LICENSE)

**[Download](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest)** · [Documentation](docs/README.md) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues)

<table>
<tr>
<td align="center"><img src="screenshot/home.png" width="440" alt="Unified game library"><br><sub>One library for every supported source</sub></td>
<td align="center"><img src="screenshot/achievements.png" width="440" alt="Achievement progress and rarity"><br><sub>Progress, rarity and unlock history</sub></td>
</tr>
</table>

</div>

> This fork continues [Xan105's original Achievement Watcher](https://github.com/xan105/Achievement-Watcher) and [darktakayanagi's 2.x branch](https://github.com/darktakayanagi/Achievement-Watcher), with a modern runtime and a large compatibility, reliability and feature pass.

---

## ✨ What this fork adds

| Area | What you get here |
|---|---|
| **Modern Windows base** | Electron 43, a current Node runtime, refreshed dependencies, safer renderer defaults and Windows 10/11 support without WMIC |
| **One local-first library** | Steam, GOG, Ubisoft, Epic, EA, Xbox PC and compatible saves/emulators in one place, with source controls and targeted rescans |
| **Practical compatibility tools** | Read-only Goldberg/GBE/Uplay R2 diagnosis plus opt-in repairs, matched runtimes and backups when a local setup needs help |
| **Notifications made for play** | Native Windows toasts or a localized in-game overlay, with progress, rare/completion styles, priority delivery, custom sounds and screenshot souvenirs |
| **Comfortable daily use** | Quiet tray Watchdog, live playtime, game and achievement search, installed-only filtering, cover tools and right-click game actions |
| **Personal without fragility** | Controller navigation, seven built-in themes plus a Custom theme, 18 complete UI languages, local artwork/schemas and data isolated from the original 1.6.8 app |

---

## ⚖️ At a glance

| Feature | ⭐ **This fork** | [Achievements](https://github.com/PSerban93/Achievements) | [Achievement Watcher 2.x](https://github.com/darktakayanagi/Achievement-Watcher) |
|---|:---:|:---:|:---:|
| Modern desktop runtime | ✅ Electron 43 | ✅ Electron 43 | ❌ Electron 12 |
| Local + official source readers | ✅ Steam · GOG · Ubisoft · Epic · EA · Xbox PC | ✅ Steam · GOG · Ubisoft · Epic · EA · Xbox PC | ⚠️ Steam · GOG · Epic · Uplay |
| Quiet tray playtime tracking | ✅ | ✅ | ✅ |
| Installed-only library and game actions | ✅ Filter · uninstall · restore | ⚠️ Config-driven | ❌ Not documented |
| Windows toast **and** in-game overlay | ✅ Both | ⚠️ Animated overlay | ⚠️ Chromium / toast transports |
| Selective scan and source controls | ✅ | ✅ Auto-config | ⚠️ Smart Find |
| Goldberg / GBE / Uplay R2 maintenance | ✅ Diagnose · repair · backup | ⚠️ Auto-config/schema | ❌ Manual setup |
| Live RPCS3 / ShadPS4 / Xenia unlocks | ✅ | ✅ | ⚠️ RPCS3 |
| Controller navigation | ✅ App + overlay | ✅ App + overlay | ❌ Planned |
| Themes and interface languages | ✅ 7 + Custom · 18 languages | ✅ Multiple · translated achievements | ⚠️ Legacy translations |
| Xbox PC achievement import | ✅ | ✅ | ❌ |

This fork is for players who want a polished local library, a quiet tray workflow, native Windows notifications and deeper compatibility tooling. **Achievements** is especially strong for automated configuration and its animated overlay. **Achievement Watcher 2.x** remains the historical foundation with its own legacy notification options.

<sub>✅ = supported and documented · ⚠️ = a partial, manual or different workflow · ❌ = not documented on the linked public branch. This is a concise orientation, not a feature matrix; verify upstream documentation before choosing a project.</sub>

---

## 🎯 Supported sources

| Source | Support |
|---|---|
| **Steam** | Local appcache state, public-profile data, schemas and cached product metadata |
| **Steam-compatible saves** | Goldberg, GBE Fork, GreenLuma, SmartSteamEmu, TENOKE and compatible layouts |
| **GOG Galaxy** | Native local Galaxy databases and compatible legacy saves |
| **Epic Games** | Local installations and official achievement state after optional account connection |
| **Ubisoft Connect** | Native local data, legacy Uplay formats and compatible Uplay R2 setups, with Steam global percentages bridged onto native achievement ids |
| **EA Desktop** | Achievement data recorded by the EA client log |
| **Console emulators** | RPCS3, ShadPS4 and Xenia |
| **Xbox PC** | Local Game Pass / Microsoft Store installs plus imported Xbox Network achievement state (optional account connection) |

The optional Steam Web API key can improve some lookups, but local sources and cached metadata continue to work without one.

---

## 📥 Install and use

1. Download `Achievement.Watcher.Setup.<version>.exe` from the [latest release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/latest).
2. Install and open Achievement Watcher.
3. Use the first-run guide to choose your language, sources, folders and notification mode.
4. Run **Settings → Folders → Smart Find** and add any custom game or save location.
5. Leave the app in the system tray for live notifications and playtime tracking.

<div align="center">
<img src="screenshot/settings.png" width="680" alt="Achievement Watcher settings"><br>
<sub>Sources, folders, notifications, appearance and diagnostics in one place</sub>
</div>

Updating over an older build keeps settings, cache, playtime and achievement data under `%APPDATA%\Achievement Watcher 3.0`. The first launch after upgrading imports the legacy `%APPDATA%\Achievement Watcher` folder once (copied, never moved), so the original 1.6.8 app and its uninstaller stay fully independent. See [Getting started](docs/getting-started.md) for the full first-run and update guide.

---

## 🔔 Notifications

Choose **Windows notification**, **In-game overlay** or **Both** under **Settings → Notification**.

- Presets for clean desktop, Steam, PlayStation, Xbox, rare and completion styles.
- A no-code preset builder with live preview.
- Custom `.wav`, `.mp3` and `.ogg` sounds.
- Position, scale, duration and overlay volume up to 200%.
- Separate presets for normal, rare and 100% completion events.
- Per-game progress mute without hiding real unlocks.
- Optional priority unlock notifications that can appear during Windows Do Not Disturb after your approval.
- Optional screenshot souvenirs.

<table>
<tr>
<td align="center"><img src="screenshot/notifications.png" width="470" alt="Notification settings"><br><sub>Preset library and custom builder</sub></td>
<td align="center"><img src="screenshot/overlay.png" width="330" alt="In-game overlay"><br><sub>In-game achievement overlay</sub></td>
</tr>
</table>

[Notification guide](docs/notifications.md)

---

## 🧩 Goldberg, GBE Fork and Uplay R2

Normal achievement reading is read-only. Extra actions appear under **Emulator & tools** when a local setup needs help:

- **Diagnose** the AppID, schema, save state, icons and configuration.
- **Repair `steam_settings`** while preserving richer existing data.
- **Apply GBE Fork** with the matching 32-bit or 64-bit runtime.
- **Back up and restore** DLLs and configuration files.
- **Use Steamless** after confirmation when SteamStub prevents a DLL replacement from loading.

Full background setup is **off by default**. Repairs create backups, but they still modify game files; use them only with games you own.

Ubisoft titles use a separate **Uplay R2** path because they do not load `steam_api.dll`. Achievement Watcher can derive a safe mapping for compatible games and reuse the normal `GSE Saves` pipeline. The loader must be provided locally because no stable official download exists.

Those games show the same Steam community percentage column as native Steam games: Uplay R2 uses its mapped Steam AppID directly, official Ubisoft Connect titles are bridged from Steam's global percentages onto their native ids, and the result is cached like any other rarity.

[Goldberg/GBE setup](docs/emulator-setup.md) · [Uplay R2 setup](docs/uplay-r2.md) · [Technical reference](docs/goldberg-gbe.md)

---

## 📚 Documentation

- [Getting started](docs/getting-started.md)
- [Notifications](docs/notifications.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Build guide](BUILD.md)
- [Architecture](docs/architecture.md)
- [Release workflow](docs/RELEASE_WORKFLOW.md)

The [documentation index](docs/README.md) explains what each guide covers.

## 🔧 Build from source

Requirements: Windows and Node.js `22.22.2+` or `24.15+`.

```powershell
Push-Location watchdog
npm ci
npm test
Pop-Location

Push-Location app
npm ci
npm test
npm run build
Pop-Location
```

The installer and updater files are written to `app\dist`. See [BUILD.md](BUILD.md) for packaging details and known constraints.

## 🔐 Security and support

- Download builds only from the [official Releases page](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases).
- Releases are currently unsigned, so SmartScreen or antivirus warnings are possible.
- `latest.yml` contains the installer's SHA-512 digest.
- Sensitive settings and Epic account tokens are encrypted before local storage.
- The project contains no game files and does not bypass online ownership checks.

For a bug report, include the app version, Windows version, affected source and relevant files from `%APPDATA%\Achievement Watcher 3.0\logs`. The issue tracker cannot provide games, credentials or piracy support.

## ⚖️ Credits and license

Created by [Xan105](https://github.com/xan105/Achievement-Watcher), continued by [darktakayanagi](https://github.com/darktakayanagi/Achievement-Watcher), and maintained here by Shirowwww and project contributors.

Licensed under [LGPL-3.0](LICENSE). This project is not affiliated with Valve, Sony, Microsoft, GOG, Epic Games, Electronic Arts or Ubisoft.
