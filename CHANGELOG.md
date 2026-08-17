# Changelog

All notable changes to AW Next are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## 3.9.0 - 2026-08-18

Achievement Watcher becomes **Achievement Watcher Next** (**AW Next**): notifications that pick their
own transport, a per-game health report with guided repairs, a rebuilt preset library and designer,
and a Simple interface mode for people who do not want the full control panel.

Existing installs upgrade in place. The executable, its AppUserModelID, shortcuts and the autostart
entry are deliberately unchanged. User data moves to `%APPDATA%\Achievement Watcher Next`, imported
forward from the `Achievement Watcher 3.0` and `Achievement Watcher` folders — settings, presets,
themes, covers, caches, backups, souvenir screenshots and playtime counters — without modifying or
deleting either source.

### Added

- **Automatic notification delivery**, and the new default: the in-game overlay when it can be seen,
  a Windows notification when it cannot, never both. The choice is made per notification from
  observable signals only — whether the app can render a popup and report back, whether the game
  holds exclusive Direct3D fullscreen (so borderless keeps the overlay), and whether the overlay
  recently failed. **In-game overlay**, **Windows notification** and **Both** remain, and a saved
  choice is never rewritten.
- **A Game Health panel for every game**, from the tools button on its tile: one state — *Ready*,
  *Needs attention* or *Not tracking* — the checks behind it, and only the repairs that apply to that
  game (locate it, rewrite its achievement data, restore the emulator file, correct a mismatched
  `steam_appid.txt`, watch it, or send a test notification with its own name and artwork). It also
  reports which transport delivered its last notification, and why.
- **Reset and restore a game's achievements**, from its page or right-click menu, across every local
  source in one action. Emulator saves and RPCS3's `TROPUSR.DAT` are removed; ShadPS4's `TROP*.XML`
  and Xenia's `.gpd` are relocked in place, because those files also hold the achievement list.
  Account-held sources (Steam, GOG Galaxy, Ubisoft Connect, EA, Epic, Xbox) are reported as out of
  reach rather than appearing to work.
