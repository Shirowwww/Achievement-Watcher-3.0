'use strict';

// regodit is ESM-only (koffi); load it lazily and use the SYNC API — under the pinned koffi the async
// DWORD write segfaults after storing `total`, which is why `last` never reached the registry.
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
