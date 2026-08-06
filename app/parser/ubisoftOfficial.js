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
// Adapted to Achievement Watcher's parser contract; icons are extracted once into steam_cache/ubisoftOfficial/<appid>/img and served as
// local paths; rarity is seeded into the shared sidecar cache through the uplay↔steam name bridge.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { officialAppId } = require('../util/platformId.js');

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
  // The index quotes values with either kind of quote ("Watch Dogs: Legion" / 'Watch Dogs: Legion').
  return String(value || '')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function normalizeAchievementsSpec(value) {
  const raw = String(value || '').trim().replace(/^"+|"+$/g, '').replace(/[\\/]+/g, '/');
  if (!raw) return '';
  let base = path.posix.basename(raw).toLowerCase();
  if (base.endsWith('.zip')) base = base.slice(0, -4);
  const prefixed = base.match(/^\d+_(.+)$/);
  return prefixed ? prefixed[1] : base;
}

// The configurations index mixes launcher metadata into each game block. `root.name` (and
// sometimes `display_name`/`game_identifier`) can be the *launcher's* name ("Steam",
// "Ubisoft Connect", …) rather than the game's — using it as the game title produced library
// entries literally titled "Steam" with no cover (Far Cry 4, uplay-971). Treat known launcher
// names as "no title" so the real title comes from the game's own fields, the generic Steam
// name resolution, the mapping asset or the fallback.
const LAUNCHER_TITLE_BLOCKLIST = new Set([
  'steam',
  'uplay',
  'ubisoft',
  'ubisoft connect',
  'epic',
  'epic games',
  'epic games launcher',
  'ea',
  'ea app',
  'ea desktop',
  'origin',
  'rockstar',
  'rockstar games',
  'rockstar games launcher',
  'rockstar launcher',
  'social club',
  'gog',
  'galaxy',
]);

function isLauncherTitle(value) {
  const v = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[™®©]/g, '');
  return !v || LAUNCHER_TITLE_BLOCKLIST.has(v);
}

// `root.name` is very often an UNRESOLVED localization key rather than a name — real values seen in
// the index include "l1", "NAME", "RELATED_GAMENAME_116", "THUMBIMAGE". Using one as a title puts
// gibberish in the library; using one as a Steam search term produces a wrong match, which is worse.
const PLACEHOLDER_TITLES = new Set(['name', 'gamename', 'title', 'displayname', 'null', 'none']);
function isPlaceholderTitle(value) {
  const v = String(value || '').trim();
  if (!v) return true;
  if (/^l\d+$/i.test(v)) return true; // localization slot ("l1")
  if (PLACEHOLDER_TITLES.has(v.toLowerCase())) return true;
  // SCREAMING_SNAKE placeholders. Plain all-caps titles ("UNO") have no underscore and are kept.
  return /_/.test(v) && v === v.toUpperCase() && !/[a-z]/.test(v);
}

function cleanTitle(value) {
  if (isLauncherTitle(value) || isPlaceholderTitle(value)) return '';
  return String(value || '').trim();
}

// Turn an Ubisoft achievements spec (e.g. "971_spec", "FarCry4", "ACShadows_fr") into readable
// words that can be matched against the Steam catalog. Short spec ids ("fc4", "uplay") and pure
// numbers are too ambiguous to use as name candidates; longer camelCase specs ("FarCry4") become
// "far cry 4" and are only ever auto-committed through the same high-confidence Steam matcher as
// every other name lookup.
function specToWords(value) {
  const raw = String(value || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!raw) return [];
  // Most specs are just a content hash ("e58f2672942d2a930e591c55f54f75c6"). Splitting one into
  // "words" yields digit soup that a fuzzy catalog lookup can still match — to the WRONG game. Only
  // specs that actually spell something out ("FarCry4") are usable as a name candidate.
  const body = raw.replace(/\.(zip|bin)$/i, '').replace(/^\d+_/, '');
  if (/^[0-9a-f]{16,}$/i.test(body)) return [];
  const withoutPrefix = raw
    .replace(/^\d+_/, '')
    .replace(/_(?:spec|loc|pc|uplay|steam)$/i, '')
    .replace(/^\d+$/, '');
  const words = String(withoutPrefix)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/gi, '$1 $2')
    .replace(/([0-9])([a-z])/gi, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w && (w.length > 1 || /^\d+$/.test(w)) && !/^(uplay|ubisoft|connect|spec|steam)$/.test(w));
  return words;
}

