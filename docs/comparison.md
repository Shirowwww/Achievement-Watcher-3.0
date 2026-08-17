# How AW Next compares

AW Next continues [Xan105's original Achievement Watcher](https://github.com/xan105/Achievement-Watcher)
and [darktakayanagi's 2.x branch](https://github.com/darktakayanagi/Achievement-Watcher). This page
places it beside that lineage and beside
[Achievements](https://github.com/PSerban93/Achievements), the other actively developed tracker, so
you can tell which one fits how you play.

| Feature | ⭐ **AW Next** | [Achievements](https://github.com/PSerban93/Achievements) | [Achievement Watcher 2.x](https://github.com/darktakayanagi/Achievement-Watcher) |
|---|:---:|:---:|:---:|
| Modern desktop runtime | ✅ Electron 43 | ✅ Electron 43 | ❌ Electron 12 |
| Unified dashboard, game and achievement search | ✅ Both | ✅ Both | ✅ Both |
| Installed-games-only filter and game actions | ✅ Filter · uninstall · restore | ❌ | ❌ |
| Automatic folder discovery/configuration | ✅ Auto-config & Smart Find | ✅ Auto-config | ✅ Smart Find |
| Official and local platform readers | ✅ Steam · GOG · Ubisoft · Epic · Xbox PC | ✅ Steam · GOG · Ubisoft · Epic · EA | ⚠️ Steam · GOG · Epic · Uplay (legacy) |
| Steam-emulator tracking | ✅ | ✅ | ✅ |
| Goldberg SocialClub (Rockstar/GTA) source | ✅ | ❌ | ❌ |
| Goldberg Uplay R2 support | ✅ Loader-version aware | ❌ | ❌ |
| GBE runtime install and schema repair | ✅ Full | ⚠️ Schema | ❌ Manual setup |
| Safe repair workflow | ✅ Backup/restore · Steamless · opt-in API-check bypass | ❌ | ❌ |
| Per-game health report with guided repairs | ✅ | ❌ | ❌ |
| Reset and restore a game's achievements | ✅ | ❌ | ❌ |
| Native Windows notifications and in-game overlay | ✅ Both | ✅ Both | ⚠️ Chromium / toast transports |
| Automatic transport selection | ✅ | ❌ | ❌ |
| No-code notification preset designer | ✅ | ❌ | ❌ |
| Shareable preset packages | ✅ `.awpreset` | ❌ | ❌ |
| Separate rare and completion styles | ✅ | ✅ | ❌ Not documented |
| Live RPCS3 / ShadPS4 / Xenia unlocks | ✅ | ✅ | ⚠️ RPCS3 only |
| Full controller navigation | ✅ App + overlay | ✅ App + overlay | ❌ Planned only |
| Screenshot souvenirs | ✅ | ✅ | ✅ |
| Multiple UI themes | ✅ Built-in + Custom | ✅ 8 | ❌ |
| Interface languages | ✅ 18 bundled | ✅ 30 locales | ✅ 18 locales |
| Xbox PC (Game Pass / Store) | ✅ Account import | ✅ Account import | ❌ |
| Manual achievement unlock | ✅ | ✅ | ❌ |
| Process trail for already-running games | ✅ | ✅ | ❌ |
| Random sound and FLAC/M4A/AAC support | ✅ | ✅ | ⚠️ Custom FLAC/M4A/AAC |
| Per-emulator notification presets | ✅ Xenia · RPCS3 · ShadPS4 | ✅ | ❌ |
| Emulator rarity and live Xbox unlocks | ✅ | ✅ | ❌ |

<sub>✅ = supported and documented · ⚠️ = partial, manual or a different workflow · ❌ = unavailable or
not documented on the current public branch. Compared against the public READMEs, package manifests
and source on 13 August 2026.</sub>

## In short

**AW Next** focuses on an all-in-one library, a quiet tray workflow, notifications that pick their
own transport, and deeper Goldberg / GBE repair with a per-game health report behind it.

**Achievements** has a strong auto-configuration and animated-overlay workflow.

**Achievement Watcher 2.x** remains the historical base, with broad emulator compatibility and
several legacy notification transports.

---

<div align="center">

[← Documentation](README.md) · [Project home](https://github.com/Shirowwww/Achievement-Watcher-3.0)

</div>