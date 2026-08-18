'use strict';

// Process listing for the playtime monitor and the "is the game running?" notification guard.
//
// The native ToolHelp snapshot (util/processSnapshot.js) is the fast path: no child process, ~6 ms
// against ~440 ms for a `tasklist.exe` round trip. `win-tasklist` stays as the fallback for any
// machine where koffi cannot load kernel32 - it is only reached after the native path throws once.

const snapshot = require('./processSnapshot.js');

let modulePromise;
let nativeBroken = false;

function loadWinTasklist() {
  modulePromise ||= import('win-tasklist');
  return modulePromise;
}

async function list() {
  if (!nativeBroken) {
    try {
      return snapshot.listSync();
    } catch {
      nativeBroken = true;
    }
  }
  const { default: tasklist } = await loadWinTasklist();
  return tasklist();
}

// Name-or-pid membership test. The native path answers it from the same snapshot instead of
// spawning a filtered `tasklist.exe`; this runs on every achievement unlock, per game binary.
//
// Membership, not liveness: win-tasklist's own isProcessRunning() filters on `STATUS eq RUNNING`,
// and `tasklist.exe` reports the state as "Unknown" for ordinary console-session processes on at
// least some Windows builds - so that call answers false for a process that is plainly running.
// `watchdog.js` uses this to decide whether an unlock belongs to a game that is on screen, and a
// false negative there silently drops the notification. Both paths below therefore ask only whether
// the process exists, which is also the right answer for a game busy enough to stop pumping
// messages ("Not Responding").
async function isProcessRunning(target, ...rest) {
  if (!nativeBroken && rest.length === 0) {
    try {
      const processes = snapshot.listSync();
      if (typeof target === 'number' || (typeof target === 'string' && target !== '' && !isNaN(target))) {
        const pid = Number(target);
        return processes.some((entry) => entry.pid === pid);
      }
      const name = String(target || '').toLowerCase();
      return name !== '' && processes.some((entry) => entry.process.toLowerCase() === name);
    } catch {
      nativeBroken = true;
    }
  }
  // hasProcess(), not isProcessRunning(): see above.
  const { hasProcess } = await loadWinTasklist();
  return hasProcess(target, ...rest);
}

// Whether the fast path is still the one being used. A silent fall back to win-tasklist restores
// ~440 ms of work every 3 s with no other symptom, so the playtime monitor logs this on startup.
function usingNativeSnapshot() {
  return !nativeBroken && snapshot.isAvailable();
}

module.exports = { list, isProcessRunning, getProcessPath: snapshot.getProcessPath, usingNativeSnapshot };