- Every reset is backed up to `<userData>\backups\achievements\<appid>\<date>\` first, a file whose
  backup fails is skipped rather than cleared, and **Restore an achievement backup** puts a whole
  reset back — including AW Next's own unlock record, so restored achievements do not arrive as a
  burst of notifications.
- **Simple and Advanced interface modes**, chosen on their own first-run step. Advanced adds the
  Steam emulator and Advanced tabs plus the deeper rows elsewhere; Game Health states outcomes in
  Simple and exact values in Advanced, with **Technical details** available in both. Simple folds a
  niche source away only while it is still enabled *and* no game came from it, so it can never hide
  the one control that would explain a missing game.
- **A rebuilt preset library**: nine presets — **AW Next** (the new default), **Steam**, **Epic
  Games**, **PlayStation**, **Xbox**, **Cover**, **Glass**, **Arcade** and **Slim** — replacing the
  previous seventeen. Each has its own composition, typography, motion and colour, renders a real
  **100% completion** state, and shows the game's name and rarity percentage.
- **A full Preset Designer** in **Settings → Presets**, replacing the slider-based custom builder:
  layout, typography, background (including the game's own artwork), corners, shadow and glow, motion
  and timing, the rare and 100% treatments, and a per-preset sound. It opens on a **Start from**
  gallery of eight designs, with **Surprise me** and **Duplicate**.
- The designer previews the real notification — the same page, styles and engine a game gets — as a
  **Card**, a **Compare** of normal/rare/100%, or a mock **Screen** from 720p to 4K, over a
  transparent, dark, bright or real-artwork backdrop, played at the preset's own timings.
- **Share a preset as a single `.awpreset` file**, carrying its style, images, fonts, designer
  settings, metadata and any hand-imported sound. A name clash asks whether to keep both or replace.
- **Manually added games**, from the `+` beside library search. Achievement-less entries stay
  launchable, track playtime, show **No achievements**, and can adopt a Steam achievement list later
  without being recreated.
- **Open folder** beside the souvenir save folder, creating it first if nothing has been saved yet.
- Folder lists mark manual locations with a compact icon and show Smart Find sources with their
  detector provenance.

### Changed

- **The product is Achievement Watcher Next / AW Next**, with a new icon set, across the interface,
  installer and log strings; the repository is now `Shirowwww/Achievement-Watcher-Next`. The
  executable name, toast AppUserModelID, install directory and autostart entry are unchanged, so
  existing installs, shortcuts and updaters keep working.
- **Per-type preset settings are gone.** Rare and 100% are states a preset paints itself, so a second
  and third preset for them could only disagree with the first. Per-emulator overrides (Xenia, RPCS3,
  ShadPS4) remain; the Xbox Series rare and platinum variants fold back into **Xbox Series**.
- All bundled presets render through **one engine** — the one the designer generates — instead of
  seventeen near-copies of the same script, so a fix to rare tiers, the completion state, the progress
  line or a long scrolling title lands in all of them at once.
- The bundled preset library is **1.0 MB, down from 10.8 MB**: the removed presets carried megabytes
  of animated GIFs and three copies of the same fonts. Only PlayStation's two typefaces remain.
  `backdrop-filter` is gone from the bundled presets — it cost a blur pass per frame and blurred
  nothing, the notification window being transparent.
- **Notifications sit closer to the screen edge**, and every bundled preset is the same width, so
  switching preset no longer moves the popup sideways. A preset you already built keeps its own
  window until you re-save it.
- **`Random` is an entry in the sound list** rather than a switch beside it, so the list can no longer
  name one sound while another plays. `Indiana.wav` was dropped from the bundled sounds.
- Community presets are named for what they look like: `ArmsofGod`, `Epic Preset`, `TigerDX Award`
  and `mudoss` become **Pantheon**, **Onyx**, **Hexagon** and **Outline**.
- The theme picker opens on seven contrasting themes, including a new Light one, and keeps the rest
  behind **More themes…**.
- Plainer settings vocabulary, a shorter first-run guide that is reachable again from **Settings →
  General**, and a one-line About block, with the upstream lineage credits moved to the Advanced tab.
- Smart Find probes only known save locations, launcher and library conventions, stable emulator data
  folders and shallow emulator binaries. `C:\Games` / `C:\Jeux` are added only when present, and
  library-like Desktop folders are surfaced explicitly rather than scanned through a Desktop root.
- Missing artwork falls back to a cached SteamGridDB cascade after native and Steam metadata, with
  conservative title matching and fill-only semantics, so a good existing asset is never downgraded.
- Accepted updates install through the existing NSIS package in silent upgrade mode and relaunch
  automatically, without a second confirmation or a repeated onboarding flow.
- The guides are reorganized around real tasks and published as a browsable documentation site.

### Fixed

- **An overlay notification the app could not display is no longer lost in silence.** The app reports
  the outcome of every popup it renders, and a failed one falls back to a Windows notification. A
  send call returning is no longer treated as proof that anything appeared on screen.
- **Transport selection has a single owner, so a fallback can never duplicate an unlock.** Ten copies
  of the transport rules — two already drifted apart — are replaced by one decision taken before
  anything is sent, and a fallback is authorised only on a definite failure.
- Overlay notifications below 100% scale are no longer cropped or padded, and a custom position is
  used verbatim again. An anchor left on a disconnected monitor is still brought back into view.
- **Notification popups reach the screen edge they were anchored to.** Placement was measured against
  the desktop work area, so a bottom anchor floated above the taskbar instead of sitting on the edge
  the preset builder had shown. Every anchor is now measured against the whole display, without the
  extra inset that kept a popup from touching its side.
- Notification tests produce one preview consistent with the selected transport and preset, instead of
  sending both an overlay popup and a differently styled toast. A playtime notification with no header
  artwork falls back to the square logo instead of showing an empty image.
- Deleting a custom preset no longer moves the selection to whichever preset sorts first
  alphabetically. A preset shared from an older build keeps its sound on import, and a deliberately
  silent one is no longer pinned to the exporter's own sound.
- In the designer: an over-long scrolling title is clipped to its own column instead of painted over
  the icon, the **Advanced** disclosures actually toggle, and a generated preset's window is measured
  from the design rather than a fixed height, so a stacked layout or strong glow is no longer cropped.
- **Apply emulator fix** no longer disappears from the right-click menu once a game has a setup — it
  hid itself on exactly the games that need it most, such as a repack update that wiped
  `steam_settings`. Those games get **Re-apply emulator fix**, which names the setup it found and asks
  before replacing it. **Generate configs** now counts the games it skips and points at **Advanced →
  Fix all games**.
- A `steam_appid.txt` naming another game has a repair: Game Health offers **Correct the game ID
  file**, showing both values and keeping the previous one. It is confirmed rather than automatic,
  because a mismatch can equally mean the library card is the part that is wrong.
- Source badges come from one anchored table instead of loose string matching, so GOG Galaxy and Epic
  stop being labelled Steam and SmartSteamEmu stops being labelled EA. Cross-source dedupe no longer
  depends on discovery order, a collection folder can no longer be adopted as a game's install
  directory, and a game known only through emulator saves still gets a process to track.
- Souvenir screenshots no longer overwrite each other when several achievements unlock in the same
  second, and a game whose title Windows refuses as a folder name no longer loses them silently.
- Games with no achievement set show **No achievements** instead of `0%`, and are excluded from
  unlocked totals, completed-game counts and average completion.
- Disabled auto-detected folders are excluded consistently from the renderer scan, the Watchdog and
  the Xenia watcher, and library skeletons clear only when the scan actually completes. Their count
  also follows the installed-only filter, so a rescan no longer shimmers with a full grid of
  placeholders that collapses to the three tiles the filter actually shows.
- Initial GBE config generation targets only unconfigured Steam games with no existing fix, protecting
  OnlineFix, TENOKE, ALI213, SmartSteamEmu, UniverseLAN, scene emulators, GBE/Goldberg, Ubisoft,
  official-launcher and console installs. Manual emulator tools no longer offer a GBE install for
  arbitrary programs such as Ryujinx.
- **The Light theme would not stay selected**: the settings validator carried its own copy of the
  built-in theme names and that copy had never learned about `light`. It now reads the theme engine's
  own palette list.
- **The Light theme has depth again.** Its window, library panel and cards all sat within a few
  percent of white, so they read as one flat sheet with tiles floating on nothing — the white-alpha
  highlights the dark themes rely on do not register at that lightness. The surfaces are spread into
  real steps, cards lift off the panel, and sunken wells sit clearly below the card they are cut into.
  The Watchdog status dot also keeps its whole glow instead of being sliced flat on one side.
- **Every registry read has a fallback, so a missing native module no longer empties the library.**
  `registry-js` is a compiled add-on, and a build whose install step never ran ships without its
  binary; every read then answered exactly as it would for a key that is not on the machine. Steam
  accounts and therefore Steam games, Uplay, GreenLuma, playtime and the user avatar all went quiet
  with nothing written to any log. Those reads now fall back to `reg.exe`, which is present on every
  Windows install, so losing the binary costs speed instead of answers.
- **A custom cover applies to the shape you chose it in, and shows up immediately.** Portrait and
  landscape now hold their own picture instead of overwriting one another, and the stored file is
  named after its own contents — picking a second cover previously reused the same path, so the tile
  kept painting the previous image and choosing a cover looked like it had done nothing.
- **An update that is not newer is never offered.** A manifest naming the installed version or an
  older one — a rolled-back release, a stale mirror — no longer reaches a prompt or starts an
  installer download.
- **Restore points survive the move to the new data folder.** Each entry recorded the absolute path it
  was created at, so every migrated restore point still pointed into the previous folder and became a
  dead button the moment that folder was uninstalled or deleted. Entries whose backup is present in
  the current data folder are repointed at it on startup.
- Picking a starting point in the Preset Designer says what it did, instead of printing the template's
  bare name with no explanation, and **Surprise me** reports its result at all.
- Interface fixes: the Settings sidebar sizes itself to its longest label instead of scrolling
  sideways (checked in all 18 locales at five widths), the game page's duplicate floating achievement
  search is gone and `Ctrl+F` focuses the visible field, the profile block is centred again, and
  sliders and the position picker are large enough to aim at.
- Accessible names for the library and achievement search, the Settings dropdowns and the icon-only
  buttons on a game tile, derived from each row's visible label so they follow the interface language.
- Localisation: one consistent native achievement term per locale (including **Succès** in French,
  where the **Preset** picker had been translated as "Thème"); real ellipses, per-language quotation
  marks and typographic apostrophes across some 460 strings; machine-translation errors in the
  first-run guide's buttons; and **Import Xbox PC library**, the one untranslated Xbox label.
- The overlay acknowledgement timeout no longer lets the event loop drain while a caller is still
  waiting on it, which left the promise unsettled.
- `tools/aw-probe.ps1` is DPI-aware, so its screenshots capture the whole window on a scaled display.

### Performance

Measured against the installed app's own logs and user data, not synthetic load.

- **The library no longer reloads itself a few minutes after every launch.** New-game detection
  compared discovery against the games rendered on screen, but those are different populations by
  design, so every session paid a full refresh for a game that was never new.
- **Each achievement folder is watched once** instead of twice — seven duplicate recursive watchers on
  a typical install, one of which could take a Ubisoft unlock down the Steam lookup path.
- **Less blocking work before the window appears**: the eleven parser modules sharing `parser.log` no
  longer each re-read it and open their own stream — 111–123 ms of synchronous startup work on a
  rotated 2.4 MB log, now 21–24 ms.
- **Placeholder tiles follow the real scan**, and streaming no longer re-queries the DOM for every
  game added — 28.2 ms for 200 tiles against 4.3 ms.
- **Theme images are reused instead of duplicated** — one library held 22 byte-identical copies of a
  7.3 MB image, 168 MB of a 193 MB store — and the Custom theme editor no longer re-renders each
  layer's blurred copy on every autosave: about 1469 ms per save against 0.4 ms.

### Security

- A `.awpreset` package is validated whole before anything is written, and refused entirely rather
  than part-installed: format and minimum app version, an extension allowlist, and a path gate that
  rejects traversal, absolute paths, drive letters and Windows reserved names. It is installed through
  a staging folder and moved in one rename, so a failure leaves every installed preset untouched.
  Nothing inside a package is executed, required or evaluated.
- Hardened the preview script-tag matching in the notification CSP hash check, which CodeQL flagged as
  `js/bad-tag-filter`: the pattern only matched a bare lowercase `<script>`, so a change of case or an
  added attribute would have passed the check without asserting anything.
- Updated `puppeteer-core` to 25.7.0 and `js-yaml` to 5.3.0, and grouped the `github/codeql-action`
  bumps so its `init` and `analyze` halves can never land on different versions.

## 3.8.6 - 2026-08-13

### Added

- Fast keyless Steam schema retrieval: the official `IPlayerService/GetGameAchievements` endpoint
  now works without a Steam Web API key (hidden descriptions, icons and global rarity included),
  with an automatic fallback chain to the SteamHunters public JSON API, the SteamCommunity
  achievements page, and finally the existing browser scrape. Schemas are fetched in parallel with
  product info and the keyless worker pool is now the same as the keyed one (8 concurrent games).
- Settings → Help now adapts to the user's actual setup: it shows the current overlay hotkey,
  the controller layout and real controller bindings (Xbox, PlayStation or Switch wording),
  the notification mode, the active theme, and a live count of enabled sources. A compact
  "your setup" strip sits at the top of the Help tab and updates as settings change. Its 11 guides
  are grouped into compact topic cards with case- and accent-insensitive search; a single result
  opens automatically while multiple results stay easy to scan.
- DLC and update achievements are now tagged with their SteamHunters group name (e.g.
  "The Witcher 3: Wild Hunt - Hearts of Stone") under the achievement title, matching by the
  schema api-name so base-game and untagged entries are left untouched.
- The Watchdog's SteamHunters fallback now also reads the SteamCommunity achievements page over
  plain HTTP, so notifications still get icons and a trustworthy hidden flag when the official
  endpoint is unreachable. SteamHunters rarity falls back to `estimatedSteamPercentage` for
  brand-new titles Steam has not measured yet.
- The translated but previously missing **Generated configs** Help topic is now visible.
- Settings → Advanced gains a **Clear caches** button: it deletes the updater's own downloaded-update
  files plus the re-fetchable Steam/Ubisoft schema, icon, cover and downloaded emulator-fix-tool
  caches, and reports what it cleared. Everything it touches is re-downloaded automatically the next
  time it's needed; settings, saves, GBE restore-point backups, notification presets, theme images
  and the user-seeded Uplay R2 loader cache are never included (see `util/clearableCaches.js`'s
  explicit allowlist).
- The Steam Web API key is gone from the app: the Settings field, the first-run guide step,
  the Diagnostics row and every keyed fetch path (renderer and Watchdog) were removed. Steam
  metadata is always fetched with the keyless chain, and legit Steam user unlocks now use the
  public profile XML instead of `GetPlayerAchievements`.

### Fixed

- The SteamCommunity HTML fallback now strips malformed nested markup with a stateful scanner,
  preventing executable markup from surviving the fallback path. Markdown anchor parsing uses the
  same safe tag-stripping approach and has regression coverage for nested tags.
- Custom overlay-notification placement now persists from the Windows drag event, stays on the
  monitor where it was positioned even when the cursor is elsewhere, and locks every real popup to
  the saved bounds instead of allowing later window activity to move it. Custom coordinates use the
  full display rather than the taskbar-shortened work area, so a scaled popup can once again sit
  exactly flush in a screen corner or over the taskbar on HiDPI displays (issue #25).
- The profile summary (unlocked achievements, completed games and average progress bar) now follows
  the **Installed games only** filter immediately and uses a short, reduced-motion-safe transition.
- Settings → Advanced now displays the bundled sync icon for **Recheck achievement lists**. Cache
  and achievement-recheck results fade away after they have been read instead of permanently
  occupying a row; the in-progress recheck message remains visible only while the scan is running.
- Custom covers selected from SteamDB, SteamGridDB or another Steam AppID now survive **Clear
  caches** and a game-list refresh. New selections are copied to the durable `covers` folder;
  existing cache-backed selections are promoted before deletion, and an already-broken legacy
  SteamGridDB reference reconstructs its exact CDN URL from the retained content hash. Any other
  unrecoverable legacy reference falls back to the normal cover instead of leaving a blank tile.
- Hard-coded user-facing text is now localized: the Steam-avatar context-menu label, the update-failure tray balloon, the Goldberg/GBE and Uplay R2 diagnostic details, the setup-steps aria-label, the default Watchdog status text, the overlay window title and the technical lines of the install dialogs all use the bundled locale files (18 languages).
- The last native-dialog bypasses are gone: `OK`, the debug reload action and the fatal startup
  error now use a locale key or Electron's localized standard role instead of fixed English text.
- Theme colors no longer drift between the main window, Settings, custom-theme defaults, the
  in-game overlay and the window's initial paint. The duplicate Steam Blue palette was collapsed
  into one CSS token block, all 17 built-in palettes now expose their Settings surface, and
  success/error/warning states plus the title-bar status lights follow semantic theme tokens.
- Self-signed updates no longer depend on the certificate being installed or trusted on the user's
  PC. The updater accepts the exact `CN=Shirow` publisher identity even when Windows reports an
  untrusted root, while rejecting lookalike common names such as `CN=Shirow Evil`; the release
  SHA-512 remains independently verified.
- The Watchdog's schema fallback (`api.xan105.com`, offline) is replaced by the same keyless chain,
  so playtime seeding and game-index lookups work without a key again.
- Games with zero Steam achievements (e.g. UNDERTALE, Dota 2) are no longer treated as errors by
  the Watchdog's schema path.
- Settings → Help no longer documents the old two-button **Back + Start** overlay combo:
  controller instructions now follow the saved three-button binding and the selected
  PlayStation/Switch/Xbox layout, and the shortcut text shows the hotkey actually saved.
- Help, onboarding and the emulator guide no longer claim that the current standalone GBE Fork
  setup creates ColdClient launch helpers. The two obsolete hidden controls for ColdClient mode
  and `Launch.bat`, together with their dead translations, were removed from Settings.
- The LumaPlay source default used by the emergency config fallback disagreed with the normal
  loader default (`false` vs `true`). Both paths now agree on `true`.
- An update stuck failing with a sha512 checksum mismatch no longer requires manually deleting the
  updater's cache folder. Differential (patch) downloads are disabled entirely, removing their
  never-revalidated cached base file as a failure source; if a checksum still mismatches, the
  cache is cleared and the full installer is re-downloaded once automatically. If that also fails,
  a clear dialog names the cache folder and offers to open the release page for a manual install.
- The Settings → Advanced cache-clearing button always failed in dev builds
  (`autoUpdater.getOrCreateDownloadHelper()` had no `dev-app-update.yml` to read). A dev-mode
  config now ships alongside the packaged one (excluded from packaged builds), and the update
  cache is cleared independently of the app caches so a failure resolving one never blocks the other.
- Opening the overlay or a toast for an appid that has no library tile (no discovery record) no
  longer throws while parsing local achievement data; the schema-only game loads instead.
- The SteamHunters fallback no longer loses icons and hidden status (or stays English-only) for
  non-English users: icons/hidden are merged from the English SteamCommunity page (whose titles
  match SteamHunters), then the localized page is overlaid by icon hash. The Watchdog now loads
  the shared schema module instead of maintaining a private copy that could drift.
- Settings → Advanced → **Recheck achievement lists** now also works when it is the first scan
  of the session; the fast-start path no longer suppresses an explicit re-check.
- A SteamCommunity translation row with an empty image URL can no longer overwrite the title of
  the first achievement whose icons were missing.
- Periodic Steam schema repair now uses the complete keyless fallback chain, and a provider response
  containing the same new API name twice can no longer append a duplicate achievement.
- The Watchdog no longer stores a temporary numeric AppID as a game's permanent title, treats
  malformed provider payloads as failures, or caches a total schema outage as a verified game with
  zero achievements. Its final SteamCommunity fallback is now also used outside notifications.
- Cache deletion retries transient Windows file locks, and **Clear caches** no longer reports success
  when the updater cache specifically failed to clear.
- Browser-backed tests retry removal of locked temporary profiles, eliminating cleanup-only failures
  after Chromium has already passed the real assertion.
- The packaging script invokes Electron Builder directly through Node instead of an argument-joining
  command shell, removing the Node 24 security warning and its avoidable quoting risk.
- Stale-Watchdog port cleanup now invokes `netstat.exe` and `taskkill.exe` with explicit argument
  arrays instead of building shell command strings.
- The advanced GBE configuration and interface generators are launched directly with argument
  arrays; their remaining batch-shell compatibility path and Node 24 security warnings are gone.
- Production dependency pruning now explicitly suppresses install scripts; it only removes
  development packages and no longer emits npm's pending-script warnings during packaging.
- The Watchdog no longer writes the complete settings object to diagnostics, preventing encrypted
  credentials and account identifiers from being copied into routine log files. Dumps left by
  older builds are redacted in place on startup without deleting surrounding diagnostics.
- The removed Steam Web API credential is now discarded from legacy in-memory settings and erased
  from `options.ini` by the Watchdog migration instead of surviving indefinitely as an unused secret.
- The complete Settings → Help panel is now genuinely translated in all 18 bundled locales instead
  of leaving most of its instructions in English. A locale regression test rejects copied English
  Help prose; controller bindings, localized button labels and the three-day refresh interval are
  covered too.

### Changed

- **Analyze selected folders** now uses a simpler compact layout and a thin, theme-aware scrollbar
  instead of Chromium's bright native scrollbar; its scan button is now a quiet standard action
  instead of a large filled primary button.
- Settings → Sources now identifies the directly supported official desktop libraries (Steam,
  Ubisoft Connect, GOG Galaxy, Epic Games and Xbox PC) with a translated explanation and shield
  markers, while keeping EA's log-only/non-managed-install scope explicit in the documentation.
- Opening Settings, switching its tabs and expanding a section now use short compositor-friendly
  transitions, with the existing reduced-motion preference still disabling every animation.
- The first-run guide, settings help and documentation no longer mention a Steam Web API key at
  all; metadata retrieval is automatic and the first scan is fast without one.
- The getting-started guide and the documentation index now describe the adaptive
  **Settings → Help** tab, its live setup strip, controller layout and topic search.
- Relative links and heading anchors across the Markdown documentation now have an automated
  exact-casing regression test, preventing Windows-only false passes and broken GitHub links.
- Troubleshooting now describes the release signature accurately: installers use the project's
  self-signed publisher certificate, which Windows may still treat as untrusted. The user docs now
  make clear that no certificate installation is required: the updater accepts the exact
  `CN=Shirow` identity on a fresh PC and separately checks the release SHA-512.
- Electron, Puppeteer Core and the Watchdog screenshot helper received their latest compatible patch
  updates (`43.4.0`, `25.6.0` and `1.15.6` respectively).

### Performance

- SteamHunters DLC/update group lookups are deferred until a game actually has achievements and
  are cached on disk for 30 days, so large libraries no longer fire one extra request per title
  on every scan.

## 3.8.5 - 2026-08-13

### Added

- The built-in theme set now includes Catppuccin Mocha, Rosé Pine, Synthwave '84,
  Everforest, Cyberpunk, Ember, Ocean, Hacker, Burgundy and Champagne (replacing the
  earlier Solarized, One Dark and Monokai additions). The theme picker in Settings >
  General is now a dropdown as well as the existing arrow controls, matching the
  notification-overlay selectors.
- Settings → Controller gains an optional **Send Escape to the game when opening
  with controller** action: when the overlay is opened with a controller while a
  game is running, the watchdog sends an Escape key press to the focused game
  window first, so many games open their pause menu or pause automatically. It
  is opt-in, off by default, and never runs for keyboard-hotkey opens.
- Controller support now also covers the main window: **Control the app with a
  controller** navigates the library, game details, settings and searches with a
  gamepad. The Controller settings were moved to their own tab and gained a
  button-layout selector (Auto/Xbox/PlayStation/Switch), fully configurable
  one-to-three-button bindings, and a **Focus overlay when it opens** option for
  games that pause when they lose focus.
- Non-Steam games (official Ubisoft Connect, Uplay R2, Epic, GOG, EA, Xbox PC and
  standalone installs) now show their tracked playtime and last-played date in the
  achievements page header, like Steam games already did.
- The overlay window is kept hidden and reused for five minutes after its first
  open, so toggling it during a session is near-instant and its controller
  polling pauses while hidden. The first library scan of a session also serves
  cached data immediately instead of waiting for every cover and description,
  so the grid appears fast.

### Removed

- `watchdog/util/toastAudio.js`, orphaned since the toast transport stopped requiring it.
  Nothing in the app or the Watchdog referenced it any more, so it was dead weight in the
  packaged build.

### Changed

- The watchdog status line no longer calls the delivery "Windows notifications": the
  transport can be a toast, the in-game overlay or both, so the wording now covers all three.
- Dropped the unused **In-game overlay** and **Guide** settings side-menu strings, which no
  longer have a tab, from all 18 locales.
- The documentation and screenshots were refreshed: the first-run guide, custom theme editor,
  controller tab, custom notification-preset builder and the Emulator & tools context menu are
  now shown, and the emulator-setup guide describes where the `steam_settings` repair actually
  lives (a button on the diagnosis report, not a context-menu entry). The auto-fix setting is
  documented as disabled by default, which is what it has always been.
- The documentation now reads as an ordered path: the index numbers the seven user guides and
  every page ends with a link to the next one. The controller guide became the single source of
  truth for gamepad control - the overlay guide's duplicate copy of it (which still documented
  the old two-button **Back + Start** overlay toggle, replaced by **Back + Start + LB**) is now
  a short summary that links to it. The controller guide also documents what was missing: app
  navigation being on by default while overlay control is opt-in, the LB/RB page scroll outside
  Settings, the backend selector, that shortcuts may deliberately share a button, and the
  `[controller] debugLogging` flag for bug reports. Notification sounds are listed as
  `.wav/.mp3/.ogg/.flac/.m4a/.aac`, the three formats added later having never been documented.

### Fixed

- A game whose cached Steam schema resolved a name but no achievement list stayed empty for
  good: the cache has no expiry and only the name was ever tested, so a fetch that reached the
  store page but not the schema froze the game at zero achievements. Such an entry is now
  re-checked at most once a week, and the check is stamped on the record so a game that
  genuinely has no achievements is not looked up again on every scan. A re-check that cannot
  run - offline, rate-limited - hands the cached entry back untouched instead of dropping it.
- The settings and per-game configuration modals are now inset below the custom title bar,
  and the settings side navigation scrolls on its own. On short windows its 14 entries used
  to stretch the modal past the viewport and drag it off-screen.
- Notification artwork now prefers the high-resolution Steam art already cached by the app
  (schema, store and SteamDB covers) instead of the predictable CDN URLs, which 404 on newer
  titles whose assets live under hashed `store_item_assets` paths - the playtime/launch icon
  was falling back to Steam's 32×32 clienticon (e.g. Assassin's Creed Black Flag Resynced).
  Playtime toast icons are then center-cropped to a square, as the Windows toast logo slot
  requires.
- Native select dropdown popups now use the Settings surface palette instead of the app
  window background, so the Custom theme no longer paints every open menu with its
  `bg` layer color.
- The title-bar separator, drop shadow and window-control button backgrounds are now
  much more transparent, so no square or line stands out under the settings, minimize,
  maximize and close buttons anymore.
- The playtime monitor no longer logs `No entry found for ...` on every process creation:
  unknown processes are now reported once per name, so background helpers no longer flood
  `playtime.log`.
- A Ubisoft Connect metadata seed could wipe the detected game executable from
  `cfg/gameIndex.json`, silently disabling playtime tracking for official Ubisoft titles.
  Metadata-only seeds no longer overwrite the binary, name or icon a scan already found.
- The Watchdog now reloads its playtime game index when the app finishes a library scan, so
  a newly added non-Steam game is tracked immediately instead of only after a Watchdog
  restart.
- The Watchdog now uses the synchronous regodit API for its remaining registry
  reads (Documents-folder lookup and controller-rumble settings), closing the
  same koffi crash path that was already fixed for playtime registry writes.
- The default **Overlay control** (LB+X) and **Move & scroll** (LB+RB) controller combos
  shared the Left Shoulder button, so holding all three buttons at once triggered both
  actions together; the interface-navigation toggle now yields to move/scroll mode when
  both combos are held.
- The default overlay open/close combo is now **Back + Start + LB** instead of just
  **Back + Start**, which sat close enough together that some pads could trigger it by
  accident; new setups get the safer three-button combo, existing custom bindings are
  unaffected.
- The "never send Escape to Achievement Watcher's own window" controller safeguard did not
  protect the main window on a fresh launch, since the window did not exist yet when the
  Watchdog first started; it now updates the moment the window is created.
- A duplicated button in a custom controller binding (e.g. the same button picked twice)
  was accepted by the app but rejected by the Watchdog, which silently fell back to the
  default combo instead of the one shown as saved in Settings.
- A DualShock 4's analog-stick drift/quantization correction only applied when the app used
  the GameInput controller backend; it now applies for the XInput backend too.
- Removed stale controller help text describing a window move/resize mode that no longer
  exists.
- 16 of the 18 bundled locales showed the in-game controller hint ("Open: Back + Start ·
  ...") in English instead of their own language.
- Owned Steam games could stay marked "installed" forever after being uninstalled: Steam's
  own per-app registry flag can go stale (a folder deleted outside Steam, or an interrupted
  "move install folder" that leaves the manifest pointing at a path that no longer exists),
  and the "show installed games only" filter trusted it unconditionally. It is now
  cross-checked against Steam's own library manifests on every scan, the actual source of
  truth Steam itself uses.
- A folder name that merely contained a game's title as a substring (e.g. a generic
  "Content" or "Fallout" folder elsewhere on disk) could satisfy a much longer owned title
  ("Content Warning", "Fallout New Vegas") and wrongly resolve it to an unrelated install,
  also contributing to games appearing "installed" when they were not.
- Source-engine games (Garry's Mod and others) could have their tracked launch executable
  auto-set to a bundled SDK/dev tool (e.g. `elementviewer.exe`) instead of the real game
  binary, because those tools sit next to the emulator DLL and can be larger than the actual
  launcher exe. The known Source SDK tool names are now excluded from executable detection.
- Clicking "Check for updates" again while an accepted update was still downloading called
  `checkForUpdates()` a second time mid-download, re-firing the "update available" prompt and
  stacking a second `downloadUpdate()` on top of the running one - which is what corrupted the
  download. The check is now refused with an "Already downloading…" status while a download is
  in progress. The download itself was also silent for minutes at a time (the taskbar progress
  bar needs a visible window, which the resident tray daemon usually doesn't have): the
  Settings and footer update-status labels now show live "downloading update NN%" text instead.

### Performance

- Locating an emulator's local achievement schema no longer walks the whole game install on
  every scan. The handful of directories an emulator actually writes those files to are probed
  first, and the outcome - including "not here", which is the answer that used to cost a full
  synchronous six-level walk per game - is remembered. Both layouts are probed before anything
  is walked, so a non-TENOKE install no longer pays a complete walk just to prove `tenoke.ini`
  is absent. The memo is dropped when the app writes a schema itself or the library is
  refreshed, so a hand-added schema is still picked up at once.
- The playtime monitor no longer logs every process it does not recognize; on a busy machine
  most running processes are not games, and the log filled with them.
- The library skips rendering off-screen game tiles, so cover images stay undecoded until
  they scroll into view, and the renderer frees its decoded image/font/code caches when the
  window hides to the tray. The V8 heap ceiling is also lowered to 192 MB and Chromium's
  unused video-decode path is disabled, trimming resident RAM across the app processes.
- Skeleton tiles now animate with a GPU-composited shimmer instead of repainting a moving
  background, and the library scan progress bar eases instead of moving at a fixed linear
  rate, so both loaders feel smoother during refreshes.
- Notification artwork lookups (Steam header/portrait) are now cached per source file
  instead of re-reading and re-parsing the same store/SteamDB JSON from disk for every
  achievement processed in one scan.
- Controller bindings are now normalized once per settings change instead of on every
  poll tick (up to ~60 times a second per connected controller).

### Security

- The Epic account login no longer injects the redirect URL into an `executeJavaScript`
  script body. The redirect endpoint is fetched from the main process with the login
  window's own session cookies, closing the CodeQL "improper code sanitization" finding.

## 3.8.4 - 2026-08-11

### Added

- RLD! and CreamAPI emulator save roots are watched automatically (Public Documents and AppData
  for RLD!, AppData for CreamAPI), and user-added folders that carry a GOG `.info` or UniverseLAN
  configuration keep their dedicated watcher instead of falling back to a generic numeric scan.

### Fixed

- The in-game notification overlay now sits 6 px from the chosen screen edge instead of 12 px.
- Reloading the library no longer shows a single fast-loading game alone for seconds: skeleton
  tiles fill the grid while games stream in, and the folder index used to resolve installs by name
  is built once per scan instead of once per parallel worker. The shimmer stays fluid on every
  theme instead of pulsing in hard bands.
- "Recently played" sorting works again. The Watchdog's async registry writer crashed under the
  bundled koffi runtime after storing `total`, killing the Watchdog before the `last` timestamp was
  written. Playtime tracking now uses the synchronous registry API, so games played since 3.8.3 get
  a real last-played date.
- The automatic emulator fix no longer applies to a folder that no longer contains a real game
  executable, so uninstalling a game while a background repair is running no longer recreates the
  folder or fires a misleading "ready" notification.

## 3.8.3 - 2026-08-11

### Fixed

- Automatic emulator fix no longer overwrites `steam_api(64).dll` on a game already made to work by
  a crack loader that hooks that DLL in place instead of replacing it (OnlineFix confirmed). Doing so
  broke the loader's own Steamworks/EOS emulation on the next launch (an activation prompt or an
  `EOS_Connect_CreateDeviceId` failure), even though the game worked before Achievement Watcher
  touched it. The manual "Apply emulator fix" menu action still allows a deliberate override.
- Steam API Check Bypass no longer silently fails to download or refresh its proxy DLLs: the RAR
  extraction used to run inline in the renderer process, which its strict Content-Security-Policy
  always blocked; it now runs in the main process, matching how the community-fix downloader already
  handles the same restriction.

### Security

- Hardened string sanitization flagged by CodeQL code scanning: a stable tag-stripping pass now
  loops until the string stops changing, closing a bypass a single regex pass could miss on
  overlapping tags, and theme/preset CSS `url()` values are built through the existing
  backslash-safe helper everywhere instead of a duplicated one. The Exophase image-proxy host
  check now requires an exact or subdomain match, and line-separator characters are stripped
  before the Epic login redirect URL is spliced into injected page script.

## 3.8.2 - 2026-08-11

### Fixed

- A Goldberg/GBE install whose configuration lives in a nested engine folder (Unity's
  `_Data/Plugins/x86_64`, Unreal's `Binaries/Win64`, ...) no longer resurfaces as a second,
  artwork-less "Unconfigured" tile, and the real game executable is now attached to the
  already-tracked game instead of being missed. A same-folder loader or launcher (for example a
  second Uplay R2 loader shipped by a repack) can no longer outrank the actual game executable
  during automatic detection.
- Xbox PC polling cannot overlap itself or apply a delayed result after the tracked game changes,
  avoiding stale achievement notifications and state updates.
- Xbox PC imports now retain their unlocked/progress state, including achievements marked secret by
  the normal boolean Xbox API flag.
- Legacy GOG and Epic discovery tolerates absent or corrupt mapping caches, GOG-only releases and
  temporary Epic mapping outages without hiding other locally discovered games.
- Achievement rarity rendering handles names containing selector-special characters and still
  updates every duplicate rendered row.
- A failed Chromium startup releases its Steam scrape lease, library rescans preserve the game-view
  click behavior, and detached overlay/custom-action launches fail safely instead of taking the
  Watchdog down.
- Restarting the Watchdog while a game is already running restores activity, overlay and Xbox
  polling state without generating a synthetic launch notification.
- A slow Windows notification-state query no longer starts its cache lifetime before its result
  arrives, avoiding repeated PowerShell calls on a busy machine.
- Partial hand-edited Watchdog configuration files are completed without discarding valid or
  unknown sections.
- Manually unlocked achievements are applied while the library rebuilds, so their tile and profile
  completion remain correct after restarting the app.
- The development window once again loads the profile avatar and presents visible Settings,
  minimize, maximize and close controls reliably on high-DPI displays.
- The Watchdog no longer depends on a native WQL callback that could crash on startup on some
  Windows systems; process tracking now starts reliably and recognizes games already running.

### Changed

- High-frequency schema, discovery, process and renderer lookups use scoped indexes or snapshots,
  reducing repeated scans without retaining extra long-lived UI state.
- Main-window chrome, progress tracks and settings status surfaces now inherit the selected theme
  instead of retaining fixed Steam-blue colors. The NSIS welcome/finish banner is regenerated from
  the 256px app logo, keeping the installer emblem sharp.

## 3.8.1 - 2026-08-11

### Added

- Every section of the Settings panel folds away under its own header, with a chevron that points
  down when open and sideways when closed. Each section remembers its state, so a tab can be kept
  reduced to the few sections actually being used. The **Custom preset** builder - the largest
  section, and the one needed least often - starts closed. Searching still looks through closed
  sections, so a match is never buried in one.
- Presets made in the builder can be deleted from it. It could only ever add to the preset list, so
  a throwaway attempt had to be removed from Explorer. Only presets the builder generated can be
  deleted - bundled and hand-written ones are refused.
- **Find a community fix** is offered for Ubisoft installs too, and now names its source
  (**CrakFiles**) so it can be found. The list is matched by game name and a fix is just files
  dropped into the install folder, so nothing about it was ever Steam-specific - the entry simply
  sat inside the Steam-only branch of the menu.
- Uplay R2 setups can restore the snapshot taken before the last repair. Every repair already saved
  one; nothing could read it back, which is most of why that submenu looked so much thinner than the
  Steam one.
- The custom notification-preset builder can now reopen a preset it made. Every generated preset
  stores the settings that produced it, so **Edit a preset** loads its colours and sliders back into
  the builder and the button becomes **Update preset** instead of silently replacing the old one.
- **Preview** renders the design being edited as a real overlay popup, at full size and with the
  configured position, scale and animation - without saving it first, so trying ideas no longer
  fills the preset list with throwaway attempts.
- The builder gained a **Width** control for the popup, and each slider now shows its value.
- Downloading an update drives the taskbar progress bar. The download starts once the prompt is
  answered and then says nothing for as long as it takes; the app is a resident tray daemon, so the
  window is usually closed and the next visible sign was the "install now?" box minutes later. The
  progress is re-applied if the window is opened mid-download, the tray tooltip carries the same
  figure while there is no window to draw on, and the log records one line per 10% with the rate.

### Changed

- Every theme carries its own success, warning and danger hue. The Steam-login and Epic-account
  cards and their badges were pinned to one hardcoded amber and stayed Steam-blue-tinted under
  OLED, Dracula, Nord, Gruvbox and Tokyo Night; they now recolour with the palette.
- The **Rescan selected folders** card is an ordinary settings section, with the same frame, header
  and hairline as every other card, instead of its own accent-washed frame.
- The profile stat pills and the empty-library panel follow the theme. Both were painted with fixed
  Steam-blue values and stayed blue under every other palette.
- A card's primary action is accented again. The panel's neutral button fill was more specific than
  the primary style, so the one action meant to stand out in a card rendered exactly like the plain
  buttons next to it.
- A window closed while it was still starting no longer breaks the next one. The main process gates
  "ready to show" on a one-shot handler that is only unregistered when it fires, and registering it
  a second time throws - which would have taken the whole window creation down with it. The
  watchdog-status handlers are also guarded against arriving before the title bar exists.
- The **EA Desktop** source now reads "Read EA Desktop's local achievement log (for games outside
  EA's managed folders)".
- The onboarding's recommended-settings step points at how to find things afterwards: the search box
  at the top of the panel, the foldable sections, and the Help tab.
- Every launch writes a `[diag]` block to the log - versions, install and data paths, how the app
  was started, language, theme and the geometry of every display - followed by a `[MainWindow]` line
  each time the window is shown, moved, resized or closed. It is the block to paste into an issue.
- Testing an overlay notification no longer blacks out the screen. The popup is its own
  always-on-top window and never needed the fullscreen backdrop that stood in for a running game -
  all it did was hide the settings panel whose presets you were comparing, for several seconds per
  click.

- The installer shows what it is doing again. The status line above the progress bar was blank and
  the details pane empty for the whole install, including the steps the installer prints itself -
  closing the background monitor, and the settings folder it preserves. The build now keeps NSIS's
  default reporting instead of suppressing it.

### Fixed

- The custom notification-preset builder can save and preview at all. Both wrote the generated
  preset into the app's own `presets` folder, which is packed inside `app.asar` once the app is
  installed - an archive file, not a directory - so creating a folder in it failed with `ENOTDIR`
  and **Preview** and **Save** did nothing on an installed build. Only a development run, where that
  path is a real directory, ever worked. Generated presets now live in
  `%APPDATA%\Achievement Watcher 3.0\presets\Users Presets`, next to imported sounds and user
  themes: always writable, and no longer discarded by an update or an uninstall. The bundled preset
  libraries are still read from the app, and a generated preset is looked up first, so saving under
  a bundled name shadows it rather than being ignored.
- The layer controls in the custom theme editor stop sliding left. Switching an effect on and then
  off hides its two sub-groups, which shrank the collapsed panel enough for it to fit back on the
  controls' line - a collapsed panel has no height but still had a width - and the whole colour /
  gradient / effect block jumped 130px toward the middle of the row.
- **Launch game** and **Configure executable…** are offered for every game, not only Ubisoft ones.
  Both entries were built inside the Ubisoft branch of the right-click menu, so a Steam, GOG, Epic
  or emulated game could not be started from it even with its executable already configured - while
  the tile's own play button, which runs the very same code, worked fine.
- A manual unlock raises the game's percentage straight away. The tile and the profile counters are
  accumulated while the library is scanned and nothing recomputed them afterwards, so the library
  kept showing the figure from the last full scan. Clearing a manual unlock now also takes the
  unlock back: the marker was removed but the achievement stayed unlocked until the next rescan. An
  unlock the save itself reported is never undone.
- Scanning the library shows a busy pointer, so a long scan is not mistaken for a frozen window.
- Log files are no longer shredded by a second launch. They were opened truncating, and the stream
  is created before the single-instance check - so starting the app while it was already running
  emptied the running instance's log, which then kept writing at its old offset and left a hole of
  NUL bytes over everything before it. A crash was also erased by the very next launch. Logs now
  append, mark each run with a session line, and rotate at 2 MB.
- Notification presets no longer clip their own artwork: the Xbox Series family cut off its laurel
  wreath, and the progress row was drawn at full width while the popup was still expanding, so it
  hung outside the pill. Sunset, Batman and TigerDX Award were clipped too.
- The window buttons cannot stack on top of each other. They sit in a shrink-to-fit row that wrapped
  once the available width got small enough - reachable on a display/scaling change.
- A community fix is no longer proposed for a different game in the same franchise. Ranking scored
  "Assassin's Creed: Mirage" above the match floor against "Assassin's Creed Black Flag Resynced" on
  the words the whole franchise shares, so an unrelated fix was offered as found. A candidate that
  carries a distinguishing word the game's name never mentions is now rejected; repack tags and
  re-release words in the local name still match.
- Uninstalling a game shows that it is working. Running the uninstaller and moving a folder to the
  Recycle Bin both take time and left the tile looking untouched; they now use the same spinner as
  the emulator fix, cleared on success, on failure and on a launch error alike.
- Update prompts no longer interrupt a game. The dialog is modal and has no parent window, so it
  landed on top of whatever was on screen, fullscreen sessions included. The background monitor now
  tells the app how many games are running, and while any are, the check is skipped entirely - no
  dialog and no network. The offer comes back shortly after the session ends, and a download that
  finished mid-session re-opens its own "install now?" prompt rather than asking about the download
  again. Nothing is recorded when a prompt is only held back, and an explicit **Check for updates**
  always answers immediately.
- The update prompt stops nagging. Answering **Later** recorded nothing at all, and the app - a tray
  daemon that stays resident and re-checks every hour - reopened the same dialog an hour later, and
  every hour after that. **Later** now silences that version for a day; **Skip this version** stays
  permanent; neither ever hides a newer release, and **Check for updates** in Settings overrules a
  postpone. Declining the "install now?" prompt is remembered too, instead of coming straight back
  through a re-download on the next check.
- Two update checks landing together can no longer stack two dialogs. Both prompt handlers tested
  their "a prompt is already open" flag, then awaited, and only then set it - so the hourly check
  racing the Settings button walked past the guard twice. Answers are also written to disk before
  the handler moves on, so a "skip" or "later" is not lost if the app closes right after the click.
- **Start with Windows** stays on. Windows' login-item query matches the registered command line
  against the running build, so it answers "not registered" whenever the two drift apart - after an
  update that moved the executable, or in a development run - and opening Settings adopted that
  answer, flipping the setting to No and persisting it on the next save. The saved preference now
  wins and is re-applied to Windows when the two disagree.
- Hidden games are listed by name instead of a bare App ID. Names are resolved from the app's own
  game index and cached game data first - the only local sources that cover non-Steam entries - then
  from Steam for anything left, and the answer is remembered. A game hidden from the right-click
  menu also records its name before it is dropped from the index. A local install whose id is a hash
  of its folder is traced back to that folder, which is the only thing that can still name an entry
  hidden long before names were recorded.

## 3.8.0 - 2026-08-10

### Added

- Folder settings can now rescan only the selected save/config or game-library locations. Entries
  found outside that selection stay in the library, while the selected disks are the only ones read.
- Help now includes direct, localized shortcuts to the Folders, Sources and Notifications settings,
  so the most common setup and troubleshooting steps are one click away.
- Achievement toasts can be marked urgent, which is the only way Windows 11 (22H2 and later) puts a
  notification on screen while Do Not Disturb is on - including the automatic "playing a game" and
  "app in full screen" rules that make an in-game unlock invisible for a whole session. It is off by
  default and available as **Priority notifications** under **Settings → Notification**. Windows asks
  once, per app, before honouring it and keeps the answer in Settings > Notifications, so nothing is
  escalated behind the user's back. Playtime and progress toasts are never marked urgent.
- Right-click → **Folders** keeps only the game installation, achievement-data sources and caches,
  grouped into short submenus instead of one long flat list.
- The Sources tab now has a switch for every source the scanner reads. Ubisoft Connect, GOG Galaxy,
  Epic Games, the Nemirtingas GOG/Epic emulators, shadPS4 and Xenia were all on by default with no
  way to turn them off short of hand-editing `options.ini` - which is why a Ubisoft entry could not
  be hidden through the interface (issue #20).
- The in-game overlay has a close (×) button in its header, next to the options gear. The overlay is
  a frameless always-on-top window with no system title bar, so closing it previously meant pressing
  the hotkey again. `Escape` closes it too, after first dismissing the options panel and the search.
- The launch panel now auto-fills game executables after every scan: Steam installs are matched to
  their `appmanifest`/`libraryfolders.vdf` folders, GOG Galaxy launch tasks, Epic manifests, EA
  Desktop logs and Xbox configs provide the exact launcher exe, and every other known install folder
  is detected with a conservative confidence gate (single plausible exe, strong name/folder match,
  or Steam-dll adjacency). Ambiguous folders stay empty for a manual pick - no guessing - and a
  manually configured exe is never overwritten.

### Fixed

- The background monitor is supervised again after a manual restart. Restarting it from the tray
  or Settings while an automatic respawn was already queued left the supervisor believing a
  respawn was still pending, which silently disabled it for the rest of the session: the next
  crash ended achievement notifications and playtime tracking until the app was restarted.
- Cover art falls back correctly when a download fails. A failed fetch was reported to the
  interface as a successful one, so the portrait/header fallback never ran and the tile stayed
  blank; **Use another Steam AppID…** could also save that failure as a permanent cover override
  instead of warning that the AppID has no art.
- Covers, achievement icons and game backgrounds no longer disappear when their path contains an
  apostrophe or parentheses - an ordinary game folder ("Assassin's Creed", `Program Files (x86)`)
  or a Windows account name with an apostrophe was enough to drop the image silently.
- Per-game launch arguments keep quoted values intact. `-savedir "D:\My Games\Save"` reached the
  game with the quotes still attached, so the path did not resolve; an unmatched quote no longer
  makes the play button do nothing either.
- Epic backgrounds are blurred and tinted again. The image was fetched through an API the bundled
  runtime does not provide, so the step failed on every game and the error was swallowed.
- Scanning Epic games no longer freezes the interface. Looking up a title's Steam AppID and its
  artwork blocked the whole window for up to 30 seconds per game - several minutes on a first
  scan - and artwork requests are now time-boxed instead of hanging on an unreachable network.
- Saving settings twice in quick succession no longer leaks file watchers in the background
  monitor.
- Links are only opened in a browser when they are web addresses. In-app navigation and the links
  carried by CrakFiles community-fix entries - which come from a remote catalog - were both passed
  to Windows as-is, which would launch whatever program is registered for the scheme.
- Updates signed with the local Shirow certificate no longer fail on PCs that do not trust that
  self-signed root. The updater verifies the matching publisher name and the release SHA-512
  manifest instead of showing the misleading “not signed by the application owner” error.
- In-game notification popups now use the real dimensions of the selected theme and scale before
  anchoring. Every preset is kept inside the active monitor's work area - including custom saved
  positions - so bottom/right choices stay bottom/right and oversized themes shrink to fit instead
  of being clipped off screen.
- Native Windows notification artwork is square; playtime cards use the game logo in that compact
  slot and always show the game's wide header above their message.
- Standalone notification tests now prefer Achievement Watcher's registered Windows identity,
  instead of unnecessarily displaying under Xbox Game Bar.
- Overlay notifications now retain the achievement name and type when Windows case-folds the
  Watchdog command-line arguments during its hand-off to the resident app.
- The Priority notifications setting now shows its warning icon on the bundled Font Awesome 5
  version and follows the active theme like the other notification preferences.
- Updated transitive `js-yaml` packages to 4.3.1, removing the known high-severity YAML parsing
  vulnerability from the updater and release dependency tree.
- Hiding the main window to the tray now stops its renderer-side gamepad polling. Electron does not
  consistently expose `BrowserWindow.hide()` through the page visibility API, so the main process
  now sends the actual show/hide state to the renderer. This removes needless background CPU work
  while keeping controller navigation responsive when the window is shown again.
- The Settings notification test finally shows a Windows toast. It never did: the payload grouped
  toasts by game with the appid as-is, and the test's appid is a number, while powertoast accepts a
  group only when both its id and title are non-empty strings. Given anything else it stored a null
  group and then dereferenced it, throwing before the toast was ever shown - and the failure landed
  in the tray-balloon fallback, so the test reported success, the gamepad still rumbled, and the
  only symptom was that nothing appeared. That is exactly how it was reported (issue #18). The id is
  now coerced and a game with no resolved name loses its grouping rather than its notification, so
  unnamed entries can no longer swallow a toast either. The test also logs the underlying failure
  instead of falling back silently.
- Windows full-screen and quiet-hours detection works at all. `SHQueryUserNotificationState` was
  read through `Add-Type -AssemblyName shell32`, which is not a real assembly: PowerShell wrote two
  errors to stderr, left the state at 0 and still exited 0, so the reader parsed "0", matched no
  state (the enum starts at 1) and returned null on every Windows machine - without ever reaching
  its error handler. Both callers therefore always answered "no". The state is now read with a real
  `DllImport` and its `HRESULT` is checked, so the Watchdog log finally reports when Windows is
  swallowing achievement toasts (issue #18), and an unreadable state is warned about once instead of
  failing silently forever.
- The overlay hotkey stays in step with the overlay however it was closed. The app reported closes
  only from the × button, so any other way the window went away - Escape, the game-changed reopen,
  an external close - left the Watchdog's flag stale and the next hotkey press sent the wrong
  request. Open and close are now both reported from the overlay window's own lifecycle events.
- The main process no longer logs "opening overlay window" for requests that open nothing: an
  incoming close or refresh was announced as an open before the decision was even taken, which made
  issue #19 look like it was still happening long after it was fixed.
- The playtime monitor's muted-path filter compares Windows paths correctly regardless of the host
  separator, and no longer builds paths from an unset `SystemRoot`.
- Disabling the display of official Steam games now also hides a Steam purchase that launches
  Ubisoft Connect (e.g. Far Cry 4). Such an entry is read through the Ubisoft source, so no filter
  applied to it. Two generic signals now identify one: the configuration blocks naming Steam
  (`third_party_platform`, or a storefront-only sibling block) and an install registered inside a
  Steam library (`steamapps\common`). No per-game data is involved (issue #20).
- The Settings notification test no longer breaks the very thing it tests: it opened a fullscreen
  backdrop right before firing the Windows toast, and Windows turns on do not disturb by default
  while an app is in full screen, so the toast was accepted and then never shown. The backdrop is
  now only used for the in-game overlay test, which is what it was for. This is also why achievement
  toasts appear to vanish in-game while playtime ones (fired after the game exits) always show up
  (issue #18).
- The overlay no longer opens by itself after a game exits. The Watchdog asks the app to close the
  overlay on every game exit; with no overlay open that request fell through to the open path and
  popped the overlay onto the desktop. Close and refresh requests now only ever act on a window that
  is already there, and the Watchdog only asks for a close when it believes one is up (issue #19).
- Ubisoft Connect titles bought on Steam no longer need a per-game row in the uplay↔Steam mapping
  asset: the cached achievements archive's own spec name (`971_FarCry4` → "far cry 4") is now a
  resolution candidate when the registered install folder is unavailable and the configurations
  index has no usable title. The game resolves through the same generic chain as before - mapping
  asset by title, installed Steam library, then Steam catalog - and the Steam release's canonical
  name wins for display. This replaces the 3.7.0 per-product id row for Far Cry 4 (uplay 971),
  which has been removed (issues #7/#14).

## 3.7.0 - 2026-08-06

### Added

- The custom theme editor has a per-layer "Gradient" editor (surface layers only): pick the two
  colors and the direction (0/45/90/135/180/270°) freely, with a live preview, and the gradient is
  applied in the app and the in-game overlay. The old single-toggle gradient is still imported
  automatically as a dark fade of the layer color.
- Right-click → "Choose another cover…" opens a themed gallery with the current cover, the SteamDB
  library assets and up to eight SteamGridDB community grids; clicking one applies it as the
  per-game cover override. The gallery matches the library orientation (vertical 600×900 covers in
  portrait view, wide 920×430 covers in landscape view).
- SteamGridDB now uses the bundled public API key only (the optional per-user key handling was
  removed).
- Unconfigured installs are named from the exe's own FileDescription/ProductName when the folder
  name is meaningless (repacks that rename folders to "Game123" no longer show that garbage).
- Cross-source duplicate merge ("merge duplicate games"): a Ubisoft Connect product mapped to an
  already-listed Steam release (e.g. product 66088 → Steam 3751950) is merged into one tile with
  both unlock sources instead of showing twice.
- SteamGridDB cover fallback (optional per-user API key, bundled public fallback otherwise), used
  when neither the guessable CDN path nor SteamDB has a portrait.
- GOG Galaxy database reads now retry transient WAL lock failures ("unable to open database file")
  instead of dropping the whole source from a scan.
- SteamDB cover scrapes are serialized through one queue, so a cold first scan no longer opens N
  parallel browser pages that can each stall for 45s.
- Local Ubisoft launcher cover extraction (header/background/icon) for products whose Steam release
  cannot be resolved.
- Drive/profile library probes now run in parallel.

### Fixed

- In-app updates no longer fail with "App is not signed" on intentionally unsigned releases: the
  signature verifier now accepts a file with no Authenticode signature (the release feed's SHA-512
  still authenticates it) and keeps rejecting only a signature that belongs to another publisher.
- The game-page header icon is reset to a neutral placeholder when the opened game has no artwork -
  it no longer keeps the previous game's icon, which made the page look like it belonged to
  another title (issue #15).
- A Steam purchase that launches Ubisoft Connect now resolves again when its registered install
  folder is unavailable: the Steam-variant Far Cry 4 product id 971 was missing from the
  uplay↔Steam mapping asset, so the entry degraded to "Ubisoft 971" with an empty poster
  (issue #14). It now maps to Steam 298110 like the other Far Cry 4 variants, with regression
  tests on the mapping and identity-resolution layers.
- The playtime monitor no longer crashes the Watchdog when a muted-path entry is an unset
  environment variable (e.g. `ProgramFiles(x86)` on 32-bit Windows); the path filter also uses
  boundary-aware, separator-normalized matching instead of a raw prefix check.
- The Watchdog no longer fails to start when `options.ini` has a missing or partial `[overlay]`
  section: the hotkey and notification-sound defaults now match the app-side loader.
- A busy WebSocket port no longer crash-loops the Watchdog - it logs the error and keeps
  notifications working without the websocket broadcast.
- The `fetch-icon` IPC handler now returns `null` on failure like its synchronous twin, instead
  of surfacing an unhandled rejection to the renderer.
- Removed dead Watchdog code: the never-called `getFoldersLuma` registry walker (which referenced
  an undefined logger) and the stale `exeList.json` reader that nothing consumed.
- An enabled per-layer gradient now replaces the layer's base color entirely, in the app and in the
  in-game overlay - previously the base color/backdrop was still painted over the gradient. Layer
  images keep rendering above the gradient. The base color is fully cut: no translucent tint of it
  remains over the gradient.
- The watchdog status dot no longer pulses forever once the watchdog is running: the pulse only
  plays while the watchdog is starting/checking, which removes a steady ~100% GPU-core burn on
  some machines.
- Playtime tracking now starts before the toast/controller services initialize COM security, so the
  watchdog no longer loses it to an `RPC_E_TOO_LATE` failure at startup.
- Gradients now size correctly when combined with a layer image (the gradient stretches over the
  whole layer, the image keeps its own fit/repeat), and enabling a fresh gradient follows the
  layer's color instead of falling back to a fixed default.
- "Merge duplicate games" now also drops a same-name Steam save phantom when a GOG Galaxy entry
  exists for the same game - Cyberpunk 2077 no longer appears twice (stale CODEX/Goldberg save +
  real GOG copy). Genuinely installed Steam copies are still kept.
- The "Choose another cover…" gallery opens reliably again: a scope bug (wrong variable reference)
  could abort it before the modal appeared, and the modal is now shown before the cover fetch so a
  failed lookup always leaves a visible state.
- The cover gallery never hangs: picking a cover is bounded by a 15s download timeout and falls
  back to the remote URL when a CDN stalls (previously the click could silently do nothing).
- SteamDB is only queried for real Steam releases - a non-Steam id (GOG/Xbox/local) no longer
  triggers a pointless 45s SteamDB scrape that delayed the gallery.
- Games without cover art are checked against the network again on every scan, as before - the
  temporary "fast-scan" skip that cached those lookups for a week was removed.
- A stale "configure executable" entry pointing at a known non-game program (e.g. R.exe from IBM
  SPSS, Steam's streaming_client.exe, DiskSpd64, Dolphin) no longer marks a game as installed -
  this is what made The Last of Us Part II appear installed after it was uninstalled.
- The "download icons" emulator setting no longer falls back to a missing locale path (its label,
  description and option values were already fully translated under `settings.emulator`).
- Well-known non-game executables (browsers, chat/office apps, system/driver tools, storefront
  launchers, …) are no longer offered as "Unconfigured" games even when a library folder happens to
  contain them.
- Windows uninstall-registry `InstallLocation` folders are no longer auto-scanned: the filter was
  too loose and surfaced every installed application (browsers, drivers, Docker, …) as a game, plus
  stale folders of uninstalled games. User-created library folders remain fully supported.
- A Ubisoft Connect game whose product id has no direct uplay→Steam mapping row no longer shows as
  "Ubisoft <id>": storefront variants resolve through the installed product's own
  `uplay_install.state` or a mapping-by-name fallback, and Assassin's Creed Black Flag Resynced
  (Ubisoft product 66088, the Steam variant) is now mapped to its Steam release (3751950).
- Ubisoft Connect games are kept by the "Show installed games only" filter when the launcher
  registry proves they are installed - previously the Ubisoft 66088 entry disappeared as soon as
  the filter was enabled.
- Ubisoft games resolved to a modern Steam release get their real portrait via the SteamDB cover
  fallback, so vertical (portrait) view no longer shows blank tiles for covers that live under a
  hashed CDN path.
- Steam games (including cracked/Goldberg installs) whose portrait is a dead guessable URL or
  missing from the product info now recover the real hashed capsule through SteamDB at load time
  (e.g. Yakuza 0 Director's Cut), and the library grid falls back to the header when no portrait
  exists instead of rendering a blank tile.
- SteamGridDB cover lookups require an exact or token-level title match - an unrelated first
  autocomplete result is never used as a cover.
- Generic executable descriptors ("Installer", "Launcher", "Application", …) are ignored when
  naming an unconfigured install; the folder/exe name is used instead.
- Legit launcher installs (Ubisoft Connect, GOG Galaxy, Epic Games, Microsoft Store) are no longer
  surfaced as "Unconfigured" games or mis-promoted as Uplay R2 emulated installs, no matter which
  folder they live in (custom library roots included). A genuine Uplay R2 crack (launcher markers
  plus the emulator loader dll) is still detected and promoted as before.

### Changed

- The custom theme editor and cover gallery are now responsive at small window sizes: every theme
  layer row stacks on two clean lines (preview + label on top, controls right-aligned below) under
  980 px, and the cover grid shrinks its tiles instead of overflowing.
- In the custom theme editor, a layer's base-color picker is disabled while its gradient is enabled
  (the gradient replaces it) and re-enabled when the gradient is turned off; it stays in place so
  the row controls never shift.
- The Windows "reduce motion" accessibility preference now disables decorative animations across
  the whole main window (status indicator, rare-achievement rays, spinners), not only in Settings.
- The "Choose another cover…" gallery now uses the shared modal chrome and global theme tokens
  (surfaces, borders, accent, fonts and radii) instead of its own inline styles, and exposes proper
  dialog/aria attributes.
- Installed-game folder detection now merges smart-discovered library roots on every scan (common
  neutral folder names on all drives - Games/Jeux/Juegos/Spiele, Games Library/GameLibrary,
  Repacks, plus GOG Games and Epic Games as before) without requiring the user to add them in
  Settings. Launcher-managed install roots (Ubisoft Game Launcher/games, GOG Galaxy, Origin/EA,
  Epic Games under Program Files) are deliberately NOT auto-added: they contain legit launcher
  games that the official sources already cover, and scanning them would surface duplicates as
  "Unconfigured" entries.
- The unconfigured-install scan also looks inside library-like Desktop subfolders (e.g.
  Desktop\Jeux\<game>, Desktop\Games\<game>) so nested installs are found, while loose Desktop
  folders/shortcuts are still ignored. The name-based folder index follows the same rule.
- Per-user game libraries are probed too: portable/repack installs under
  %USERPROFILE%\Games/Jeux, %APPDATA%\Games/Jeux and %LOCALAPPDATA%\Games/Jeux (library-like
  names only - the raw AppData roots are never scanned, so application config stays out of the
  game list).
- Library-folder name detection now understands localized names in many languages (Игры, Jogos,
  游戏/遊戲, ゲーム, 게임, Hry, Gry, Oyunlar, Játékok, Jocuri, Spellen, Pelit, Trò chơi, …) for
  drive-root probes, profile/AppData roots and the Desktop subfolder expansion.

### Removed

- The dedicated "Playtime scale / size of playtime popups" option in the notification settings -
  playtime popups now always use the main notification scale.
- The Windows installer now shows installation/uninstallation progress details by default, uses
  refreshed Steam Blue header/sidebar artwork (also on the uninstaller), and explicitly creates
  the Start Menu and desktop shortcuts. Installer images are generated from
  `app/build/generate-installer-images.ps1`.

## 3.6.1 - 2026-08-06

### Added

- Themes are truly global and layer-based: built-in themes (Steam Blue, OLED
  Black, Dracula, Graphite, and the new Nord, Gruvbox and Tokyo Night) and the
  "Custom…" theme recolor the whole app - window, library, game cards,
  achievement rows, dialogs - and the in-game overlay follows the active theme
  through a "Use app theme" toggle (off by default). Steam Blue stays the
  default.
- The Custom theme lets you pick a color and, per layer (window, header,
  library panel, cards/rows, Settings window), an optional background image
  with Cover / Contain / Repeat / Stretch fit and an optional veil or blur
  effect. Images persist in the user-data folder; adding, replacing or
  removing one never resets other layers' colors or effects.
- The theme editor moved into its own "Theme" Settings section, with a live
  preview swatch per row, ellipsized filenames, and a disabled "remove image"
  button when no image is set.
- Settings sidebar is grouped (General, Notifications, Game sources, Emulator,
  Advanced) and always opens on General.
- Discreet icon-only "Check for updates" button in the Settings footer with a
  translated inline status (checking / up to date / update available / failed).
- The overlay hotkey (Ctrl+Shift+K by default) toggles the overlay even with no
  game running, follows the active game if it changes, and closes/resets when
  the game exits.
- The blacklist manager shows the game name with the App ID as a secondary
  pill, and gained an add-by-AppID field with automatic name resolution.
- Two new notification presets (Midnight, Sunset).

### Fixed

- The "Cards & rows" theme layer was leaking into Settings and the executable
  configuration modal - header, sidebar, panels and controls all inherited the
  card color instead of the dedicated Settings layer. Settings now uses its
  own surface tokens, fully independent from cards.
- Custom-theme background images were barely visible under opaque layer colors
  and gradients; a layer with an image now shows through a dark scrim instead,
  in both the main window and the overlay.
- ~50 hardcoded hex colors (mostly blue) across the title bar, settings,
  library, achievement list, search bars and dialogs were replaced with theme
  variables, so every theme actually reaches the whole app instead of a few
  containers.
- Progress bars under game tiles and achievement rows now use fully opaque
  theme-derived tracks and accent-colored fills, fixing translucent/white
  artifacts on light or illustrated backgrounds.
- The in-game overlay hides the whole progress block (title, value, bar and
  reserved space) for single-step achievements (0/1, 1/1), matching the main
  window.
- The overlay hotkey now defaults to Ctrl+Shift+K on a fresh install; it was
  silently defaulting to Ctrl+Shift+O in code while the UI already showed K.
- The executable configuration modal is fully themed and localized (title,
  launch arguments, placeholder, unlink tooltip) in all 18 bundled locales.
- The "Clean" notification preset was missing its bundled font file.
- The renderer could silently lose the whole UI when a top-level destructured
  import collided between two classic scripts; the scope test now also tracks
  destructured top-level bindings.
- The achievement icon background and the Uplay achievement-page banner tint
  were hardcoded navy blue regardless of the active theme; both now follow it.
- A leftover `require` of the removed `util/toastAudio.js` could crash the
  toast transport if a legacy `customAudio` value ever reached it.

### Changed

- Goldberg / GBE Fork scanning lives in Advanced with its own section; the
  Windows notification settings block (superseded by the toast/overlay/both
  transport picker) was removed, along with its now-dead i18n keys.
- The installer no longer ships the Watchdog test suite or its manual
  notification test script.

## 3.6.0 - 2026-08-05

### Added

- The NSIS installer now follows the Windows display language for every page
  and custom message, matching the 18 languages bundled in the app, instead of
  always defaulting to English. It also ships a modern dark-blue
  welcome/finish sidebar and header image that match the app theme.
- The in-game overlay is now localized: the header columns, status labels and
  empty/fallback messages follow the selected app language, and localized
  achievement names/descriptions are used when available (previously the
  overlay was hardcoded to English).
- Imperative strings (message boxes, context/tray menus, toasts, busy labels)
  now go through a translation helper instead of hardcoded French/English
  ternaries. Existing behaviour is preserved (French fallback, English
  otherwise) and each string can now be translated per locale by adding a
  `dialogs.<key>` entry to `locale/lang/*.json`.
- The installer now shows the LGPL licence before installing and, at
  uninstall, asks whether to also delete the app's settings, cache and saved
  data (default: keep - the legacy 1.6.8 data folder is never touched).
- The in-game achievement overlay got a visual refresh and is now
  customizable: a stats bar (unlocked/total + completion %), instant search
  and status filters, community-rarity badges when the source provides them,
  progress bars, density/icon-size/accent/zoom options and show/hide toggles
  persisted between sessions.

### Changed

- The resident update check now runs hourly instead of every six hours, and a check that fires
  while an update prompt is open reschedules itself instead of stopping all future checks until
  the app restarts.

### Fixed

- The first-run guide no longer relies on a duplicated, incomplete French/English fallback object
  (it was missing two strings used by the API-key toggle and the notification test). A broken or
  missing per-language file now degrades to English, matching the rest of the UI.
- The in-game overlay list works again under the current Electron runtime and follows the
  selected locale: its preload required app modules that fail in the sandboxed window context
  (so `window.api` was never exposed and the page script crashed), and the `overlay-language`
  channel had a renderer listener but nothing in the main process ever sent it - the list stayed
  empty/English even with a localized UI.
- The overlay now loads the app's own `view/overlay.html` instead of a stale copy in the user-data
  folder, so shipped fixes and localization actually reach it without waiting for the next install.
- The overlay escapes game-provided names/descriptions (no more raw HTML injection) and no longer
  renders a misleading "Progress: undefined / 1" when a schema declares a max without a current value.
- Watched emulator save roots (SmartSteamEmu, CODEX, OnlineFix, GSE Saves, …) no longer appear as
  fake games in the library. Their numeric Steam AppID subfolders (e.g. `311210`) match the hex
  profile shape the Goldberg SocialClub parser uses to recognise game folders, so every such root
  was misclassified as a SocialClub game and listed by its folder name next to the real games.
  SocialClub detection now only claims the real `Goldberg SocialClub Emu Saves` root (or a path
  under it) and folders with hard Rockstar profile evidence.
- The Settings footer's "maintained by" link pointed at a non-existent `Shirowwww/Achievement-Watcher`
  repository instead of this one.
- A Goldberg SocialClub game folder whose only content is an empty, never-written-to hex profile
  folder (the emulator creates the shape before the game ever saves anything) is no longer listed
  as a game named after the raw folder; an empty profile folder is no longer treated as evidence of
  a real game.
- A manually added custom save folder whose name doesn't match any known emulator/scene layout
  (e.g. a folder the user renamed themselves) fell back to an unset library source instead of a
  readable one once its numeric AppID subfolder was found.
- A locally uploaded profile avatar, and most of the library, could be lost on the first launch
  after upgrading to 3.5.3. The avatar lived only in the renderer's `localStorage`, which is
  Chromium profile state and is deliberately never imported by the one-time migration into
  `%APPDATA%\Achievement Watcher 3.0` (it's rebuilt on launch); the avatar now persists in a
  migration-covered `cfg\avatar.txt` file instead, with a one-time carry-over from `localStorage`
  for sessions that already had one set. Separately, the "show installed games only" library filter
  also lives in that same Chromium storage and defaults to ON when unset - on a fresh post-migration
  profile that silently hid every game without an on-disk-confirmed install (which is most of an
  emulated/cracked library), even though the underlying watched folders and settings had migrated
  correctly. The filter now only defaults to ON for a genuinely new install, not one carried over
  from a previous version.

## 3.5.3 - 2026-08-05

### Added

- New Goldberg Social Club emulator source: `%APPDATA%\Goldberg SocialClub Emu Saves` is now
  accepted in Settings, auto-scanned and monitored like the other emulator save roots. Games are
  discovered by their real layout - hex profile folders and Rockstar save/profile files
  (SGTA*/SRDR*, `settings\cfg.dat`, `SAVE\…`) as well as standard emulator achievement files -
  resolved to their Steam release for title/cover/schema, and labelled "Goldberg SocialClub" in the
  library and source filters, with a dedicated source toggle. When a profile only contains
  Rockstar's proprietary save files (which no local tracker can decode), the game is still listed
  honestly instead of being silently skipped.
