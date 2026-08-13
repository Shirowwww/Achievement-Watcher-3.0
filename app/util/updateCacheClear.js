'use strict';

const fs = require('fs');

// Wipes an electron-updater download-cache directory: resets the helper's in-memory record of
// what it has on disk (its own `.clear()`, which also empties the pending/ subfolder), then
// removes everything else under `.cacheDir` too — including the differential-download base file
// and current.blockmap, which `.clear()` alone does not touch. Takes the helper instance (from
// `autoUpdater.getOrCreateDownloadHelper()`) rather than recomputing the path by hand, so this
// stays correct if electron-updater ever changes its cache layout.
async function clearUpdaterCacheDir(helper, { onHelperClearError } = {}) {
  const cacheDir = helper.cacheDir;
  try {
    await helper.clear();
  } catch (err) {
    if (onHelperClearError) onHelperClearError(err);
  }
  await fs.promises.rm(cacheDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  return cacheDir;
}

module.exports = { clearUpdaterCacheDir };