// Candidate game titles for a configurations block, best first. Launcher names ("Steam", …) are
// filtered out; the achievements spec is a last resort because it is often a short internal id.
function buildNameCandidates(block, archiveSpec = '') {
  const candidates = [];
  const push = (value) => {
    const title = cleanTitle(value);
    if (title && !candidates.includes(title)) candidates.push(title);
  };
  if (block) {
    push(block.gameIdentifier);
    push(block.displayName);
    push(block.rootName);
    // `sort_string` is deliberately NOT a candidate. It is a shelf-ordering key whose stem is the
    // FRANCHISE, not the title ("Assassin's Creed 05.1" → "Assassin's Creed", "watch_dogs03" →
    // "watch_dogs"), and a confident match on a franchise name resolves to the wrong game.
    const specWords = specToWords(block.achievementsSpec);
    if (specWords.length >= 2) push(specWords.join(' '));
  }
  // The achievements archive filename is the last offline signal that survives a missing
  // configurations index: Ubisoft names those caches "<productId>_<spec>" and the spec often
  // spells the title ("971_FarCry4" → "far cry 4"). It is a search candidate only — the resolved
  // Steam release's own name wins for display (see resolveIdentity).
  const archiveWords = specToWords(archiveSpec);
  if (archiveWords.length >= 2) {
    const name = archiveWords.join(' ');
    if (!candidates.includes(name)) candidates.push(name);
  }
  return candidates;
}

// A title distributed on several stores gets SEVERAL configuration blocks sharing one achievements
// spec: the real game block, plus one per storefront whose only name is the storefront itself
// ("root: name: Steam"). Picking the first match is therefore a coin flip — that is how Far Cry 4
// ended up in the library titled "Steam" with no cover (issue #7). Merge them instead and take the
// first usable value for each field, so the storefront block can only ever fill gaps.
function mergeConfigBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
  if (!list.length) return null;

  const firstUsable = (field) => {
    for (const block of list) {
      const value = cleanTitle(block[field]);
      if (value) return value;
    }
    return '';
  };
  const firstRaw = (field) => {
    for (const block of list) {
      const value = String(block[field] || '').trim();
      if (value) return value;
    }
    return '';
  };

  const merged = {
    achievementsSpec: list[0].achievementsSpec,
    normalizedAchievementsSpec: list[0].normalizedAchievementsSpec,
    gameIdentifier: firstUsable('gameIdentifier'),
    displayName: firstUsable('displayName'),
    rootName: firstUsable('rootName'),
    sortString: firstUsable('sortString'),
    backgroundImage: firstRaw('backgroundImage'),
    logoImage: firstRaw('logoImage'),
    iconImage: firstRaw('iconImage'),
    // Which storefronts this spec appeared under. Not a title, but it does say "this product is
    // also sold on Steam", which is exactly the case the identity resolution has to handle.
    storefronts: [...new Set(list.map((b) => String(b.rootName || '').trim().toLowerCase()).filter((n) => LAUNCHER_TITLE_BLOCKLIST.has(n)))],
  };
  merged.title = merged.gameIdentifier || merged.displayName || merged.rootName || '';
  return merged;
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
    // The file is binary-framed with UTF-8 text payloads. Decoding it as latin1 mangled every
    // accented character in a title ("Assassin's Creed® Mirage" → "Assassin's CreedÂ® Mirage");
    // decoding as UTF-8 keeps titles correct and only produces replacement characters inside the
    // binary framing between blocks, which this parser never reads.
    text = fs.readFileSync(filePath).toString('utf8').replace(/\0/g, '');
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
    // `root.name` is frequently a localization key ("l1", "NAME", "RELATED_GAMENAME_116") or the
    // storefront's own name, so it ranks below the installer's game_identifier and display_name.
    const rootName = normalizeQuotedText(block.match(/root:\s*[\s\S]*?\n\s+name:\s*([^\r\n]+)/m)?.[1] || '');
    // sort_string is a shelf-ordering key ("Assassin's Creed 05.1"): a poor title, but a usable
    // last-resort name candidate when every other field is a storefront name or a loc key.
    const sortString = normalizeQuotedText(block.match(/^\s*sort_string:\s*([^\r\n]+)/m)?.[1] || '');
    const backgroundImage = normalizeQuotedText(block.match(/^\s*background_image:\s*([^\r\n]+)/m)?.[1] || '');
    const logoImage = normalizeQuotedText(block.match(/^\s*logo_image:\s*([^\r\n]+)/m)?.[1] || '');
    const iconImage = normalizeQuotedText(block.match(/^\s*icon_image:\s*([^\r\n]+)/m)?.[1] || '');
    blocks.push({
      achievementsSpec,
      normalizedAchievementsSpec: normalizeAchievementsSpec(achievementsSpec),
      gameIdentifier,
      displayName,
      rootName,
      sortString,
      backgroundImage,
      logoImage,
      iconImage,
      title: cleanTitle(gameIdentifier) || cleanTitle(displayName) || cleanTitle(rootName) || '',
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
    const rawSpec = path.basename(filePath).slice(prefix.length);
    const normalizedSpec = normalizeAchievementsSpec(rawSpec);
    const metadata = mergeConfigBlocks(blocks.filter((block) => block.normalizedAchievementsSpec === normalizedSpec));
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(filePath).mtimeMs;
    } catch {}
    const score = metadata ? 2 : 1;
    if (!best || score > best.score || (score === best.score && mtimeMs > best.mtimeMs)) {
      best = { archivePath: filePath, spec: rawSpec, metadata, score, mtimeMs };
    }
  }
  return { archivePath: best.archivePath, spec: best.spec || '', title: best.metadata?.title || '', metadata: best.metadata || null };
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
// down to the trailing number so they can be matched to the archive's numeric ids. Single
// implementation lives in util/rarity.js so the parser seed and the renderer bridge stay in sync.
function normalizeSteamAchName(name) {
  return require('../util/rarity.js').normalizeSteamBridgeName(name);
}

