'use strict';

/*
  Overlay delivery acknowledgements.

  An overlay popup is not drawn by this process: the args go over the IPC channel and the resident
  app renders them. `process.send()` returning true only means the pipe accepted the bytes, so the
  app reports back what it did with them (see init.js reportNotificationOutcome):

    stage 'accepted'  the request was understood and a usable preset exists - ok:false here means the
                      popup will definitely never appear
    stage 'rendered'  the popup window loaded (ok:true) or failed to load (ok:false)

  The delivery layer waits for the first stage only, and falls back to a toast solely on an explicit
  ok:false. A missing answer resolves as 'unknown' and never produces a second notification for the
  same event - it downgrades the transport for the NEXT one instead (transportPolicy cooldown), which
  is the only way to react to silence without risking a duplicate.
*/

const RESULT = { ACCEPTED: 'accepted', REJECTED: 'rejected', UNKNOWN: 'unknown' };

// How long an answer stays available after the request. Entries are kept rather than cleared on the
// first report so a reply that beats its own wait still counts (see wait() below); the TTL is what
// stops the map growing over a long session.
const ENTRY_TTL_MS = 60000;
const DEFAULT_TIMEOUT_MS = 3000;

let sequence = 0;
const pending = new Map();
const listeners = new Set();

function nextId() {
  sequence += 1;
  return `${process.pid}-${Date.now().toString(36)}-${sequence}`;
}

// `meta` travels with the acknowledgement so a late render failure can still be attributed to its game.
function track(id, meta = {}) {
  const entry = { meta, settle: null, at: Date.now() };
  entry.expiry = setTimeout(() => pending.delete(id), ENTRY_TTL_MS);
  if (typeof entry.expiry.unref === 'function') entry.expiry.unref();
  pending.set(id, entry);
  return id;
}

// Resolves 'accepted' | 'rejected' | 'unknown'. Never rejects: a delivery decision must not depend
// on error handling around it.
function wait(id, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const entry = pending.get(id);
  if (!entry) return Promise.resolve(RESULT.UNKNOWN);
  // The answer can be here already - a local IPC round trip is fast, and a request rejected inside
  // this process is answered on the spot. Losing it because nobody was waiting yet would turn a
  // known failure into "no report", i.e. into a notification the user never gets.
  if (entry.result) return Promise.resolve(entry.result);
  return new Promise((resolve) => {
    // Deliberately not unref'd, unlike the TTL timer above: this one is the answer. Left unref'd it
    // lets the event loop drain while a caller is still awaiting, and the promise never settles.
    const timer = setTimeout(() => {
      entry.settle = null;
      resolve(RESULT.UNKNOWN);
    }, timeoutMs);
    entry.settle = (value) => {
      clearTimeout(timer);
      entry.settle = null;
      resolve(value);
    };
  });
}

function report(id, result = {}) {
  const entry = pending.get(id);
  const stage = String(result.stage || '');
  const ok = result.ok === true;

  if (entry) {
    const outcome = ok ? RESULT.ACCEPTED : RESULT.REJECTED;
    // Entries are only ever dropped by their TTL: a result kept for the full window is what lets a
    // reply that arrives before (or after) the wait still count.
    entry.result = outcome;
    if (entry.settle) entry.settle(outcome);
  }

  const payload = { id, stage, ok, reason: String(result.reason || ''), meta: (entry && entry.meta) || {} };
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      /* a health listener must never break delivery */
    }
  }
}

function onResult(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function _reset() {
  for (const entry of pending.values()) clearTimeout(entry.expiry);
  pending.clear();
  listeners.clear();
  sequence = 0;
}

module.exports = { nextId, track, wait, report, onResult, RESULT, DEFAULT_TIMEOUT_MS, ENTRY_TTL_MS, _reset };
