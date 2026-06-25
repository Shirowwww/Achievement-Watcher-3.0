'use strict';

// File-change events can fire while a game is still writing its save file.
// Retry short-lived parse failures or empty reads, then fall back to the
// caller's existing "no achievements" path.
async function parseWithRetry(producer, { attempts = 3, delayMs = 220, onError } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const list = await producer();
      if (Array.isArray(list) && list.length > 0) return list;
    } catch (err) {
      if (typeof onError === 'function') onError(err, i);
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return [];
}

module.exports = parseWithRetry;