- Right-click uninstall from the game list: game tiles now offer an "Uninstall"
  submenu that can run the game's own uninstaller (Inno Setup/NSIS silent flags
  when detected), ask the Steam client to uninstall the game
  (`steam://uninstall/<appid>`), or move the game folder to the Recycle Bin when
  no uninstaller exists. The feature is toggled from Settings > General
  ("Uninstall from the game list") and every action asks for confirmation first.

### Fixed

- Achievement Watcher 3.x no longer shares `%APPDATA%\Achievement Watcher` with the original
  1.6.8 app. 3.x data now lives in `%APPDATA%\Achievement Watcher 3.0`; on the first launch after
  this update the legacy directory is imported once (never moved or deleted) and playtime counters
  are copied into a separate registry namespace, so uninstalling 1.6.8 can no longer wipe 3.x
  configuration, caches or playtime. The import is selective and near-instant: settings and themes
  are copied, the large write-once payloads (icon cache, GBE backups, downloaded tool caches) are
  hard-linked so they cost no extra disk yet survive the legacy folder being deleted, and Chromium's
  own profile - the bulk of the old directory, rebuilt on launch anyway - is skipped entirely. A new
  directory that already exists because the Watchdog wrote a log into it is still imported. The
  Watchdog also gets its own single-instance mutex, so both versions can run side by side.
