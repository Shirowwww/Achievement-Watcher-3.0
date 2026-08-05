# Achievement Watcher 3.6.1

Theming release: themes now recolor the whole app instead of just Settings, three new
built-in palettes join the lineup, and a batch of hardcoded colors and localization gaps
found while auditing the theme system are fixed.

## Highlights

- **Themes are truly global.** Built-in themes (now including new Nord, Gruvbox and Tokyo
  Night palettes alongside Steam Blue, OLED Black, Dracula and Graphite) and the Custom
  theme recolor the window, library, game cards, achievements and dialogs, and the in-game
  overlay follows the active theme through a "Use app theme" toggle (off by default).
- **Custom theme images.** Pick a color and, per layer (window, header, library panel,
  cards/rows, Settings window), an optional background image with Cover/Contain/Repeat/
  Stretch fit and a veil or blur effect. Adding, replacing or removing an image never resets
  other layers' colors.
- **Settings no longer inherits the card color.** The Settings window and the executable
  configuration modal had been picking up the "Cards & tiles" layer's color instead of
  their own; they're now fully independent.
- **~50 hardcoded colors replaced with theme variables** across the title bar, achievement
  icons, the Uplay achievement-page banner, search bars and dialogs, so every theme
  actually reaches the whole app.
- **More localized.** The executable configuration modal, the footer update-button status,
  and the blacklist add-by-AppID field are now translated in all 18 bundled locales.
- **Overlay hotkey defaults to Ctrl+Shift+K** and toggles the overlay even with no game
  running; it was silently defaulting to Ctrl+Shift+O in code while the UI already showed K.

## Install

Download `Achievement.Watcher.Setup.3.6.1.exe` from the
[v3.6.1 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.6.1).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Upgrading preserves data.

See the [changelog](CHANGELOG.md#361---2026-08-06) for the full list of changes.
