'use strict';

// Live toasts for Xenia (Xbox 360 emulator) achievements. A title keeps schema, unlock state AND
// icons inside one binary GPD (XDBF) file: <root>/content/<XUID>/<titleID>/00000001/<titleID>.gpd.
// The minimal XDBF reader below is the same logic as app/parser/xenia.js, trimmed to what live
// notifications need. Like shadps4Watch, this module is isolated from the Steam watch path: it has
// its own discovery (the user's saved folders, cfg/userdir.db), its own unlock baseline, and reuses
// only the shared notify() toaster + waitForFileStable.
//
// Xenia rewrites every profile GPD on some syncs (the reference project hit duplicate notifications
// for several games at once) — two guards prevent that here: only the title's own <titleID>.gpd is
// watched (never the dashboard/profile GPDs), and unlocks are diffed against a persisted baseline so
// a rewrite without new earned flags never toasts.

const fs = require('fs');
const path = require('path');
const watch = require('node-watch');
const moment = require('moment');
const debug = require('../util/log.js');
const waitForFileStable = require('../util/waitForFileStable.js');
const { notificationVolumePercent } = require('../util/notificationVolume.js');

const APPDATA = process.env['APPDATA'] || '';
const cacheDir = path.join(APPDATA, 'Achievement Watcher/steam_cache/console');
// Same icon cache the app parser extracts into — icons written by either side are shared.
const iconCacheRoot = path.join(APPDATA, 'Achievement Watcher/icon_cache/xenia');
const userDirFile = path.join(APPDATA, 'Achievement Watcher/cfg', 'userdir.db');

const XDBF_HEADER_SIZE = 0x18;
const ENTRY_SIZE = 0x12;
const FREE_ENTRY_SIZE = 0x08;
const ACHIEVEMENT_NAMESPACE = 1;
const STRING_NAMESPACE = 5;
const IMAGE_NAMESPACE = 2;
const TITLE_STRING_ID = 0x8000;
const ACHIEVEMENT_EARNED_FLAG = 0x20000;

const FILETIME_EPOCH_DIFF_MS = 11644473600000n; // 1601 -> 1970
const DOTNET_EPOCH_DIFF_MS = 62135596800000n; // 0001 -> 1970

let watchers = [];

// ---- XDBF / GPD low-level parser (same logic as app/parser/xenia.js) ---------------------------

function readUInt64LE(buf, offset) {
  return (BigInt(buf.readUInt32LE(offset + 4)) << 32n) | BigInt(buf.readUInt32LE(offset));
}
function readUInt64BE(buf, offset) {
  return (BigInt(buf.readUInt32BE(offset)) << 32n) | BigInt(buf.readUInt32BE(offset + 4));
}
function readInt64LE(buf, offset) {
  return buf.readBigInt64LE ? buf.readBigInt64LE(offset) : readUInt64LE(buf, offset);
}
function readInt64BE(buf, offset) {
  if (buf.readBigInt64BE) return buf.readBigInt64BE(offset);
  const u = readUInt64BE(buf, offset);
  return u >= 0x8000000000000000n ? u - 0x10000000000000000n : u;
}

function decodeUtf16Be(buffer) {
  if (!buffer || buffer.length === 0) return '';
  const swapped = Buffer.from(buffer);
  for (let i = 0; i + 1 < swapped.length; i += 2) {
    const tmp = swapped[i];
    swapped[i] = swapped[i + 1];
    swapped[i + 1] = tmp;
  }
  return swapped.toString('utf16le').replace(/\u0000+$/, '').trim();
}

function readUtf16BeNullTerminated(buffer, offset) {
  if (!buffer || offset >= buffer.length) return { text: '', nextOffset: offset };
  const bytes = [];
  let cursor = offset;
  while (cursor + 1 < buffer.length) {
    const code = buffer.readUInt16BE(cursor);
    cursor += 2;
    if (code === 0) break;
    bytes.push((code >> 8) & 0xff, code & 0xff);
  }
  return { text: decodeUtf16Be(Buffer.from(bytes)), nextOffset: cursor };
}

