'use strict';

// Live toasts for ShadPS4 (PS4 emulator) trophies. Kept deliberately small and self-contained: a
// ShadPS4 trophy file is plain XML (TROP*.XML) holding BOTH the schema and the unlock state
// (`unlockstate` / `timestamp` attributes), so a dependency-free regex reader is enough — no xml2js
// (which the watchdog doesn't ship) and no binary decoding. This module is isolated from the Steam
// watch path: it has its own discovery, its own tiny baseline cache, and reuses only the shared
// notify() toaster + waitForFileStable. PS4 "platinum" is itself a normal trophy, so it toasts like
// any other unlock — no synthetic 100% logic needed.

const fs = require('fs');
const path = require('path');
const watch = require('node-watch');
const moment = require('moment');
const debug = require('../util/log.js');
const waitForFileStable = require('../util/waitForFileStable.js');

const APPDATA = process.env['APPDATA'] || '';
const cacheDir = path.join(APPDATA, 'Achievement Watcher/steam_cache/console');

// Best-effort language → TROP_NN.XML suffix (Sony index). english/default is the suffix-less TROP.XML.
const LANG_FILE = { japanese: '00', english: '01', french: '02', spanish: '03', german: '04', italian: '05', russian: '08', koreana: '09', schinese: '11', polish: '16', brazilian: '17', turkish: '19' };

let watchers = [];

function decodeXml(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}

function ttype(t) {
  const c = String(t || '').trim().toUpperCase();
  return ['P', 'G', 'S', 'B'].includes(c) ? c : 'B';
}

function toUnixSeconds(raw) {
  let n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e12) n = Math.floor(n / 1000000);
  else if (n > 1e11) n = Math.floor(n / 1000);
  return n;
}

// Parse one TROP*.XML string into { title, trophies:[{id, ttype, hidden, displayName, description, unlockstate, timestamp}] }.
function parseXml(xml) {
  const title = decodeXml((xml.match(/<title-name>([\s\S]*?)<\/title-name>/i) || [])[1] || '').trim();
  const trophies = [];
  const re = /<trophy\b([^>]*)>([\s\S]*?)<\/trophy>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const body = m[2];
    const attr = (n) => {
      const a = attrs.match(new RegExp(`${n}\\s*=\\s*"([^"]*)"`, 'i'));
      return a ? a[1] : '';
    };
    const id = parseInt(attr('id'), 10);
    if (!Number.isFinite(id)) continue;
    trophies.push({
      id,
      ttype: ttype(attr('ttype')),
      hidden: /yes/i.test(attr('hidden')) ? 1 : 0,
      displayName: decodeXml((body.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || '').trim(),
      description: decodeXml((body.match(/<detail>([\s\S]*?)<\/detail>/i) || [])[1] || '').trim(),
      unlockstate: attr('unlockstate'),
      timestamp: attr('timestamp'),
    });
  }
  return { title, trophies };
}

function listXml(xmlDir) {
  try {
    return fs.readdirSync(xmlDir).filter((f) => /^trop(_\d{2})?\.xml$/i.test(f)).sort();
  } catch {
    return [];
  }
}

// Read a trophy set: schema from the language/base file, unlock state unioned across all TROP*.XML.
function read(target, lang) {
  const files = listXml(target.xmlDir);
  if (files.length === 0) return null;

  const suffix = LANG_FILE[String(lang || '').toLowerCase()];
  const wanted = suffix ? `trop_${suffix}.xml` : 'trop.xml';
  const baseFile = files.find((f) => f.toLowerCase() === wanted) || files.find((f) => f.toLowerCase() === 'trop.xml') || files[0];

  const base = parseXml(fs.readFileSync(path.join(target.xmlDir, baseFile), 'utf8'));

  // Union unlock state across every language file (state can be written to just one of them).
  const stateById = new Map();
  for (const file of files) {
    let parsed;
    try {
      parsed = parseXml(fs.readFileSync(path.join(target.xmlDir, file), 'utf8'));
    } catch {
      continue;
    }
    for (const t of parsed.trophies) {
      const unlocked = String(t.unlockstate).toLowerCase() === 'true' || String(t.unlockstate).toLowerCase() === 'yes';
      const prev = stateById.get(t.id);
      if (!prev || (unlocked && !prev.achieved)) stateById.set(t.id, { achieved: unlocked, time: toUnixSeconds(t.timestamp) });
    }
  }

  const list = base.trophies.map((t) => {
    const st = stateById.get(t.id) || { achieved: false, time: 0 };
    const icon = path.join(target.iconsDir, `TROP${String(t.id).padStart(3, '0')}.PNG`);
    return { id: t.id, type: t.ttype, hidden: t.hidden, displayName: t.displayName, description: t.description, icon, achieved: st.achieved, time: st.time };
  });

  return { name: base.title || target.appid, list };
}

