'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

// init.js is the Electron main process and cannot be required here, so the supervisor's state
// machine is reproduced from its source and driven directly. The point of the test is the
// interaction between the two functions, which is where the bug lived.
const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'electron', 'init.js'), 'utf8');

test('launchWatchdog clears the respawn handle instead of only cancelling the timer', () => {
  // scheduleMonitorRespawn() early-returns while monitorRespawnTimer is truthy. Cancelling the timer
  // without nulling the handle left the scheduler permanently "busy": a manual restart landing on a
  // pending respawn disabled supervised respawn for the rest of the session, so the next monitor
  // crash silently ended notifications and playtime tracking.
  const body = /function launchWatchdog\(\) \{([\s\S]*?)\n  const baseDir/.exec(source);
  assert.ok(body, 'launchWatchdog() preamble not found');
  assert.match(body[1], /clearTimeout\(monitorRespawnTimer\)/);
  assert.match(body[1], /monitorRespawnTimer\s*=\s*null/, 'the handle must be reset, not just cleared');
});

test('a manual restart during a pending respawn leaves the scheduler armed', () => {
  // Faithful reproduction of the two functions' shared state.
  let monitorRespawnTimer = null;
  let monitorRespawnDelay = 3000;
  let launches = 0;
  const isQuiting = false;
  const timers = new Map();
  let nextId = 1;

  const setT = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { fn, ms });
    return id;
  };
  const clearT = (id) => timers.delete(id);

  function scheduleMonitorRespawn() {
    if (isQuiting || monitorRespawnTimer) return;
    const delay = monitorRespawnDelay;
    monitorRespawnDelay = Math.min(monitorRespawnDelay * 2, 60000);
    monitorRespawnTimer = setT(() => {
      monitorRespawnTimer = null;
      launchWatchdog();
    }, delay);
  }

  function launchWatchdog() {
    clearT(monitorRespawnTimer);
    monitorRespawnTimer = null; // the fix
    launches += 1;
  }

  // The monitor crashes: a respawn is queued.
  scheduleMonitorRespawn();
  assert.notEqual(monitorRespawnTimer, null, 'a respawn should be pending');

  // The user hits "Restart monitor" before it fires.
  launchWatchdog();
  assert.equal(launches, 1);
  assert.equal(timers.size, 0, 'the pending respawn timer must have been cancelled');

  // The monitor crashes again — supervision must still work.
  scheduleMonitorRespawn();
  assert.notEqual(monitorRespawnTimer, null, 'the supervisor must still be able to queue a respawn');

  const pending = timers.get(monitorRespawnTimer);
  assert.ok(pending, 'the queued respawn must be a live timer');
  pending.fn();
  assert.equal(launches, 2, 'the queued respawn must actually relaunch the monitor');
  assert.equal(monitorRespawnTimer, null);
});

test('the main window renderer PID reaches the watchdog even when it does not exist yet at spawn time', () => {
  // launchWatchdog() runs before createMainWindow() on a fresh launch (see the call sites in
  // app.whenReady()), so AW_APP_PIDS alone can only ever carry the browser-process PID at that
  // point. createMainWindow() must separately push the renderer PID over the IPC channel once it
  // exists, or "send Escape to the game, never to AW" never protects the main window until the
  // watchdog happens to respawn.
  assert.match(
    source,
    /AW_APP_PIDS:\s*\[String\(process\.pid\),\s*getRendererPid\(\)\]/,
    'AW_APP_PIDS should still cover the common respawn case'
  );
  assert.match(source, /function notifyWatchdogOfAppPid\(\)/);
  assert.match(source, /monitorProc\.send\(\{\s*appPid:\s*rendererPid\s*\}\)/);

  const createMainWindowBody = /function createMainWindow\(\) \{([\s\S]*?)\n {4}\/\/ A download started/.exec(source);
  assert.ok(createMainWindowBody, 'createMainWindow() preamble not found');
  assert.match(
    createMainWindowBody[1],
    /MainWin = new BrowserWindow\(options\);[\s\S]*notifyWatchdogOfAppPid\(\);/,
    'the renderer PID must be pushed right after MainWin is created, not deferred to a later event'
  );

  const launchWatchdogIndex = source.indexOf('launchWatchdog();');
  const createMainWindowCallIndex = source.indexOf('parseArgs(startupArgs)');
  assert.ok(launchWatchdogIndex >= 0 && createMainWindowCallIndex >= 0);
  assert.ok(
    launchWatchdogIndex < createMainWindowCallIndex,
    'documents why AW_APP_PIDS alone is insufficient: the watchdog spawns before the window does'
  );
});

test('the watchdog applies a late-arriving appPid instead of only trusting AW_APP_PIDS', () => {
  const watchdogSource = fs.readFileSync(path.join(__dirname, '..', 'watchdog', 'watchdog.js'), 'utf8');
  assert.match(watchdogSource, /require\('\.\/util\/sendKey\.js'\)/);
  assert.match(watchdogSource, /if \(msg\.appPid !== undefined\) \{/);
  assert.match(watchdogSource, /addExcludedPid\(msg\.appPid\)/);
});
