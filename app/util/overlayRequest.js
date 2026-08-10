'use strict';

// Decides what an incoming in-game overlay request means, given what is currently on screen.
//
// Requests reach the main process from three places — the Watchdog hotkey, the controller service
// and the playtime monitor — as `{ appid, action }` pairs, and the same pair means different things
// depending on whether an overlay window is already open. Keeping that decision here (instead of
// inline in createOverlayWindow's branch chain) makes it unit-testable, which is how issue #19 was
// caught: a `close` request arriving with NO overlay open fell through to the open path and popped
// the overlay onto the desktop right after the game exited.
//
// Outcomes:
//   ignore   — nothing to do
//   close    — close the open overlay
//   refresh  — push fresh achievement data into the open overlay
//   reopen   — the running game changed: close the current overlay, then open the new game's
//   open     — open the overlay for `appid`
//   fallback — appid 0 (hotkey pressed with no game running): resolve a game, then open
function resolveOverlayRequest({ action, appid, isOpen, openAppid } = {}) {
  const wanted = String(appid == null ? '' : appid).trim();
  const current = String(openAppid == null ? '' : openAppid).trim();
  const wantedAction = String(action || 'open');

  if (isOpen) {
    if (wantedAction === 'close') return { action: 'close' };
    if (wantedAction === 'refresh') return { action: 'refresh', appid: wanted };
    // A fallback overlay is already showing something: a second appid-less open is a no-op.
    if (wanted === '0') return { action: 'ignore' };
    if (current && current !== wanted) return { action: 'reopen', appid: wanted };
    return { action: 'ignore' }; // same game already shown
  }

  // Nothing is open. Close and refresh only ever act on an existing window — treating them as an
  // implicit "open" is what made the overlay appear by itself on game exit (issue #19).
  if (wantedAction === 'close' || wantedAction === 'refresh') return { action: 'ignore' };
  return wanted === '0' ? { action: 'fallback' } : { action: 'open', appid: wanted };
}

module.exports = { resolveOverlayRequest };