- Achievement toasts never appeared, from two stacked faults. powertoast reads the AUMID from its
  `aumid` option, but every toast payload (achievement, progress, playtime, platinum and the
  Settings tests) sent `appID`, so each toast was posted under powertoast's own fallback - the
  Microsoft Store's identity - instead of the selected one; and the selected one was the classic
  Xbox app, which Windows 11 no longer ships. Windows discards a toast whose app id no installed app
  owns, silently, which is why the controller still rumbled and nothing was logged. The correct key
  is used everywhere, the WinRT-off flag is forwarded the way powertoast expects it, and the app id
  is now verified to exist against the Start Menu instead of being checked for shape only - the old
  check also rejected Achievement Watcher's own (non-packaged) identity as "not a valid AUMID".
- Toast identity and rendering were audited end to end. Notifications now appear under Achievement
  Watcher's own name when the installer's Start Menu identity is registered (falling back to the
  Xbox ids only in dev/portable runs), an app id that no installed app owns is reported in the log
  instead of failing silently, and because a non-packaged app cannot load remote toast images the
  icon prefetch is enabled automatically for it. The Settings test buttons resolve their app id and
  build their payload through the exact same code as real unlocks, so a passing test can no longer
  mean anything other than a working toast. Achievement/progress/rare toasts no longer embed the
  game header image (playtime and platinum keep it), every achievement toast shows the game name in
  the attribution line (with the rare percentage when applicable), and clicking a toast now opens
  the corresponding game page in the library - including when the app was not running yet, through
  an `achievement-watcher://` scheme re-registered at every launch (the legacy `ach:` scheme was
  left behind by 1.6.8 pointing at its own, now uninstalled, executable). The payload was also
  aligned with the powertoast contract: `time` (unlock timestamp), `heroImg` / `inlineImg` for the
  game art and a real progress bar (`value` 0–100 + status) were previously sent under unsupported
  keys (`timeStamp`, `headerImg`/`footerImg`, `{percent, footer}`) and silently dropped by the XML
  builder.
