# 3.0.2

Small stability release focused on game detection, duplicate entries, playtime tracking and first-run language setup.

## Changes

- Better executable detection when the main `.exe` is in the game folder and Steam API files are nested deeper.
- Stronger merge between installed games, save metadata, covers and cached metadata to avoid duplicate tiles.
- Removed/ignored games stop playtime tracking immediately.
- Wallpaper Engine and its helper processes are excluded from game tracking.
- First-run language choice is required before the initial library scan.
- All supported UI languages now include the onboarding text.

## Download

Download `Achievement.Watcher.Setup.3.0.2.exe` from this release.
