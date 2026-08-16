# Notifications

AW Next can announce unlocks with a native Windows notification (toast), an in-game overlay, or both. Configure the transport under **Settings → Notification**.

## Choose a delivery mode

| Mode | Behavior |
|---|---|
| **Automatic** (default) | Uses the in-game overlay when it can be shown, and a Windows notification when it cannot. Nothing to configure. |
| **In-game overlay** | Always opens the styled popup above the running game, including in exclusive fullscreen where it may not be visible. If the overlay reports that it could not display at all, that one notification still arrives as a Windows notification rather than being lost. |
| **Windows notification** | Always uses the Windows system notification (toast). Achievement and progress notifications use the achievement icon; playtime notifications can include game artwork and a progress bar. |
| **Both** | Sends the same event to both transports. |

The main library window may stay closed in every mode: the background tracker handles delivery.

> [!TIP]
> Use the built-in test buttons after changing the mode. A successful test confirms the display path; a real unlock still depends on the relevant game source being watched correctly.

### How Automatic decides

Each notification is routed once, from what AW Next can actually observe at that moment:

| Situation | What happens |
|---|---|
| Nothing covering the screen | In-game overlay. |
| The game holds **exclusive fullscreen** (Direct3D) | Windows notification — an always-on-top popup is not drawn over an exclusive fullscreen game, so it would play invisibly. Borderless and windowed games keep the overlay. |
| The app reports it cannot display the popup (no usable preset, renderer unavailable) | That notification is sent as a Windows notification instead. |
| The overlay fails to display | Automatic stays on Windows notifications for ten minutes, then tries the overlay again. |
| The overlay was asked but never reported back | No second notification is sent — a duplicate is worse than a delayed switch — and the next unlock uses a Windows notification. |

AW Next remembers which transport last delivered for each game and uses it only as a tie-breaker, when Windows cannot answer whether a game is in exclusive fullscreen. A live answer always wins over what was remembered, so a game never gets stuck on the wrong transport.

The transport is chosen **before** anything is sent, and a fallback is only ever allowed when the primary transport reported a definite failure. The same unlock is therefore never announced twice.

> [!NOTE]
> Exclusive fullscreen is respected rather than worked around: AW Next does not inject into games or force display-mode changes to put a popup on top of one.

### Where the current state is shown

Open a game and check **Game Health**. The Notifications row reports the transport that actually delivered the last notification for that game and why — for example *Working — Windows fallback active* in Simple mode, or *Windows notification · game in exclusive fullscreen* in Advanced. Until a game has had a notification, the row shows the configured mode instead of claiming an observation that has not happened.

## Priority Windows notifications

Full-screen games and other automatic Windows rules can turn on **Do Not Disturb**, which sends ordinary
toasts to Notification Center without showing them on screen. Enable **Settings → Notification → Priority
notifications** to mark achievement unlocks as important. Windows then asks once whether Achievement
Watcher may send those notifications; the user can allow or refuse it in Windows notification settings.

