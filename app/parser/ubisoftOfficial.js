'use strict';

// Ubisoft Connect OFFICIAL achievement source. Unlike parser/uplay.js (LumaPlay emulator saves),
// this reads the real Ubisoft Connect client data, entirely offline:
//   %LOCALAPPDATA%\Ubisoft Game Launcher\spool\<userGuid>\<productId>.spool
//       ← unlock state: protobuf records of {achievementId, earnedTime} appended by the client
//   %ProgramData%\Ubisoft\Ubisoft Game Launcher\cache\achievements\<productId>_<spec>[.zip]
//       ← schema: a ZIP holding <locale>_loc.txt (id ⇥ name ⇥ description) + <id>.png icons,
//         cached by the client when the game's achievements page is opened
//   %LOCALAPPDATA%\Ubisoft Game Launcher\cache\configuration\configurations
//       ← game titles / process names (plain-text blocks)
// A game with a spool but no cached achievements archive can't be displayed meaningfully (the
// schema is the display) — it is skipped with a log; opening its achievements page once in
// Ubisoft Connect populates the cache.
//
// assets/uplay-steam.json (productId → steam appid/name) supplies offline titles, Steam cover art
// URLs and the Steam rarity bridge.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/ubisoft-connect-local.js (+ the
// match-uplay-steam asset) — MIT-licensed; see NOTICE.md. Adapted to Achievement Watcher's parser
// contract; icons are extracted once into steam_cache/ubisoftOfficial/<appid>/img and served as
// local paths; rarity is seeded into the shared sidecar cache through the uplay↔steam name bridge.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let cacheRoot;
let debug = { log() {}, warn() {}, error() {} };

module.exports.initDebug = ({ isDev, userDataPath }) => {
  module.exports.setUserDataPath(userDataPath);
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

module.exports.setUserDataPath = (p) => {
  cacheRoot = p;
};

const DEFAULT_SPOOL_ROOT = process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Ubisoft Game Launcher', 'spool') : '';
const DEFAULT_CONFIGURATIONS_PATH = process.env['LOCALAPPDATA']
  ? path.join(process.env['LOCALAPPDATA'], 'Ubisoft Game Launcher', 'cache', 'configuration', 'configurations')
  : '';
const DEFAULT_ACHIEVEMENTS_ROOT = process.env['ProgramData']
  ? path.join(process.env['ProgramData'], 'Ubisoft', 'Ubisoft Game Launcher', 'cache', 'achievements')
  : '';
const UPLAY_STEAM_ASSET = path.join(__dirname, '..', 'assets', 'uplay-steam.json');

// Ubisoft locale file names (en-US_loc.txt …) → the Steam API language names used app-wide.
const UBISOFT_LOCALE_MAP = new Map([
  ['en-us', 'english'], ['en-gb', 'english'], ['ar-sa', 'arabic'], ['bg-bg', 'bulgarian'],
  ['zh-cn', 'schinese'], ['zh-sg', 'schinese'], ['zh-tw', 'tchinese'], ['cs-cz', 'czech'],
  ['da-dk', 'danish'], ['nl-nl', 'dutch'], ['fi-fi', 'finnish'], ['fr-fr', 'french'],
  ['de-de', 'german'], ['el-gr', 'greek'], ['hu-hu', 'hungarian'], ['id-id', 'indonesian'],
  ['it-it', 'italian'], ['ja-jp', 'japanese'], ['ko-kr', 'koreana'], ['ko-ko', 'koreana'],
  ['ko', 'koreana'], ['nb-no', 'norwegian'], ['no-no', 'norwegian'], ['pl-pl', 'polish'],
  ['pt-pt', 'portuguese'], ['pt-br', 'brazilian'], ['ro-ro', 'romanian'], ['ru-ru', 'russian'],
  ['es-es', 'spanish'], ['es-mx', 'latam'], ['es-419', 'latam'], ['sv-se', 'swedish'],
  ['th-th', 'thai'], ['tr-tr', 'turkish'], ['uk-ua', 'ukrainian'], ['vi-vn', 'vietnamese'],
]);

// ---- uplay ↔ steam mapping asset ----------------------------------------------------------------

let uplayToSteam = null;
function getUplaySteamMapping() {
  if (uplayToSteam) return uplayToSteam;
  uplayToSteam = new Map();
  try {
    const rows = JSON.parse(fs.readFileSync(UPLAY_STEAM_ASSET, 'utf8'));
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.uplay_id == null) continue;
      uplayToSteam.set(String(row.uplay_id).trim(), row);
    }
  } catch (err) {
    debug.log(`uplay-steam mapping asset unavailable => ${err}`);
  }
  return uplayToSteam;
}

