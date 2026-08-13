'use strict';

const fs = require('fs');

// A change event can fire mid-write; poll size+mtime until two consecutive samples match (or
// maxWaitMs elapses) — node-watch's equivalent of chokidar's awaitWriteFinish.
async function waitForFileStable(filePath, { intervalMs = 120, maxWaitMs = 1200 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let previous = null;

  while (Date.now() < deadline) {
    let sample;
    try {
      const st = await fs.promises.stat(filePath);
      sample = `${st.size}:${st.mtimeMs}`;
    } catch {
      return; // file vanished or is momentarily unreadable — let the caller's parse/retry handle it
    }

    if (previous !== null && sample === previous) return; // two identical samples → writer settled
    previous = sample;

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

module.exports = waitForFileStable;
