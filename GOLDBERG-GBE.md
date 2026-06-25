# Goldberg & GBE Fork — how Achievement Watcher reads them

Reference for the Steam-emulator achievement path. Written against the real on-disk behaviour of
classic **Goldberg** (`mr_goldberg`) and **GSE Fork** (`alex47exe/gse_fork`), verified on a live
install (June 2026).

## The single most important distinction: two different `achievements.json`

There are **two** files with this name and they are unrelated. Almost every "achievements don't
show" / "everything is locked" / "no descriptions" report comes from confusing them.

| | **Schema** `achievements.json` | **Save** `achievements.json` |
|---|---|---|
| Lives in | the game install dir, under `steam_settings/` | the runtime save dir (see below), under `<appid>/` |
| Written by | the cracker / repacker when setting the game up | the emulator at runtime, as you unlock things |
| Shape | a **JSON array** of `{ name, displayName, description, hidden, icon, icongray }` | a **JSON object** keyed by apiname → `{ "earned": true, "earned_time": <unix> }` |
| Purpose | *defines* which achievements exist + their text/icons | *records* which ones you have unlocked |
| If missing | GBE has nothing to pop; AW falls back to the online Steam schema | the game is simply 0% — **everything shows locked, and that is correct** |

Achievement Watcher reads the **save** file for unlock state and gets descriptions/icons from the
**online Steam schema** (`GetSchemaForGame` with an API key, or a fallback scrape). The local
**schema** file is the offline source of truth GBE itself uses, and the target of the in-app repair.

## Runtime save locations (`%APPDATA%`)

- **GBE Fork:** `%APPDATA%\GSE Saves\<appid>\achievements.json` (+ `playtime.txt`, `remote\…`).
  Global config in `%APPDATA%\GSE Saves\settings\configs.*.ini`. Override the folder name with
  `saves_folder_name` in `configs.user.ini`.
