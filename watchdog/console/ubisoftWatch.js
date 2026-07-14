'use strict';

// Live toasts for Ubisoft Connect OFFICIAL achievements. The client appends a protobuf record
// ({achievementId, earnedTime}) to %LOCALAPPDATA%\Ubisoft Game Launcher\spool\<userGuid>\
// <productId>.spool the moment an achievement pops — watching those files gives real-time unlocks
// for legit Ubisoft games. Toast texts/icons come from the client's cached achievements archive
// (%ProgramData%\Ubisoft\Ubisoft Game Launcher\cache\achievements\<id>_<spec>, a ZIP of
// <locale>_loc.txt + <id>.png); games without that archive are skipped (nothing to display).
// Isolated from the Steam watch path like the other console watchers: own discovery, own baseline
// cache, shared notify() only. The spool/zip readers are duplicated from app/parser/
// ubisoftOfficial.js on purpose — the watchdog is packaged standalone and cannot require app/*.
//
// Format knowledge ported from PSerban93/Achievements (JokerVerse) utils/ubisoft-connect-local.js —
// MIT-licensed; see THIRD_PARTY_NOTICES.md.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const watch = require('node-watch');
const moment = require('moment');
const debug = require('../util/log.js');
const waitForFileStable = require('../util/waitForFileStable.js');
const { notificationVolumePercent } = require('../util/notificationVolume.js');

const APPDATA = process.env['APPDATA'] || '';
const cacheDir = path.join(APPDATA, 'Achievement Watcher/steam_cache/console');
const iconCacheRoot = path.join(APPDATA, 'Achievement Watcher/steam_cache/ubisoftOfficial');
const SPOOL_ROOT = process.env['LOCALAPPDATA'] ? path.join(process.env['LOCALAPPDATA'], 'Ubisoft Game Launcher', 'spool') : '';
const ACHIEVEMENTS_ROOT = process.env['ProgramData']
  ? path.join(process.env['ProgramData'], 'Ubisoft', 'Ubisoft Game Launcher', 'cache', 'achievements')
  : '';
const CONFIGURATIONS_PATH = process.env['LOCALAPPDATA']
  ? path.join(process.env['LOCALAPPDATA'], 'Ubisoft Game Launcher', 'cache', 'configuration', 'configurations')
  : '';

let watchers = [];

// ---- spool protobuf reader (subset of app/parser/ubisoftOfficial.js) ----------------------------

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
    if (shift > 49) throw 'varint too large';
  }
  throw 'truncated varint';
}

function skipProtoField(buffer, offset, wireType, end = buffer.length) {
  if (wireType === 0) return readVarint(buffer, offset, end).nextOffset;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const lenInfo = readVarint(buffer, offset, end);
    return lenInfo.nextOffset + lenInfo.value;
  }
  if (wireType === 5) return offset + 4;
  throw `unsupported wire type ${wireType}`;
}

function findFirstProtoVarint(buffer, targetField, start, end, depth = 0) {
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

// [{id, time(unix s)}] — deduped, sorted by time
function readSpool(filePath) {
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
      const id = findFirstProtoVarint(buffer, 1, payloadStart, payloadEnd);
      const rawTime = findFirstProtoVarint(buffer, 2, payloadStart, payloadEnd);
      if (Number(id) > 0 && Number(rawTime) > 0) {
        const time = Number(rawTime) >= 10_000_000_000 ? Math.floor(Number(rawTime) / 1000) : Number(rawTime);
        const key = `${id}:${time}`;
        if (!seen.has(key)) {
          seen.add(key);
          records.push({ id: String(id), time });
        }
      }
      offset = payloadEnd;
      continue;
    }
    offset = skipProtoField(buffer, offset, wireType, buffer.length);
  }
  records.sort((a, b) => a.time - b.time);
  return records;
}

// ---- schema archive reader (subset) --------------------------------------------------------------

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
  if (eocdOffset < 0) throw 'zip EOCD not found';
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralEnd = centralDirectoryOffset + centralDirectorySize;
  const entries = new Map();
  let offset = centralDirectoryOffset;
  while (offset < centralEnd) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw 'invalid zip central entry';
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
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw 'invalid zip local entry';
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.compressionMethod === 0) return Buffer.from(compressed);
    if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
    throw `unsupported zip compression ${entry.compressionMethod}`;
  };
  return { entries, readEntry };
}

