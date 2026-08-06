# In-game overlay list

The in-game overlay (`Ctrl+Shift+K` by default while a supported game runs) shows the
achievement list of the running game without leaving it: names, descriptions,
lock state, unlock dates and progress. The window is draggable by its header
and stays on top of the game.

## What it shows

- A stats bar with `unlocked / total` and the completion percentage.
- One row per achievement with a colored status pill
  (`Unlocked` / `Locked`), the unlock date for earned achievements, and a
  progress bar + `current / max` label for progress achievements.
- A community-rarity badge (`★ 12.3%`) for every achievement with a known
  unlock rate (Epic/GOG official schemas and emulator sidecars). Common
  achievements use a dark-gray badge; rare ones use gold (<3%), silver (<6%)
  and bronze (≤10%) with a soft halo.

## Search and filters

- The search box filters rows by achievement name and description as you type.
- The pills above the list switch between **All**, **Unlocked**, **Locked** and
  **In progress**.
- Clicking the **Rarity**, **Date** or **Status** column header sorts ascending,
  then descending, then back to the natural order. Only one column sorts at a
  time, so activating another column resets the rest.
- Press `/` to focus the search box and `Esc` to clear it (or close the
  options panel if it is open).

## Controller (gamepad)

The in-game overlay can be driven entirely from a controller. Enable
**Settings → General → Controller** first:

- **BACK + START** opens/closes the overlay.
- **LB + X** toggles in-overlay navigation (a focus ring shows where you are).
- **RB + Y** toggles window move/resize mode.
- In navigation mode: D-pad/left stick move the focus, **A** confirms,
  **B** cancels, **X** focuses the search, **Y** opens the options panel.
- In window mode: the left stick moves the overlay, **LB/RB** resize it, and
  the D-pad moves it too when navigation is off.

Works with Xbox, PlayStation (DualShock 4 / DualSense) and Switch Pro
controllers. A small **UI / WIN** badge in the overlay header shows which mode
is active.

## Customization

Open the **⚙** button in the overlay header to customize the list:

- **Accent** — five color presets or a custom color picker (used for progress,
  active filters, focus rings and unlocked-row glow).
- **Density** — Compact, Cozy or Spacious row spacing.
- **Icon size** — Small, Medium or Large.
- **Zoom** — 80% to 125% of the panel size.
- **Show/hide toggles** for the stats bar, progress bars, rarity badges and
  descriptions.

Changes apply immediately and are saved locally, so they survive closing and
reopening the overlay. **Reset defaults** restores the original look.

## Keyboard shortcuts (overlay open)

- `Ctrl+Alt+Shift+Arrows` — nudge the overlay window.
- `Ctrl+Alt+Shift+1` … `5` — snap to a preset position.
- `Ctrl+Alt+Shift+C` — toggle click-through.

## Notes

- The overlay follows the interface language selected in the app.
- Row content is escaped before rendering; achievement data is only displayed,
  never executed.
- The overlay list is separate from the one-shot overlay *notification*
  presets (Settings → Notifications). Preset appearance is configured there.
