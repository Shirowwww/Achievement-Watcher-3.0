# Architecture

AW Next is a Windows-only Electron application with a separate background monitor. This page describes the boundaries that matter when changing the project.

## Runtime overview

```text
Electron main process
├── creates the tray, windows and IPC handlers
├── owns updates, browser-backed lookups and native app integration
├── starts the renderer library UI
└── starts the Watchdog with ELECTRON_RUN_AS_NODE
    ├── watches processes and achievement files
    ├── tracks playtime
    └── dispatches Windows notifications and overlay events
```

Electron's bundled Node runtime runs both processes. The installed app does not ship a second Node or NW.js executable.

## Main directories

| Path | Responsibility |
|---|---|
| `app/electron/` | Main process, window lifecycle, IPC, update flow and browser-backed services |
| `app/app.js` | Renderer entry point and game-library interactions |
| `app/parser/` | Platform parsers, discovery, schema lookup and emulator tools |
| `app/ui/` | Settings, game view, sorting and renderer-side UI behavior |
| `app/locale/` | UI language files and DOM text binding |
| `app/view/` | HTML views for the application and overlay |
| `app/presets/` | Bundled notification preset assets |
| `watchdog/` | Background monitoring, notifications and playtime |
| `test/` | App, parser, discovery and locale tests |
| `watchdog/test/` | Background-monitor and notification tests |

## Data flow

1. Enabled source parsers scan launcher data, configured folders and known save locations.
2. `app/parser/achievements.js` normalizes results into the library's shared game shape.
3. Platform-aware IDs prevent unrelated stores from sharing the same cache key.
4. Metadata and artwork are resolved from local caches first where possible, then from configured online fallbacks.
5. The Watchdog establishes a baseline for each active source and watches for later changes.
6. A new unlock is normalized, de-duplicated and sent to the notification transports one planner
   selects for it (`watchdog/notification/transportPolicy.js`).

Startup must not replay existing unlocks as new events. Watchers should baseline current state before emitting notifications.

## Parser expectations

Parsers normally expose a `scan` function and an `initDebug` hook. Their results are normalized by the aggregator rather than rendered directly.

When adding a source:

- keep the source's native identity instead of forcing every item into a Steam AppID;
- distinguish installed state from leftover achievement data;
- return partial data when safe instead of blacklisting a game after one transient failure;
- cache network results with a bounded lifetime;
- make missing optional files a normal empty state;
- keep watcher and parser rules aligned so the library and live notifications observe the same files.

Current integrations include Steam, Goldberg/GBE-compatible saves, Goldberg SocialClub, GOG, Epic, Ubisoft, EA Desktop, Xbox PC, GreenLuma, RPCS3, ShadPS4 and Xenia. Some platforms have both a legacy mapped-save parser and a newer official/local parser.

## Important components

| File | Role |
|---|---|
| `app/parser/achievements.js` | Aggregation, folder discovery and background emulator setup orchestration |
| `app/parser/installState.js` | Evidence-based installed-state decisions |
| `app/parser/gameIndex.js` | Persistent game identity and install metadata |
| `app/parser/steam.js` | Steam schema, metadata and compatible-save parsing |
| `app/parser/goldberg.js` | Goldberg/GBE detection, diagnosis, repair and backup |
| `app/parser/uplayR2.js` | Ubisoft-to-Steam mapping and Uplay R2 schema setup |
| `app/electron/init.js` | Main lifecycle, updater, browser helpers and overlay window |
| `watchdog/watchdog.js` | Background entry point and service coordination |
| `watchdog/monitor.js` | Process and filesystem monitoring |
| `watchdog/notification/toaster.js` | Notification delivery: one plan per event, single owner of the fallback |
| `watchdog/notification/transportPolicy.js` | Which transport delivers a notification, from observable signals |
| `watchdog/playtime/monitor.js` | Process-based playtime sessions |
| `app/util/gameHealth.js` | Per-game health derivation: state, explanation, checks and repairs |
| `app/util/interfaceMode.js` | Simple / Advanced policy: which tabs, rows and health checks each mode shows |

## Local data