- Ubisoft Connect games can no longer end up titled "Steam" with no cover (Far Cry 4, uplay id 971).
  A title sold on several storefronts gets several blocks in the Ubisoft configurations index that
  share one achievements spec - the real game block, plus one per storefront whose only name is the
  storefront itself - and the parser kept whichever came first, so the displayed title depended on
  file order. Blocks sharing a spec are now merged with the real game name winning, storefront
  names and unresolved localization keys (`l1`, `NAME`, `RELATED_GAMENAME_116`) are never used as
  titles, and the index is decoded as UTF-8 instead of latin1 so accented titles stop rendering as
  "Assassin's CreedÂ® Mirage". The Steam release is then resolved generically for ANY title, best
  signal first: the product's registered install folder when it sits inside a Steam library (which
  identifies a Steam purchase launching Ubisoft Connect with no name involved at all), then the
  uplay↔Steam catalog, then a confident name match against the installed Steam manifests, then the
  full catalog. Candidates that cannot identify a game - content-hash specs and franchise-level
  sort keys - are no longer searched, because a confident match on those resolves to the wrong
  game. No per-game asset mapping is needed for future releases.
- Right-click context menus (game tiles and the avatar menu) now render their
  icons at the standard 16×16 size instead of the bundled 32×32 images, which
  looked oversized on normal and high-DPI displays.
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
- Watchdog baseline persistence rejects non-array save payloads and keeps an
  immutable in-memory snapshot, so a bad save call can no longer wipe a valid
  baseline and later mutations of the caller's array stay out of the cache.

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

