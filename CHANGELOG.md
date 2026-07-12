# Changelog

All notable changes to Achievement Watcher (3.0 fork) are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Full controller navigation across the library, achievement view, settings, onboarding and in-app prompts, including spatial D-pad/stick movement, activation/back, search, scrolling and settings-tab shortcuts.

### Fixed

- Windows account avatars are read correctly with the current extractor API and from both account-picture folder names used by supported Windows versions.

### Changed

- Updated the desktop runtime to Electron 43.1.0 (Chromium 150, Node 24.18) and moved direct dependencies to their current releases.
- Replaced Puppeteer's bundled Chromium 110 fallback with Puppeteer Core 25 using an installed Chrome or Microsoft Edge, and moved network requests to the built-in Fetch API.

## 3.1.0 - 2026-07-11

### Added

- Notification volume is now a real slider (0–200%, live preview at the chosen loudness — including the >100% overlay boost); custom toast sounds follow the same setting instead of playing at a fixed half volume.
- New "Rare" notification test button, firing a random gold/silver/bronze rarity through both the overlay and toast transports, exactly like a real rare unlock.
- 7 new overlay notification presets imported from the reference Achievements project: the full Xbox Series family (base, Purple, Rare ×2, Platinum ×2 with the animated diamond) and Game Cover (uses the game's header art as background).
- Rare unlocks and the platinum (100%) popup can each use their own overlay preset (Settings → Notifications, "Same as main" by default) — pairs naturally with the Xbox Series Rare/Platinum presets.
- App color themes (Settings → General): Steam Blue (default), OLED Black, Dracula, Graphite — previewed live, applied at startup.
- Achievement search box in the game view: filter the unlocked/locked lists by title or description.
- Mouse side-button navigation everywhere: Back closes Settings or returns to the library; Forward reopens the game you just left.
- Live Xenia (Xbox 360) achievement notifications: each title's GPD is watched while you play, with baseline seeding (no replay of old unlocks at startup) and duplicate-event suppression.
- Blacklist manager (Settings → Advanced): hidden games are listed by name with a one-click restore, instead of an all-or-nothing reset.
- Adding a save/config folder (Settings and onboarding) now scans it immediately and reports how many games were found; Smart Find reports how many new folders it added; the "invalid folder" warning lists concrete examples of supported layouts.

### Fixed

- Packaged builds once again check the GitHub release feed automatically on startup, download available updates and offer to restart after the download completes.
- The window no longer freezes permanently when an Epic game's artwork lookup (SteamGridDB) finds no match or the network fails.
- Steam games without store background art no longer lose all their metadata (name, icon, header) during a scan.
- A failed SteamHunters user-list lookup no longer discards the achievement descriptions that were already fetched.
- Settings → Advanced "Fix all games" no longer fails every game's DLC configuration step (`steam is not defined`).
- Float-based achievement progress (e.g. distance stats) is now capped at 2 decimals in the game view, overlay popups and toast footers, instead of printing long tails like `3.3333333`.

### Changed

- All 18 bundled UI languages now contain the same complete 454-key interface set, including themes, achievement search, notification presets, folder guidance and blacklist actions.
- Internal cleanup: removed unreachable scraper branches (one less headless-browser tab per scrape), dead Electron APIs and orphan imports; hardened popup handling for all windows.
- Notifications tab reorganized: the test buttons now sit right below the overlay options they exercise, before the custom-preset builder and souvenir sections.
- Onboarding "How it works" texts now name the exact folders and files the scanner recognizes (GSE Saves, steam_settings, CODEX/RUNE…) and explain that the Watchdog detects the game's executable; French wording cleaned up.

## 3.0.8 - 2026-06-30

### Fixed

- Playtime notifications (overlay and toast) now show the game's high-resolution Steam library art instead of Steam's tiny, low-quality icon, which only shows up as a fallback when no library art is available.

## 3.0.7 - 2026-06-29

### Fixed

- Notifications now show the right primary image: the achievement's own icon for unlock and progress notifications, and the game's icon for playtime. Overlay and toast transports, the Shirow preset, and the in-app test notifications all follow the same rule.

## 3.0.6 - 2026-06-29

### Added

- TENOKE achievements are now read locally from `tenoke.ini` (names, descriptions, icons and progress), so TENOKE games show full achievement details without an online lookup.
- Goldberg/GBE installs that have a `steam_settings` folder but no app id are now resolved by name when possible, or kept visible as an "Unconfigured" entry so they can be identified and repaired manually instead of silently disappearing.
- Achievement progress is shown as a progress bar with its count, both in the game view and in overlay/toast progress notifications.

### Changed

- Notifications now display the game's cover/header art (toast hero image and overlay game art).
- The GBE/Goldberg backup now snapshots `steam_settings` and `steam_api(64).dll`, and a restore point is created automatically before any emulator fix runs — "Restore latest GBE/Goldberg backup" rolls it back. Backup/restore menu wording is localized in every UI language.
- Name → Steam app id lookup falls back to Steam's live app search when the cached app list is unreachable or stale, so brand-new releases resolve too.
- Automatic community-fix (CrakFiles) matching also tries the install-folder and executable names, not just the display name.
- Faster repeat scans (short-lived discovery cache); background new-game detection now runs every 3 minutes.

### Fixed

- Games that bundle a modding editor, SDK or dedicated server in a subfolder (e.g. Divinity: Original Sin 2, which ships "The Divinity Engine 2") are no longer mislabelled with the tool's app id/name.
- Standalone emulator/tool folders (e.g. Dolphin) are no longer mistaken for games.
- Progress values are validated and clamped, so malformed progress no longer produces broken bars or notifications.

## 3.0.5 - 2026-06-29

### Added

- Support for `stats.json` and rich progress-to-stat mappings used by newer GBE Fork / Steamworks games.
- Automatic seeding of missing GBE runtime achievement state after repair or bulk auto-fix, without overwriting existing runtime progress.

### Changed

- Generated emulator configs can now replace placeholder schemas when they contain richer Steam progress metadata.
- Goldberg/GBE repair preserves existing rich generated achievement schemas.
- First watchdog observation of already-unlocked emulator saves now shows only the latest few unlocks before recording the baseline.

### Fixed

- Stat-backed achievements can now map local progress to the real achievement ids in both the app parser and live watchdog.
- Executable detection now prefers the base executable over same-folder `-l` launcher/helper variants.
- The settings shortcut for reopening the first-run guide now works even if the onboarding module was not ready yet.

## 3.0.3 - 2026-06-27

### Changed

- Improved automatic discovery for Steam emulator save folders and common game library locations.
- Reorganized settings into clearer General, Notification, Sources, Folders, Emulator, Guide and Advanced sections.
- Expanded the platform guide in settings and left all guide panels open by default.

### Fixed

- Smart Find and first-run scanning now include additional concrete emulator save roots and library roots.
- App-id folder recognition is more reliable for common emulator layouts while avoiding obvious profile-id folders.
- Small build, installer and configuration cleanups.

## 3.0.2 - 2026-06-27

### Fixed

- Improved installed-game detection for emulated Steam games, including installs where the main executable is in the game root but `steam_api(64).dll` or Steam app-id files are nested in subfolders.
- Reduced duplicate game tiles by merging matching save metadata, installed-folder metadata and cover/cache results more consistently.
- Ignored and removed games no longer keep accumulating playtime, and Wallpaper Engine helper processes are excluded from game tracking.
- The first-run guide now requires choosing a language before the initial scan, and all supported UI languages include the new onboarding text.
- The language selector now only offers languages with complete UI translation files, while Steam metadata languages remain available internally for data fetching.

## 3.0.1 - 2026-06-26

### Fixed

- **Fixed: the app froze on a fresh install (no Steam Web API key, empty cache).** Without an API key, Achievement Watcher reads each game's achievement data by scraping the Steam pages, which can take several seconds per game. That scrape was run over a *blocking* channel, so the whole window locked up — most painfully on a brand-new install where every game has to be scraped from scratch, leaving the UI frozen from the very first game. The scrape now runs in the background: the window stays responsive and the library fills in as each game's data arrives.
- **A Steam Web API key set during the first-run guide now speeds up that very first load.** The first library scan is held until you finish (or skip) onboarding, so the key you just entered is used from the first game instead of after a slow key-less pass — far faster loading and more accurate data (real hidden-achievement descriptions). Setting or changing the key later in Settings now also takes effect immediately, without restarting the app. Without a key the load is necessarily slower (it scrapes), but the window stays fully interactive and games appear progressively as they load. The onboarding **API-key step now prominently warns** that skipping the key makes the first load very slow.
- **Fixed: the library could show every game twice (one copy loaded, one stuck on the loading spinner).** A second scan starting before the first finished (e.g. the 15-minute background new-game check firing during the initial load) appended a duplicate set of tiles. Scans are now coalesced — a refresh requested while one is running queues a single follow-up pass instead of running concurrently.
- **Fixed: the background monitor crashed on a fresh install (no playtime tracking, game-launch detection or live notifications).** It tried to load an optional process-blacklist file (`filter.json`) that doesn't exist on a clean install, threw, and restarted in a loop. It now falls back to empty lists and starts normally.

## 3.0.0

First public release of the modernized 3.0 fork — a large stability, security,
compatibility and feature pass on top of the upstream
[darktakayanagi](https://github.com/darktakayanagi/Achievement-Watcher) base.

### Added

- **System-tray app** — runs in the tray with no window; the library/settings open on demand and closing the window no longer quits. Tracking, playtime and notifications keep running in the background.
- **In-game overlay notifications** — a styled popup drawn on top of the game (presets + sounds), selectable as toast / overlay / both. Works with only the background tracker running.
- **Custom notification preset builder** — pick colours, opacity, font/icon size and corners with a live preview, no HTML needed. Plus custom imported sounds and adjustable overlay volume & duration.
- **"Rare · X%" labels** for sub-10% unlocks, platinum toasts, a 3-tier rarity display, and persistent rarity cached per game (instant and offline).
- **"Installed games only"** filter to hide phantom entries (orphaned saves, owned-but-not-installed games).
- **Automatic new-game detection** — fresh installs are picked up in the background and registered for playtime tracking.
- **New sources** — ShadPS4 (PS4) with live trophy toasts, Xenia (Xbox 360) achievements, and EA Desktop achievements.
- **Goldberg / GBE tooling** — Diagnose and Repair `steam_settings`, install the GBE Fork `steam_api(64).dll`, strip Steam DRM (Steamless), back up / restore the emulator config, and auto-fix new emulated games in the background.
- **Advanced cover management** — re-download art, pull it from an alternate Steam AppID, or set a local image.
- **Souvenir screenshots** — optionally capture the screen on unlock, saved per game.
- **Guide links** in the right-click menu (SteamHunters, Steam Community guides).

### Improved

- **Platform modernized** — Electron 12 → 42 (Chromium 148, Node 24) with every major dependency updated.
- **Faster, lighter loading** — bounded-concurrency scanning, an optional browser-free data path with a Steam Web API key, a roughly halved emulator scan, and a size-capped (LRU) icon cache.
- **~80 MB smaller install** — dropped Chromium UI locale packs and other-platform native binaries the app never loads; the background tracker now shares the app's runtime instead of bundling its own Node.
- **Lower idle footprint** — the hidden main window lets Chromium throttle background timers; the keyless scraper can reuse an installed Edge/Chrome instead of downloading a 170 MB Chromium.
- **More resilient background tracker** — auto-launches at sign-in, keeps running after the window closes, and seeds playtime from the install folder so tracking works on a game's first launch.
- **Modern dark UI** across the library, details, settings and dialogs; resizable window (down to 900 × 600); broader French / English localization.
- **Security hardening** — untrusted text is HTML-escaped before reaching the DOM, a tightened Content-Security-Policy (no inline/eval), jQuery 3.7.1, and a hardened main window.

### Fixed

- **Windows 11 24H2+ compatibility** — every `WMIC` call (removed by Microsoft) was replaced, so folder scanning, drive listing and process priority work again.
- **Hidden achievement descriptions** now resolve correctly even with a Steam Web API key, and stale blank entries are repaired in place.
- **GreenLuma, Uplay, RPCS3 and Epic** first-load failures fixed; no more permanent blacklisting after a single transient error.
- **Emulator notification edge cases** (3DM, TENOKE, GOG/Nemirtingas, `[object Object]` titles) now notify correctly.
- **Playtime tracking** is correct for games whose process name differs from the store index, and store launchers / helper processes are no longer tracked as games.
- Several **CPU and memory-leak** issues (busy-loops during scraping, orphaned browser instances, a tracker pipe leak) resolved.
- **Self-healing config** — a corrupted folder database is quarantined and defaults restored instead of silently disabling your folders.
- The main window can no longer get stuck **invisible** at startup; launch failures now show a clear dialog instead of failing silently.

### Changed

- **Executable auto-detection** rewritten so each game resolves to its own binary instead of several games sharing one.
- The emulator fix is a **standalone DLL swap** matching common auto-crackers (replace `steam_api(64).dll`, optionally strip DRM), powered by the maintained **GBE Fork** runtime; the original DLL is always backed up.
- With a Steam Web API key set, the data path is **fully browser-free** (schema via `GetSchemaForGame`/`GetGameAchievements`); the headless browser remains only as the keyless fallback.
- The WinRT toast modules are now optional dependencies, so a failed native build no longer blocks installation (toasts fall back to PowerShell).