function normalizeUnlockTime(raw) {
  if (raw === null || raw === undefined) return 0;
  const value = typeof raw === 'bigint' ? raw : BigInt(raw);
  if (value <= 0n) return 0;
  const filetimeMs = value / 10000n - FILETIME_EPOCH_DIFF_MS;
  if (filetimeMs > 946684800000n && filetimeMs < 4102444800000n) return Number(filetimeMs);
  const dotnetMs = value / 10000n - DOTNET_EPOCH_DIFF_MS;
  if (dotnetMs > 946684800000n && dotnetMs < 4102444800000n) return Number(dotnetMs);
  return Number(filetimeMs);
}

function parseHeader(buffer) {
  if (buffer.length < XDBF_HEADER_SIZE) return null;
  if (buffer.slice(0, 4).toString('ascii') !== 'XDBF') return null;
  const be = {
    version: buffer.readUInt32BE(0x04), entryTableLength: buffer.readUInt32BE(0x08),
    entryCount: buffer.readUInt32BE(0x0c), freeTableLength: buffer.readUInt32BE(0x10),
    freeCount: buffer.readUInt32BE(0x14), endian: 'be',
  };
  const le = {
    version: buffer.readUInt32LE(0x04), entryTableLength: buffer.readUInt32LE(0x08),
    entryCount: buffer.readUInt32LE(0x0c), freeTableLength: buffer.readUInt32LE(0x10),
    freeCount: buffer.readUInt32LE(0x14), endian: 'le',
  };
  const beOk = be.version >= 0x00010000 && be.version <= 0x00020000;
  const leOk = le.version >= 0x00010000 && le.version <= 0x00020000;
  if (beOk && !leOk) return be;
  if (leOk && !beOk) return le;
  return beOk ? be : le;
}

function resolveTableSizes(header, fileSize) {
  let entryEntries = header.entryTableLength;
  let freeEntries = header.freeTableLength;
  if (header.endian === 'be') {
    const baseData = XDBF_HEADER_SIZE + entryEntries * ENTRY_SIZE + freeEntries * FREE_ENTRY_SIZE;
    if (baseData > fileSize || header.entryCount > entryEntries) {
      if (header.entryTableLength % ENTRY_SIZE === 0) entryEntries = header.entryTableLength / ENTRY_SIZE;
      if (header.freeTableLength % FREE_ENTRY_SIZE === 0) freeEntries = header.freeTableLength / FREE_ENTRY_SIZE;
    }
  } else {
    const entryIsBytes =
      header.entryTableLength % ENTRY_SIZE === 0 && header.entryCount > 0 &&
      header.entryTableLength >= header.entryCount * ENTRY_SIZE;
    const freeIsBytes =
      header.freeTableLength % FREE_ENTRY_SIZE === 0 && header.freeCount > 0 &&
      header.freeTableLength >= header.freeCount * FREE_ENTRY_SIZE;
    entryEntries = entryIsBytes ? header.entryTableLength / ENTRY_SIZE : header.entryTableLength;
    freeEntries = freeIsBytes ? header.freeTableLength / FREE_ENTRY_SIZE : header.freeTableLength;
  }
  const baseData = XDBF_HEADER_SIZE + entryEntries * ENTRY_SIZE + freeEntries * FREE_ENTRY_SIZE;
  return { entryEntries, freeEntries, baseData };
}

function parseXdbfEntries(buffer) {
  if (buffer.length < XDBF_HEADER_SIZE) return [];
  const header = parseHeader(buffer);
  if (!header) return [];
  const { entryEntries, baseData } = resolveTableSizes(header, buffer.length);
  const totalEntries =
    header.entryCount > 0 && header.entryCount <= entryEntries ? header.entryCount : entryEntries;

  const entries = [];
  const readU16 = header.endian === 'be' ? 'readUInt16BE' : 'readUInt16LE';
  const readU32 = header.endian === 'be' ? 'readUInt32BE' : 'readUInt32LE';
  for (let i = 0; i < totalEntries; i += 1) {
    const base = XDBF_HEADER_SIZE + i * ENTRY_SIZE;
    if (base + ENTRY_SIZE > buffer.length) break;
    const namespace = buffer[readU16](base);
    const id = header.endian === 'be' ? readUInt64BE(buffer, base + 2) : readUInt64LE(buffer, base + 2);
    const offset = buffer[readU32](base + 10);
    const length = buffer[readU32](base + 14);
    if (!length) continue;
    const absoluteOffset = baseData + offset;
    if (absoluteOffset < 0 || absoluteOffset + length > buffer.length) continue;
    entries.push({ namespace, id, offset: absoluteOffset, length });
  }
  entries.__endian = header.endian;
  return entries;
}