### Changed

- The update check now retries 30 minutes after a failure and re-checks every 6 hours while the app stays resident; overlapping prompts are ignored, and check/download failures surface as a tray balloon instead of only appearing in the log.
- Removed the unused `sound-play` dependency from the app and the Watchdog (sound playback already goes through PowerShell).

### Fixed

- The background monitor is now supervised with an exponential respawn backoff (3 s → 60 s cap), so a monitor that crash-loops no longer restarts every three seconds. A failed spawn no longer leaves the monitor permanently dead for the session.
- Uncaught exceptions in the Watchdog now log the stack and exit cleanly, letting the app-level supervisor restart it instead of leaving it running with half-initialized state.
- File-watcher errors (options.ini and achievement folders) are now logged instead of risking an unhandled `error` event that could take the monitor down.
- The startup sweep of orphaned Watchdog processes (by port 8082) now runs once before the first launch instead of on every monitor restart, so tray restarts and supervised respawns are faster.
- Game-list context-menu icons referenced image files that did not exist (`file-text.png`, `cross.png`, `folder-open.png`, ...), so every menu icon was blank. The @2x artwork is now the canonical file and the unused @1x/@4x duplicates were removed.

### Security

- Pinned `ip-address` to 10.4.0 and `undici` to patched releases; `npm audit` reports 0 vulnerabilities.

