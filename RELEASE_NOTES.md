# AW Next v3.8.6

A feature and reliability release: keyless Steam schemas, a clearer Help and cache-management
experience, safer updates, fixes for custom notification placement and scaled displays, plus
hardened HTML fallback sanitization.

## Highlights

- **Keyless Steam schemas.** Achievement metadata now uses the official public endpoint first, then
  SteamHunters, SteamCommunity and the existing browser fallback. No Steam Web API key is required.
- **Clear caches.** Settings → Advanced can remove disposable updater, schema, icon, cover and
  emulator-tool caches while preserving settings, saves, backups, themes and manually seeded files.
- **Better Help and localization.** Help reflects the actual hotkey, controller layout, notification
  mode, theme and enabled sources, with searchable localized guides.
- **Safer updates.** Differential downloads are disabled; a checksum mismatch clears the poisoned
  updater cache and retries a complete download once. If that also fails, the app explains the cache
  location and offers the official release page.
- **Custom notification placement fixed.** Saved positions now stay on their original display and
  use full display bounds, so a scaled popup can sit flush over the taskbar again (issue #25).
- **HTML fallback hardened.** Malformed nested markup is stripped with a stateful scanner, and
  Markdown anchor parsing has matching regression coverage.
- **Reliability and privacy.** The release includes the related cache-recovery fix (issue #24),
  safer process launches, redacted diagnostics, localized dialogs and more resilient schema and
  library fallbacks.

## Install

Download `Achievement.Watcher.Setup.3.8.6.exe` from the
[v3.8.6 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.6).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#386---2026-08-13) for the full list of changes.