// cacheId = the (namespaced) appid the UI reads rarity by; steamAppId = the Steam release the
// Ubisoft product resolved to (asset, configurations name lookup or installed-library match).
async function seedRarityFromSteam(cacheId, steamAppId, ids) {
  steamAppId = String(steamAppId || '').trim();
  if (!/^\d+$/.test(steamAppId)) return;
  try {
    const rarity = require('../util/rarity.js');
    await rarity.getSteamBridgeRarity(String(cacheId), steamAppId, ids);
  } catch (err) {
    debug.log(`[${cacheId}] ubisoft rarity bridge failed => ${err}`);
  }
}

// ---- generic product identity resolution ---------------------------------------------------------

// Local Steam library scan (appmanifest_*.acf): a Steam purchase that launches Ubisoft Connect is
// installed in the Steam library, so its ACF carries the REAL Steam appid and store name. Matching
// the configurations candidates against those offline manifests resolves ANY future title with no
// asset edit and no network (issue #7).
const { readRegistryString, listRegistryAllSubkeys } = require('../util/reg.js');

function unescapeVdf(value) {
  return String(value || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
}

function parseSteamVdfLibraryFolders(text) {
  const roots = [];
  const re = /^\s*"path"\s+"([^"]+)"/gm;
  let m = null;
  while ((m = re.exec(String(text || '')))) roots.push(unescapeVdf(m[1]));
  return roots;
}

function parseSteamAppManifest(text) {
  const out = { appid: '', name: '', installDir: '' };
  const re = /^\s*"(appid|name|installdir)"\s+"([^"]*)"/gm;
  let m = null;
  while ((m = re.exec(String(text || '')))) {
    if (m[1] === 'appid') out.appid = unescapeVdf(m[2]);
    else if (m[1] === 'name') out.name = unescapeVdf(m[2]);
    else if (m[1] === 'installdir') out.installDir = unescapeVdf(m[2]);
  }
  return out;
}

