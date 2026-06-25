'use strict';

const fs = require('fs');

// A file-change event can arrive while the game is still writing its save file, so a read taken the
// instant the event fires can see a truncated / half-written file (a JSON cut mid-object, an INI
// missing its tail). Poll the file's size+mtime until two consecutive samples are identical — i.e.
// the writer has stopped touching it — or until maxWaitMs elapses. This is the equivalent of
// chokidar's `awaitWriteFinish`, which node-watch does not provide. parseWithRetry remains the
// second line of defence for the residual race (and for the rare case the writer pauses mid-write).
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
