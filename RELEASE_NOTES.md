# Achievement Watcher 3.8.3

A hotfix release: the automatic emulator fix no longer breaks games already made to work by their
own crack loader, the Steam API Check Bypass feature actually works now, and the CodeQL sanitization
hardening previously (and incorrectly) credited to 3.8.2 is included here for real.

## Highlights

- **Automatic emulator fix no longer breaks already-working crack loaders.** A game made to run by a
  loader that hooks its existing `steam_api(64).dll` in place instead of replacing it (OnlineFix
  confirmed) is now left alone: the automatic fix used to swap that DLL for a GBE Fork build and
  break the loader's own Steamworks/EOS emulation, causing an activation prompt or an
  `EOS_Connect_CreateDeviceId` failure on the next launch. The manual "Apply emulator fix" menu
  action can still override this for an edge case.
- **Steam API Check Bypass actually works now.** Its proxy-DLL download always failed silently
  because the RAR extraction ran in the renderer process, which blocks it by policy; it now runs in
  the main process.
- **Hardened sanitization.** A stable tag-stripping pass now loops until the string stops changing,
  theme/preset CSS `url()` values are built through the shared backslash-safe helper everywhere, the
  Exophase image-proxy host check requires an exact or subdomain match, and line-separator
  characters are stripped before the Epic login redirect URL is spliced into injected page script.

## Install

Download `Achievement.Watcher.Setup.3.8.3.exe` from the
[v3.8.3 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.8.3).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#383---2026-08-11) for the full list of changes.