let localSteamLibraryCache = { steamPath: '', mtimeMs: 0, scan: null };

function normalizePathKey(value) {
  return String(value || '')
    .replace(/[\\/]+/g, '\\')
    .replace(/\\+$/, '')
    .toLowerCase();
}

// Where Ubisoft Connect installed a product. For a Steam purchase that launches Ubisoft Connect,
// this points straight inside the Steam library (…\steamapps\common\Far Cry 4), which identifies
// the Steam release WITHOUT going through any name at all — no asset row, no fuzzy match, no
// network. This is the resolution path that survives titles nobody has mapped yet (issue #7).
function ubisoftInstallDir(productId) {
  const id = String(productId || '').trim();
  if (!/^\d+$/.test(id)) return '';
  for (const hive of ['HKLM', 'HKCU']) {
    for (const root of ['Software/WOW6432Node/Ubisoft/Launcher/Installs', 'Software/Ubisoft/Launcher/Installs']) {
      try {
        const dir = readRegistryString(hive, `${root}/${id}`, 'InstallDir');
        if (dir && String(dir).trim()) return String(dir).trim();
      } catch {
        /* key absent on this hive/bitness — try the next one */
      }
    }
  }
  return '';
}

// The Steam appid whose install folder contains (or equals) `installDir`.
function matchSteamInstall(installDir, installs) {
  const target = normalizePathKey(installDir);
  if (!target) return '';
  let best = '';
  let bestLength = 0;
  for (const entry of installs || []) {
    const dir = normalizePathKey(entry.dir);
    if (!dir) continue;
    // Longest match wins so a nested library folder beats its parent.
    if ((target === dir || target.startsWith(`${dir}\\`)) && dir.length > bestLength) {
      best = entry.appid;
      bestLength = dir.length;
    }
  }
  return best;
}

async function loadLocalSteamInstalls(options = {}) {
  const scan = await scanLocalSteamLibrary(options);
  return scan.installs;
}

async function loadLocalSteamLibrary(options = {}) {
  const scan = await scanLocalSteamLibrary(options);
  return scan.names;
}

async function scanLocalSteamLibrary(options = {}) {
  const explicitPath = String(options.steamPath || '').trim();
  let steamPath = explicitPath;
  if (!steamPath) {
    try {
      steamPath = readRegistryString('HKCU', 'Software/Valve/Steam', 'SteamPath');
      if (!steamPath || !fs.existsSync(path.join(steamPath, 'steam.exe'))) {
        steamPath = readRegistryString('HKLM', 'Software/WOW6432Node/Valve/Steam', 'InstallPath');
      }
    } catch {
      steamPath = '';
    }
  }
  const empty = { names: [], installs: [] };
  if (!steamPath || !fs.existsSync(path.join(steamPath, 'steam.exe'))) return empty;

  const libraryFile = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(libraryFile).mtimeMs;
  } catch {
    /* a Steam install without libraryfolders.vdf still has its own steamapps root */
  }
  if (localSteamLibraryCache.steamPath === steamPath && localSteamLibraryCache.mtimeMs === mtimeMs && localSteamLibraryCache.scan) {
    return localSteamLibraryCache.scan;
  }

  const roots = [path.join(steamPath, 'steamapps')];
  try {
    if (fs.existsSync(libraryFile)) {
      roots.push(...parseSteamVdfLibraryFolders(fs.readFileSync(libraryFile, 'utf8')).map((r) => path.join(r, 'steamapps')));
    }
  } catch {
    /* unreadable library file — the main steamapps root still works */
  }

  const names = [];
  const installs = [];
  const seen = new Set();
  for (const root of roots) {
    let files = [];
    try {
      files = fs.readdirSync(root).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const manifest = parseSteamAppManifest(fs.readFileSync(path.join(root, file), 'utf8'));
        const appid = String(manifest.appid || '').trim();
        if (!/^\d+$/.test(appid) || seen.has(appid)) continue;
        seen.add(appid);
        const name = String(manifest.name || '').trim();
        const installDir = String(manifest.installDir || '').trim();
        if (name) names.push({ appid, name });
        if (installDir && installDir !== name) names.push({ appid, name: installDir });
        if (installDir) installs.push({ appid, name: name || installDir, dir: path.join(root, 'common', installDir) });
      } catch {
        /* skip one corrupt manifest */
      }
    }
  }

  const scan = { names, installs };
  localSteamLibraryCache = { steamPath, mtimeMs, scan };
  return scan;
}