// ---- spool protobuf reader ----------------------------------------------------------------------

function readVarint(buffer, offset, end = buffer.length) {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < end) {
    const byte = buffer[cursor];
    value += (byte & 0x7f) * 2 ** shift;
    cursor += 1;
    if ((byte & 0x80) === 0) return { value, nextOffset: cursor };
    shift += 7;
    if (shift > 49) throw 'ubisoft-official: varint too large';
  }
  throw 'ubisoft-official: truncated varint';
}

function skipProtoField(buffer, offset, wireType, end = buffer.length) {
  if (wireType === 0) return readVarint(buffer, offset, end).nextOffset;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const lenInfo = readVarint(buffer, offset, end);
    return lenInfo.nextOffset + lenInfo.value;
  }
  if (wireType === 5) return offset + 4;
  throw `ubisoft-official: unsupported wire type ${wireType}`;
}

function findFirstProtoVarint(buffer, targetField, start = 0, end = buffer.length, depth = 0) {
  let offset = start;
  while (offset < end) {
    const tagInfo = readVarint(buffer, offset, end);
    const fieldNumber = tagInfo.value >> 3;
    const wireType = tagInfo.value & 0x07;
    offset = tagInfo.nextOffset;
    if (wireType === 0) {
      const valueInfo = readVarint(buffer, offset, end);
      if (fieldNumber === targetField) return valueInfo.value;
      offset = valueInfo.nextOffset;
      continue;
    }
    if (wireType === 2) {
      const lenInfo = readVarint(buffer, offset, end);
      const payloadStart = lenInfo.nextOffset;
      const payloadEnd = payloadStart + lenInfo.value;
      if (depth < 4) {
        const nested = findFirstProtoVarint(buffer, targetField, payloadStart, payloadEnd, depth + 1);
        if (nested != null) return nested;
      }
      offset = payloadEnd;
      continue;
    }
    offset = skipProtoField(buffer, offset, wireType, end);
  }
  return null;
}

