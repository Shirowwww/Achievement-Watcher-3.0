'use strict';

// regodit is ESM-only (koffi) since v2; load it lazily via dynamic import (cached by Node's module
// registry). The async API now lives at the dedicated `regodit/promises` subpath (the `.promises`
// namespace was removed in v2), and the functions were renamed PascalCase -> camelCase.
let regeditPromise = null;
const loadRegedit = () => regeditPromise || (regeditPromise = import('regodit/promises'));

module.exports = async (appID, time) => {
  const regedit = await loadRegedit();
  const key = 'Software/Achievement Watcher/Playtime/Steam/' + appID;

  const current = +(await regedit.regQueryIntegerValue('HKCU', key, 'total')) || 0;
  await regedit.regWriteDwordValue('HKCU', key, 'total', current + time);

  const last = Math.floor(Date.now() / 1000);
  await regedit.regWriteDwordValue('HKCU', key, 'last', last);
};