// Discover ShadPS4 trophy sets under %APPDATA%/shadPS4 (game_data and user/game_data).
function discover() {
  const targets = [];
  const seen = new Set();
  const roots = [path.join(APPDATA, 'shadPS4', 'game_data'), path.join(APPDATA, 'shadPS4', 'user', 'game_data')];

  for (const gameData of roots) {
    let cusas;
    try {
      cusas = fs.readdirSync(gameData, { withFileTypes: true }).filter((e) => e.isDirectory() && /^CUSA/i.test(e.name)).map((e) => e.name);
    } catch {
      continue;
    }
    for (const cusa of cusas) {
      if (seen.has(cusa)) continue;
      const trophyFiles = path.join(gameData, cusa, 'TrophyFiles');
      let sets;
      try {
        sets = fs.readdirSync(trophyFiles, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        continue;
      }
      for (const set of sets) {
        const xmlDir = path.join(trophyFiles, set, 'Xml');
        if (listXml(xmlDir).length === 0) continue;
        targets.push({ appid: cusa, xmlDir, iconsDir: path.join(trophyFiles, set, 'Icons') });
        seen.add(cusa);
        break;
      }
    }
  }
  return targets;
}

function cacheFile(appid) {
  return path.join(cacheDir, `${String(appid).replace(/[^\w.-]/g, '_')}.json`);
}
function cacheLoad(appid) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(appid), 'utf8'));
  } catch {
    return null;
  }
}
function cacheSave(appid, unlockedIds) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile(appid), JSON.stringify({ unlocked: unlockedIds }), 'utf8');
  } catch (err) {
    debug.warn(`[shadps4] cache save failed for ${appid}: ${err}`);
  }
}

async function handleChange(target, changedFile, ctx) {
  try {
    if (changedFile) await waitForFileStable(changedFile);

    const data = read(target, ctx.options.achievement.lang);
    if (!data) return;

    const achievedNow = data.list.filter((t) => t.achieved);
    const cache = cacheLoad(target.appid);
    const isFirstObservation = !cache || !Array.isArray(cache.unlocked);

    // First time we ever see this game: record the baseline silently so a pre-existing save full of
    // already-earned trophies doesn't toast on startup. Only real unlocks afterwards notify.
    if (!isFirstObservation) {
      const prev = new Set(cache.unlocked);
      let delay = 0;
      for (const t of achievedNow) {
        if (prev.has(t.id)) continue;
        debug.log(`[shadps4] Unlocked: ${data.name} - ${t.displayName}`);
        await ctx.notify(
          {
            source: 'ShadPS4 Emulator',
            appid: target.appid,
            gameDisplayName: data.name,
            achievementName: String(t.id),
            achievementDisplayName: t.displayName,
            achievementDescription: t.description,
            icon: fs.existsSync(t.icon) ? t.icon : undefined,
            time: t.time || moment().unix(),
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
              imageIntegration: '0',
              group: ctx.options.notification_toast.groupToast,
              cropIcon: true,
              attribution: 'Trophy',
            },
            prefetch: false, // icons are already local files
            rumble: ctx.options.notification.rumble,
          }
        );
        delay += 1;
      }
    }

    cacheSave(target.appid, achievedNow.map((t) => t.id));
  } catch (err) {
    debug.warn(`[shadps4] handleChange failed for ${target.appid}: ${err}`);
  }
}

// Tear down any existing watchers and (re)start from the current options. Safe to call on every
// settings reload. Gated by the ShadPS4 source flag + the master notify switch.
module.exports.start = async (ctx) => {
  module.exports.stop();

  if (!ctx || !ctx.options) return;
  if (ctx.options.achievement_source && ctx.options.achievement_source.shadps4 === false) return;
  if (ctx.options.notification && ctx.options.notification.notify === false) return;
  if (typeof ctx.notify !== 'function') return;

  let targets;
  try {
    targets = discover();
  } catch (err) {
    debug.warn(`[shadps4] discovery failed: ${err}`);
    return;
  }
  if (targets.length === 0) return;

  for (const target of targets) {
    // Seed the baseline up front so we never replay a back-catalogue of unlocks on launch.
    if (!cacheLoad(target.appid)) {
      const data = read(target, ctx.options.achievement.lang);
      if (data) cacheSave(target.appid, data.list.filter((t) => t.achieved).map((t) => t.id));
    }
    try {
      const w = watch(target.xmlDir, { recursive: false, filter: /trop(_\d{2})?\.xml$/i }, (evt, name) => {
        if (evt !== 'update') return;
        handleChange(target, name, ctx);
      });
      watchers.push(w);
      debug.log(`[shadps4] watching trophies for ${target.appid}`);
    } catch (err) {
      debug.warn(`[shadps4] failed to watch ${target.xmlDir}: ${err}`);
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
module.exports._internal = { parseXml, read, discover };