// One resolved identity per Ubisoft product (cache keyed by the raw product id). Resolution is a
// chain, not a per-game patch:
//
//   installdir → the product's registered install folder sits inside a Steam library, which names
//                the Steam release with no title involved at all (the strongest signal, and the one
//                that works for a storefront block carrying no game name whatsoever),
//   asset      → the bundled uplay↔steam mapping,
//   uplay-name → the mapping asset searched by title (the archive spec names the game even when
//                the configurations index does not),
//   library    → a confident name match against the installed Steam manifests,
//   name       → a confident name match against the full Steam catalog.
//
// A Steam purchase that launches Ubisoft Connect (issues #7/#14) is resolved generically — by the
// first step, or from the achievements archive's own spec ("971_FarCry4") through the library or
// catalog — with no per-game asset edit.
let identityCache = new Map();

// Whether a Ubisoft product id is really on disk. Ubisoft Connect registers every product under
// HKLM/HKCU Installs (32/64-bit views), but it also leaves stale subkeys behind after uninstalls,
// so a bare registry key is NOT install proof (it kept owned-but-uninstalled titles such as
// Assassin's Creed Mirage in the "installed" filter). Only a subkey whose InstallDir still exists
// on disk counts. Memoized for the session — the launcher rarely changes mid-run.
let _installedUbisoftProducts = null;
function isUbisoftProductInstalled(productId) {
  const id = String(productId || '').trim();
  if (!/^\d+$/.test(id)) return false;
  if (_installedUbisoftProducts) return _installedUbisoftProducts.has(id);
  const installed = new Set();
  for (const hive of ['HKLM', 'HKCU']) {
    for (const root of ['Software/WOW6432Node/Ubisoft/Launcher/Installs', 'Software/Ubisoft/Launcher/Installs']) {
      try {
        for (const sub of listRegistryAllSubkeys(hive, root) || []) {
          try {
            const dir = readRegistryString(hive, `${root}/${sub}`, 'InstallDir');
            if (dir && fs.existsSync(dir)) installed.add(String(sub));
          } catch {
            /* one corrupt entry must not hide the others */
          }
        }
      } catch {
        /* key absent on this hive/bitness — try the next one */
      }
    }
  }
  _installedUbisoftProducts = installed;
  return installed.has(id);
}

