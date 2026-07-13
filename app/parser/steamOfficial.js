'use strict';

// Legit-Steam LOCAL achievement state, read straight from the Steam client's own appcache:
//   <Steam>\appcache\stats\UserGameStatsSchema_<appid>.bin   ← binary KV: per-achievement apiname,
//                                                              statId/bit mapping, progress stats
//   <Steam>\appcache\stats\UserGameStats_<account>_<appid>.bin ← binary KV: packed unlock bitfields,
//                                                              unlock times, raw stat values
// Steam rewrites the user bin the moment an achievement pops, so parsing these two files yields the
// player's real unlock state with no Web API key, no login and no network — including achievement
// progress (statvalue-driven bars). Used by parser/steam.js as the local-first path for the legit
// Steam source; the old steamcommunity/WebAPI round-trip remains the fallback.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/steam-appcache.js — MIT-licensed; see
// NOTICE.md. The binary KV reader (parseKVBinary) is kept byte-for-byte faithful.

const fs = require('fs');
const path = require('path');

let debug = { log() {}, warn() {}, error() {} };

module.exports.initDebug = ({ isDev, userDataPath }) => {
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

// ---- binary KV reader ----------------------------------------------------------------------------

function readCString(buf, off) {
  let i = off;
  while (i < buf.length && buf[i] !== 0x00) i++;
  const s = buf.toString('utf8', off, i);
  return { s, next: i + 1 };
}

function addKey(obj, key, value) {
  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    const cur = obj[key];
    if (Array.isArray(cur)) cur.push(value);
    else obj[key] = [cur, value];
  } else obj[key] = value;
}

// Keep the on-disk value type available (non-enumerable) — float stats need it to decode.
function recordKeyType(obj, key, type) {
  if (!obj || !key) return;
  if (!Object.prototype.hasOwnProperty.call(obj, '__kvTypes')) {
    Object.defineProperty(obj, '__kvTypes', { value: {}, enumerable: false, configurable: true, writable: true });
  }
  obj.__kvTypes[key] = type;
}

function parseNodeChildren(buf, offset) {
  let off = offset;
  const obj = {};
  while (off < buf.length) {
    const type = buf.readUInt8(off);
    off += 1;
    if (type === 0x08) return { obj, next: off };
    const k = readCString(buf, off);
    const key = k.s;
    off = k.next;
    if (type === 0x00) {
      const child = parseNodeChildren(buf, off);
      addKey(obj, key, child.obj);
      off = child.next;
      continue;
    }
    if (type === 0x01) {
      const v = readCString(buf, off);
      addKey(obj, key, v.s);
      recordKeyType(obj, key, 'string');
      off = v.next;
      continue;
    }
    if (type === 0x02) {
      const v = buf.readInt32LE(off);
      off += 4;
      addKey(obj, key, v);
      recordKeyType(obj, key, 'int32');
      continue;
    }
    if (type === 0x03) {
      const v = buf.readFloatLE(off);
      off += 4;
      addKey(obj, key, v);
      recordKeyType(obj, key, 'float');
      continue;
    }
    if (type === 0x07) {
      const v = buf.readBigUInt64LE(off);
      off += 8;
      addKey(obj, key, v.toString());
      recordKeyType(obj, key, 'uint64');
      continue;
    }
    throw `Unsupported KV type 0x${type.toString(16)} (key="${key}")`;
  }
  return { obj, next: off };
}

function parseKVBinary(buf) {
  if (!buf || buf.length < 2) throw 'Empty/invalid KV file';
  let off = 0;
  const firstType = buf.readUInt8(off);
  off += 1;
  let rootName = 'root';
  let rootObj = {};
  if (firstType === 0x00) {
    const r = readCString(buf, off);
    rootName = r.s || 'root';
    off = r.next;
    rootObj = parseNodeChildren(buf, off).obj;
  } else {
    rootObj = parseNodeChildren(buf, 0).obj;
  }
  return { rootName, data: rootObj };
}

// ---- user stats bin ------------------------------------------------------------------------------