function parseAchievementPayload(buffer, endian = 'le') {
  if (!buffer || buffer.length < 0x1c) return null;
  const readU32 = endian === 'be' ? 'readUInt32BE' : 'readUInt32LE';
  const readI32 = endian === 'be' ? 'readInt32BE' : 'readInt32LE';
  const structSize = buffer[readU32](0x00);
  const startOffset = structSize >= 0x1c ? structSize : 0x1c;
  const achievementId = buffer[readU32](0x04);
  const imageId = buffer[readU32](0x08);
  const gamerscore = buffer[readI32](0x0c);
  const flags = buffer[readU32](0x10);
  const unlockRaw = endian === 'be' ? readInt64BE(buffer, 0x14) : readInt64LE(buffer, 0x14);
  const nameRes = readUtf16BeNullTerminated(buffer, startOffset);
  const lockedRes = readUtf16BeNullTerminated(buffer, nameRes.nextOffset);
  const unlockedRes = readUtf16BeNullTerminated(buffer, lockedRes.nextOffset);
  return {
    achievementId, imageId, gamerscore, flags, unlockRaw,
    name: nameRes.text, lockedDescription: lockedRes.text, unlockedDescription: unlockedRes.text,
  };
}

const txt = (v) => String(v || '').trim();
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

function isValidAchievement(a) {
  if (!a || typeof a !== 'object') return false;
  if (!txt(a.name) || !txt(a.lockedDescription) || !txt(a.unlockedDescription)) return false;
  return positive(a.flags) && positive(a.imageId) && positive(a.achievementId);
}

function score(a) {
  return (
    txt(a?.name).length + txt(a?.lockedDescription).length + txt(a?.unlockedDescription).length +
    (Number(a?.flags || 0) > 0 ? 1000 : 0) + (Number(a?.imageId || 0) > 0 ? 1000 : 0) +
    ((Number(a?.flags || 0) & ACHIEVEMENT_EARNED_FLAG) !== 0 ? 10 : 0)
  );
}

// Parse one GPD file into { title, list: [{id, displayName, description, gamerscore, achieved, time, imageId}], imagesById }.
function read(gpdPath) {
  const raw = fs.readFileSync(gpdPath);
  const entries = parseXdbfEntries(raw);
  const endian = entries.__endian || 'le';

  const byId = new Map();
  const imagesById = new Map();
  let title = '';
  for (const entry of entries) {
    const payload = raw.slice(entry.offset, entry.offset + entry.length);
    if (entry.namespace === ACHIEVEMENT_NAMESPACE) {
      const parsed = parseAchievementPayload(payload, endian);
      if (!parsed || !isValidAchievement(parsed)) continue;
      const key = String(parsed.achievementId);
      const existing = byId.get(key);
      if (!existing || score(parsed) > score(existing)) byId.set(key, parsed);
    } else if (entry.namespace === IMAGE_NAMESPACE) {
      imagesById.set(String(entry.id), Buffer.from(payload));
    } else if (entry.namespace === STRING_NAMESPACE && Number(entry.id) === TITLE_STRING_ID) {
      title = decodeUtf16Be(payload);
    }
  }

  const list = [...byId.values()].map((a) => {
    const earned = (a.flags & ACHIEVEMENT_EARNED_FLAG) !== 0;
    return {
      id: String(a.achievementId),
      displayName: txt(a.name),
      description: txt(a.unlockedDescription) || txt(a.lockedDescription),
      gamerscore: a.gamerscore,
      imageId: String(a.imageId),
      achieved: earned,
      time: earned ? Math.floor(normalizeUnlockTime(a.unlockRaw) / 1000) : 0,
    };
  });

  return { title, list, imagesById };
}

