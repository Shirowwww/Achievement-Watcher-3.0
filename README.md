<div align="center">

# 🏆 Achievement Watcher 3.0

### All your PC achievements in one modern Windows library.

Track achievements, rarity and playtime across launchers, local saves and supported emulators — with live Windows toasts or an in-game overlay.

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

| Area | Main improvements since Achievement Watcher 2.x |
|---|---|
| **Modern foundation** | Electron 12 → 43, current Node runtime, refreshed dependencies, tighter renderer security and Windows 11 support without WMIC |
| **More real sources** | Local Steam appcache, GOG Galaxy and Ubisoft Connect readers; Epic account connection; EA Desktop; RPCS3, ShadPS4 and Xenia |
| **Live tracking** | Tray-first background Watchdog, Xenia/ShadPS4/GOG/Ubisoft unlock monitoring, safer startup baselines and duplicate suppression |
| **Better library** | Game and achievement search, installed-only filtering, blacklist restore, rarity tiers, progress achievements, smarter covers and executable detection |
| **Notifications** | Native Windows toasts + in-game overlay, preset library, custom builder, custom sounds, 0–200% volume and separate rare/completion styles |
| **Controller and UI** | Full controller navigation, mouse Back/Forward, optional native overlay control, resizable interface, four themes and 18 complete UI languages |
| **Goldberg / GBE tools** | Read-only diagnosis, `steam_settings` repair, matched runtime install, Steamless support, backups/restore and opt-in background setup |
| **Local-first reliability** | Offline names and artwork, local schemas, platform-aware cache IDs, bounded caches, self-healing folders and fewer browser-dependent lookups |

The current `main` branch also adds dedicated detection and repair for compatible **Goldberg Uplay R2** installs. It is newer than the packaged 3.1.0 release; see [`Unreleased`](CHANGELOG.md#unreleased) for what will ship next.

---

## ⚖️ Quick comparison

| Feature | ⭐ **This fork** | [Achievements](https://github.com/PSerban93/Achievements) | [Achievement Watcher 2.x](https://github.com/darktakayanagi/Achievement-Watcher) |
|---|:---:|:---:|:---:|
| Modern desktop runtime | ✅ Electron 43 | ✅ Electron 40 | ❌ Electron 12 |
| Unified game dashboard | ✅ | ✅ | ✅ |
| Game + achievement search | ✅ Both | ⚠️ Game search | ✅ Both |
| Installed-games-only filter | ✅ | ⚠️ Install-aware configs | ❌ |
| Automatic folder discovery/config | ✅ | ✅ | ⚠️ More manual |
| Official/local platform readers | ✅ Steam · GOG · Ubisoft · Epic · EA | ✅ Steam · GOG · Ubisoft · Epic · EA | ⚠️ Older mapped paths |
| Native Windows toasts | ✅ | ❌ | ✅ |
| Animated in-game overlay | ✅ | ✅ | ✅ Chromium |
| Toast + overlay together | ✅ | ❌ | ⚠️ Separate legacy transports |
| No-code custom preset builder | ✅ | ❌ | ❌ |
| Separate rare/completion presets | ✅ | ✅ | ❌ Not documented |
| Live ShadPS4 / Xenia unlocks | ✅ | ✅ | ❌ Planned only |
| Steam-emulator tracking | ✅ | ✅ | ✅ |
| GBE runtime install + schema repair | ✅ Full | ⚠️ Auto-config/schema | ❌ Manual setup |
| Backup and one-click restore | ✅ | ❌ | ❌ |
| Integrated Steamless path | ✅ | ❌ | ❌ |
| Full controller UI navigation | ✅ | ⚠️ Overlay control only | ❌ Planned only |
| Screenshot souvenirs | ✅ | ✅ | ✅ |
| Multiple UI themes | ✅ 4 | ✅ | ❌ |
| Interface languages | ✅ 18 complete | ✅ Multi-language | ✅ Multi-language |

This fork focuses on an all-in-one library, a quiet tray workflow, native toasts and deeper Goldberg/GBE repair. **Achievements** has a strong auto-configuration and animated-overlay workflow. **Achievement Watcher 2.x** remains the historical base with broad emulator compatibility and several legacy notification transports.

<sub>✅ = supported and documented · ⚠️ = partial, manual or a different workflow · ❌ = unavailable or not documented on the current public branch. Checked against the public READMEs and default branches on 14 July 2026.</sub>

---

## 🎯 Supported sources

| Source | Support |
|---|---|
| **Steam** | Local appcache state, public-profile data, schemas and cached product metadata |
| **Steam-compatible saves** | Goldberg, GBE Fork, GreenLuma, SmartSteamEmu, TENOKE and compatible layouts |
| **GOG Galaxy** | Native local Galaxy databases and compatible legacy saves |
| **Epic Games** | Local installations and official achievement state after optional account connection |
| **Ubisoft Connect** | Native local data, legacy Uplay formats and compatible Uplay R2 setups |
| **EA Desktop** | Achievement data recorded by the EA client log |
| **Console emulators** | RPCS3, ShadPS4 and Xenia |

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

Updating over an older build keeps settings, cache, playtime and achievement data under `%APPDATA%\Achievement Watcher`. See [Getting started](docs/getting-started.md) for the full first-run and update guide.

---

## 🔔 Notifications

Choose **Toast**, **Overlay** or **Both** under **Settings → Notification**.

- Presets for clean desktop, Steam, PlayStation, Xbox, rare and completion styles.
- A no-code preset builder with live preview.
- Custom `.wav`, `.mp3` and `.ogg` sounds.
- Position, scale, duration and overlay volume up to 200%.
- Separate presets for normal, rare and 100% completion events.
- Per-game progress mute without hiding real unlocks.
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

For a bug report, include the app version, Windows version, affected source and relevant files from `%APPDATA%\Achievement Watcher\logs`. The issue tracker cannot provide games, credentials or piracy support.

## ⚖️ Credits and license

Created by [Xan105](https://github.com/xan105/Achievement-Watcher), continued by [darktakayanagi](https://github.com/darktakayanagi/Achievement-Watcher), and maintained here by Shirowwww and project contributors.

Licensed under [LGPL-3.0](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md) for adapted components and attribution. This project is not affiliated with Valve, Sony, Microsoft, GOG, Epic Games, Electronic Arts or Ubisoft.
