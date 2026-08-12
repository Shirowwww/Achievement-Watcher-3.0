'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createKeySender,
  VK_ESCAPE,
  ESCAPE_SCAN_CODE,
  KEYEVENTF_SCANCODE,
  KEYEVENTF_KEYUP,
} = require('../util/sendKey.js');

test('injects an Escape scancode press and release through user32', () => {
  const calls = [];
  const fakeLib = {
    func(signature) {
      if (!/keybd_event/.test(signature)) {
        // GetForegroundWindow / GetWindowThreadProcessId stubs are never consulted here
        // (no excludePid), but ensureNative() still resolves them.
        return () => 0;
      }
      return (bVk, bScan, dwFlags, dwExtraInfo) => {
        calls.push({ bVk, bScan, dwFlags, dwExtraInfo });
      };
    },
  };
  const fakeKoffi = {
    load(name) {
      assert.equal(name, 'user32.dll');
      return fakeLib;
    },
  };

  const sender = createKeySender({ koffi: fakeKoffi, platform: 'win32' });
  assert.equal(sender.sendEscape(), true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].bVk, 0);
  assert.equal(calls[0].bScan, ESCAPE_SCAN_CODE);
  assert.equal(calls[0].dwFlags, KEYEVENTF_SCANCODE);
  assert.equal(calls[1].bVk, 0);
  assert.equal(calls[1].bScan, ESCAPE_SCAN_CODE);
  assert.equal(calls[1].dwFlags, KEYEVENTF_SCANCODE | KEYEVENTF_KEYUP);
});

test('never injects input on non-Windows platforms', () => {
  let loaded = false;
  const fakeKoffi = {
    load() {
      loaded = true;
      throw new Error('should not load');
    },
  };
  const sender = createKeySender({ koffi: fakeKoffi, platform: 'linux' });
  assert.equal(sender.sendEscape(), false);
  assert.equal(loaded, false);
});

test('fails softly when user32 cannot be loaded and logs only once', () => {
  const logs = [];
  const fakeKoffi = {
    load() {
      throw new Error('boom');
    },
  };
  const sender = createKeySender({ koffi: fakeKoffi, platform: 'win32', log: (msg) => logs.push(msg) });
  assert.equal(sender.sendEscape(), false);
  assert.equal(sender.sendEscape(), false);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /boom/);
});

test('skips injection when the focused window is the excluded app', () => {
  const calls = [];
  const fakeKoffi = {
    load() {
      return {
        func() {
          return (...args) => calls.push(args);
        },
      };
    },
  };
  const sender = createKeySender({
    koffi: fakeKoffi,
    platform: 'win32',
    excludePids: [111, 4242],
    getForegroundPid: () => 4242,
  });
  assert.equal(sender.sendEscape(), false);
  assert.equal(calls.length, 0, 'no keyboard event may be injected into the app itself');
});

test('injects normally when the focused window belongs to the game', () => {
  const calls = [];
  const fakeKoffi = {
    load() {
      return {
        func() {
          return (...args) => calls.push(args);
        },
      };
    },
  };
  const sender = createKeySender({
    koffi: fakeKoffi,
    platform: 'win32',
    excludePids: [4242],
    getForegroundPid: () => 7777,
  });
  assert.equal(sender.sendEscape(), true);
  assert.equal(calls.length, 2);
});

test('addExcludedPid extends the exclusion set after creation (renderer PID arriving late over IPC)', () => {
  const calls = [];
  const fakeKoffi = {
    load() {
      return {
        func() {
          return (...args) => calls.push(args);
        },
      };
    },
  };
  const sender = createKeySender({
    koffi: fakeKoffi,
    platform: 'win32',
    excludePids: [111],
    getForegroundPid: () => 9999,
  });
  assert.equal(sender.sendEscape(), true, 'not excluded yet');
  assert.equal(calls.length, 2);

  sender.addExcludedPid(9999);
  assert.equal(sender.sendEscape(), false, 'now excluded');
  assert.equal(calls.length, 2, 'no extra injection happened');
});

test('addExcludedPid ignores non-positive or non-finite values instead of excluding pid 0', () => {
  const calls = [];
  const fakeKoffi = {
    load() {
      return {
        func() {
          return (...args) => calls.push(args);
        },
      };
    },
  };
  const sender = createKeySender({
    koffi: fakeKoffi,
    platform: 'win32',
    excludePids: [],
    getForegroundPid: () => 0,
  });
  sender.addExcludedPid(0);
  sender.addExcludedPid(-5);
  sender.addExcludedPid(NaN);
  sender.addExcludedPid('nope');
  // foregroundBelongsToExcludedPid() only short-circuits on a non-empty set; junk input must not
  // have added anything, or a foreground pid of 0 (no window) would wrongly count as excluded.
  assert.equal(sender.sendEscape(), true);
  assert.equal(calls.length, 2);
});

test('exposes the Escape virtual-key and scancode constants', () => {
  assert.equal(VK_ESCAPE, 0x1b);
  assert.equal(ESCAPE_SCAN_CODE, 0x01);
  assert.equal(KEYEVENTF_SCANCODE, 0x0008);
  assert.equal(KEYEVENTF_KEYUP, 0x0002);
});
