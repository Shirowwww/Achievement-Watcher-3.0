# Changelog

All notable changes to Achievement Watcher (3.0 fork) are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed

- Interface translations across the bundled locales: corrected false-friend
  terms ("Disabled" no longer reads as "disabled person", "Toast" no longer
  reads as toasted bread), aligned onboarding labels with the wording used in
  Settings (Smart Find, Overlay, Enabled/Disabled), fixed capitalization in
  onboarding steps, and cleaned up English source punctuation.
- Notification terminology is now explicit everywhere: "Toast" labels became
  "Windows notification" (the native Windows system notification) and
  "Overlay" labels became "In-game overlay" (the Steam-style popup), in every
  bundled locale, the first-run guide, the settings test buttons and the docs.
- Malformed Tenoke inline progress values (e.g. `progress=12.5.3`) are ignored
  instead of writing `NaN` into the achievement baseline; the matching
  `[STATS]` value is used as fallback.

## 3.5.2 - 2026-08-04

### Added

- Local Windows builds can now be signed with a self-signed `CN=Shirow`
  certificate (`build/signing/create-self-signed-cert.ps1`); `npm run build`
  signs automatically when the local PFX exists. Installing the certificate
  into the Windows trust stores is opt-in (`-InstallTrust`) so the script
  never shows a certificate-install prompt by default. Windows publisher
  metadata (used by the firewall prompt) is now `Shirow` instead of the
  original author.
- Every overlay notification preset now consumes the same payload richness as the Shirow preset:
  rare achievements get a gold/silver/bronze tier (accent, glow and progress colors) and progress
  notifications show a real progress bar with a `current/max - %` label. This covers all bundled
  presets, the user presets and the custom preset builder. Presets that lacked it also gained
  marquee scrolling for long titles/descriptions so text stays readable.
- Smart Find now probes `Program Files\Games` and `Program Files (x86)\Games`, and the default
  library folder list includes `C:\Games`.

### Changed

- Notification delivery now defaults to the in-game overlay with the Shirow preset instead of
  Windows toasts; first-run onboarding, settings and the Watchdog defaults were updated, while
  existing saved settings keep their previous choice.

### Fixed

- The Watchdog no longer re-notifies the latest pre-unlocked achievements on every save-file change
  after a fresh install: the per-game baseline cache folder (`steam_cache/data`) is now created before
  the first write, baselines are saved atomically, and a failed disk write keeps the baseline in
  memory for the session instead of making the next scan look like a first observation.
- Presets that previously required a full `displayName`/`description`/`iconPath` payload (Modern,
  Neon Future, LAZ0RBOX, PS5 presets, Xbox 360, xqjan) now render whatever fields are present, so
  progress-only and playtime notifications no longer skip their content.
- Smart Find no longer adds Steam library/install paths (`Steam`, `SteamLibrary`, `steamapps`, …)
  as emulator scan roots, and Steam-sourced library entries no longer show a redundant Steam
  source icon or dll badge.

## 3.5.1 - 2026-08-04

### Fixed

- The Microsoft / Xbox Network login window no longer stays open after you accept the consent page.
  The OAuth redirect to the localhost callback is now captured from the navigation itself (the code
  was previously invisible because the navigation was cancelled before the URL committed), the
  callback path tolerates a trailing slash, and popups the consent flow opens are watched like the
  main window instead of being denied by the default popup blocker.

## 3.5.0 - 2026-08-04

### Added

- Online-Fix emu support: a sibling `Stats.ini` next to `achievements.ini` is now merged into the
  parsed save, so progress-type achievements resolve through the local Goldberg/GBE schema instead
  of showing 0% forever.
- TENOKE `user_stats.ini` stat support: `[STATS]` values are cross-referenced onto same-key
  achievements (and inline `progress=`/`value=` entries on the achievement itself are honored), so
  Tenoke progress-type achievements display real progress.
- Epic appid detection: legacy NemirtingasEpicEmu installs (hex artifact ids) now resolve their real
  Epic namespace/title through egdata.app, reuse the same cached, localized, rarity-annotated schema
  as official Epic installs, and fetch their community rarity against the correct product id instead
  of the artifact id.

### Fixed

- The update prompt's "Download & Install" button now shows its ampersand literally. Windows was
  treating the single `&` as a keyboard-mnemonic prefix, which hid it from the button label.
