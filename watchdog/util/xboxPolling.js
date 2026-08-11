'use strict';

// Run one Xbox poll at a time for a state object. The current-state callback makes a poll
// cancellable when the running game changes while an API request or a notification is pending.
async function runXboxPoll({
  state,
  getCurrentState,
  ensureSession,
  pollOnce,
  writeState,
  beforeNotifications = () => {},
  notifyUnlock = async () => {},
  onError = () => {},
}) {
  const isCurrent = () => getCurrentState() === state;
  if (!state || !isCurrent() || state.polling) return false;

  state.polling = true;
  try {
    const auth = await ensureSession(state.auth);
    if (!isCurrent()) return false;
    state.auth = auth;

    const { snapshot, newUnlocked } = await pollOnce({
      auth,
      titleId: state.appid,
      previousSnapshot: state.snapshot,
    });
    if (!isCurrent()) return false;

    state.snapshot = snapshot;
    writeState(state.appid, snapshot);
    if (!newUnlocked.length) return true;

    beforeNotifications(newUnlocked);
    if (!isCurrent()) return false;
    for (const id of newUnlocked) {
      if (!isCurrent()) return false;
      await notifyUnlock(id);
      if (!isCurrent()) return false;
    }
    return true;
  } catch (error) {
    if (isCurrent()) onError(error);
    return false;
  } finally {
    state.polling = false;
  }
}

function matchesActiveXboxPoll(state, exitedGame, normalizeTitleId) {
  if (!exitedGame) return true;
  if (!state || String(exitedGame.source || '') !== 'Xbox PC') return false;
  return normalizeTitleId(exitedGame.appid) === state.appid;
}

module.exports = { runXboxPoll, matchesActiveXboxPoll };
