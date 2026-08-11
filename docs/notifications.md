# Notifications

Achievement Watcher can announce unlocks with a native Windows notification (toast), an in-game overlay, or both. Configure the transport under **Settings → Notification**.

## Choose a delivery mode

| Mode | Behavior |
|---|---|
| **Windows notification** | Uses the Windows system notification (toast). Achievement and progress notifications use the achievement icon; playtime notifications can include game artwork and a progress bar. |
| **In-game overlay** | Opens a styled popup above the running game. The main library window may stay closed while the background tracker handles it. |
| **Both** | Sends the same event to both transports. |

Use the built-in test buttons after changing the mode. A successful test confirms the display path; a real unlock still depends on the relevant game source being watched correctly.

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

The app includes presets inspired by several console and PC notification styles. You can select a main preset and optional overrides for:

- rare achievements;
- 100% completion notifications;
- normal achievement unlocks.

Choose **Same as main** when a separate style is not needed.

All bundled presets, the included user presets and the custom preset builder consume the same
rich payload: rare achievements tint the popup with a gold/silver/bronze tier (below 3%, 6% and
10% global unlock rate) and progress notifications show a real progress bar with a
`current/max - %` label, exactly like the Shirow preset.

## Create a custom preset

The builder is the **Custom preset** section of **Settings → Notification**. It starts collapsed: open it with its header.

Set the background, text and accent colors, then the opacity, font size, corner radius, icon size and popup width. Each slider shows its current value, and the sample popup under the controls updates as you go — it is painted from your colors, not from the app theme, so it shows what the notification will look like in a game.

| Action | What it does |
| --- | --- |
| **Preview** | Renders the design as a real overlay popup, at full size and in the configured position, **without saving it**. Use it to compare ideas without filling the preset list. |
| **Create preset** | Saves it and selects it as the active preset. |
| **Update preset** | The same button, once the name matches a preset the builder made — it replaces that preset instead of adding another. |
| **Edit a preset** | Loads one of your generated presets back into the controls. Every value returns exactly as saved. |
| **Delete** | Appears once a generated preset is loaded, and removes it after a confirmation. |

Only presets this builder generated can be re-opened or deleted: it stores its settings in an `aw-preset.json` beside the generated files, and that file is what makes a preset editable. Bundled presets and hand-written ones are never touched.

> **Custom presets are stored in the installation folder** (`presets\Users Presets\`), not in the data directory. Copy any preset you want to keep before reinstalling or updating, since installing over the application replaces that folder.

## Sounds, volume and duration

- Import `.wav`, `.mp3` or `.ogg` files from the Notification settings.
- Overlay volume ranges from 0% to 200%. Values above 100% apply an overlay-side boost; Windows notification playback is limited by the system audio path.
- Duration can follow the preset automatically or use a fixed cap.
- Playtime notifications are silent by design.

## Position and interaction

Choose a corner, edge or centered position from the Notification settings. The custom position can be moved with **Reposition** and is stored for later sessions.

The in-game overlay also supports configured keyboard shortcuts for moving, snapping and click-through behavior. Controller overlay control is optional: enable it under **Settings → General → Controller**, then **BACK+START** opens the overlay, **LB+X** toggles in-overlay navigation and **RB+Y** toggles window move/resize. The in-app **Help** menu lists the full controller cheatsheet.

## Per-game behavior

Right-click a game to mute its progress notifications without disabling achievement unlocks or completion notifications. A duplicate guard also prevents the same unlock from appearing twice when a watched save is rewritten.

Achievements with a global unlock rate below the configured rare threshold display their rarity percentage and can use the rare preset.

## If a test or unlock does not appear

1. Confirm the selected mode is **Windows notification**, **In-game overlay** or **Both**, not disabled.
2. Check that the background tracker is running.
3. For overlays, select a valid preset and test again outside an exclusive fullscreen game.
4. If a full-screen game or Do Not Disturb hides Windows notifications, enable **Priority notifications**
   and approve Windows' one-time request for Achievement Watcher.
5. Check Windows notification settings for Achievement Watcher when notifications are missing.
6. Open **Settings → Advanced → Diagnostics** and inspect the logs.

Continue with [Troubleshooting](troubleshooting.md#notifications-do-not-appear) if the problem remains.

[Back to the documentation index](README.md)