// {statId: {data_u32, data_value, data_type, times: {bit: unixSeconds}}}
function extractUserStats(rootObj) {
  const stats = {};
  const findTimes = (node) => node.AchievementTimes || node.achievementTimes || node.AchievementsTimes || node.achievement_times || null;
  const toTs = (v) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v)) {
      const n = Number(v);
      return Number.isSafeInteger(n) ? n : null;
    }
    return null;
  };
  function walk(node, pathArr) {
    if (!node || typeof node !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(node, 'data') && typeof node.data === 'number') {
      const statId = String(pathArr[pathArr.length - 1]);
      const times = {};
      const tn = findTimes(node);
      if (tn && typeof tn === 'object') {
        for (const [k, v] of Object.entries(tn)) {
          const ts = toTs(v);
          if (ts != null) times[String(k)] = ts;
        }
      }
      stats[statId] = { data_u32: node.data >>> 0, data_value: node.data, data_type: node.__kvTypes?.data || '', times };
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, pathArr.concat(k));
    }
  }
  walk(rootObj, ['root']);
  return stats;
}

// ---- schema bin ----------------------------------------------------------------------------------

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toInteger(value) {
  const n = toFiniteNumber(value);
  return n != null && Number.isInteger(n) ? n : null;
}

function normalizeProgressStatType(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (raw === 'FLOAT' || raw === 'FLOAT32') return 'FLOAT';
  if (raw === 'INT' || raw === 'INTEGER' || raw === 'UINT32') return 'INT';
  return raw;
}

function localizedString(val, lang) {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return String(val[lang] || val.english || Object.values(val).find((v) => typeof v === 'string') || '');
  }
  return '';
}

function normalizeHidden(v) {
  if (typeof v === 'number') return v ? 1 : 0;
  const s = String(v ?? '').toLowerCase().trim();
  return s === '1' || s === 'true' || s === 'yes' ? 1 : 0;
}

// name → {statId, min, max, type} for every non-achievement stat (progress metadata source)
function extractSchemaStatDefinitions(schemaRootObj) {
  const byName = new Map();
  function walk(node, pathArr) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.name && !node.bits && String(node.type || '').toUpperCase() !== 'ACHIEVEMENTS') {
      const statId = toInteger(pathArr[pathArr.length - 1]);
      if (statId != null) {
        byName.set(node.name, {
          statId,
          min: toFiniteNumber(node.min),
          max: toFiniteNumber(node.max),
          type: normalizeProgressStatType(node.type),
        });
      }
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, pathArr.concat(k));
    }
  }
  walk(schemaRootObj, ['root']);
  return byName;
}

function extractProgressMetadata(bitVal, statDefinitions) {
  const progress = bitVal?.progress;
  if (!progress || typeof progress !== 'object') return null;
  const valueNode = progress.value && typeof progress.value === 'object' ? progress.value : progress;
  const operation = String(valueNode.operation || progress.operation || '').toLowerCase();
  const progressStatName = String(valueNode.operand1 || progress.operand1 || '').trim();
  if (operation !== 'statvalue' || !progressStatName) return null;

  const statInfo = statDefinitions.get(progressStatName) || {};
  const progressStatId = toInteger(statInfo.statId);
  const progressMin = toFiniteNumber(progress.min_val) ?? toFiniteNumber(progress.min) ?? toFiniteNumber(statInfo.min) ?? 0;
  const progressMax = toFiniteNumber(progress.max_val) ?? toFiniteNumber(progress.max) ?? toFiniteNumber(statInfo.max);
  if (progressMax == null || progressMax <= 0) return null;

  return {
    progressStatName,
    progressStatId,
    progressStatType: statInfo.type || '',
    progressMin,
    progressMax,
  };
}

function inferStatIdAndBit(pathArr) {
  const isNum = (s) => typeof s === 'string' && /^\d+$/.test(s);
  for (let i = pathArr.length - 1; i >= 0; i--) {
    if (isNum(pathArr[i])) {
      const bit = Number(pathArr[i]);
      for (let j = i - 1; j >= 0; j--) {
        if (isNum(pathArr[j])) return { statId: Number(pathArr[j]), bit };
      }
      return { statId: null, bit };
    }
  }
  return { statId: null, bit: null };
}

