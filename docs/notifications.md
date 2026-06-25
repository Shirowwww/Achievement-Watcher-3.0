# Notifications

Achievement Watcher can announce unlocks in two ways. Configure them in
**Settings → Notification**.

## Delivery mode

- **Toast** — native Windows notifications. Achievement and progress toasts show a round
  icon; playtime toasts show the game's hero image and a progress bar.
- **Overlay** — a styled popup drawn on top of the running game, using a preset and an
  optional sound. It works even when only the background tracker is running (the window
  can be closed).
- **Both** — show the toast *and* the overlay.

## Presets and the custom builder

The overlay ships with a library of presets. To make your own, open the **custom preset
builder** in the Notification tab:

- Set the name, background / text / accent colours, opacity, font size, corner radius and
  icon size.
- Watch the live **Achievement Unlocked** preview update as you tweak it.
- Click **Create preset** — it's saved to your library and selected automatically. No
  HTML/CSS required.

## Sounds, volume and duration

- **Import** your own `.wav` / `.mp3` / `.ogg` next to the built-in sounds (stored under
  your AppData).
- **Volume** (0–200%) and **Duration** (Auto, or a 2–10 s cap) controls for the overlay.
  Playtime notifications are silent by design.

## Position

The overlay can be nudged, snapped to corners/centre and made click-through with keyboard
shortcuts, and it remembers where you put it. The notification popup also has a **Custom**
position with a **Reposition** button — drag it where you want.

## Per-game and quality options

- **Mute progress notifications** per game from its right-click menu (unlock and platinum
  toasts still fire).
- **"Rare · X%"** labels appear for achievements unlocked by fewer than 10% of players.
- A duplicate guard prevents the same unlock from popping twice when a save is rewritten.

## Testing

Use the **Test** buttons in Settings → Notification (and the Diagnostics tab) to preview
toasts and the overlay without launching a game.
