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
- updates `upc_r2.ini` and `uplay_r2.ini` with achievement support and the save format;
- on loader builds that support it, sets the derived key prefix and directs `AchSavePath` to `%APPDATA%\GSE Saves\<steamAppid>`;
- creates the runtime save folder so the game can appear at 0% before the first unlock.

The loader reads `upc_r2.ini` first and falls back to `uplay_r2.ini`; both are written so the one actually in use is always correct.

## Steam percentages in the detail view

Because a mapped Uplay R2 game keeps the Steam AppID and its achievements are keyed by the Steam API
names, the detail view shows the same community percentage column as a native Steam game (Steam icon,
global unlock % per achievement, offline via the shared rarity cache). Official Ubisoft Connect games
get the same column through the Steam↔numeric-id bridge: the Steam global percentages are translated
onto the Ubisoft achievement ids and cached under the game's namespaced appid. Games whose Steam
counterpart cannot be resolved simply keep the column hidden.

## Loader builds

The achievement redirect (`AchSaveType` / `AchSavePath` / `AchKeyPrefix`) was added to the loader partway through its life. Builds released before that ignore those keys entirely: they look an unlock up by the bare objective ID and always write to their own save folder. Achievement Watcher probes the installed loader for those key names and adapts:

| Loader | INI written | `achievements_schema.json` keys | Unlocks read from |
| --- | --- | --- | --- |
| With redirect support | `Achievements`, `AchKeyPrefix`, `AchSaveType`, `AchSavePath` | Steam API names (`<prefix><id>`) | `%APPDATA%\GSE Saves\<steamAppid>` |
| Without redirect support | `Achievements` only | bare objective IDs (`<id>`) | the emulator's own save folder |

In both cases the unlock file is read from every plausible location — the configured `AchSavePath`, `%APPDATA%\Goldberg UplayEmu Saves\<uplayId>`, the game's `saves\<uplayId>` folder and any custom `SavePath` — and the objective IDs are translated back to the game's Steam achievement names. Updating the loader to a build with redirect support is worthwhile but not required.

## Compatibility limits

The mapping works only when the Steam achievement API names contain a stable numeric objective ID, typically a prefix followed by digits. Some Ubisoft games use a different naming scheme, and some never received a Steam release. Those games are reported as unsupported because a guessed mapping could associate the wrong achievements.

## Achievements remain at 0%

An empty or missing runtime save is expected until the game records an unlock. If an earned achievement still does not appear:

1. Run **Diagnose Uplay R2 setup** again. It names the INI the loader actually reads, whether that loader supports the redirect, and every folder that was searched for a save.
2. Check for `NO_SCHEMA_JSON` or `ACHIEVEMENTS_DISABLED`. **A Ubisoft game update commonly causes both**: re-extracting the repack deletes `achievements_schema.json` and restores an INI with `Achievements = 0`. Achievement Watcher re-applies the setup automatically on the next scan when *Automatically fix newly detected games* is enabled; otherwise run **Apply emulator fix (Uplay R2)** again.
3. Confirm the installed loader architecture matches the game.
4. Set `Logging = 1` in the INI the diagnosis reported and check `upc_r2.log` next to the game executable — `Achievements disabled or achievements.json file not found!` confirms the emulator never armed achievements.
5. Review `%APPDATA%\Achievement Watcher\logs\parser.log`.

For general schema/save distinctions, see the [Goldberg and GBE Fork guide](emulator-setup.md#schema-and-save-files-are-different).

[Back to the documentation index](README.md)