## 3.4.2 - 2026-08-03

### Added

- Steam global achievement percentages now appear for games that are not running under a Steam emulator, so a Ubisoft/Uplay game behaves exactly like a Steam game in the detail view. Goldberg Uplay R2 titles keep their mapped Steam AppID and fetch the percentages directly; official Ubisoft Connect titles go through a Steam↔numeric-id bridge that translates Steam achievement names onto the game's native ids and caches the result in the shared rarity sidecar; Epic installs with a known Steam release borrow the Steam percentages. The community % column, the rare tiers and the percentage sort work identically for all of these sources.
- Native non-Steam ids (Ubisoft Connect, GOG/Epic official, Lumaplay, EA, Xbox) are never sent to Steam's global-percentages endpoint anymore. Sources without a Steam counterpart keep their own rarity: GOG/Epic sidecars, Exophase for console emulators, and the Xbox import cache.

## 3.4.1 - 2026-08-03

### Fixed

- Fixed the real cause of the library reloading itself and of scans feeling slow. Each loaded game was handed to the interface from inside a `requestAnimationFrame` callback, which the browser engine only delivers to a *visible* window. Achievement Watcher lives in the tray with its window hidden, so a background scan finished having added nothing to the on-screen list; the periodic new-game check then saw the entire library as newly installed and started a full refresh - every three minutes, indefinitely. Real logs showed `54 new game(s) detected` on every tick for a 52-game library. Games are now handed over directly, so the list is correct whether or not the window is open.