This is deliberately off by default. It applies to achievement and completion unlocks only, never to
progress or playtime updates. The underlying Windows toast uses the `urgent` scenario, supported on
Windows 10 version 2004 and later; it remains subject to Windows' notification permission and system
policy. See [Microsoft's app-notification documentation](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/app-notifications-content).

## In-game overlay presets

AW Next ships nine presets. They are not variations on one card: each has its own composition, type,
motion and colour, and each was designed to be recognisable at a glance while a game is on screen
behind it.

| Preset | What it is |
| --- | --- |
| **AW Next** | The signature, and the default. The app's own palette, an accent rail that draws down the left edge, a ringed icon and the game's name above the achievement. |
| **Steam** | The dark navy plate with the Steam mark behind the text, square corners and the toast sliding up out of the bottom edge. |
| **Epic Games** | Flat, neutral and square-shouldered, with the widest gutters in the set and a single rule down the left edge. |
| **PlayStation** | The console's own type and long grey-to-black panel, with the PlayStation mark pulsing inside a ring on the right. |
| **Xbox** | A dark pill with a green arc that sweeps once around the circular icon and settles into a steady ring. |
| **Cover** | The game's own artwork as the background, drifting slowly, with a scrim under the text and the largest type in the set. |
| **Glass** | Genuinely translucent and deliberately quiet: no accent bar, no colour until a rare or 100% unlock brings one. |
| **Arcade** | Phosphor green on black, monospaced and uppercase, with scanlines and a hard offset edge. A rare unlock switches to amber. |
| **Slim** | The low one, on true black - the same width as the rest but half the height, built to disappear on an OLED panel. |

Every one of them renders the same four notifications, and each state changes more than a colour:

| State | What it looks like |
| --- | --- |
| **Normal** | The preset's own accent. |
| **Rare** | Gold below 3%, silver below 6%, bronze up to 10%, plus the unlock rate printed on the card, a stronger glow and an added edge. |
| **100% completion** | A cold, brighter treatment with a doubled rim - different from a rare unlock, not just another colour. |
| **Progress** | A real progress bar with a `current/max - %` label. |

There is one preset setting, not three. A rare unlock and a 100% completion are states the preset
you picked paints itself, so there is nothing to configure for them and no way for the two to
disagree about how the same game should look. The per-emulator overrides (Xenia, RPCS3, ShadPS4)
remain, under **Advanced**.

Presets named after a platform reference its visual language and carry its mark; the type, the
palettes and the state system are AW Next's own.

A preset does not choose a sound - the one in the Notifications tab is used, so changing the look
never changes what you hear. (A preset someone shares with you *can* bring its own sound; see
[Share a preset](#share-a-preset).)

> [!NOTE]
> Presets shipped under earlier names still resolve. `Shirow`, `Default`, `Midnight` and `xqjan`
> become **AW Next**; `PS4` and `PS5 enhanced` become **PlayStation**; `Xbox 360` and `Xbox One`
> become **Xbox**; `Game Cover` and `Sunset` become **Cover**; `Clean`, `Modern` and `Smooth Pop`
> become **Glass**; `Neon Future` and `LAZ0RBOX` become **Arcade**. Among the community presets,
> `ArmsofGod`, `Epic Preset`, `TigerDX Award` and `mudoss` were renamed **Pantheon**, **Onyx**,
> **Hexagon** and **Outline**, and the Xbox Series rare/platinum variants fold back into
> **Xbox Series**. A preset of your own that happens to carry one of those names is always used
> ahead of the replacement.

## Design your own preset

The designer has its own tab: **Settings → Presets**, listed under Notification and reachable from the tools button beside the preset setting. Everything is set with ordinary controls - there is no CSS, no JSON and no file to edit.

> [!NOTE]
> Presets style the **in-game overlay**. With **Type of notification** set to *Windows notification*, nothing a preset describes is ever drawn, so the tab is not shown at all.

<div align="center">
<img src="../screenshot/notification-preset.png" width="480" alt="Notification preset designer"><br>
<sub>A live preview of the real popup, beside the controls that shape it</sub>
</div>

### Starting points

The first row of the card holds eight complete designs - *Classic* (the look the builder always produced), *Aurora*, *Neon*, *Cover*, *Minimal*, *Console*, *Terminal* and *Slate*. Each one is an ordinary set of control values, so picking one is the same as having moved every control by hand: keep it, or use it as a base and change anything.

| Action | What it does |
| --- | --- |
| **Surprise me** | Builds a design you have not tried. One hue drives the accent and the background is built around it, so the result is a design rather than noise. |
| **Duplicate** | Keeps the current design, frees the name, and lets go of the picker - so the next **Create preset** adds a preset instead of replacing the one it was based on. |

Nothing here is saved until you press **Create preset**.

### The preview

The preview is the notification itself, not an impression of it: it renders the same page, the same styles and the same engine the popup uses in a game, so what you see is what unlocks.

| Control | What it shows |
| --- | --- |
| **Card** | The popup at its own size, so the design can be judged close up. The size in pixels and the preview zoom are printed under it. |
| **Compare** | The normal, rare and 100% notifications one under the other. Switching states shows what a rare unlock looks like; seeing them together shows whether it looks *different*, which is what a rare colour is actually for. |
| **Screen** | The popup on a mock display at **720p**, **1080p**, **1440p** or **4K**, at its true relative size and in the corner notifications are set to appear. A popup that is unreadably small at 4K shows up here rather than in a game. |
| **Normal / Rare / 100% / Progress** | The four notifications a preset has to look right in. Switching states repaints immediately. |
| **Play** | Plays the whole thing once - entry, hold and exit - at the preset's own timings. |
| **Backdrop** | What the popup is judged against: transparency, a dark scene, a bright one, or **artwork from your own library** - a notification is seen over a game, and a design that reads well on dark can vanish on a bright scene. |
| **Position / Scale** | Both mirror the settings of the same name in the Notification tab - they are how big the popup is and where it lands, which is only judgeable next to the design. Changing them here changes that one setting. A popup you placed by hand is drawn at the bottom centre and labelled, since only the app knows where you dragged it. |

### The controls

Each group opens with its everyday settings; the less common ones sit behind **Advanced** inside the group. In **Simple** interface mode the Advanced halves are not shown at all.

| Group | What it covers |
| --- | --- |
| **Layout & size** | Icon on the left, right, above the text, or no icon at all; text alignment; popup width, padding and spacing; and whether the **game's name** is printed above the achievement. |
| **Text** | Font, title size, description size, how many lines the description may wrap onto, what colours the title (the accent, the text colour, or one you pick), and - under Advanced - title weight, uppercase, letter spacing and a text shadow for reading over artwork. |
| **Colours & background** | A solid colour, a two-colour gradient with an angle, or the **game's own artwork** dimmed, blurred and framed behind the text. Plus text colour, accent and opacity. |
| **Icon** | Size, corner rounding (50% makes it a circle) and, under Advanced, a border and a glow in the accent colour. |
| **Border & corners** | Corner radius, which edge carries the accent bar (or a full outline, or none) and its thickness; under Advanced, a border of your own colour. |
| **Shadow & glow** | How deep the drop shadow is and how much the popup glows in its accent colour. |
| **Motion & timing** | Which edge the popup enters from and leaves to (or fade, or zoom), how long it stays on screen, and - under Advanced - how far it travels, entry and exit speed, and the easing. |
| **Rare & completion** | The colour and glow for a rare unlock and for 100% completion, whether the progress bar shows, whether a **rarity badge** prints the unlock rate, and - under Advanced - the progress bar thickness and the silver and bronze rarity tiers. |
| **Sound** | A sound this preset plays instead of the one in the Notifications tab. Leave it on **App setting** for no opinion. |

| Action | What it does |
| --- | --- |
| **Show on screen** | Renders the design as a real overlay popup, at full size, in the configured position, in the state the preview is showing, **without saving it**. |
| **Create preset** | Saves it and selects it as the active preset. |
| **Update preset** | The same button, once the name matches a preset the designer made - it replaces that preset instead of adding another. |
| **Edit a preset** | Loads one of your generated presets back into the controls. Every value returns exactly as saved. |
| **Reset** | Returns the controls to the default design. Nothing on disk changes. |
| **Duplicate** | Frees the name so the design can be saved beside the preset it came from. |
| **Delete** | Appears once a generated preset is loaded, and removes it after a confirmation. |
| **Export** | Writes the preset to a single `.awpreset` file you can share. |
| **Import** | Installs a `.awpreset` file someone sent you. |

Only presets this designer generated can be re-opened or deleted: it stores its settings in an `aw-preset.json` beside the generated files, and that file is what makes a preset editable. Bundled presets and hand-written ones are never touched.

> [!NOTE]
> A preset shared from an older build still imports, still renders exactly as its author designed it, and keeps the sound named in its package.

> [!NOTE]
> A preset you already made keeps its own files exactly as they were generated. Opening it in the designer and saving is what applies today's defaults to it - among them a rare unlock and a 100% completion now repainting the whole popup, where before only the progress bar changed colour.

> [!NOTE]
> **Custom presets are stored in** `%APPDATA%\Achievement Watcher Next\presets\Users Presets`, not in the installation folder. They survive app updates.

## Share a preset

**Export** and **Import** sit in the **Presets** tab and move a preset between machines as one `.awpreset` file - the style, every image and font it uses, its builder settings and its metadata.

**Export** writes what the card is showing, under the name in the **Name** field - the design in the controls, saved or not, so a preset in progress can be shared without creating it first. The one exception is an imported preset selected in **Edit a preset**: its look lives in files the controls cannot describe, so that one is exported from disk as it is. Only the preset itself travels: no path from your machine, no account name, and no setting of yours.

**Import** asks for the file, checks it, and installs it under `presets\Users Presets`. If that name is already taken - by one of your presets *or* by a bundled one, which an import would otherwise hide behind a copy - you are asked whether to **Keep both** (the import lands under `Name (2)`) or to **Replace**. Nothing is written until you answer, and an import that fails for any reason leaves every preset you already have untouched.

An imported preset appears in **Edit a preset**, is selected straight away, and can be exported again or deleted from there. A preset the designer made comes back complete: every value returns to the controls exactly as it was exported, so you can keep editing it. A hand-written preset gets its look from files the controls cannot reproduce, so the controls are left alone and the name field stays empty - pressing **Create preset** then makes a new preset instead of overwriting the imported one, and **Show on screen** still shows the imported preset itself.

A package is validated before installation, and is refused whole rather than partly installed when:

- it is not a preset package, or its manifest is missing or malformed;
- it needs a newer AW Next than the one running, or was made by a newer package format;
- it carries a file the format does not describe - a program, a script or anything outside `preset/` and `sounds/`;
- any path inside it points outside its own folder.

Nothing inside a package is ever run, loaded or evaluated while it is being checked or installed. The preset's own page renders later in the same sandboxed notification window that renders a bundled preset.

### What a package contains

```
manifest.json     name, description, author, version, tags, format version,
                  minimum AW Next version, and the builder settings
preset/           index.html, style.css, images and fonts (relative paths only)
sounds/           optional audio, added to your sound list on import
```

The manifest is kept beside the installed preset as `aw-package.json`. That is what tells the app the preset is one it installed and may remove again, and it carries the description and credit through to the next export.

A sound you imported yourself travels with the preset. A bundled sound does not - the manifest names it, since every install already has it. Importing never changes which sound you have selected, and never overwrites a sound you already have: a different file of the same name arrives as `name (2)`.

Presets built here export with their builder settings, so the person receiving one can open it in **Edit a preset** and keep changing it. A hand-written preset has no builder settings and stays as it is on the other side, exactly as it does here. The `author` field is optional and is only ever filled from the preset's own file, so nothing is credited to you unless you put it there.

## Sounds, volume and duration

- Import `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a` or `.aac` files from the Notification settings.
- **Random** is an entry in the sound list, picked like any other sound: choose it and every
  notification plays a different file from the ones you have. It used to be a separate switch beside
  the list, which meant the list could name one sound while a different one played. It previews like
  any other choice too — selecting it, moving the volume slider under it or firing a test all play a
  real sound, a different one each time.
- Overlay volume ranges from 0% to 200%. Values above 100% apply an overlay-side boost; Windows notification playback is limited by the system audio path.
- Duration can follow the preset automatically or use a fixed cap.
- Playtime notifications are silent by design.

## Position and interaction

Choose a corner, edge or centered position from the Notification settings. The custom position can be moved with **Reposition** and is stored for later sessions. It is used exactly as you left it, so a popup can sit flush in a corner or over the taskbar; a position saved on a monitor that is no longer connected is brought back into view.

The scale setting resizes the whole popup without changing the preset's layout: every preset is drawn exactly as it is at 100%, only larger or smaller. **Reposition** shows the popup at the selected scale, so what you place is what you get.

The in-game overlay also supports keyboard shortcuts for moving, snapping and click-through behavior - see the [Overlay guide](overlay.md#keyboard-shortcuts-overlay-open) - plus optional gamepad control, covered in the [Controller guide](controller.md).

## Per-game behavior

Right-click a game to mute its progress notifications without disabling achievement unlocks or completion notifications. A duplicate guard also prevents the same unlock from appearing twice when a watched save is rewritten.

Achievements with a global unlock rate below the configured rare threshold display their rarity percentage and can use the rare preset.

## Screenshot souvenirs

**Screenshot on unlock** saves a picture of the screen a moment after an achievement pops, so the notification itself is in the shot. Files land in `<folder>\<game>\<date> - <achievement>.png`, and **Open folder** in the same row takes you straight there. The folder defaults to `Pictures\Achievement Watcher Next` and can be changed at any time - the button shows the one in use.

### Playing with Windows HDR on

Screenshots are saved exactly as Windows hands them over, and Windows converts an HDR screen to SDR before any ordinary screenshot tool - AW Next, the Snipping Tool, Print Screen or OBS - ever sees it. Ordinary content comes through correctly, but anything brighter than SDR white is clipped to flat white, so a bright sky or a strong light source can lose its detail. That detail is not in the file to recover: the picture is 8 bits per colour by the time it arrives.

Two things help, both outside AW Next:

- Lower **SDR content brightness** in Windows' HDR settings. On some systems this also fixes screenshots that come out overall too bright.
- For a shot where a blown highlight really matters, use **Win + G** (Xbox Game Bar), which captures the HDR frame itself and saves a tone-mapped copy beside it.

On multi-monitor setups the souvenir captures the primary monitor, so play on it if you want your screenshots to match.

## If a test or unlock does not appear

1. Confirm notifications are enabled, and check the Notifications row of the game's **Game Health** panel — it names the transport that last delivered and why.
2. Check that the background tracker is running.
3. For overlays, select a valid preset and test again outside an exclusive fullscreen game. **Automatic** already handles both of those cases on its own.
4. If a full-screen game or Do Not Disturb hides Windows notifications, enable **Priority notifications**
   and approve Windows' one-time request for AW Next.
5. Check Windows notification settings for AW Next when notifications are missing.
6. Open **Settings → Advanced → Diagnostics** and inspect the logs.

Continue with [Troubleshooting](troubleshooting.md#notifications-do-not-appear) if the problem remains.

---

**Next:** [Overlay guide](overlay.md) - the in-game achievement list, its search,
filters and customization.

<p align="center"><a href="README.md">← Documentation</a> · <a href="../README.md">Project home</a></p>
