# In-game overlay list

The in-game overlay (`Ctrl+Shift+O` while a supported game runs) shows the
achievement list of the running game without leaving it: names, descriptions,
lock state, unlock dates and progress. The window is draggable by its header
and stays on top of the game.

## What it shows

- A stats bar with `unlocked / total` and the completion percentage.
- One row per achievement with a colored status pill
  (`Unlocked` / `Locked`), the unlock date for earned achievements, and a
  progress bar + `current / max` label for progress achievements.
- A community-rarity badge (`★ 12.3%`) when the source provides rarity
  (Epic/GOG official schemas and emulator sidecars). Sources without rarity
  simply don't show a badge.

## Search and filters

- The search box filters rows by achievement name and description as you type.
- The pills above the list switch between **All**, **Unlocked**, **Locked** and
  **In progress**.
- Clicking the **Achievement** or **Status** column header sorts ascending,
  then descending, then back to the natural order.
- Press `/` to focus the search box and `Esc` to clear it (or close the
  options panel if it is open).

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

## Notes

- The overlay follows the interface language selected in the app.
- Row content is escaped before rendering; achievement data is only displayed,
  never executed.
- The overlay list is separate from the one-shot overlay *notification*
  presets (Settings → Notifications). Preset appearance is configured there.