### Security

- Updated two pinned dependencies that were held at vulnerable versions: `protobufjs` (7.6.4 → 7.6.5, denial of service via `.proto` option parsing) and `adm-zip` (0.5.18 → 0.6.0, 4 GB memory allocation from a crafted ZIP). `npm audit --omit=dev` now reports no vulnerabilities. Pinning the patched releases avoids the downgrade of `steam-user` that `npm audit fix` proposed.

### Changed

- Added `.gitattributes` marking the repository `whitespace=cr-at-eol`. Files here legitimately mix CRLF and LF, so `git diff --check` was reporting every CRLF line as trailing whitespace and burying genuine hits; real trailing spaces and tabs are still reported.

## 3.4.0 - 2026-08-03

### Added

- Settings has a search field: typing filters the rows of every tab at once and the side menu shows how many matches each tab holds, so an option can be found without knowing which tab owns it. Rows are matched on their label, their help text, the values they offer and their internal option name (`hideZero` works in any language). Section headers now stay pinned while a long tab scrolls.

### Fixed

- Ubisoft (Goldberg Uplay R2) games no longer report 0% when the emulator is recording unlocks somewhere else. Achievement Watcher now reads the unlock file from wherever the emulator actually writes it - its own `Goldberg UplayEmu Saves` folder, the game's `saves` folder, or a custom `SavePath` - instead of only the `GSE Saves\<AppID>` folder the fix redirects to, and translates the Ubisoft objective ids back to the game's Steam achievement names.
- The Uplay R2 fix now adapts to the loader build that is installed. Loader builds released before `AchSaveType`/`AchSavePath`/`AchKeyPrefix` existed silently ignored those keys, so the configuration looked correct while nothing was ever written where Achievement Watcher reads. Such builds now get a configuration they understand (achievements enabled, schema keyed by bare objective id) and their unlocks are read from their own save folder.
- A Ubisoft game update that re-extracts the repack removes `achievements_schema.json` and restores an ini with achievements disabled, silently breaking a working setup. The setup is now re-applied automatically on scan (like the Goldberg/GBE schema already was), and "Diagnose Uplay R2 setup" reports the missing schema, the disabled ini and the loader's limitations explicitly.
- "Apply emulator fix (Uplay R2)" now offers to update a loader that is too old to redirect achievements, when a newer one is in the local loader cache. The offer is an explicit prompt that defaults to keeping the current loader, since the fix works either way and the game already launches with the installed DLL; the original is kept as `.bak`. Previously a loader was only ever installed when the game had none at all.
- "Open Ubisoft achievement saves" opens the folder that actually holds the unlock file rather than always opening the redirect target, which is empty on a loader without redirect support.
- Fixed the library reloading itself every few minutes. An appid that discovery keeps finding but that never reaches the list - a failed load, a game hidden by "hide 0%" or by a disabled source - was counted as a brand-new install on every background check and triggered a full refresh each time.
- Fixed the loading bar stalling near 100%. Folders under `Goldberg UplayEmu Saves` are named with the Ubisoft product id, which was being looked up as if it were a Steam AppID: every scan spent up to 30 seconds waiting for a Steam lookup that could never succeed. Those folders are now mapped to their Steam release, and any appid that genuinely resolves to nothing on Steam is remembered for three days instead of being re-fetched on every scan.
- Keys appended to an emulator ini kept the lower-cased spelling used to look them up (`achkeyprefix` instead of `AchKeyPrefix`), which the Uplay R2 loader ignores.
- Ubisoft (Uplay R2) games now fire live achievement notifications while you play. The Watchdog never watched the emulator's save folder at all, so these unlocks only ever appeared after a manual library refresh. It now watches `Goldberg UplayEmu Saves`, resolves the Ubisoft product id in the folder name to the game's Steam AppID, and maps the objective ids in the save onto the game's achievement names.
- Unlock state is read from all of the emulator's possible save folders and merged instead of stopping at the first file found. Several of them routinely hold a file at once - the emulator seeds a fully-locked copy from the schema, a previous save location leaves one behind - and a stale all-zero copy could hide real unlocks. An unlock now always wins over a lock, and the most recent timestamp wins.
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

- Notification volume is now a real slider (0–200%, live preview at the chosen loudness - including the >100% overlay boost); custom toast sounds follow the same setting instead of playing at a fixed half volume.
- New "Rare" notification test button, firing a random gold/silver/bronze rarity through both the overlay and toast transports, exactly like a real rare unlock.
- 7 new overlay notification presets imported from the reference Achievements project: the full Xbox Series family (base, Purple, Rare ×2, Platinum ×2 with the animated diamond) and Game Cover (uses the game's header art as background).
- Rare unlocks and the platinum (100%) popup can each use their own overlay preset (Settings → Notifications, "Same as main" by default) - pairs naturally with the Xbox Series Rare/Platinum presets.
- App color themes (Settings → General): Steam Blue (default), OLED Black, Dracula, Graphite - previewed live, applied at startup.
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
- The GBE/Goldberg backup now snapshots `steam_settings` and `steam_api(64).dll`, and a restore point is created automatically before any emulator fix runs - "Restore latest GBE/Goldberg backup" rolls it back. Backup/restore menu wording is localized in every UI language.
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

- **Fixed: the app froze on a fresh install (no Steam Web API key, empty cache).** Without an API key, Achievement Watcher reads each game's achievement data by scraping the Steam pages, which can take several seconds per game. That scrape was run over a *blocking* channel, so the whole window locked up - most painfully on a brand-new install where every game has to be scraped from scratch, leaving the UI frozen from the very first game. The scrape now runs in the background: the window stays responsive and the library fills in as each game's data arrives.
- **A Steam Web API key set during the first-run guide now speeds up that very first load.** The first library scan is held until you finish (or skip) onboarding, so the key you just entered is used from the first game instead of after a slow key-less pass - far faster loading and more accurate data (real hidden-achievement descriptions). Setting or changing the key later in Settings now also takes effect immediately, without restarting the app. Without a key the load is necessarily slower (it scrapes), but the window stays fully interactive and games appear progressively as they load. The onboarding **API-key step now prominently warns** that skipping the key makes the first load very slow.
- **Fixed: the library could show every game twice (one copy loaded, one stuck on the loading spinner).** A second scan starting before the first finished (e.g. the 15-minute background new-game check firing during the initial load) appended a duplicate set of tiles. Scans are now coalesced - a refresh requested while one is running queues a single follow-up pass instead of running concurrently.
- **Fixed: the background monitor crashed on a fresh install (no playtime tracking, game-launch detection or live notifications).** It tried to load an optional process-blacklist file (`filter.json`) that doesn't exist on a clean install, threw, and restarted in a loop. It now falls back to empty lists and starts normally.

## 3.0.0

First public release of the modernized 3.0 fork - a large stability, security,
compatibility and feature pass on top of the upstream
[darktakayanagi](https://github.com/darktakayanagi/Achievement-Watcher) base.

### Added

- **System-tray app** - runs in the tray with no window; the library/settings open on demand and closing the window no longer quits. Tracking, playtime and notifications keep running in the background.
- **In-game overlay notifications** - a styled popup drawn on top of the game (presets + sounds), selectable as toast / overlay / both. Works with only the background tracker running.
- **Custom notification preset builder** - pick colours, opacity, font/icon size and corners with a live preview, no HTML needed. Plus custom imported sounds and adjustable overlay volume & duration.
- **"Rare · X%" labels** for sub-10% unlocks, platinum toasts, a 3-tier rarity display, and persistent rarity cached per game (instant and offline).
- **"Installed games only"** filter to hide phantom entries (orphaned saves, owned-but-not-installed games).
- **Automatic new-game detection** - fresh installs are picked up in the background and registered for playtime tracking.
- **New sources** - ShadPS4 (PS4) with live trophy toasts, Xenia (Xbox 360) achievements, and EA Desktop achievements.
- **Goldberg / GBE tooling** - Diagnose and Repair `steam_settings`, install the GBE Fork `steam_api(64).dll`, strip Steam DRM (Steamless), back up / restore the emulator config, and auto-fix new emulated games in the background.
- **Advanced cover management** - re-download art, pull it from an alternate Steam AppID, or set a local image.
- **Souvenir screenshots** - optionally capture the screen on unlock, saved per game.
- **Guide links** in the right-click menu (SteamHunters, Steam Community guides).

### Changed

- **Platform modernized** - Electron 12 → 42 (Chromium 148, Node 24) with every major dependency updated.
- **Faster, lighter loading** - bounded-concurrency scanning, an optional browser-free data path with a Steam Web API key, a roughly halved emulator scan, and a size-capped (LRU) icon cache.
- **~80 MB smaller install** - dropped Chromium UI locale packs and other-platform native binaries the app never loads; the background tracker now shares the app's runtime instead of bundling its own Node.
- **Lower idle footprint** - the hidden main window lets Chromium throttle background timers; the keyless scraper can reuse an installed Edge/Chrome instead of downloading a 170 MB Chromium.
- **More resilient background tracker** - auto-launches at sign-in, keeps running after the window closes, and seeds playtime from the install folder so tracking works on a game's first launch.
- **Modern dark UI** across the library, details, settings and dialogs; resizable window (down to 900 × 600); broader French / English localization.
- **Security hardening** - untrusted text is HTML-escaped before reaching the DOM, a tightened Content-Security-Policy (no inline/eval), jQuery 3.7.1, and a hardened main window.

### Fixed

- **Windows 11 24H2+ compatibility** - every `WMIC` call (removed by Microsoft) was replaced, so folder scanning, drive listing and process priority work again.
- **Hidden achievement descriptions** now resolve correctly even with a Steam Web API key, and stale blank entries are repaired in place.
- **GreenLuma, Uplay, RPCS3 and Epic** first-load failures fixed; no more permanent blacklisting after a single transient error.
- **Emulator notification edge cases** (3DM, TENOKE, GOG/Nemirtingas, `[object Object]` titles) now notify correctly.
- **Playtime tracking** is correct for games whose process name differs from the store index, and store launchers / helper processes are no longer tracked as games.
- Several **CPU and memory-leak** issues (busy-loops during scraping, orphaned browser instances, a tracker pipe leak) resolved.
- **Self-healing config** - a corrupted folder database is quarantined and defaults restored instead of silently disabling your folders.
- The main window can no longer get stuck **invisible** at startup; launch failures now show a clear dialog instead of failing silently.

### Changed

- **Executable auto-detection** rewritten so each game resolves to its own binary instead of several games sharing one.
- The emulator fix is a **standalone DLL swap** matching common auto-crackers (replace `steam_api(64).dll`, optionally strip DRM), powered by the maintained **GBE Fork** runtime; the original DLL is always backed up.
- With a Steam Web API key set, the data path is **fully browser-free** (schema via `GetSchemaForGame`/`GetGameAchievements`); the headless browser remains only as the keyless fallback.
- The WinRT toast modules are now optional dependencies, so a failed native build no longer blocks installation (toasts fall back to PowerShell).