function parseLocTxt(buffer) {
  const out = new Map();
  for (const line of buffer.toString('utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const parts = String(line || '').trim().split('\t');
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

// Load {texts: Map(id→{displayName,description}), iconFor(id)→localPath|undefined} for a product.
// Locale preference: the app language's Ubisoft locale, then en-US, then any.
function loadSchema(appid, lang) {
  const prefix = `${appid}_`;
  let candidates = [];
  try {
    candidates = fs
      .readdirSync(ACHIEVEMENTS_ROOT, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.startsWith(prefix))
      .map((e) => path.join(ACHIEVEMENTS_ROOT, e.name));
  } catch {
    return null;
  }
  if (!candidates.length) return null;
  const archivePath = candidates.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  })[0];

  let zip;
  try {
    zip = readZipEntries(archivePath);
  } catch (err) {
    debug.warn(`[ubisoft] unreadable achievements archive for ${appid}: ${err}`);
    return null;
  }

  // steam-api lang name → ubisoft locale prefix ("french" → fr)
  const LANG_PREFIX = { english: 'en', french: 'fr', german: 'de', italian: 'it', spanish: 'es', portuguese: 'pt', brazilian: 'pt-br', russian: 'ru', polish: 'pl', japanese: 'ja', koreana: 'ko', schinese: 'zh-cn', tchinese: 'zh-tw', dutch: 'nl', danish: 'da', finnish: 'fi', swedish: 'sv', norwegian: 'nb', czech: 'cs', hungarian: 'hu', romanian: 'ro', turkish: 'tr', ukrainian: 'uk', greek: 'el', thai: 'th', vietnamese: 'vi', arabic: 'ar', bulgarian: 'bg', indonesian: 'id', latam: 'es-mx' };
  const wantedPrefix = LANG_PREFIX[String(lang || '').toLowerCase()] || 'en';
  const locNames = Array.from(zip.entries.keys()).filter((n) => /_loc\.txt$/i.test(n));
  const pick =
    locNames.find((n) => n.toLowerCase().startsWith(wantedPrefix)) ||
    locNames.find((n) => n.toLowerCase().startsWith('en')) ||
    locNames[0];
  const texts = pick ? parseLocTxt(zip.readEntry(pick)) : new Map();

  const iconDir = path.join(iconCacheRoot, String(appid), 'img');
  const iconFor = (id) => {
    const entryName = Array.from(zip.entries.keys()).find((n) => n.toLowerCase() === `${id}.png` || n.toLowerCase() === `${String(id).padStart(2, '0')}.png`);
    if (!entryName) return undefined;
    const iconPath = path.join(iconDir, `${id}.png`);
    try {
      if (!fs.existsSync(iconPath)) {
        fs.mkdirSync(iconDir, { recursive: true });
        fs.writeFileSync(iconPath, zip.readEntry(entryName));
      }
      return iconPath;
    } catch {
      return undefined;
    }
  };

  return { texts, iconFor };
}

// Product titles from the configurations index (best effort).
function readTitles() {
  const out = new Map(); // normalizedSpec is not needed here — map by product id prefix of archives
  let text = '';
  try {
    text = fs.readFileSync(CONFIGURATIONS_PATH).toString('latin1').replace(/\0/g, '');
  } catch {
    return out;
  }
  const blockRegex = /version:\s*[^\r\n]+\r?\nroot:\s*[\s\S]*?(?=(?:version:\s*[^\r\n]+\r?\nroot:)|$)/g;
  let match = null;
  while ((match = blockRegex.exec(text))) {
    const block = String(match[0] || '');
    const spec = (block.match(/^\s*achievements:\s*([^\r\n]+)/m)?.[1] || '').trim().replace(/^"+|"+$/g, '');
    if (!spec) continue;
    const title = (
      block.match(/^\s*game_identifier:\s*([^\r\n]+)/m)?.[1] ||
      block.match(/^\s*display_name:\s*([^\r\n]+)/m)?.[1] ||
      ''
    )
      .trim()
      .replace(/^"+|"+$/g, '');
    if (title) out.set(spec.toLowerCase(), title);
  }
  return out;
}

function discover() {
  const targets = [];
  let userDirs = [];
  try {
    userDirs = fs.readdirSync(SPOOL_ROOT, { withFileTypes: true });
  } catch {
    return targets;
  }
  for (const userDir of userDirs) {
    if (!userDir.isDirectory()) continue;
    const dir = path.join(SPOOL_ROOT, userDir.name);
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      const match = file.match(/^(\d+)\.spool$/i);
      if (!match) continue;
      targets.push({ appid: match[1], spoolDir: dir, spoolFilePath: path.join(dir, file) });
    }
  }
  return targets;
}