// Best-effort: make sure the achievement's embedded PNG exists in the shared icon cache and return
// its path ('' when unavailable). The app parser writes the same <titleId>/<imageId>.png layout.
function ensureIcon(titleId, imageId, imagesById) {
  try {
    const iconDir = path.join(iconCacheRoot, titleId);
    const iconPath = path.join(iconDir, `${imageId}.png`);
    if (fs.existsSync(iconPath)) return iconPath;
    const buf = imagesById && imagesById.get(String(imageId));
    if (!buf || buf.length === 0) return '';
    fs.mkdirSync(iconDir, { recursive: true });
    fs.writeFileSync(iconPath, buf);
    return iconPath;
  } catch {
    return '';
  }
}

// Discover per-title achievement GPDs under the user's saved folders (cfg/userdir.db — the same list
// the app scans). A Xenia root is any folder holding content/<XUID>/<titleID>/00000001/<titleID>.gpd.
function discover(configFile = userDirFile) {
  const targets = [];
  const seen = new Set();

  let userDirs = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    if (Array.isArray(parsed)) userDirs = parsed.map((entry) => (typeof entry === 'string' ? entry : entry && entry.path)).filter(Boolean);
  } catch {
    return targets;
  }

  for (const dir of userDirs) {
    const contentRoots = [];
    if (path.basename(dir).toLowerCase() === 'content') contentRoots.push(dir);
    else contentRoots.push(path.join(dir, 'content'));

    for (const content of contentRoots) {
      let xuids;
      try {
        xuids = fs.readdirSync(content, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        continue;
      }
      for (const xuid of xuids) {
        let titleIds;
        try {
          titleIds = fs.readdirSync(path.join(content, xuid), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
        } catch {
          continue;
        }
        for (const titleId of titleIds) {
          if (seen.has(titleId.toLowerCase())) continue;
          const dataDir = path.join(content, xuid, titleId, '00000001');
          // Only the title's own GPD carries its achievements; dashboard/profile GPDs are ignored.
          const gpd = path.join(dataDir, `${titleId}.gpd`);
          const gpdUpper = path.join(dataDir, `${titleId}.GPD`);
          const gpdPath = fs.existsSync(gpd) ? gpd : fs.existsSync(gpdUpper) ? gpdUpper : null;
          if (!gpdPath) continue;
          targets.push({ titleId, dataDir, gpdPath });
          seen.add(titleId.toLowerCase());
        }
      }
    }
  }
  return targets;
}

function cacheFile(titleId) {
  return path.join(cacheDir, `xenia-${String(titleId).replace(/[^\w.-]/g, '_')}.json`);
}
function cacheLoad(titleId) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(titleId), 'utf8'));
  } catch {
    return null;
  }
}
function cacheSave(titleId, unlockedIds) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile(titleId), JSON.stringify({ unlocked: unlockedIds }), 'utf8');
  } catch (err) {
    debug.warn(`[xenia] cache save failed for ${titleId}: ${err}`);
  }
}

// Suppress duplicate events: Xenia can rewrite the same GPD several times per unlock. Keyed by
// titleId:achievementId within a short window (the baseline diff already blocks true re-toasts;
// this only guards the burst while the baseline write races the next change event).
const recentUnlocks = new Map();
function isDuplicateUnlock(titleId, achId) {
  const key = `${titleId}:${achId}`;
  const now = Date.now();
  for (const [k, t] of recentUnlocks) if (now - t > 15000) recentUnlocks.delete(k);
  const last = recentUnlocks.get(key);
  recentUnlocks.set(key, now);
  return last != null && now - last < 15000;
}