Packaged user data is stored below `%APPDATA%\Achievement Watcher Next`. AW Next owns a folder neither predecessor's uninstaller touches, and imports forward along the chain `Achievement Watcher` (1.6.8) → `Achievement Watcher 3.0` → `Achievement Watcher Next` on first launch, newest source first. Each hop is one-way and non-destructive: it never deletes a source, never overwrites a file already present in the destination, and stops as soon as the destination holds AW configuration (`app/util/migrateUserData.js`):

| Directory | Contents |
|---|---|
| `cfg/` | Settings, game index, executable mappings and exclusions |
| `logs/` | Main, renderer, parser and Watchdog diagnostics |
| `cache/` and `steam_cache/` | Downloaded tools, metadata and artwork caches |
| `Media/` | Legacy seed for custom Windows toast sounds (old registry entries point here; kept for upgrades) |
| `sounds/`, `presets/` | Imported notification sounds and generated user presets |

Settings are stored in `cfg/options.ini`. Sensitive fields are encrypted before the file is written. Epic account tokens use a separate encrypted cache.

## UI and localization

The renderer is a long-lived HTML/JavaScript application. Some locale bindings still depend on DOM order, so changing settings markup can shift text onto the wrong control even when the JSON keys are correct. Update the view, `app/locale/loader.js` and every locale together, then run the full app suite.

The settings panel has two display modes, Simple and Advanced, stored as `[general] interfaceMode`
and decided by `app/util/interfaceMode.js`. The module is pure: it owns the list of Advanced-only
tabs, the `data-advanced` attribute that marks individual rows inside the tabs Simple keeps, and the
Game Health checks Simple leaves out. `app/ui/settings.js` applies it by toggling the `mode-hidden`
class - **never by removing markup**, because the positional locale bindings above would break.

The mode is a display setting: no parser, watcher or stored value changes with it, and an unset or
unrecognized value resolves to Advanced so an upgrade never hides a feature someone already used.
When adding a settings tab, put its `data-view` in one of the two lists in `interfaceMode.js`;
`test/ui/interfaceMode.test.js` fails on a tab that belongs to neither.

The Sources tab is the exception to the static rules. `hiddenOptionalSources()` decides per row from
live state: a niche source (`OPTIONAL_SOURCES`) is folded away only while it is still enabled *and*
no game in the library carries one of its `source` values. Switching it off or owning a game it
detected brings the row back, so Simple can never hide the only control that would explain a missing
game. Those rows therefore carry no `data-advanced` marker - adding one would defeat the rule.

English is the reference locale. `app/locale/uiLanguages.js` only exposes languages that have a bundled JSON file, and the loader falls back to English at runtime.

## Packaging boundaries

`app/electron-builder.yml` packages the desktop app and copies the Watchdog beside it. Notification presets, sounds and shared Steam-schema mapper modules are unpacked from ASAR because overlay windows and the external Watchdog load them from disk.

`npm run build` prunes Watchdog development dependencies before packaging. Restore them after a build before returning to development. See [BUILD.md](https://github.com/Shirowwww/Achievement-Watcher-3.0/blob/main/BUILD.md) and the [release workflow](RELEASE_WORKFLOW.md).

## Change checklist

When changing a parser or watcher, verify:

- discovery and installed-state behavior;
- initial baseline versus a real new unlock;
- duplicate suppression;
- cache identity and platform namespacing;
- missing/offline data behavior;
- logs and user-facing diagnostics;
- both app and Watchdog tests when the boundary crosses processes.

---

**Next:** [Build guide](https://github.com/Shirowwww/Achievement-Watcher-3.0/blob/main/BUILD.md) - running from source, packaging and the native-module
gotchas · [Contributing](https://github.com/Shirowwww/Achievement-Watcher-3.0/blob/main/CONTRIBUTING.md) · [Release workflow](RELEASE_WORKFLOW.md).

<div align="center">

[← Documentation](README.md) · [Build guide](https://github.com/Shirowwww/Achievement-Watcher-3.0/blob/main/BUILD.md) · [Project home](https://github.com/Shirowwww/Achievement-Watcher-3.0)

</div>