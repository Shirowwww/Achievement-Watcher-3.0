# Goldberg and GBE Fork technical reference

This document describes how Achievement Watcher discovers, reads and repairs Goldberg/GBE-compatible achievement data. For normal setup steps, use the [user guide](emulator-setup.md).

## Data model

The schema and runtime state use two separate files with the same name:

| | Local schema | Runtime save |
|---|---|---|
| Path | `<game>\steam_settings\achievements.json` | `%APPDATA%\GSE Saves\<appid>\achievements.json` or `%APPDATA%\Goldberg SteamEmu Saves\<appid>\achievements.json` |
| JSON shape | Array of achievement definitions | Object keyed by achievement API name |
| Purpose | Names, descriptions, hidden state and icon paths | Earned state and unlock time |
| Main reader | `app/parser/goldberg.js` | `app/parser/steam.js` and `app/parser/achievements.js` |

The schema follows the GBE example shape:

```json
[
  {
    "name": "ACH_WIN_ONE_GAME",
    "displayName": "First Win",
    "description": "Win a game.",
    "hidden": "0",
    "icon": "images/abc123.jpg",
    "icongray": "images/abc123_gray.jpg"
  }
]
```

`hidden` is written as the string `"0"` or `"1"`. Icon paths are relative to `steam_settings`.

Runtime formats vary. The normal GBE shape is an object such as:

```json
{
  "ACH_WIN_ONE_GAME": {
    "earned": true,
    "earned_time": 1710000000
  }
}
```

The shared parser also accepts compatible field names used by other local save formats.

## Runtime save roots

The default roots are evaluated under `%APPDATA%`:

- `GSE Saves\<appid>` for GBE Fork;
- `Goldberg SteamEmu Saves\<appid>` for classic Goldberg.

A missing runtime file is not an error. It means no unlock state has been written yet. Custom save-path settings must either resolve into a watched root or be added as a user folder.

## Detecting the emulator

`app/parser/goldberg.js` uses local files rather than a product-name guess:

- `configs.*.ini` under `steam_settings` identifies the GBE-style configuration;
- a populated `steam_settings` without those INI files is treated as classic Goldberg-compatible;
- a replaced Steam API DLL can identify an unconfigured install even before `steam_settings` exists;
- a real `steam_appid.txt` is preferred to a name-based AppID guess.

Install discovery walks configured game libraries with a bounded depth. It can surface an installed game before its first runtime save, attach the install path to a game already found from saves, and mark incomplete installs for later repair.

Name-based AppID matching removes common version and repack suffixes, then ranks exact, token and fuzzy candidates. Only confident matches are written automatically; ambiguous candidates require a user choice.

## Diagnosis

`diagnose` reports independent schema and runtime state. It checks:

- emulator type and `steam_settings` location;
- on-disk AppID versus the resolved game;
- schema validity and missing achievement API names;
- blank descriptions and missing icons;
- GBE configuration and custom save paths;
- whether a runtime save exists and how many achievements are earned.

This distinction prevents an empty save from being misreported as a broken schema.

## Repair behavior

`repair` builds a normalized schema from the best available achievement metadata and updates the GBE configuration with section-aware INI edits. Unknown sections, comments and existing keys are preserved where possible.

A repair may:

- write or refresh `achievements.json`;
- download normal and locked icons into `steam_settings\images`;
- create `steam_appid.txt` when it is missing;
- set DLC behavior in `configs.app.ini`;
- set required main options in `configs.main.ini`;
- set account name, language and a valid save path in `configs.user.ini`.

An existing rich schema is preserved when it contains more useful progress metadata than the replacement. Existing Steam IDs and curated DLC entries are also preserved.

Before replacing files, the repair creates a timestamped snapshot in `steam_settings\.aw-backups`. The separate backup action can capture both DLL and configuration files with a restore manifest.

## DLC configuration

GBE supports a general unlock flag and explicit DLC enumeration:

```ini
[app::dlcs]
unlock_all=1
1234=DLC display name
```

Achievement Watcher writes both when data is available. Explicit IDs let games enumerate DLC, while `unlock_all=1` covers ownership checks that query a specific ID. Existing entries are merged rather than discarded.

## User configuration

The relevant GBE section is:

```ini
[user::general]
account_name=Player
language=english
account_steamid=7656119...
```

The account name and language follow Achievement Watcher settings. An existing `account_steamid` is preserved because changing it can redirect the emulator to a different save identity. Placeholder local-save paths are removed or corrected so the Watchdog can observe the resulting files.

## Runtime installation

`app/parser/gbeInstaller.js` downloads a Windows release from `Detanup01/gbe_fork` into the local cache and keeps the matching 32-bit/64-bit DLLs with their `generate_interfaces` tools. The cache is reused, and the release endpoint is not queried on every scan.

`installDlls` selects the architecture already present in each game directory, keeps the original DLL as a one-time `.bak`, and installs only a matched runtime set. Achievement Watcher uses a standalone Steam API DLL replacement; the old ColdClient path is not part of the current setup.

Advanced schema generation is separate. `app/parser/genEmuConfig.js` uses the maintained `gse_fork_tools` generator, then merges its output into the game's `steam_settings` rather than replacing the entire directory blindly.

## Optional executable tools

- `app/parser/steamless.js` can unpack SteamStub after explicit confirmation and preserves the original executable as `*.steamstub.bak`.
- `app/parser/apiCheckBypass.js` is an opt-in compatibility path for games that re-check the original Steam API after a replacement. It is disabled by default.

Neither path bypasses online ownership or server-side checks.

## Automatic behavior

Normal scanning can discover installs and fill a missing schema without replacing runtime DLLs. The full background emulator setup is controlled by `emulator.autoApplyNewGames` and is disabled by default.

Background attempts are keyed by game and content version so an unchanged broken install is not rewritten on every scan. A manual diagnosis or repair remains available when a retry is needed.

## Implementation invariants

- Never treat the schema file as proof of an unlock.
- Never write an uncertain AppID automatically.
- Back up before replacing a DLL, executable or populated configuration.
- Preserve unknown INI content and stable account identity.
- Keep install discovery bounded and skip dependency, redist and tool directories.
- Keep manual and background setup paths on the same repair functions.
- Prefer a safe partial result over hiding a game after a transient metadata failure.

[Back to the documentation index](README.md)