- **Classic Goldberg:** `%APPDATA%\Goldberg SteamEmu Saves\<appid>\achievements.json`.
- **EMPRESS** (Goldberg-based): saves under `…\remote\<appid>\`.

AW scans both roots; see `app/parser/steam.js` `scan()`. The save's `earned` / `earned_time` keys are
handled in `app/parser/achievements.js` (alongside `Achieved`, `State`, `unlocked`, `HaveAchieved`…).

## GBE Fork vs classic Goldberg — telling them apart

| Signal | GBE Fork | Classic Goldberg |
|---|---|---|
| Config style | `configs.main.ini` / `configs.user.ini` / `configs.app.ini` / `configs.overlay.ini` | loose `.txt` files (`force_account_name.txt`, `user_steam_id.txt`, …) and a `settings/` folder |
| Save root | `GSE Saves` | `Goldberg SteamEmu Saves` |
| DLL | `steam_api.dll` / `steam_api64.dll` (replaced) | same |

`goldberg.detectEmulator(gameDir)` encodes this: any `configs.*.ini` in `steam_settings` ⇒ `gbe`,
otherwise a populated `steam_settings` or a replaced dll ⇒ `goldberg`, else `none`.

## Conditions for AW to recognise a game and show unlocked achievements

1. The emulator has run at least once, so a save folder exists under one of the roots above
   (this is how AW discovers the appid — there is **no** install-dir scan in the normal path).
2. The save's apinames match the schema names AW gets from Steam (matched case-insensitively).
3. For pop-ups/icons *in game*, `steam_settings/achievements.json` must list every achievement with
   valid `icon`/`icongray` paths relative to `steam_settings`.

If 1 holds but the save is empty/absent, AW correctly shows the game at 0% (all locked). That is the
expected state for a game you have launched but not earned anything in — **not** a bug.

## "Achievements stay locked even though the GBE Fork files are there"

In order of likelihood:

1. **Nothing unlocked yet** → no save file / empty save → all locked. Correct. (`NO_SAVE_YET`.)
2. **Schema mismatch** → the `steam_settings/achievements.json` was hand-fabricated and its names
   don't match Steam's real apinames, so the save's earned keys never line up. (`MISSING_ACHIEVEMENTS`.)
3. **Wrong save folder** → `saves_folder_name` was customised, so the save isn't under the scanned
   root. Point a custom user dir at it, or reset the override.
4. **appid mismatch** → `steam_appid.txt` ≠ the real appid, so the emulator writes under the wrong
   `<appid>` folder. (`APPID_MISMATCH`.)

## What Achievement Watcher does to help (`app/parser/goldberg.js`)

- **`detectEmulator(gameDir)`** — GBE Fork vs classic Goldberg vs none.
- **`diagnose({ gameDir, appid, schema })`** — full report: emulator type, steam_settings location,
  schema vs save counts, missing achievements/icons, blank descriptions, and the runtime unlock
  state (`SAVE_PRESENT` / `NO_SAVE_YET`). Surfaced via the game's context-menu → *Diagnose
  Goldberg/GBE setup*.
- **`repair({ steamSettings, appid, schema, downloadIcon, fetchDlc, accountName, language })`** —
  auto-config: writes a correct, schema-matching `achievements.json`, downloads `icon`/`icongray` into
  `images/`, creates `steam_appid.txt` if missing (never overwrites an existing one), enables all DLCs
  (`configs.app.ini`) and stamps the user identity (`configs.user.ini`) — see below. The pre-change
  files are snapshotted into `steam_settings/.aw-backups/<timestamp>`. Wired to the *Repair
  steam_settings* button in the diagnosis dialog and to the per-scan auto-repair.
- **`writeDlcConfig` / `writeUserConfig`** — the non-destructive INI writers `repair` uses (also
  exported). A minimal section-scoped editor preserves unknown sections, comments and key order.
- **`findCompatibleGames(roots)`** — walks a library folder and lists every Goldberg/GBE install,
  flagging those that are compatible but unconfigured (`hasSchema: false`).
- **`readLocalSchema(steamSettings)`** — reads the install's `steam_settings/achievements.json`
  schema array. A fully offline source of achievement names/descriptions: used to fill "…" blanks
  when there's no Steam Web API key and no internet (see *Automatic install detection* below).

### Automatic install detection (built on `findCompatibleGames`)

`app/parser/achievements.js`'s `discover()` runs this on every scan over a few library roots — the
folders configured in the **Folder** tab plus the defaults `C:\Jeux` and the Desktop. It serves two
purposes:

1. **Surface never-launched games.** A game installed there but not yet run has no `%APPDATA%` save
   folder, so the regular scan can't see it. Auto-detection adds it (identified by `steam_appid.txt`)
   as a 0% / all-locked game; once you play it the emulator writes the save and the normal scan takes
   over (entries are de-duplicated by appid, so there's no double listing).
2. **Repair broken install schemas in place.** Any install whose `steam_settings/achievements.json`
   is missing or empty is repaired once the schema has been fetched — `repair()` writes the correct
   file (and `steam_appid.txt` if missing). This runs without downloading icons to stay fast; use the
   Debug-tab scan or the *Diagnose → Repair* dialog for a full repair that also fetches the images.
   It is idempotent: a repaired install reports `hasSchema: true` next scan and is left alone.

The scan attaches the install `steam_settings` path to every matched game (not just broken ones).
That powers an **offline description backfill**: when a game's achievements still show "…" (no API key,
no internet) and its install is known, `readLocalSchema` reads the local `achievements.json` and fills
the blank descriptions/displayNames from it — case-insensitively by `name`, never overwriting a value
that was actually fetched, hidden achievements left blank by design.

## DLC unlocking (`configs.app.ini`)

GBE Fork has two complementary DLC mechanisms and `repair` writes **both**:

```ini
[app::dlcs]
unlock_all=1
1234=DLC display name
56789=Another DLC
```

- `unlock_all=1` makes `BIsDlcInstalled` / `BIsSubscribedApp` return true for any id (covers games
  that just ask "do I own DLC X?").
- The `id=name` list is what the *enumeration* APIs (`GetDLCCount` / `BGetDLCDataByIndex`) return —
  games that list their DLCs only see the ones spelled out here, so `unlock_all` alone isn't enough.

The id list comes from `steam.getDLCList(appid)` (public storefront `appdetails`: the base app's
`data.dlc` ids, then a `filters=basic` batch to resolve names), disk-cached for 14 days under
`steam_cache/dlc/` so the per-scan auto-repair never re-hits the store. A failed/offline fetch still
writes `unlock_all=1`. Existing `id=name` entries are preserved (unioned), so a curated list is never
lost. (Note: as of late 2025 GBE Fork unlocks all DLCs by default regardless — see issue #400 — but
writing the explicit list keeps enumeration correct across builds.)

## User identity & language (`configs.user.ini`)

```ini
[user::general]
account_name=<the app's username>
language=<the app's achievement language, e.g. french>
account_steamid=<preserved if already present>
```

`account_name` ← `options.general.username`, `language` ← `options.achievement.lang` (already a Steam
API language code such as `english` / `french`, exactly what GBE expects). `account_steamid` and any
other keys are **preserved** — changing the steamid would point the emulator at a different
`GSE Saves/<steamid>` folder and orphan existing unlock saves. If a `supported_languages.txt` exists
and lacks the chosen language it's appended (GBE ignores a language absent from that file); the file
is never *created*, so a game's real language list is never narrowed.

## Installing the emulator DLL (`app/parser/gbeInstaller.js`)

`ensureEmulatorDlls({ cacheDir })` downloads the upstream **`Detanup01/gbe_fork`** Windows release
once and caches the entire emulator runtime as a single **matched** build: `steam_api.dll` /
`steam_api64.dll` (from `release/regular/<arch>/`), the `generate_interfaces` executables, and the
steamclient/ColdClient build. gbe is chosen because its steam_api tracks Steamworks closely and it
ships far more often than the downstream `alex47exe/gse_fork` (whose binary releases lag months).
Taking the whole runtime from one fork — rather than mixing gbe's steam_api with gse's steamclient —
is the most compatible, least-breakage choice, since the ColdClient path needs steam_api and
steamclient to agree on interface versions. Loader/interface lookups tolerate both gbe (`x86`) and gse
(`x32`) spellings. `steam_settings/steam_interfaces.txt` is generated from the original game DLL before
replacement, as required by the release guide. GitHub is re-checked at most once a day, so after the
first download the installer is effectively offline.

The achievement-schema generator (`generate_emu_config`) is **not** here — it lives in
[genEmuConfig.js](app/parser/genEmuConfig.js) and uses `alex47exe/gse_fork_tools`, the maintained
"improved" config tool (Detanup01 froze their own `gbe_fork_tools`, shipping it as `..._old`). So: gbe
for the emulator runtime, gse for the config tooling — best of both. `installDlls({ dllDirs, dlls, writeIfMissing })` replaces whichever
arch a folder already uses (a dir with neither gets `writeIfMissing`), keeping each original as a
one-time `<name>.bak`.

Two entry points share this:

1. **Manual** — the right-click *Install GBE Fork steam_api(64).dll…* action (always available for
   cracked/emulated sources). Installs both arches, then runs the full auto-repair.
2. **Automatic** — the setting `emulator.autoApplyNewGames` (default **on**). The full setup runs on a
   freshly detected install, gated on `needsSchema` so a configured game is never re-touched.

## Resolving the AppID & removing Steam DRM (ideas from ARMGDDN Autocracker)

- **AppID fuzzy search** (`app/util/fuzzyAppid.js`): folder/exe names rarely equal the store name
  (`Cyberpunk 2077 [FitGirl Repack]`, `Elden.Ring.v1.12.CODEX`). The matcher strips that noise and
  scores candidates exact → token → fuzzy. `steam.findAppidByName` auto-commits only a confident
  (exact/strong-token) hit — a fuzzy guess is never written to `steam_appid.txt`. When the GBE-install
  action still has no AppID, it shows `findAppidCandidatesByName` results as a pick-the-game dialog.
- **Steam DRM removal** (`app/parser/steamless.js`): the right-click *Remove Steam DRM (Steamless)…*
  downloads/caches atom0s/Steamless and unpacks SteamStub from a game's exe, keeping the original as
  `<exe>.steamstub.bak`. No-op when there's no stub. Some titles need this before the replaced
  steam_api DLL can load.

## Field shape written by `buildAchievementsJson` / `repair`

Matches `alex47exe/gse_fork` `steam_settings.EXAMPLE`:

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

`hidden` is the string `"0"` / `"1"`; `icon`/`icongray` are paths relative to `steam_settings`.