// [{api, displayName, description, hidden, icon, icon_gray, statId, bit, progress*}] — displayName
// and description stay language-keyed objects here; pick with `lang` at the call site.
function extractSchemaAchievements(schemaRootObj) {
  const results = [];
  const statDefinitions = extractSchemaStatDefinitions(schemaRootObj);

  const pushEntry = ({ api, display, desc, icon, iconGray, hidden, statId, bit, progress }) => {
    if (!api || statId == null || bit == null) return;
    const entry = {
      api: String(api),
      displayName: display,
      description: desc,
      hidden: normalizeHidden(hidden),
      icon,
      icon_gray: iconGray || icon,
      statId,
      bit,
    };
    if (progress) Object.assign(entry, progress);
    results.push(entry);
  };

  function walk(node, pathArr) {
    if (!node || typeof node !== 'object') return;

    // Modern appcache shape: { "<statId>": { type: "4", bits: { "<bit>": { name, display } } } }
    if (node.bits && typeof node.bits === 'object') {
      const statId = Number(pathArr[pathArr.length - 1]);
      for (const [bitKey, bitVal] of Object.entries(node.bits)) {
        const bit = Number(bitVal?.bit ?? bitKey);
        const name = bitVal?.name || bitVal?.api || bitVal?.statname || bitVal?.display?.name?.token || bitVal?.display?.name || null;
        pushEntry({
          api: name || `stat${statId}_bit${bit}`,
          display: bitVal?.display?.name || bitVal?.displayName || bitVal?.name,
          desc: bitVal?.display?.desc || bitVal?.description || '',
          icon: bitVal?.display?.icon || bitVal?.icon,
          iconGray: bitVal?.display?.icon_gray || bitVal?.display?.icongray || bitVal?.icon_gray,
          hidden: bitVal?.display?.hidden ?? bitVal?.hidden ?? node.hidden,
          statId: Number.isFinite(statId) ? statId : null,
          bit: Number.isFinite(bit) ? bit : null,
          progress: extractProgressMetadata(bitVal, statDefinitions),
        });
      }
    }

    // Legacy shape: name+bit inferred from the numeric path. Never inside a bits subtree — that's
    // the modern branch's territory, and a display node whose name is a plain string would
    // otherwise produce a phantom entry (upstream has this bug; fixed here).
    if (typeof node.name === 'string' && node.name && !node.bits && !pathArr.includes('bits')) {
      const { statId, bit } = inferStatIdAndBit(pathArr);
      pushEntry({
        api: node.name,
        display: node.display || node.DisplayName || node.displayName || node.name,
        desc: node.desc || node.description || node.Desc || '',
        icon: node.icon || node.Icon || null,
        iconGray: node.icon_gray || node.iconGray || null,
        hidden: node.hidden,
        statId,
        bit,
      });
    }

    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object') walk(v, pathArr.concat(k));
    }
  }

  walk(schemaRootObj, ['root']);
  const seen = new Set();
  const dedup = [];
  for (const r of results) {
    if (seen.has(r.api)) continue;
    seen.add(r.api);
    dedup.push(r);
  }
  return dedup;
}

function extractGameName(rootObj) {
  let hit = null;
  function walk(node) {
    if (!node || typeof node !== 'object' || hit) return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && String(k).toLowerCase() === 'gamename') {
        hit = v;
        return;
      }
      if (v && typeof v === 'object') walk(v);
      if (hit) return;
    }
  }
  walk(rootObj);
  return hit;
}

// ---- snapshot ------------------------------------------------------------------------------------

