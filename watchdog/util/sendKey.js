'use strict';

// Minimal Win32 keyboard injection for the "send Escape when the overlay opens via controller"
// setting. koffi is loaded lazily (it is already a runtime dependency of the controller stack) so
// the watchdog stays light when the feature is unused.

const VK_ESCAPE = 0x1b;
const KEYEVENTF_SCANCODE = 0x0008;
const KEYEVENTF_KEYUP = 0x0002;
// Physical "make" scan code for Escape on a 101/104-key layout.
const ESCAPE_SCAN_CODE = 0x01;

let cachedKoffi = null;
let cachedKoffiError = null;

function loadKoffi() {
  if (cachedKoffiError) throw cachedKoffiError;
  if (cachedKoffi) return cachedKoffi;
  try {
    cachedKoffi = require('koffi');
    return cachedKoffi;
  } catch (err) {
    err.message = `Failed to load koffi: ${err.message || String(err)}`;
    cachedKoffiError = err;
    throw err;
  }
}

// Separated from the singleton so tests can inject a fake koffi and never touch the real keyboard.
function createKeySender({
  koffi = null,
  log = null,
  platform = process.platform,
  excludePids = null,
  getForegroundPid = null,
} = {}) {
  const logger = typeof log === 'function' ? log : () => {};
  const excluded = new Set(
    (Array.isArray(excludePids) ? excludePids : [])
      .map((pid) => Number(pid))
      .filter((pid) => Number.isFinite(pid) && pid > 0)
  );
  let keybdEvent = null;
  let getForegroundWindow = null;
  let getWindowThreadProcessId = null;
  let failureLogged = false;

  function ensureNative() {
    const lib = (koffi || loadKoffi()).load('user32.dll');
    keybdEvent = lib.func(
      'void __stdcall keybd_event(uint32_t bVk, uint32_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)'
    );
    getForegroundWindow = lib.func('void * __stdcall GetForegroundWindow(void)');
    getWindowThreadProcessId = lib.func(
      'uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *processId)'
    );
  }

  function foregroundBelongsToExcludedPid() {
    if (excluded.size === 0) return false;
    let foregroundPid;
    if (typeof getForegroundPid === 'function') {
      foregroundPid = Number(getForegroundPid() || 0);
    } else {
      const hwnd = getForegroundWindow();
      if (!hwnd) return false;
      const pidOut = [0];
      getWindowThreadProcessId(hwnd, pidOut);
      foregroundPid = Number(pidOut[0] || 0);
    }
    return foregroundPid > 0 && excluded.has(foregroundPid);
  }

  return {
    // Sends Escape to the window that currently has keyboard focus (the game while the overlay is
    // opening). Returns true when both the down and up events were injected.
    sendEscape() {
      if (platform !== 'win32') return false;
      try {
        if (!keybdEvent) ensureNative();
        // Never let Escape land on the Achievement Watcher window itself: the option is meant for
        // the game, and the user might press the combo while the app has focus.
        if (foregroundBelongsToExcludedPid()) return false;
        keybdEvent(0, ESCAPE_SCAN_CODE, KEYEVENTF_SCANCODE, 0);
        keybdEvent(0, ESCAPE_SCAN_CODE, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP, 0);
        return true;
      } catch (err) {
        if (!failureLogged) {
          failureLogged = true;
          logger(`[controller] failed to send Escape: ${err && err.message ? err.message : err}`);
        }
        return false;
      }
    },
    // The main window's renderer OS PID does not exist yet at watchdog spawn time on a fresh
    // launch (createMainWindow() runs after launchWatchdog()), so AW_APP_PIDS alone cannot cover
    // it. The main process calls this once the window is actually created.
    addExcludedPid(pid) {
      const value = Number(pid);
      if (Number.isFinite(value) && value > 0) excluded.add(value);
    },
  };
}

const defaultSender = createKeySender({
  excludePids: String(process.env.AW_APP_PIDS || '')
    .split(',')
    .map((value) => Number(value))
    .filter((pid) => Number.isFinite(pid) && pid > 0),
  log: (message) => {
    try {
      console.warn(message);
    } catch {}
  },
});

function sendEscapeToFocusedWindow() {
  return defaultSender.sendEscape();
}

function addExcludedPid(pid) {
  defaultSender.addExcludedPid(pid);
}

module.exports = {
  createKeySender,
  sendEscapeToFocusedWindow,
  addExcludedPid,
  VK_ESCAPE,
  KEYEVENTF_SCANCODE,
  KEYEVENTF_KEYUP,
  ESCAPE_SCAN_CODE,
};