async function handleChange(target, ctx) {
  try {
    await waitForFileStable(target.gpdPath);

    const data = read(target.gpdPath);
    if (!data || data.list.length === 0) return;
    const gameName = data.title || target.titleId;

    const achievedNow = data.list.filter((a) => a.achieved);
    const cache = cacheLoad(target.titleId);
    const isFirstObservation = !cache || !Array.isArray(cache.unlocked);

    // First observation: record the baseline silently so a pre-existing profile full of earned
    // achievements doesn't toast on startup. Only real unlocks afterwards notify.
    if (!isFirstObservation) {
      const prev = new Set(cache.unlocked.map(String));
      let delay = 0;
      for (const a of achievedNow) {
        if (prev.has(String(a.id))) continue;
        if (isDuplicateUnlock(target.titleId, a.id)) continue;
        debug.log(`[xenia] Unlocked: ${gameName} - ${a.displayName}`);
        const iconPath = ensureIcon(target.titleId, a.imageId, data.imagesById);
        await ctx.notify(
          {
            source: 'Xenia Emulator',
            appid: target.titleId,
            gameDisplayName: gameName,
            achievementName: String(a.id),
            achievementDisplayName: a.displayName,
            achievementDescription: a.description,
            icon: iconPath || undefined,
            time: a.time || moment().unix(),
            delay,
          },
          {
            notify: ctx.options.notification.notify,
            transport: {
              toast: ctx.options.notification_transport.mode !== 'overlay',
              websocket: ctx.options.notification_transport.websocket || ctx.options.notification_transport.mode !== 'toast',
              overlay: ctx.options.notification_transport.mode === 'overlay' || ctx.options.notification_transport.mode === 'both',
            },
            toast: {
              appid: typeof ctx.getToastID === 'function' ? ctx.getToastID() : ctx.toastID,
              winrt: ctx.options.notification_transport.winRT,
              balloonFallback: ctx.options.notification_transport.balloon,
              customAudio: ctx.options.notification_toast.customToastAudio,
              volume: notificationVolumePercent(ctx.options),
              imageIntegration: '0',
              group: ctx.options.notification_toast.groupToast,
              cropIcon: true,
              attribution: a.gamerscore > 0 ? `${a.gamerscore} G` : 'Achievement',
            },
            prefetch: false, // icons are already local files
            rumble: ctx.options.notification.rumble,
          }
        );
        delay += 1;
      }
    }

    cacheSave(target.titleId, achievedNow.map((a) => a.id));
  } catch (err) {
    debug.warn(`[xenia] handleChange failed for ${target.titleId}: ${err}`);
  }
}

// Tear down any existing watchers and (re)start from the current options. Safe to call on every
// settings reload. Gated by the Xenia source flag + the master notify switch.
module.exports.start = async (ctx) => {
  module.exports.stop();

  if (!ctx || !ctx.options) return;
  if (ctx.options.achievement_source && ctx.options.achievement_source.xenia === false) return;
  if (ctx.options.notification && ctx.options.notification.notify === false) return;
  if (typeof ctx.notify !== 'function') return;

  let targets;
  try {
    targets = discover();
  } catch (err) {
    debug.warn(`[xenia] discovery failed: ${err}`);
    return;
  }
  if (targets.length === 0) return;

  for (const target of targets) {
    // Seed the baseline up front so we never replay a back-catalogue of unlocks on launch.
    if (!cacheLoad(target.titleId)) {
      try {
        const data = read(target.gpdPath);
        if (data) cacheSave(target.titleId, data.list.filter((a) => a.achieved).map((a) => a.id));
      } catch (err) {
        debug.warn(`[xenia] baseline seed failed for ${target.titleId}: ${err}`);
      }
    }
    try {
      const wantedFile = path.basename(target.gpdPath).toLowerCase();
      const w = watch(target.dataDir, { recursive: false }, (evt, name) => {
        if (evt !== 'update') return;
        // Only the title's own GPD matters — Xenia touching sibling files must not re-trigger.
        if (String(path.basename(name || '')).toLowerCase() !== wantedFile) return;
        handleChange(target, ctx);
      });
      watchers.push(w);
      debug.log(`[xenia] watching achievements for ${target.titleId}`);
    } catch (err) {
      debug.warn(`[xenia] failed to watch ${target.dataDir}: ${err}`);
    }
  }
};

module.exports.stop = () => {
  for (const w of watchers) {
    try {
      w.close();
    } catch {}
  }
  watchers = [];
};

// Exposed for unit testing the pure reader.
module.exports._internal = { read, discover, parseXdbfEntries, normalizeUnlockTime };
