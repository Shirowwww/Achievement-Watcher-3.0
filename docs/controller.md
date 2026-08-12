# Controller (gamepad) guide

Achievement Watcher can be driven with a gamepad in two places: the main
window and the in-game overlay. Both are controlled from the same place:
**Settings → Controller**.

## Enable and configure

Open **Settings → Controller** and enable **Control the in-game overlay with
a controller**. The same section also has:

- **Control the app with a controller** — gamepad navigation of the main
  Achievement Watcher window (library, game details, settings and searches),
  independent from the overlay.
- **Controller layout** — the vocabulary used for the shortcut hints and
  button names: **Auto** (follows the connected pad when it can be
  identified), **Xbox**, **PlayStation** or **Switch**.
- **Bindings** — each shortcut accepts one to three buttons. The defaults are
  **Back + Start** to open/close the overlay, **LB + X** to toggle overlay
  navigation, and **LB + RB** (held) to move and scroll the overlay.
- **Focus overlay when it opens** — gives the overlay keyboard focus when it
  opens. Many games pause when they lose focus.
- **Send Escape to the game when opening with controller** — sends an Escape
  key press to the focused game before the overlay opens, so many games pause
  or open their menu. It only runs for controller-triggered opens while a game
  is running, never for the keyboard hotkey.

## App window

With app navigation enabled, pressing any gamepad button in the main window
activates a focus ring. D-pad or left stick move between interactive controls;
**A** confirms, **B** goes back or cancels, **X** focuses the search, and **Y**
or **Start** opens Settings. While Settings is open, **LB** and **RB** switch
tabs. Moving the mouse or pressing a keyboard key returns control to the mouse
and keyboard.

## In-game overlay

The overlay defaults are covered in the [overlay guide](overlay.md#controller-gamepad).
In short: **Back + Start** opens or closes the overlay, **LB + X** toggles
navigation mode (D-pad/left stick move the focus, **A** confirms, **B** cancels,
**X** searches, **Y** opens the options), and holding **LB + RB** moves the
overlay with the left stick and scrolls with the right stick. The header shows
a small **UI** badge while navigation is active, and the hint bar always shows
your configured shortcuts and layout.

> **Windows input caveat:** Windows does not allow a third-party app to capture
> a controller exclusively, so the game may still receive button input while
> the overlay is open. If you want the game to pause, enable **Focus overlay
> when it opens** (most games pause when they lose focus) or **Send Escape to
> the game when opening with controller**.

## Supported pads

Xbox controllers, PlayStation DualShock 4 / DualSense and Switch Pro
controllers are supported through the selected backend (Auto, XInput or
GameInput).

<p align="center"><a href="README.md">← Documentation</a> · <a href="overlay.md">Overlay guide</a> · <a href="../README.md">Project home</a></p>
