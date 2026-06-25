'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

// Synchronous registry string read via reg.exe. The old native ./reg helper was removed in the A2
// koffi migration (regodit is async-only); these getters are sync and best-effort, so shelling out to
// reg.exe keeps them dependency-free. Returns '' on any miss/error.
function readRegistryString(root, keyPath, name) {
  try {
    const key = root + '\\' + String(keyPath).replace(/\//g, '\\');
    const args = ['query', key];
    if (name) args.push('/v', name);
    else args.push('/ve');
    const out = execFileSync('reg', args, { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m);
    if (!m) return '';
    // Expand %SystemRoot%-style variables (REG_EXPAND_SZ values).
    return m[1].replace(/%([^%]+)%/g, (whole, n) => process.env[n] || whole);
  } catch {
    return '';
  }
}

module.exports.getDefault = () => {
  const _default_ = 'Windows Unlock.wav';

  try {
    const filepath = readRegistryString('HKCU', 'AppEvents/Schemes/Apps/.Default/WindowsUnlock/.Current', '');

    if (filepath) {
      return path.parse(filepath).base;
    } else {
      return _default_;
    }
  } catch {
    return _default_;
  }
};

module.exports.getCustom = () => {
  try {
    const filepath = readRegistryString('HKCU', 'AppEvents/Schemes/Apps/.Default/Notification.Achievement/.Current', '');

    if (filepath) {
      return filepath;
    } else {
      return '';
    }
  } catch {
    return '';
  }
};
