'use strict';

const fs = require('node:fs');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// Chromium can return from close/forced termination before Windows releases profile files.
// Retry EPERM explicitly: fs.rm's built-in maxRetries does not cover every directory-lock shape.
async function removeBrowserProfile(directory, releaseLocks) {
  if (!directory) return true;
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fs.promises.rm(directory, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (error && error.code === 'ENOENT') return true;
      lastError = error;
      if (typeof releaseLocks === 'function' && attempt % 10 === 9) releaseLocks(directory);
      await wait(100);
    }
  }

  // A cleanup-only OS lock must not turn a completed DOM assertion into a failed product test.
  process.emitWarning(`Could not remove temporary browser profile ${directory}: ${lastError?.message || lastError}`);
  return false;
}

module.exports = { removeBrowserProfile };