- Achievement progress is no longer permanently zeroed when a save file lacks `MaxProgress`: the
  parser leaves the field unset so the schema's own `max_progress` fallback still applies.

## 3.4.3 - 2026-08-03

### Reliability

- The background monitor is now supervised with an exponential respawn backoff (3 s → 60 s cap), so a monitor that crash-loops no longer restarts every three seconds. A failed spawn no longer leaves the monitor permanently dead for the session.
- Uncaught exceptions in the Watchdog now log the stack and exit cleanly, letting the app-level supervisor restart it instead of leaving it running with half-initialized state.
- File-watcher errors (options.ini and achievement folders) are now logged instead of risking an unhandled `error` event that could take the monitor down.
- The startup sweep of orphaned Watchdog processes (by port 8082) now runs once before the first launch instead of on every monitor restart, so tray restarts and supervised respawns are faster.

### Updates

- The update check now retries 30 minutes after a failure and re-checks every 6 hours while the app stays resident; overlapping prompts are ignored, and check/download failures surface as a tray balloon instead of only appearing in the log.
- Security: pinned `ip-address` to 10.4.0 and `undici` to patched releases; `npm audit` reports 0 vulnerabilities.

### Fixed

- Game-list context-menu icons referenced image files that did not exist (`file-text.png`, `cross.png`, `folder-open.png`, ...), so every menu icon was blank. The @2x artwork is now the canonical file and the unused @1x/@4x duplicates were removed.

### Cleanup

- Removed the unused `sound-play` dependency from the app and the Watchdog (sound playback already goes through PowerShell).

## 3.4.2 - 2026-08-03

### Added

- Steam global achievement percentages now appear for games that are not running under a Steam emulator, so a Ubisoft/Uplay game behaves exactly like a Steam game in the detail view. Goldberg Uplay R2 titles keep their mapped Steam AppID and fetch the percentages directly; official Ubisoft Connect titles go through a Steam↔numeric-id bridge that translates Steam achievement names onto the game's native ids and caches the result in the shared rarity sidecar; Epic installs with a known Steam release borrow the Steam percentages. The community % column, the rare tiers and the percentage sort work identically for all of these sources.
- Native non-Steam ids (Ubisoft Connect, GOG/Epic official, Lumaplay, EA, Xbox) are never sent to Steam's global-percentages endpoint anymore. Sources without a Steam counterpart keep their own rarity: GOG/Epic sidecars, Exophase for console emulators, and the Xbox import cache.

## 3.4.1 - 2026-08-03

### Fixed

- Fixed the real cause of the library reloading itself and of scans feeling slow. Each loaded game was handed to the interface from inside a `requestAnimationFrame` callback, which the browser engine only delivers to a *visible* window. Achievement Watcher lives in the tray with its window hidden, so a background scan finished having added nothing to the on-screen list; the periodic new-game check then saw the entire library as newly installed and started a full refresh — every three minutes, indefinitely. Real logs showed `54 new game(s) detected` on every tick for a 52-game library. Games are now handed over directly, so the list is correct whether or not the window is open.

### Security

- Updated two pinned dependencies that were held at vulnerable versions: `protobufjs` (7.6.4 → 7.6.5, denial of service via `.proto` option parsing) and `adm-zip` (0.5.18 → 0.6.0, 4 GB memory allocation from a crafted ZIP). `npm audit --omit=dev` now reports no vulnerabilities. Pinning the patched releases avoids the downgrade of `steam-user` that `npm audit fix` proposed.

### Changed

- Added `.gitattributes` marking the repository `whitespace=cr-at-eol`. Files here legitimately mix CRLF and LF, so `git diff --check` was reporting every CRLF line as trailing whitespace and burying genuine hits; real trailing spaces and tabs are still reported.

## 3.4.0 - 2026-08-03

### Added

- Settings has a search field: typing filters the rows of every tab at once and the side menu shows how many matches each tab holds, so an option can be found without knowing which tab owns it. Rows are matched on their label, their help text, the values they offer and their internal option name (`hideZero` works in any language). Section headers now stay pinned while a long tab scrolls.

### Fixed

