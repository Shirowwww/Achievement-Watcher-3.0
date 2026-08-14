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

<div align="center">
<img src="../screenshot/notification-preset.png" width="480" alt="Custom notification preset builder"><br>
<sub>Colors, sizing and a live sample popup that updates as you go</sub>
</div>

Set the background, text and accent colors, then the opacity, font size, corner radius, icon size and popup width. Each slider shows its current value, and the sample popup under the controls updates as you go - it is painted from your colors, not from the app theme, so it shows what the notification will look like in a game.

| Action | What it does |
| --- | --- |
| **Preview** | Renders the design as a real overlay popup, at full size and in the configured position, **without saving it**. Use it to compare ideas without filling the preset list. |
| **Create preset** | Saves it and selects it as the active preset. |
| **Update preset** | The same button, once the name matches a preset the builder made - it replaces that preset instead of adding another. |
| **Edit a preset** | Loads one of your generated presets back into the controls. Every value returns exactly as saved. |
| **Delete** | Appears once a generated preset is loaded, and removes it after a confirmation. |

Only presets this builder generated can be re-opened or deleted: it stores its settings in an `aw-preset.json` beside the generated files, and that file is what makes a preset editable. Bundled presets and hand-written ones are never touched.

> [!NOTE]
> **Custom presets are stored in** `%APPDATA%\Achievement Watcher Next\presets\Users Presets`, not in the installation folder. They survive app updates.

## Sounds, volume and duration

- Import `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a` or `.aac` files from the Notification settings.
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