function normalizeEpochSeconds(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric >= 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

// Parse one <productId>.spool: repeated outer field-1 messages holding {1: achievementId, 2: time}.
function readUbisoftSpoolFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const records = [];
  const seen = new Set();
  let offset = 0;
  while (offset < buffer.length) {
    const tagInfo = readVarint(buffer, offset, buffer.length);
    const fieldNumber = tagInfo.value >> 3;
    const wireType = tagInfo.value & 0x07;
    offset = tagInfo.nextOffset;
    if (fieldNumber === 1 && wireType === 2) {
      const lenInfo = readVarint(buffer, offset, buffer.length);
      const payloadStart = lenInfo.nextOffset;
      const payloadEnd = payloadStart + lenInfo.value;
      const achievementId = findFirstProtoVarint(buffer, 1, payloadStart, payloadEnd);
      const earnedTime = findFirstProtoVarint(buffer, 2, payloadStart, payloadEnd);
      if (Number(achievementId) > 0 && Number(earnedTime) > 0) {
        const record = { achievementId: Number(achievementId), earned_time: normalizeEpochSeconds(earnedTime) };
        const dedupeKey = `${record.achievementId}:${record.earned_time}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          records.push(record);
        }
      }
      offset = payloadEnd;
      continue;
    }
    offset = skipProtoField(buffer, offset, wireType, buffer.length);
  }
  records.sort((a, b) => a.earned_time - b.earned_time);
  return { appid: path.basename(filePath, path.extname(filePath)), filePath, records };
}

// {achievementId: {earned, earned_time(s)}} — first (earliest) unlock wins on duplicates.
function buildUbisoftOfficialSnapshot(records) {
  const snapshot = {};
  for (const record of Array.isArray(records) ? records : []) {
    const key = String(record?.achievementId || '').trim();
    const earnedTime = normalizeEpochSeconds(record?.earned_time || 0);
    if (!key || !earnedTime) continue;
    if (!snapshot[key] || earnedTime < snapshot[key].earned_time) {
      snapshot[key] = { earned: true, earned_time: earnedTime };
    }
  }
  return snapshot;
}

function listSpoolEntries(spoolRoot = DEFAULT_SPOOL_ROOT) {
  const out = [];
  if (!spoolRoot || !fs.existsSync(spoolRoot)) return out;
  let userEntries = [];
  try {
    userEntries = fs.readdirSync(spoolRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const userEntry of userEntries) {
    if (!userEntry.isDirectory()) continue;
    const userDir = path.join(spoolRoot, userEntry.name);
    let files = [];
    try {
      files = fs.readdirSync(userDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const fileEntry of files) {
      if (!fileEntry.isFile()) continue;
      const match = fileEntry.name.match(/^(\d+)\.spool$/i);
      if (!match) continue;
      out.push({
        appid: match[1],
        userId: userEntry.name,
        spoolFilePath: path.join(userDir, fileEntry.name),
      });
    }
  }
  return out;
}

// ---- configurations index (titles / process names) ----------------------------------------------

let configurationsCache = { path: '', mtimeMs: 0, blocks: [] };

function normalizeQuotedText(value) {
  return String(value || '').trim().replace(/^"+|"+$/g, '').trim();
}

function normalizeAchievementsSpec(value) {
  const raw = String(value || '').trim().replace(/^"+|"+$/g, '').replace(/[\\/]+/g, '/');
  if (!raw) return '';
  let base = path.posix.basename(raw).toLowerCase();
  if (base.endsWith('.zip')) base = base.slice(0, -4);
  const prefixed = base.match(/^\d+_(.+)$/);
  return prefixed ? prefixed[1] : base;
}

function readConfigurationsIndex(configurationsPath = DEFAULT_CONFIGURATIONS_PATH) {
  const filePath = String(configurationsPath || '').trim();
  if (!filePath || !fs.existsSync(filePath)) return [];
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (configurationsCache.path === filePath && configurationsCache.mtimeMs === Number(stat.mtimeMs || 0)) {
    return configurationsCache.blocks;
  }

  let text = '';
  try {
    text = fs.readFileSync(filePath).toString('latin1').replace(/\0/g, '');
  } catch {
    return [];
  }

  const blockRegex = /version:\s*[^\r\n]+\r?\nroot:\s*[\s\S]*?(?=(?:version:\s*[^\r\n]+\r?\nroot:)|$)/g;
  const blocks = [];
  let match = null;
  while ((match = blockRegex.exec(text))) {
    const block = String(match[0] || '');
    const achievementsSpec = normalizeQuotedText(block.match(/^\s*achievements:\s*([^\r\n]+)/m)?.[1] || '');
    if (!achievementsSpec) continue;
    const gameIdentifier = normalizeQuotedText(block.match(/^\s*game_identifier:\s*([^\r\n]+)/m)?.[1] || '');
    const displayName = normalizeQuotedText(block.match(/^\s*display_name:\s*([^\r\n]+)/m)?.[1] || '');
    const rootName = normalizeQuotedText(block.match(/root:\s*[\s\S]*?\n\s+name:\s*([^\r\n]+)/m)?.[1] || '');
    blocks.push({
      achievementsSpec,
      normalizedAchievementsSpec: normalizeAchievementsSpec(achievementsSpec),
      title: gameIdentifier || displayName || rootName || '',
    });
  }

  configurationsCache = { path: filePath, mtimeMs: Number(stat.mtimeMs || 0), blocks };
  return blocks;
}

// ---- achievements archive (schema zip) -----------------------------------------------------------

function resolveAchievementsArchive(appid, options = {}) {
  const safeAppId = String(appid || '').trim();
  const achievementsRoot = String(options.achievementsRoot || DEFAULT_ACHIEVEMENTS_ROOT).trim();
  if (!achievementsRoot || !fs.existsSync(achievementsRoot)) throw 'ubisoft-official: achievements cache missing';

  const prefix = `${safeAppId}_`;
  let candidateFiles = [];
  try {
    candidateFiles = fs
      .readdirSync(achievementsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
      .map((entry) => path.join(achievementsRoot, entry.name));
  } catch {
    candidateFiles = [];
  }
  if (!candidateFiles.length) throw 'ubisoft-official: archive missing';

  const blocks = readConfigurationsIndex(options.configurationsPath);
  let best = null;
  for (const filePath of candidateFiles) {
    const normalizedSpec = normalizeAchievementsSpec(path.basename(filePath).slice(prefix.length));
    const metadata = blocks.find((block) => block.normalizedAchievementsSpec === normalizedSpec) || null;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {}
    const score = metadata ? 2 : 1;
    if (!best || score > best.score || (score === best.score && mtimeMs > best.mtimeMs)) {
      best = { archivePath: filePath, metadata, score, mtimeMs };
    }
  }
  return { archivePath: best.archivePath, title: best.metadata?.title || '' };
}

// Minimal stored/deflate ZIP reader — the archives are plain ZIPs but carry no .zip extension, so
// going through the central directory directly avoids adm-zip's extension assumptions.
function readZipEntries(zipPath) {
  const buffer = fs.readFileSync(zipPath);
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw 'ubisoft-official: zip EOCD not found';
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralEnd = centralDirectoryOffset + centralDirectorySize;
  const entries = new Map();
  let offset = centralDirectoryOffset;
  while (offset < centralEnd) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw 'ubisoft-official: invalid zip central entry';
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.toString('utf8', offset + 46, offset + 46 + fileNameLength);
    entries.set(fileName, { compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  const readEntry = (entryName) => {
    const entry = entries.get(entryName);
    if (!entry) return null;
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw 'ubisoft-official: invalid zip local entry';
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.compressionMethod === 0) return Buffer.from(compressed);
    if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
    throw `ubisoft-official: unsupported zip compression ${entry.compressionMethod}`;
  };

  return { entries, readEntry };
}

function parseLocalizationText(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 3) continue;
    const rawId = String(parts[0] || '').trim();
    if (!/^\d+$/.test(rawId)) continue;
    out.set(rawId.replace(/^0+(?=\d)/, ''), {
      displayName: String(parts[1] || '').trim(),
      description: parts.slice(2).join('\t').trim(),
    });
  }
  return out;
}

// Read one archive: per-locale id→{displayName, description} maps + id→png buffers.
function collectSchemaData(archivePath) {
  const zip = readZipEntries(archivePath);
  const localizations = new Map();
  const imageBuffers = new Map();

  for (const entryName of zip.entries.keys()) {
    const lower = entryName.toLowerCase();
    const locMatch = lower.match(/^([a-z]{2}(?:-[a-z]{2,4})?)_loc\.txt$/i);
    if (locMatch) {
      const localeKey = UBISOFT_LOCALE_MAP.get(locMatch[1]) || locMatch[1].replace(/[^a-z]/g, '');
      if (localeKey) localizations.set(localeKey, parseLocalizationText(zip.readEntry(entryName)));
      continue;
    }
    const pngMatch = lower.match(/^(\d+)\.png$/);
    if (pngMatch) imageBuffers.set(String(Number(pngMatch[1])), zip.readEntry(entryName));
  }

  const ids = new Set();
  for (const map of localizations.values()) for (const id of map.keys()) ids.add(id);
  if (!ids.size) for (const id of imageBuffers.keys()) ids.add(id);

  return {
    ids: Array.from(ids).sort((a, b) => Number(a) - Number(b)),
    localizations,
    imageBuffers,
  };
}

// ---- rarity bridge (ubisoft numeric ids ↔ steam apinames) ---------------------------------------

// Steam apinames for Ubisoft ports are usually "Ach_<id>"/"ACH_<id>" or "<something>_<id>"; strip
// down to the trailing number so they can be matched to the archive's numeric ids.
function normalizeSteamAchName(name) {
  let result = String(name || '').trim();
  const ach = result.match(/Ach_(.+)$/i);
  if (ach && ach[1]) result = ach[1];
  const trailing = result.match(/^(.*)_(\d+)$/);
  if (trailing && trailing[1] && /[A-Za-z]/.test(trailing[1])) result = trailing[2];
  return result;
}

async function seedRarityFromSteam(appid, ids) {
  const mapping = getUplaySteamMapping().get(String(appid));
  const steamAppId = mapping?.steam_appid != null ? String(mapping.steam_appid).trim() : '';
  if (!/^\d+$/.test(steamAppId)) return;
  try {
    const rarity = require('../util/rarity.js');
    const steamEntries = await rarity.getRarityEntries(steamAppId, 'steam');
    if (!Array.isArray(steamEntries) || steamEntries.length === 0) return;
    const byNormalized = new Map(steamEntries.map((e) => [normalizeSteamAchName(e.name), e.percent]));
    const entries = ids
      .map((id) => (byNormalized.has(id) ? { name: id, percent: byNormalized.get(id) } : null))
      .filter(Boolean);
    if (entries.length > 0) rarity.writeRarityCache(String(appid), entries, 'steam');
  } catch (err) {
    debug.log(`[${appid}] ubisoft rarity bridge failed => ${err}`);
  }
}

// ---- parser contract ----------------------------------------------------------------------------

// One entry per product that has BOTH a spool (unlock state) and a cached achievements archive
// (schema). Multiple Ubisoft users: latest-written spool wins.
module.exports.scan = () => {
  const entries = listSpoolEntries();
  const byProduct = new Map();
  for (const entry of entries) {
    let archive;
    try {
      archive = resolveAchievementsArchive(entry.appid);
    } catch (err) {
      debug.log(
        `[${entry.appid}] Ubisoft spool found but no cached achievements archive (${err}) — open the game's achievements page in Ubisoft Connect once to populate it`
      );
      continue;
    }
    const mtimeOf = (p) => {
      try {
        return fs.statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    const prev = byProduct.get(entry.appid);
    if (prev && mtimeOf(prev.data.spoolFilePath) >= mtimeOf(entry.spoolFilePath)) continue;
    const mapping = getUplaySteamMapping().get(entry.appid);
    byProduct.set(entry.appid, {
      appid: entry.appid,
      source: 'Ubisoft Connect',
      data: {
        type: 'ubisoftOfficial',
        path: path.dirname(entry.spoolFilePath),
        spoolFilePath: entry.spoolFilePath,
        userId: entry.userId,
        archivePath: archive.archivePath,
        title: archive.title || mapping?.uplay_name || mapping?.steam_name || '',
      },
    });
  }
  return Array.from(byProduct.values());
};

module.exports.getGameData = async (appid, lang) => {
  const data = appid.data || {};
  const schema = collectSchemaData(data.archivePath);
  if (!schema.ids.length) throw `Empty Ubisoft achievements archive for ${appid.appid}`;

  // extract icons once — the renderer displays local paths directly (no network)
  const imgDir = path.join(cacheRoot || '', 'steam_cache', 'ubisoftOfficial', String(appid.appid), 'img');
  fs.mkdirSync(imgDir, { recursive: true });
  const iconPathFor = (id) => {
    if (!schema.imageBuffers.has(id)) return '';
    const iconPath = path.join(imgDir, `${id}.png`);
    if (!fs.existsSync(iconPath)) {
      try {
        fs.writeFileSync(iconPath, schema.imageBuffers.get(id));
      } catch {
        return '';
      }
    }
    return iconPath;
  };

  const language = String(lang || 'english').toLowerCase();
  const pickText = (id, field) => {
    for (const key of [language, 'english']) {
      const entry = schema.localizations.get(key)?.get(id);
      if (entry && entry[field]) return entry[field];
    }
    for (const map of schema.localizations.values()) {
      const entry = map.get(id);
      if (entry && entry[field]) return entry[field];
    }
    return '';
  };

  const list = schema.ids.map((id) => {
    const iconPath = iconPathFor(id);
    return {
      name: id,
      hidden: 0, // the archive carries no hidden flag; Ubisoft Connect shows all achievements
      displayName: pickText(id, 'displayName') || `Achievement ${id}`,
      description: pickText(id, 'description'),
      icon: iconPath,
      icongray: iconPath,
    };
  });

  // borrow Steam store art through the uplay↔steam mapping (best-effort; delisted → placeholders)
  const mapping = getUplaySteamMapping().get(String(appid.appid));
  const steamAppId = mapping?.steam_appid != null ? String(mapping.steam_appid).trim() : '';
  const img = /^\d+$/.test(steamAppId)
    ? {
        header: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`,
        background: null,
        portrait: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_600x900.jpg`,
        icon: null,
      }
    : { header: null, background: null, portrait: null, icon: null };

  // rarity: Steam global percentages bridged onto the numeric ids (best-effort, TTL-cached)
  await seedRarityFromSteam(appid.appid, schema.ids);

  return {
    name: data.title || mapping?.uplay_name || mapping?.steam_name || `Ubisoft ${appid.appid}`,
    appid: appid.appid,
    img,
    achievement: {
      total: list.length,
      list,
    },
  };
};

module.exports.getAchievements = (appid) => {
  const spool = readUbisoftSpoolFile(appid.data.spoolFilePath);
  return buildUbisoftOfficialSnapshot(spool.records);
};

// Exposed for unit tests (and a future watchdog live watcher).
module.exports._internal = {
  readUbisoftSpoolFile,
  buildUbisoftOfficialSnapshot,
  listSpoolEntries,
  readConfigurationsIndex,
  resolveAchievementsArchive,
  collectSchemaData,
  normalizeSteamAchName,
};
