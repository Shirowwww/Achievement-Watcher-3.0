# Achievement Watcher 3.6.0

Localization and reliability release: the installer and in-game overlay are now fully localized,
the overlay got a visual refresh, and several data-safety issues around the 3.5.3 migration
(lost avatar, library that appeared to shrink) are fixed.

## Highlights

- **Installer and overlay follow your Windows language.** The NSIS installer pages match all 18
  bundled locales instead of defaulting to English, and the in-game overlay (Ctrl+Shift+O) now
  localizes its headers, labels and achievement text too.
- **In-game overlay refresh.** A stats bar (unlocked/total + completion %), instant search, status
  filters, community-rarity badges, progress bars, and density/icon-size/accent/zoom options that
  persist between sessions.
- **Uninstaller asks before deleting your data.** The installer shows the LGPL license up front;
  uninstalling now asks whether to also remove settings, cache and saved data (default: keep).
- **Avatar and library no longer disappear after an upgrade.** A locally uploaded avatar and the
  "show installed only" library filter both lived in browser storage that the one-time
  `%APPDATA%\Achievement Watcher 3.0` migration never carries over on purpose. The avatar now
  survives future upgrades, and the installed-only filter no longer silently hides most of a
  migrated library (it was defaulting to ON on a fresh profile, hiding every game without a
  confirmed install folder on disk).
- **Cleaner discovery.** Empty Goldberg SocialClub profile folders and misclassified emulator save
  roots no longer show up as fake game cards, and custom watched folders that don't match a known
  emulator layout by name get a proper source label instead of none.

## Install

Download `Achievement.Watcher.Setup.3.6.0.exe` from the
[v3.6.0 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.6.0).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#360---2026-08-05) for the full list of changes.
