# Architecture

Achievement Watcher is a Windows-only Electron application with a separate background monitor. This page describes the boundaries that matter when changing the project.

## Runtime overview

```text
Electron main process
├── creates the tray, windows and IPC handlers
├── owns updates, browser-backed lookups and native app integration
├── starts the renderer library UI
└── starts the Watchdog with ELECTRON_RUN_AS_NODE
    ├── watches processes and achievement files
    ├── tracks playtime
    └── dispatches Windows toasts and overlay events
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
6. A new unlock is normalized, de-duplicated and sent to the selected notification transports.

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

Current integrations include Steam, Goldberg/GBE-compatible saves, GOG, Epic, Ubisoft, EA Desktop, GreenLuma, RPCS3, ShadPS4 and Xenia. Some platforms have both a legacy mapped-save parser and a newer official/local parser.

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
| `watchdog/notification/toaster.js` | Notification routing |
| `watchdog/playtime/monitor.js` | Process-based playtime sessions |

## Local data

Packaged user data is stored below `%APPDATA%\Achievement Watcher`:

| Directory | Contents |
|---|---|
| `cfg/` | Settings, game index, executable mappings and exclusions |
| `logs/` | Main, renderer, parser and Watchdog diagnostics |
| `cache/` and `steam_cache/` | Downloaded tools, metadata and artwork caches |
| `Media/`, `sounds/`, `presets/` | User-facing notification assets |

Settings are stored in `cfg/options.ini`. Sensitive fields are encrypted before the file is written. Epic account tokens use a separate encrypted cache.

## UI and localization

The renderer is a long-lived HTML/JavaScript application. Some locale bindings still depend on DOM order, so changing settings markup can shift text onto the wrong control even when the JSON keys are correct. Update the view, `app/locale/loader.js` and every locale together, then run the full app suite.

English is the reference locale. `app/locale/uiLanguages.js` only exposes languages that have a bundled JSON file, and the loader falls back to English at runtime.

## Packaging boundaries

`app/electron-builder.yml` packages the desktop app and copies the Watchdog beside it. Notification presets and sounds are unpacked from ASAR because overlay windows load them from disk.

`npm run build` prunes Watchdog development dependencies before packaging. Restore them after a build before returning to development. See [BUILD.md](../BUILD.md) and the [release workflow](RELEASE_WORKFLOW.md).

## Change checklist

When changing a parser or watcher, verify:

- discovery and installed-state behavior;
- initial baseline versus a real new unlock;
- duplicate suppression;
- cache identity and platform namespacing;
- missing/offline data behavior;
- logs and user-facing diagnostics;
- both app and Watchdog tests when the boundary crosses processes.

[Back to the documentation index](README.md)
