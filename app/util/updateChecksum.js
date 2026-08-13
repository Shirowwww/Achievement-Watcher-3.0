'use strict';

// electron-updater raises this specific error when a downloaded file's sha512 doesn't match the
// release metadata — the exact symptom of a corrupted or stale cached download. Pulled out of
// init.js so the classification itself is unit-testable without an Electron runtime.
function isChecksumMismatchError(err) {
  if (!err) return false;
  if (err.code === 'ERR_CHECKSUM_MISMATCH') return true;
  const message = err.message ? String(err.message) : String(err);
  return /checksum mismatch/i.test(message);
}

module.exports = { isChecksumMismatchError };
