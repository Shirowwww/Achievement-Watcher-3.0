'use strict';

// Xenia (Xbox 360 emulator) achievement reader. A title's achievements — both the schema and the
// unlock state — live in a single binary GPD (Gamer Profile Data / XDBF) file:
//   <root>/content/<XUID>/<titleID>/00000001/<titleID>.gpd
// The XDBF container also embeds the achievement icons (PNG), which are extracted to the icon cache
// and referenced via file:/// so the UI can render them.
//
// The XDBF/GPD binary parser below is ported from the reference Achievements project's
// utils/xenia-gpd.js (MIT licensed — https://github.com/<reference>, see reference-Achievements/LICENSE)
// and adapted to Achievement Watcher's scan/getGameData/getAchievements data model.

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const binary = ['xenia.exe', 'xenia_canary.exe'];

const cacheRoot = path.join(process.env['APPDATA'] || '', 'Achievement Watcher', 'icon_cache', 'xenia');

// ---- XDBF / GPD low-level parser (ported, MIT) -----------------------------------------------

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

function parseGpdBuffer(raw, filePath) {
  const entries = parseXdbfEntries(raw);
  const endian = entries.__endian || 'le';
  const achievements = [];
  const imagesById = new Map();
  let title = '';
  for (const entry of entries) {
    const payload = raw.slice(entry.offset, entry.offset + entry.length);
    if (entry.namespace === ACHIEVEMENT_NAMESPACE) {
      const parsed = parseAchievementPayload(payload, endian);
      if (parsed) achievements.push(parsed);
    } else if (entry.namespace === IMAGE_NAMESPACE) {
      imagesById.set(String(entry.id), Buffer.from(payload));
    } else if (entry.namespace === STRING_NAMESPACE && Number(entry.id) === TITLE_STRING_ID) {
      title = decodeUtf16Be(payload);
    }
  }
  return { filePath, title: title || path.basename(filePath, path.extname(filePath)), achievements, imagesById };
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

function validAchievements(parsed) {
  const byId = new Map();
  for (const a of parsed?.achievements || []) {
    if (!isValidAchievement(a)) continue;
    const key = String(a.achievementId || '').trim();
    if (!key) continue;
    const existing = byId.get(key);
    if (!existing || score(a) > score(existing)) byId.set(key, a);
  }
  return [...byId.values()];
}

// ---- Achievement Watcher data model ----------------------------------------------------------

const titleIdFromPath = (gpdPath) => path.basename(path.dirname(path.dirname(gpdPath))); // .../<titleID>/00000001/<file>.gpd

module.exports.scan = async (dir) => {
  // Lazy-require fast-glob to keep parity with the other parsers (already a dependency).
  const glob = require('fast-glob');
  const data = [];
  const seen = new Set();

  const contentRoots = [];
  if (await exists(path.join(dir, 'content'))) contentRoots.push(path.join(dir, 'content'));
  if (path.basename(dir).toLowerCase() === 'content') contentRoots.push(dir);
  if (contentRoots.length === 0) return data;

  for (const content of contentRoots) {
    let gpds;
    try {
      // <XUID>/<titleID>/00000001/<file>.gpd
      gpds = await glob('*/*/00000001/*.{gpd,GPD}', { cwd: content, onlyFiles: true, absolute: true, suppressErrors: true });
    } catch {
      continue;
    }
    for (const gpd of gpds) {
      const titleId = titleIdFromPath(gpd);
      const stem = path.basename(gpd, path.extname(gpd));
      // The per-title achievement GPD is named after its titleID; skip the dashboard/profile GPDs.
      if (stem.toLowerCase() !== titleId.toLowerCase()) continue;
      if (seen.has(titleId)) continue;
      seen.add(titleId);
      data.push({ appid: titleId, source: 'Xenia Emulator', data: { type: 'xenia', path: gpd } });
    }
  }

  return data;
};

function exists(p) {
  return fsp.access(p).then(() => true).catch(() => false);
}

module.exports.getGameData = async (gpdPath) => {
  const raw = await fsp.readFile(gpdPath);
  const parsed = parseGpdBuffer(raw, gpdPath);
  const titleId = titleIdFromPath(gpdPath);
  const valid = validAchievements(parsed);

  // Extract embedded achievement icons to the cache so the UI can render them via file:///.
  const iconDir = path.join(cacheRoot, titleId);
  let iconsWritten = false;
  try {
    await fsp.mkdir(iconDir, { recursive: true });
    iconsWritten = true;
  } catch {
    /* fall back to no icons */
  }

  const list = [];
  for (const a of valid) {
    const locked = txt(a.lockedDescription);
    const unlocked = txt(a.unlockedDescription) || locked;
    const hidden = (a.flags & 0x8) === 0 ? 1 : 0;
    let icon = '';
    const buf = parsed.imagesById.get(String(a.imageId));
    if (iconsWritten && buf && buf.length > 0) {
      const iconPath = path.join(iconDir, `${a.imageId}.png`);
      try {
        if (!fs.existsSync(iconPath)) await fsp.writeFile(iconPath, buf);
        icon = 'file:///' + iconPath.replace(/\\/g, '/');
      } catch {
        /* leave icon empty */
      }
    }
    list.push({
      name: String(a.achievementId),
      displayName: txt(a.name),
      description: hidden ? unlocked : unlocked,
      hidden,
      gamerscore: a.gamerscore,
      icon,
      icongray: icon,
    });
  }

  return {
    name: parsed.title || titleId,
    appid: titleId,
    system: 'xbox',
    img: { header: list.find((x) => x.icon)?.icon },
    achievement: {
      total: list.length,
      list,
    },
  };
};

module.exports.getAchievements = async (gpdPath) => {
  const raw = await fsp.readFile(gpdPath);
  const parsed = parseGpdBuffer(raw, gpdPath);
  return validAchievements(parsed).map((a) => {
    const earned = (a.flags & ACHIEVEMENT_EARNED_FLAG) !== 0;
    return {
      id: String(a.achievementId),
      achieved: earned,
      earned_time: earned ? Math.floor(normalizeUnlockTime(a.unlockRaw) / 1000) : 0, // ms -> unix seconds
    };
  });
};

// Exposed for unit testing the pure binary parser.
module.exports._internal = { parseGpdBuffer, validAchievements, normalizeUnlockTime };
