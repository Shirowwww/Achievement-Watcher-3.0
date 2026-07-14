# Goldberg Uplay R2 setup

Ubisoft games do not use Steam's `steam_api.dll`, so the normal GBE Fork repair is not appropriate. For compatible Ubisoft titles that use Goldberg Uplay R2, Achievement Watcher offers a separate **Apply emulator fix (Uplay R2)** action.

Official Ubisoft Connect achievement data may already be detected from the local client. This guide is only for games that actually use a Goldberg Uplay R2 loader.

The setup modifies game files. Use it only with games you own and keep any additional backup you consider important.

## Requirements

All of the following must be true:

1. Achievement Watcher can identify the Ubisoft game or match it from its install-state metadata.
2. `app/assets/uplay-steam.json` contains a matching Steam release.
3. The Steam release exposes achievement API names that can be mapped safely to Ubisoft objective IDs.
4. A compatible Uplay R2 loader has been placed in the local Achievement Watcher cache.

If a requirement is missing, diagnosis reports the limitation instead of writing a guessed mapping.

## Add the loader once

Achievement Watcher does not download a Uplay R2 loader because there is no stable official release source for the compatible build. Place your own loader file in:

```text
%APPDATA%\Achievement Watcher\cache\uplayR2
```

Supported file names are:

- `uplay_r2_loader.dll`
- `uplay_r2_loader64.dll`
- `upc_r2_loader.dll`
- `upc_r2_loader64.dll`

The installer chooses the matching architecture when the game is repaired.

## Apply the setup

1. Add the Ubisoft game library under **Settings → Folders** and run **Generate configs**.
2. Right-click the detected game.
3. Open **Emulator & tools → Diagnose Uplay R2 setup**.
4. Confirm the resolved Ubisoft ID, Steam AppID, install directory and loader status.
5. Choose **Apply emulator fix (Uplay R2)** and review the confirmation.
6. Launch the game once, then refresh Achievement Watcher.

## What the action changes

The setup:

- resolves the matching Steam achievement schema;
- installs the selected Uplay R2 loader and keeps an existing file as `*.bak`;
- writes `achievements_schema.json` next to the loader;
- updates `uplay_r2.ini` or `upc_r2.ini` with achievement support, the derived key prefix and save format;
- directs `AchSavePath` to `%APPDATA%\GSE Saves\<steamAppid>`;
- creates the runtime save folder so the game can appear at 0% before the first unlock.

The shared `GSE Saves` path lets the normal Achievement Watcher scan, artwork and notification pipeline handle the result like a compatible Steam-emulator save.

## Compatibility limits

The mapping works only when the Steam achievement API names contain a stable numeric objective ID, typically a prefix followed by digits. Some Ubisoft games use a different naming scheme, and some never received a Steam release. Those games are reported as unsupported because a guessed mapping could associate the wrong achievements.

## Achievements remain at 0%

An empty or missing runtime save is expected until the game records an unlock. If an earned achievement still does not appear:

1. Run **Diagnose Uplay R2 setup** again.
2. Confirm the INI file points to the displayed `GSE Saves` folder.
3. Confirm the installed loader architecture matches the game.
4. Check that `achievements_schema.json` exists and contains the derived IDs.
5. Review `%APPDATA%\Achievement Watcher\logs\parser.log`.

For general schema/save distinctions, see the [Goldberg and GBE Fork guide](emulator-setup.md#schema-and-save-files-are-different).

[Back to the documentation index](README.md)