- Ubisoft (Goldberg Uplay R2) games no longer report 0% when the emulator is recording unlocks somewhere else. Achievement Watcher now reads the unlock file from wherever the emulator actually writes it — its own `Goldberg UplayEmu Saves` folder, the game's `saves` folder, or a custom `SavePath` — instead of only the `GSE Saves\<AppID>` folder the fix redirects to, and translates the Ubisoft objective ids back to the game's Steam achievement names.
- The Uplay R2 fix now adapts to the loader build that is installed. Loader builds released before `AchSaveType`/`AchSavePath`/`AchKeyPrefix` existed silently ignored those keys, so the configuration looked correct while nothing was ever written where Achievement Watcher reads. Such builds now get a configuration they understand (achievements enabled, schema keyed by bare objective id) and their unlocks are read from their own save folder.
- A Ubisoft game update that re-extracts the repack removes `achievements_schema.json` and restores an ini with achievements disabled, silently breaking a working setup. The setup is now re-applied automatically on scan (like the Goldberg/GBE schema already was), and "Diagnose Uplay R2 setup" reports the missing schema, the disabled ini and the loader's limitations explicitly.
- "Apply emulator fix (Uplay R2)" now offers to update a loader that is too old to redirect achievements, when a newer one is in the local loader cache. The offer is an explicit prompt that defaults to keeping the current loader, since the fix works either way and the game already launches with the installed DLL; the original is kept as `.bak`. Previously a loader was only ever installed when the game had none at all.
- "Open Ubisoft achievement saves" opens the folder that actually holds the unlock file rather than always opening the redirect target, which is empty on a loader without redirect support.
- Fixed the library reloading itself every few minutes. An appid that discovery keeps finding but that never reaches the list — a failed load, a game hidden by "hide 0%" or by a disabled source — was counted as a brand-new install on every background check and triggered a full refresh each time.
- Fixed the loading bar stalling near 100%. Folders under `Goldberg UplayEmu Saves` are named with the Ubisoft product id, which was being looked up as if it were a Steam AppID: every scan spent up to 30 seconds waiting for a Steam lookup that could never succeed. Those folders are now mapped to their Steam release, and any appid that genuinely resolves to nothing on Steam is remembered for three days instead of being re-fetched on every scan.
- Keys appended to an emulator ini kept the lower-cased spelling used to look them up (`achkeyprefix` instead of `AchKeyPrefix`), which the Uplay R2 loader ignores.
- Ubisoft (Uplay R2) games now fire live achievement notifications while you play. The Watchdog never watched the emulator's save folder at all, so these unlocks only ever appeared after a manual library refresh. It now watches `Goldberg UplayEmu Saves`, resolves the Ubisoft product id in the folder name to the game's Steam AppID, and maps the objective ids in the save onto the game's achievement names.
- Unlock state is read from all of the emulator's possible save folders and merged instead of stopping at the first file found. Several of them routinely hold a file at once — the emulator seeds a fully-locked copy from the schema, a previous save location leaves one behind — and a stale all-zero copy could hide real unlocks. An unlock now always wins over a lock, and the most recent timestamp wins.
- Fixed a serious flaw in the new "unresolvable appid" memo: a single scan started with no internet (or with Steam's app-list endpoint down and no cached copy) would have recorded *every* uncached game as "not a Steam app" and hidden the whole library for three days. A miss is now only remembered when the app-list was actually available to miss against.

## 3.3.1 - 2026-08-03

### Changed

- Updates are now proposed before anything is downloaded: a "Download & Install" prompt appears when a new version is found, and the install prompt appears only after the download completes ("Later" keeps the app running; "Skip this version" mutes that release).

### Fixed

- Fixed the 3.3.0 startup crash that left the main window blank: `app.js` no longer redeclares the shared `userThemes` binding, which previously threw a `SyntaxError` and stopped the whole renderer script before the library could load.
- Fixed the Xbox PC account card throwing `fr is not defined` at startup, which aborted the rest of the Settings initialization.
- Fixed the Xbox PC parser being loaded from a doubled `parser/parser/xboxPc.js` path, which silently disabled the Xbox PC source in every scan.

## 3.3.0 - 2026-08-03

### Added

- A right-click "Emulator source" option lets you force a game's tools to Steam/GBE Fork or Ubisoft (Uplay R2) instead of relying on automatic detection, for the rare title that trips the on-disk marker heuristic the wrong way.
- Right-click an achievement in the game view to mark it as manually unlocked (or clear the override). The state is stored locally per game/source and never touches the game's save files; manually unlocked entries render with an amber marker and count toward progress.
- "Random sound" option for overlay notifications: each popup picks a fresh sound from the bundled and imported sound list instead of always replaying the same file.
- Sound import and the overlay dropdown now accept `.flac`, `.m4a` and `.aac` in addition to `.wav`, `.mp3` and `.ogg`.
- A dedicated playtime notification scale (Settings → Notifications) lets playtime popups render at a different size than regular achievement popups.
- Xbox PC support (ported from the reference Achievements project): connect a Microsoft / Xbox Network account from Settings → Sources, import the Xbox PC library (Game Pass and Microsoft Store installs, discovered from `XboxGames` folders, `.GamingRoot` markers and Appx packages), and read each title's achievements, unlock state and rarity from the local cache. The session token is stored encrypted.
- User themes: drop any `.css` file into `%APPDATA%\Achievement Watcher\themes` and it appears in Settings → General → Theme (stored as `user:<name>`).
- Per-platform metadata links in the game right-click menu: Epic Games Store / GOG / EA / Ubisoft Store / RPCS3 Wiki plus PCGamingWiki, for every non-Steam source.
- Process trail: games already running when the background Watchdog starts are seeded as active playtime sessions, so their playtime is recorded on exit instead of being lost.
- Per-emulator overlay presets: Xenia, RPCS3 and ShadPS4 notifications can each use their own preset (Settings → Notifications), alongside the existing rare/platinum overrides.
- Emulator rarity: RPCS3, ShadPS4 and Xenia achievements now show global unlock percentages fetched from Exophase (cached per game), and Xbox PC titles paint the rarity captured at import time.
- Live Xbox PC unlock notifications: while a Game Pass / Microsoft Store title is running, the background Watchdog polls Xbox Network and fires a toast/overlay for each new unlock (requires the connected account + imported library).

### Fixed

- Games with no Steam client icon (common for brand-new releases) now show their header/portrait art instead of a blank icon on the achievement page, and no longer silently break playtime tracking.

### Changed

- The SteamGridDB artwork key can now be overridden per user in `cfg/options.ini` (`[steamgriddb] apiKey`, AES-encrypted on disk like the Steam Web API key); the bundled public key remains the fallback.

## 3.2.1 - 2026-07-14

### Changed

- The first-run guide now has visible step progress, completed-step markers, contextual folder-search feedback, an API-key visibility control with live valid/malformed feedback and paste sanitizing, a notification test using the selected transport, reliable keyboard dismissal when reopened from Settings, and a layout that remains usable at the minimum window height.

## 3.2.0 - 2026-07-14

### Added

- Full controller navigation across the library, achievement view, settings, onboarding and in-app prompts, including spatial D-pad/stick movement, activation/back, search, scrolling and settings-tab shortcuts.
- Native local achievement readers for GOG Galaxy, Ubisoft Connect and Steam appcache, with live unlock monitoring for GOG and Ubisoft sources.
- An Epic account connection flow and official Epic achievement source, integrated into the Sources settings and normal library scan.
- Local-first metadata fallbacks for multi-language achievement descriptions, GBE product-info artwork, offline game names, SteamDB launch executables and hard-to-resolve covers.
- Optional native controller input for in-game overlay movement and control, including XInput, newer Windows input backends and raw-HID profiles.
- A dedicated Goldberg Uplay R2 diagnosis and repair path for compatible Ubisoft games, using a user-provided loader and a safely derived Steam achievement mapping.

### Fixed

- Ubisoft/Uplay R2 installs without Steam DLLs or AppID markers are now detected from their Ubisoft files and internal install-state title, even when a repack renamed the folder; known games regain Steam metadata and achievements, while every detected Ubisoft install gets the Uplay R2 repair action instead of GBE Fork.
- Ubisoft games now use a dedicated Ubisoft Connect source icon, correctly fill the game-card artwork, and expose launch/configuration, Uplay R2 diagnostics, mapped IDs, runtime folders and valid Steam catalog links from the right-click menu.
- Windows account avatars are read correctly with the current extractor API and from both account-picture folder names used by supported Windows versions.

### Changed

- Reorganized and expanded the public documentation with a richer project overview, task-focused user guides, current build and architecture references, clearer issue templates, and consolidated attribution.
- Platform-aware IDs now keep Steam, Ubisoft, Epic and GOG entries separate across shared artwork, rarity and game-index caches.
- Emulator setup attempts use a content fingerprint, avoiding repeated work while still retrying when `steam_settings` changes.
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
