'use strict';

/*
  Which of the four title-bar states the Watchdog monitor is in.

  The app supervises the monitor as a child process over an IPC channel, and separately probes the
  monitor's named pipe. Neither proves the monitor is doing anything: a process whose event loop is
  wedged keeps its channel open and its pipe listening while tracking nothing at all. The monitor
  therefore pings over IPC on a timer (watchdog/watchdog.js), which only a turning event loop can
  do, and this reduces those observations to one state.

  Kept free of Electron and of process handles so it can be exercised directly.
*/

// Four missed beats (the monitor pings every 5s). Long enough that a GC pause or a slow WQL call
// never flickers the indicator, short enough that a wedged monitor is reported inside half a minute.
const HEARTBEAT_STALE_MS = 20000;

// A cold start does real work before its event loop is free (koffi bindings, WQL/COM security init,
// the single-instance lock), so silence right after a spawn means "starting", not "wedged".
const HEARTBEAT_GRACE_MS = 30000;

/*
  `alive` is whether a supervised child exists at all. When it does not, the answer is null rather
  than 'stopped': the caller still has the named-pipe probe, which is the only thing that can see a
  monitor this process did not spawn (a dev run, or one started by hand).
*/
function deriveWatchdogState({ alive, startedAt = 0, heartbeatAt = 0, now = Date.now() } = {}) {
  if (!alive) return null;
  if (heartbeatAt > 0) return now - heartbeatAt <= HEARTBEAT_STALE_MS ? 'running' : 'unresponsive';
  return now - startedAt <= HEARTBEAT_GRACE_MS ? 'starting' : 'unresponsive';
}

module.exports = { deriveWatchdogState, HEARTBEAT_STALE_MS, HEARTBEAT_GRACE_MS };
