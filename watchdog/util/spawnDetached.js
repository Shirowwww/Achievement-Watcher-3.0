'use strict';

// `child_process.spawn()` reports a missing/quarantined executable through the ChildProcess' async
// `error` event. Without a listener, EventEmitter turns that into an uncaught exception and takes
// the entire Watchdog down. Keep the listener installation and `unref()` together so detached,
// best-effort launches always fail locally instead of crashing the daemon.
function spawnDetached(spawn, command, args, options, onError = () => {}) {
  const report = (error) => {
    try {
      onError(error);
    } catch {
      // Logging a best-effort launch failure must not introduce a second uncaught exception.
    }
  };

  let child;
  try {
    child = spawn(command, args, options);
  } catch (error) {
    report(error);
    return null;
  }

  if (!child) return null;
  if (typeof child.once === 'function') child.once('error', report);
  else if (typeof child.on === 'function') child.on('error', report);
  if (typeof child.unref === 'function') child.unref();
  return child;
}

module.exports = { spawnDetached };
