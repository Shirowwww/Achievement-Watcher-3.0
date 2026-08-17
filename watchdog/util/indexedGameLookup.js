'use strict';

const transientStatCodes = new Set(['EACCES', 'EAGAIN', 'EBUSY', 'EINTR', 'EPERM', 'ETXTBSY']);

function fileStamp(fs, file) {
  try {
    const stat = fs.statSync(file);
    return { file, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, size: stat.size };
  } catch (error) {
    if (error && transientStatCodes.has(error.code)) {
      // A Windows antivirus scan or a short-lived file lock is not the same as a deleted optional
      // file. Keep the last known-good index and force a retry instead of caching an empty result.
      return { file, unavailable: true };
    }
    // A permanent path problem (ENOENT, ENOTDIR, EISDIR, …) must rebuild without this optional
    // file rather than return potentially stale higher-priority data.
    return { file, missing: true };
  }
}

function sameStamps(previous, next) {
  return (
    Array.isArray(previous) &&
    previous.length === next.length &&
    previous.every(
      (stamp, index) =>
        stamp.file === next[index].file &&
        stamp.mtimeMs === next[index].mtimeMs &&
        stamp.ctimeMs === next[index].ctimeMs &&
        stamp.size === next[index].size &&
        stamp.missing === next[index].missing &&
        stamp.unavailable === next[index].unavailable
    )
  );
}

function buildIndex(files, stamps, fs) {
  const byAppid = new Map();
  let retry = false;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (stamps[index].missing) continue;
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(list)) continue;

      // Array.find returned the first duplicate in each file. Later files keep their established
      // cfg-over-schema priority, so apply each file's first matches only after reading it whole.
      const firstInFile = new Map();
      for (const game of list) {
        if (!game) continue;
        const key = String(game.appid);
        if (!firstInFile.has(key)) firstInFile.set(key, game);
      }
      for (const [key, game] of firstInFile) byAppid.set(key, game);
    } catch {
      /* game index files are optional or may be transiently incomplete while written */
      // A failed read of an existing file may only be an antivirus/locking race. Do not cache that
      // failure forever just because its timestamp has not changed yet; retry on the next event.
      retry = true;
    }
  }

  return { byAppid, retry };
}

// A Watchdog save event can arrive many times per second. The app's two game index files are large
// and normally unchanged between events, so parse them only when their filesystem signature changes.
function createIndexedGameLookup({ getFiles, fs = require('fs') }) {
  let stamps;
  let byAppid = new Map();

  return (appID) => {
    const files = getFiles();
    const nextStamps = files.map((file) => fileStamp(fs, file));
    if (nextStamps.some((stamp) => stamp.unavailable)) {
      // Do not replace a useful cache with an empty one on a transient stat failure. Clearing the
      // stamp makes the next save event retry immediately once the file becomes readable again.
      stamps = undefined;
      return byAppid.get(String(appID));
    }
    if (!sameStamps(stamps, nextStamps)) {
      const next = buildIndex(files, nextStamps, fs);
      byAppid = next.byAppid;
      stamps = next.retry ? undefined : nextStamps;
    }
    return byAppid.get(String(appID));
  };
}

module.exports = { createIndexedGameLookup };
