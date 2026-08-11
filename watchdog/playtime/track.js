'use strict';

// regodit is ESM-only (koffi) since v2; load it lazily via dynamic import (cached by Node's module
// registry). We deliberately use the synchronous API, not `regodit/promises`: under the pinned
// koffi 3.x the async DWORD write completes but then segfaults (0xC0000005), killing the Watchdog
// right after `total` is stored — which is why `last` never made it to the registry and the
// "recently played" sort stayed empty. The sync calls on the same DLL are unaffected, and this
// runs once per game exit.
let regeditPromise = null;
const loadRegedit = () => regeditPromise || (regeditPromise = import('regodit'));

module.exports = async (appID, time) => {
  const regedit = await loadRegedit();
  // 3.x uses its own registry namespace so the legacy 1.6.8 uninstaller (which removes the old
  // "Achievement Watcher" app key) cannot wipe playtime data either (issue #6).
  const key = 'Software/Achievement Watcher 3.0/Playtime/Steam/' + appID;

  const current = +regedit.regQueryIntegerValue('HKCU', key, 'total') || 0;
  regedit.regWriteDwordValue('HKCU', key, 'total', current + time);
  regedit.regWriteDwordValue('HKCU', key, 'last', Math.floor(Date.now() / 1000));
};
