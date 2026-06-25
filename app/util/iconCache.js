'use strict';

// Size-capped LRU purge for the per-appid icon cache (steam_cache/icon/<appid>/), which otherwise
// grows without bound. The selector is a pure function (unit-tested); the runner does the disk I/O.

const fs = require('fs');
const path = require('path');

// Given folders [{ dir, size, atimeMs }] and a byte cap, return the dirs to delete — oldest access
// first — until the running total is at or below the cap. Returns [] when already under the cap.
function selectStaleIconFolders(folders, capBytes) {
  let total = folders.reduce((s, f) => s + f.size, 0);
  if (total <= capBytes) return [];
  const oldestFirst = [...folders].sort((a, b) => a.atimeMs - b.atimeMs);
  const toDelete = [];
  for (const f of oldestFirst) {
    if (total <= capBytes) break;
    toDelete.push(f.dir);
    total -= f.size;
  }
  return toDelete;
}

// Sum of file sizes directly under (and nested below) a folder. Tolerant of races/permission errors.
function folderSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      if (e.isDirectory()) total += folderSize(p);
      else total += fs.statSync(p).size;
    } catch {
      /* skip unreadable entry */
    }
  }
  return total;
}

function scanIconFolders(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    let st;
    try {
      st = fs.statSync(dir);
    } catch {
      continue;
    }
    out.push({ dir, size: folderSize(dir), atimeMs: st.atimeMs || st.mtimeMs || 0 });
  }
  return out;
}

// Prune the icon cache to `capBytes` (default 1 GiB), least-recently-accessed appid folders first.
// `dryRun` reports the plan without deleting. Returns { before, after, freed, count, deleted }.
function pruneIconCache(root, capBytes = 1024 * 1024 * 1024, { dryRun = false } = {}) {
  const folders = scanIconFolders(root);
  const before = folders.reduce((s, f) => s + f.size, 0);
  const toDelete = selectStaleIconFolders(folders, capBytes);
  const sizeOf = (dir) => folders.find((f) => f.dir === dir)?.size || 0;
  let freed = 0;
  for (const dir of toDelete) {
    const sz = sizeOf(dir);
    if (dryRun) {
      freed += sz;
      continue;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      freed += sz;
    } catch {
      /* leave it for next run */
    }
  }
  return { before, after: before - freed, freed, count: toDelete.length, deleted: toDelete };
}

module.exports = { selectStaleIconFolders, pruneIconCache };
