'use strict';

// Resolve overlay requests without mixing open, close and refresh state in the window code.
// Outcomes are ignore, close, refresh, reopen, open or fallback.
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

  // Nothing is open. Close and refresh only ever act on an existing window - treating them as an
  // implicit "open" is what made the overlay appear by itself on game exit (issue #19).
  if (wantedAction === 'close' || wantedAction === 'refresh') return { action: 'ignore' };
  return wanted === '0' ? { action: 'fallback' } : { action: 'open', appid: wanted };
}

module.exports = { resolveOverlayRequest };