async function resolveIdentity(entry, options = {}) {
  const uplayId = String((entry && (entry.data && entry.data.uplayId)) || (entry && entry.appid) || '').trim();
  const key = `uplay-${uplayId}`;
  if (identityCache.has(key)) return identityCache.get(key);

  const findAppidByName =
    options.findAppidByName || ((name) => require('./steam.js').findAppidByName(name));
  const findAppNameByAppid =
    options.findAppNameByAppid || ((appid) => require('./steam.js').getAppNameByAppid(appid));
  const localSteamLibrary =
    typeof options.localSteamLibrary === 'function'
      ? await options.localSteamLibrary()
      : Array.isArray(options.localSteamLibrary)
      ? options.localSteamLibrary
      : await loadLocalSteamLibrary(options);
  const localSteamInstalls =
    typeof options.localSteamInstalls === 'function'
      ? await options.localSteamInstalls()
      : Array.isArray(options.localSteamInstalls)
      ? options.localSteamInstalls
      : await loadLocalSteamInstalls(options);
  const readUbisoftInstallDir = options.ubisoftInstallDir || ubisoftInstallDir;
  const block = (entry && entry.data && entry.data.configBlock) || {};
  // scan() stores the spec explicitly; entries built elsewhere (tests, cached records) can still
  // carry it inside archivePath (".../971_FarCry4" → "FarCry4").
  const archiveSpec =
    String((entry && entry.data && entry.data.spec) || '').trim() ||
    (entry && entry.data && entry.data.archivePath
      ? path.basename(String(entry.data.archivePath)).replace(/^\d+_/, '')
      : '');
  const candidates = buildNameCandidates(block, archiveSpec);
  // Names derived from the archive spec are searchable but not display-ready ("far cry 4"): a
  // canonical Steam name (asset row, appmanifest, app-list lookup) wins for the title instead.
  const specFallbacks = buildNameCandidates(null, archiveSpec);
  const isSpecCandidate = (candidate) => specFallbacks.includes(candidate);
  const useCandidateTitle = (candidate, canonical = '') => {
    if (title) return;
    title = !isSpecCandidate(candidate) || !canonical ? candidate : canonical;
  };
  const mapping = getUplaySteamMapping().get(uplayId);

  let title = cleanTitle((entry && entry.data && entry.data.title) || '');
  let steamAppId = '';
  let steamName = '';
  let method = '';

  // 1) Path identity. Ubisoft Connect records where it installed the product; when that folder is
  //    inside a Steam library, the owning appmanifest IS the answer. No name, no catalog, no guess.
  let installDir = '';
  try {
    installDir = readUbisoftInstallDir(uplayId);
    const hit = installDir ? matchSteamInstall(installDir, localSteamInstalls) : '';
    if (/^\d+$/.test(hit)) {
      steamAppId = hit;
      method = 'installdir';
      const owner = localSteamInstalls.find((i) => i.appid === hit);
      if (!title && owner && owner.name) title = owner.name;
    }
  } catch (err) {
    debug.log(`[uplay-${uplayId}] install-dir lookup failed => ${err}`);
  }

  if (!/^\d+$/.test(steamAppId) && mapping?.steam_appid != null && /^\d+$/.test(String(mapping.steam_appid).trim())) {
    steamAppId = String(mapping.steam_appid).trim();
    steamName = mapping.steam_name ? String(mapping.steam_name).trim() : '';
    method = 'asset';
  }

  // 2b) The installed product's own files: uplay_install.state embeds the canonical title, and the
  // folder/install-state matching in uplayR2 resolves it against the mapping asset even when this
  // product id has no direct row (storefront variants share one game but carry different ids, e.g.
  // Assassin's Creed Black Flag Resynced = 65043 native + 66088 Steam).
  if (!/^\d+$/.test(steamAppId) && installDir) {
    try {
      const uplayR2 = require('./uplayR2.js');
      const mapped = uplayR2.resolveSteamMapping({ appid: `UPLAY${uplayId}`, gameDir: installDir });
      if (mapped && /^\d+$/.test(String(mapped.steam_appid).trim())) {
        steamAppId = String(mapped.steam_appid).trim();
        steamName = mapped.steam_name ? String(mapped.steam_name).trim() : '';
        method = 'uplay-install-state';
        if (!title) title = steamName;
      }
    } catch (err) {
      debug.log(`[uplay-${uplayId}] install-state mapping failed => ${err}`);
    }
  }

  if (!/^\d+$/.test(steamAppId)) {
    // 2c) The mapping asset is also searchable by title: a configurations name that matches a known
    // Ubisoft release resolves to that release's Steam appid without touching the full catalog.
    try {
      const uplayR2 = require('./uplayR2.js');
      for (const candidate of candidates) {
        const mapped = uplayR2.resolveSteamMapping({ name: candidate });
        if (mapped && /^\d+$/.test(String(mapped.steam_appid).trim())) {
          steamAppId = String(mapped.steam_appid).trim();
          steamName = mapped.steam_name ? String(mapped.steam_name).trim() : '';
          method = 'uplay-name';
          useCandidateTitle(candidate, steamName);
          break;
        }
      }
    } catch (err) {
      debug.log(`[uplay-${uplayId}] mapping-by-name failed => ${err}`);
    }
  }

  if (!/^\d+$/.test(steamAppId)) {
    // 3) The game is installed in the local Steam library: match the configurations candidates
    //    against the appmanifest names/install dirs with the same high-confidence matcher the rest
    //    of the app uses.
    for (const candidate of candidates) {
      const hit = localSteamLibrary.length
        ? require('../util/fuzzyAppid.js').bestConfidentAppid(candidate, localSteamLibrary)
        : null;
      if (hit && /^\d+$/.test(String(hit))) {
        steamAppId = String(hit).trim();
        steamName = '';
        method = 'library';
        const owner = localSteamLibrary.find((i) => String(i.appid) === String(hit));
        useCandidateTitle(candidate, owner && owner.name ? String(owner.name).trim() : '');
        break;
      }
    }
  }

  if (!/^\d+$/.test(steamAppId)) {
    // 4) Last resort: the full Steam catalog, by name.
    for (const candidate of candidates) {
      let sid = null;
      try {
        sid = await findAppidByName(candidate);
      } catch {
        /* name lookup is best-effort; the next candidate may still match */
      }
      const resolved = String(sid || '').trim();
      if (/^\d+$/.test(resolved)) {
        steamAppId = resolved;
        steamName = '';
        method = 'name';
        let appName = '';
        try {
          appName = String((await findAppNameByAppid(resolved)) || '').trim();
        } catch {
          /* name lookup is best-effort; the candidate remains the fallback */
        }
        useCandidateTitle(candidate, appName);
        break;
      }
    }
  }

  const result = {
    // A resolved Steam release always outranks the mapping asset's own uplay label, which is often
    // a regional variant ("Far Cry 4 RU"). `title` stays first: it is the game's own configurations
    // entry, already stripped of storefront names.
    title: title || steamName || mapping?.steam_name || mapping?.uplay_name || '',
    steamAppId,
    steamName,
    method,
  };
  identityCache.set(key, result);
  return result;
}