function cacheFile(appid) {
  return path.join(cacheDir, `ubisoft-${String(appid).replace(/[^\w.-]/g, '_')}.json`);
}
function cacheLoad(appid) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(appid), 'utf8'));
  } catch {
    return null;
  }
}
function cacheSave(appid, unlockedKeys) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile(appid), JSON.stringify({ unlocked: unlockedKeys }), 'utf8');
  } catch (err) {
    debug.warn(`[ubisoft] cache save failed for ${appid}: ${err}`);
  }
}

async function handleChange(target, ctx) {
  try {
    await waitForFileStable(target.spoolFilePath);
    const records = readSpool(target.spoolFilePath);
    if (!records.length) return;

    const cache = cacheLoad(target.appid);
    const isFirstObservation = !cache || !Array.isArray(cache.unlocked);

    if (!isFirstObservation) {
      const prev = new Set(cache.unlocked);
      // schema loaded lazily, only when there is something new to toast
      let schema = null;
      let delay = 0;
      for (const record of records) {
        if (prev.has(record.id)) continue;
        if (!schema) schema = loadSchema(target.appid, ctx.options.achievement.lang) || { texts: new Map(), iconFor: () => undefined };
        const text = schema.texts.get(record.id) || {};
        debug.log(`[ubisoft] Unlocked: ${target.name} - ${text.displayName || record.id}`);
        await ctx.notify(
          {
            source: 'Ubisoft Connect',
            appid: target.appid,
            gameDisplayName: target.name,
            achievementName: record.id,
            achievementDisplayName: text.displayName || `Achievement ${record.id}`,
            achievementDescription: text.description || '',
            icon: schema.iconFor(record.id),
            time: record.time || moment().unix(),
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
              attribution: 'Achievement',
            },
            prefetch: false, // icons are extracted to local files
            rumble: ctx.options.notification.rumble,
          }
        );
        delay += 1;
      }
    }

    cacheSave(target.appid, records.map((r) => r.id));
  } catch (err) {
    debug.warn(`[ubisoft] handleChange failed for ${target.appid}: ${err}`);
  }
}

// Tear down any existing watchers and (re)start from the current options. Safe to call on every
// settings reload. Gated by the Ubisoft-official source flag + the master notify switch.
module.exports.start = async (ctx) => {
  module.exports.stop();

  if (!ctx || !ctx.options) return;
  if (ctx.options.achievement_source && ctx.options.achievement_source.ubisoftOfficial === false) return;
  if (ctx.options.notification && ctx.options.notification.notify === false) return;
  if (typeof ctx.notify !== 'function') return;

  let targets;
  try {
    targets = discover();
  } catch (err) {
    debug.warn(`[ubisoft] discovery failed: ${err}`);
    return;
  }
  if (targets.length === 0) return;

  const titles = readTitles();
  const watchedDirs = new Set();
  for (const target of targets) {
    // resolve a display name: archive spec title match is complex — configurations titles are keyed
    // by spec, so best effort: use any title whose spec starts with the product id, else generic.
    const titleKey = Array.from(titles.keys()).find((k) => k.startsWith(`${target.appid}_`));
    target.name = (titleKey && titles.get(titleKey)) || `Ubisoft ${target.appid}`;

    // Seed the baseline up front so we never replay a back-catalogue of unlocks on launch.
    if (!cacheLoad(target.appid)) {
      try {
        cacheSave(target.appid, readSpool(target.spoolFilePath).map((r) => r.id));
      } catch (err) {
        debug.warn(`[ubisoft] baseline read failed for ${target.appid}: ${err}`);
      }
    }
  }

  // one watcher per user dir (several spools share it)
  for (const target of targets) {
    if (watchedDirs.has(target.spoolDir)) continue;
    watchedDirs.add(target.spoolDir);
    const dirTargets = targets.filter((t) => t.spoolDir === target.spoolDir);
    try {
      const w = watch(target.spoolDir, { recursive: false, filter: /\.spool$/i }, (evt, name) => {
        if (evt !== 'update' || !name) return;
        const hit = dirTargets.find((t) => path.basename(String(name)).toLowerCase() === path.basename(t.spoolFilePath).toLowerCase());
        if (hit) handleChange(hit, ctx);
      });
      watchers.push(w);
      debug.log(`[ubisoft] watching ${dirTargets.length} spool(s) in ${target.spoolDir}`);
    } catch (err) {
      debug.warn(`[ubisoft] failed to watch ${target.spoolDir}: ${err}`);
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

// Exposed for unit testing the pure readers.
module.exports._internal = { readSpool, readZipEntries, parseLocTxt, loadSchema, discover };