// {api: {earned, earned_time(s), progress?, max_progress?}} from schema entries + user stats
function buildSnapshotFromAppcache(schemaEntries, userStats) {
  const snap = {};

  const decodeProgressValue = (stat, statType) => {
    if (!stat || typeof stat !== 'object') return 0;
    const normalizedType = normalizeProgressStatType(statType);
    const value = stat.data_value;
    if (normalizedType === 'FLOAT' && typeof value === 'number' && Number.isFinite(value) && (stat.data_type === 'float' || !Number.isInteger(value))) {
      return value;
    }
    const raw = stat.data_u32 >>> 0;
    if (normalizedType !== 'FLOAT') return raw;
    const buf = Buffer.allocUnsafe(4);
    buf.writeUInt32LE(raw, 0);
    const decoded = buf.readFloatLE(0);
    return Number.isFinite(decoded) ? decoded : 0;
  };
  const round2 = (v) => Math.round(Number(v) * 100) / 100;

  for (const a of schemaEntries || []) {
    const stat = userStats[String(a.statId)] || { data_u32: 0, times: {} };
    const earned = (((stat.data_u32 >>> 0) >>> a.bit) & 1) === 1;
    const ts = stat.times && Object.prototype.hasOwnProperty.call(stat.times, String(a.bit)) ? stat.times[String(a.bit)] : null;
    const item = { earned, earned_time: earned ? ts || 0 : 0 };

    const progressStatId = toInteger(a.progressStatId);
    const progressMax = toFiniteNumber(a.progressMax);
    if (progressStatId != null && progressMax != null && progressMax > 0) {
      const rawProgress = decodeProgressValue(userStats[String(progressStatId)] || { data_u32: 0 }, a.progressStatType);
      const isFloat = normalizeProgressStatType(a.progressStatType) === 'FLOAT';
      const clamped = Math.max(0, Math.min(rawProgress, progressMax));
      item.progress = isFloat ? round2(clamped) : clamped;
      item.max_progress = isFloat ? round2(progressMax) : progressMax;
    }
    snap[a.api] = item;
  }
  return snap;
}

// ---- file discovery ------------------------------------------------------------------------------

function parseUserBinName(filePath) {
  const match = path.basename(String(filePath || '')).match(/^UserGameStats_(\d+)_(\d+)\.bin$/i);
  if (!match) return null;
  return { accountId: String(match[1]), appid: String(match[2]) };
}

function listUserBins(statsDir, appid) {
  try {
    const targetAppId = String(appid || '').trim();
    if (!statsDir || !targetAppId || !fs.existsSync(statsDir)) return [];
    return fs
      .readdirSync(statsDir)
      .map((fileName) => {
        const parsed = parseUserBinName(fileName);
        if (!parsed || parsed.appid !== targetAppId) return null;
        const fullPath = path.join(statsDir, fileName);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(fullPath).mtimeMs;
        } catch {}
        return { ...parsed, path: fullPath, mtimeMs };
      })
      .filter(Boolean)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
}

// ---- composed helper for parser/steam.js ----------------------------------------------------------

// Read a legit game's unlock state entirely from the local appcache. Returns the same array shape
// as the network user-stats fetchers ([{apiname, achieved, unlocktime, progress?, max_progress?}]),
// or null when either bin is missing/unreadable — callers fall back to the network path.
function readLocalUserStats({ statsDir, appid, accountId } = {}) {
  try {
    const schemaBin = path.join(String(statsDir || ''), `UserGameStatsSchema_${appid}.bin`);
    if (!fs.existsSync(schemaBin)) return null;

    let userBinPath = accountId ? path.join(String(statsDir || ''), `UserGameStats_${accountId}_${appid}.bin`) : '';
    if (!userBinPath || !fs.existsSync(userBinPath)) {
      const bins = listUserBins(statsDir, appid);
      if (!bins.length) return null;
      userBinPath = bins[0].path;
    }

    const schemaEntries = extractSchemaAchievements(parseKVBinary(fs.readFileSync(schemaBin)).data);
    if (!schemaEntries.length) return null;
    const userStats = extractUserStats(parseKVBinary(fs.readFileSync(userBinPath)).data);
    const snapshot = buildSnapshotFromAppcache(schemaEntries, userStats);

    return Object.entries(snapshot).map(([apiname, state]) => {
      const row = {
        apiname,
        achieved: state.earned ? 1 : 0,
        unlocktime: state.earned_time || 0,
      };
      if (state.progress != null) {
        row.progress = state.progress;
        row.max_progress = state.max_progress;
      }
      return row;
    });
  } catch (err) {
    debug.log(`[${appid}] appcache read failed => ${err}`);
    return null;
  }
}

module.exports.parseKVBinary = parseKVBinary;
module.exports.extractUserStats = extractUserStats;
module.exports.extractSchemaAchievements = extractSchemaAchievements;
module.exports.buildSnapshotFromAppcache = buildSnapshotFromAppcache;
module.exports.extractGameName = extractGameName;
module.exports.localizedString = localizedString;
module.exports.listUserBins = listUserBins;
module.exports.parseUserBinName = parseUserBinName;
module.exports.readLocalUserStats = readLocalUserStats;