function resetIdentityCache() {
  identityCache = new Map();
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
    // Ubisoft product ids are small integers (1843, 6100, …) that overlap Steam's appid space, so
    // the shared rarity/cover/gameIndex caches would collide with a same-numbered Steam game. Use a
    // namespaced identity ("uplay-<id>") as the appid and keep the raw id in data for the mapping.
    byProduct.set(entry.appid, {
      appid: officialAppId('ubisoftOfficial', entry.appid),
      source: 'Ubisoft Connect',
      data: {
        type: 'ubisoftOfficial',
        uplayId: entry.appid,
        // Registered install dir (registry InstallDir, verified on disk) — lets the launch panel
        // auto-detect the executable instead of asking for one by hand.
        gameDir: (() => {
          const dir = ubisoftInstallDir(entry.appid);
          return dir && fs.existsSync(dir) ? dir : null;
        })(),
        // A registered install dir proves the product is really on disk, so "show installed only"
        // keeps it even when the folder scan couldn't resolve a gameDir/exe (e.g. a launcher-managed
        // install outside the configured library roots).
        trustedInstalled: isUbisoftProductInstalled(entry.appid),
        path: path.dirname(entry.spoolFilePath),
        spoolFilePath: entry.spoolFilePath,
        userId: entry.userId,
        archivePath: archive.archivePath,
        spec: archive.spec || '',
        configBlock: archive.metadata || null,
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

  // Resolve the real identity generically (configurations name → Steam catalog → name lookup) so a
  // Steam-launched Ubisoft title never shows up as "Steam"/"Ubisoft <id>" and future titles get
  // cover art without a per-game asset patch (issue #7).
  const identity = await resolveIdentity(appid);
  const uplayId = data.uplayId || appid.appid;
  const steamAppId = identity.steamAppId;
  if (identity.method) debug.log(`[${appid.appid}] identity resolved via ${identity.method}${identity.steamAppId ? ` -> Steam ${identity.steamAppId}` : ''}`);
  const displayTitle = cleanTitle(data.title) || identity.title || '';
  let img = { header: null, background: null, portrait: null, icon: null };
  if (/^\d+$/.test(steamAppId)) {
    let portrait = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_600x900.jpg`;
    // Modern Steam covers live under a hashed store_item_assets path that cannot be derived from the
    // appid; the guessable URL 404s and the tile stays blank. Recover the real capsule from SteamDB
    // (main-process stealth browser + 30-day disk cache), same as the Steam parser does.
    try {
      const { ipcRenderer } = require('electron');
      const steamdbPortrait = await ipcRenderer.invoke('get-steamdb-cover', steamAppId).catch(() => null);
      if (steamdbPortrait) portrait = steamdbPortrait;
      else if (displayTitle) {
        const sgdbPortrait = await ipcRenderer.invoke('get-steamgriddb-cover', displayTitle).catch(() => null);
        if (sgdbPortrait) portrait = sgdbPortrait;
      }
    } catch (err) {
      debug.log(`[${appid.appid}] SteamDB cover fallback failed => ${err}`);
    }
    img = {
      header: `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`,
      background: null,
      portrait,
      icon: null,
    };
  } else {
    // No Steam release to borrow art from: use the launcher's own cached images (header/background/
    // icon) when the configurations index names them, then SteamGridDB by title as a last resort.
    try {
      const uplayPath =
        readRegistryString('HKLM', 'Software/WOW6432Node/Ubisoft/Launcher', 'InstallDir') ||
        readRegistryString('HKCU', 'Software/WOW6432Node/Ubisoft/Launcher', 'InstallDir') ||
        readRegistryString('HKLM', 'Software/Ubisoft/Launcher', 'InstallDir');
      const assetsRoot = uplayPath ? path.join(uplayPath, 'cache/assets') : '';
      const gamesRoot = uplayPath ? path.join(uplayPath, 'data/games') : '';
      const meta = data.configBlock || {};
      if (assetsRoot) {
        const imgDir = path.join(cacheRoot || '', 'steam_cache', 'ubisoftOfficial', String(appid.appid), 'img');
        fs.mkdirSync(imgDir, { recursive: true });
        const copyAsset = (name, sourceRoot, key) => {
          if (!name) return '';
          const src = path.join(sourceRoot, name);
          if (!fs.existsSync(src)) return '';
          const dest = path.join(imgDir, `${key}${path.extname(name) || '.jpg'}`);
          try {
            fs.copyFileSync(src, dest);
            return dest.replace(/\\/g, '/');
          } catch {
            return '';
          }
        };
        img.background = copyAsset(meta.backgroundImage, assetsRoot, 'background');
        img.header = copyAsset(meta.logoImage, assetsRoot, 'header');
        img.icon = copyAsset(meta.iconImage, gamesRoot, 'icon') || copyAsset(meta.iconImage, assetsRoot, 'icon');
      }
    } catch (err) {
      debug.log(`[${appid.appid}] local Ubisoft cover extraction failed => ${err}`);
    }
    if (!img.portrait && displayTitle) {
      try {
        const { ipcRenderer } = require('electron');
        const sgdbPortrait = await ipcRenderer.invoke('get-steamgriddb-cover', displayTitle).catch(() => null);
        if (sgdbPortrait) img.portrait = sgdbPortrait;
      } catch (err) {
        debug.log(`[${appid.appid}] SteamGridDB cover fallback failed => ${err}`);
      }
    }
  }

  // rarity: Steam global % bridged onto the numeric ids, cached under the (namespaced) appid so the
  // detail view reads it back by game.appid without colliding with a same-numbered Steam game.
  await seedRarityFromSteam(appid.appid, steamAppId, schema.ids);

  // A configurations entry can still resolve to a launcher name even after the scan-side filter
  // (e.g. a stale user-data copy of the index). Never surface "Steam"/"Ubisoft Connect" as a title.
  return {
    name: displayTitle || `Ubisoft ${uplayId}`,
    appid: appid.appid,
    steamappid: steamAppId || undefined,
    ubisoftProductId: String(uplayId),
    system: 'uplay',
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
  isLauncherTitle,
  isPlaceholderTitle,
  cleanTitle,
  specToWords,
  buildNameCandidates,
  resolveIdentity,
  resetIdentityCache,
  parseSteamVdfLibraryFolders,
  parseSteamAppManifest,
  loadLocalSteamLibrary,
  loadLocalSteamInstalls,
  mergeConfigBlocks,
  ubisoftInstallDir,
  matchSteamInstall,
  readConfigurationsIndex,
};
