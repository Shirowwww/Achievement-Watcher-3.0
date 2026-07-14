# Notifications

Achievement Watcher can announce unlocks with a native Windows toast, an in-game overlay, or both. Configure the transport under **Settings → Notification**.

## Choose a delivery mode

| Mode | Behavior |
|---|---|
| **Toast** | Uses the Windows notification system. Achievement and progress notifications use the achievement icon; playtime notifications can include game artwork and a progress bar. |
| **Overlay** | Opens a styled popup above the running game. The main library window may stay closed while the background tracker handles it. |
| **Both** | Sends the same event to the toast and overlay transports. |

Use the built-in test buttons after changing the mode. A successful test confirms the display path; a real unlock still depends on the relevant game source being watched correctly.

## Overlay presets

The app includes presets inspired by several console and PC notification styles. You can select a main preset and optional overrides for:

- rare achievements;
- 100% completion notifications;
- normal achievement unlocks.

Choose **Same as main** when a separate style is not needed.

## Create a custom preset

The preset builder changes the background, text, accent color, opacity, font size, icon size and corner radius while showing a live preview. Select **Create preset** to save the result to the local preset library.

Custom presets live in the Achievement Watcher data directory and are preserved when the application is updated.

## Sounds, volume and duration

- Import `.wav`, `.mp3` or `.ogg` files from the Notification settings.
- Overlay volume ranges from 0% to 200%. Values above 100% apply an overlay-side boost; Windows toast playback is limited by the system audio path.
- Duration can follow the preset automatically or use a fixed cap.
- Playtime notifications are silent by design.

## Position and interaction

Choose a corner, edge or centered position from the Notification settings. The custom position can be moved with **Reposition** and is stored for later sessions.

The in-game overlay also supports configured keyboard shortcuts for moving, snapping and click-through behavior. Controller overlay control is optional and can be enabled separately under the controller settings.

## Per-game behavior

Right-click a game to mute its progress notifications without disabling achievement unlocks or completion notifications. A duplicate guard also prevents the same unlock from appearing twice when a watched save is rewritten.

Achievements with a global unlock rate below the configured rare threshold display their rarity percentage and can use the rare preset.

## If a test or unlock does not appear

1. Confirm the selected mode is **Toast**, **Overlay** or **Both**, not disabled.
2. Check that the background tracker is running.
3. For overlays, select a valid preset and test again outside an exclusive fullscreen game.
4. Check Windows notification settings for Achievement Watcher when toasts are missing.
5. Open **Settings → Advanced → Diagnostics** and inspect the logs.

Continue with [Troubleshooting](troubleshooting.md#notifications-do-not-appear) if the problem remains.

[Back to the documentation index](README.md)
