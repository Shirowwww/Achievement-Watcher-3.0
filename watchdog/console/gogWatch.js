'use strict';

// Live toasts for GOG Galaxy OFFICIAL achievements. Galaxy stores each game's achievement schema +
// unlock state in a per-game SQLite file (%LOCALAPPDATA%\GOG.com\Galaxy\Applications\<clientId>\
// Gameplay\<userId>\gameplay.db, localized, with GOG CDN icon URLs) that the client rewrites the
// moment an achievement pops — so watching those files gives real-time unlocks for legit GOG games.
// Product titles come from the Galaxy catalog db (%ProgramData%\GOG.com\Galaxy\storage\
// galaxy-2.0.db). SQLite is read via the runtime's built-in node:sqlite (the watchdog runs under
// Electron's Node 24) — no native dependency. Isolated from the Steam watch path like the other
// console watchers: own discovery, own baseline cache, shared notify() only.
//
// DB layout knowledge ported from PSerban93/Achievements (JokerVerse) utils/gog-galaxy-local.js —
// MIT-licensed; see NOTICE.md.

const fs = require('fs');
const path = require('path');
const watch = require('node-watch');
const moment = require('moment');
const debug = require('../util/log.js');
const { notificationVolumePercent } = require('../util/notificationVolume.js');

const APPDATA = process.env['APPDATA'] || '';
const cacheDir = path.join(APPDATA, 'Achievement Watcher/steam_cache/console');
const STORAGE_DB = path.join(process.env['ProgramData'] || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');
const APPLICATIONS_ROOT = path.join(process.env['LOCALAPPDATA'] || '', 'GOG.com', 'Galaxy', 'Applications');

let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

let watchers = [];

function normalizeId(value) {
  const raw = String(value ?? '').trim();
  return /^[0-9]+$/.test(raw) ? raw : '';
}

// Galaxy ids are 64-bit — node:sqlite throws on them unless the statement reads BigInts.
function queryAll(dbPath, sql) {
  if (!DatabaseSync) throw 'node:sqlite unavailable in this runtime';
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare(sql);
    if (typeof stmt.setReadBigInts === 'function') stmt.setReadBigInts(true);
    return stmt.all();
  } finally {
    try {
      db.close();
    } catch {}
  }
}

// clientId -> {productId, title} from the Galaxy catalog.
function readProductsByClientId() {
  const out = new Map();
  const rows = queryAll(
    STORAGE_DB,
    `SELECT pa.productId AS productId, pa.clientId AS clientId, ld.title AS title
     FROM ProductAuthorizations pa
     LEFT JOIN LimitedDetails ld ON ld.productId = pa.productId`
  );
  for (const row of rows) {
    const clientId = normalizeId(row?.clientId);
    const productId = normalizeId(row?.productId);
    if (!clientId || !productId) continue;
    const title = String(row?.title || '').trim();
    const prev = out.get(clientId);
    if (!prev || (!prev.title && title)) out.set(clientId, { productId, title });
  }
  return out;
}

// Read one gameplay.db: [{key, displayName, description, icon, earned, time(unix s)}]
function read(target) {
  const rows = queryAll(
    target.gameplayDbPath,
    `SELECT key, name, description, unlock_time, image_url_unlocked, image_url_locked
     FROM achievement ORDER BY id ASC`
  );
  return rows
    .map((row) => {
      const key = String(row?.key || '').trim();
      if (!key) return null;
      const epochMs = Date.parse(String(row?.unlock_time || '').trim());
      const time = Number.isFinite(epochMs) && epochMs > 0 ? Math.floor(epochMs / 1000) : 0;
      return {
        key,
        displayName: String(row?.name || '').trim(),
        description: String(row?.description || '').trim(),
        icon: String(row?.image_url_unlocked || row?.image_url_locked || '').trim() || undefined,
        earned: time > 0,
        time,
      };
    })
    .filter(Boolean);
}

function discover() {
  const products = readProductsByClientId();
  const targets = [];
  let clientDirs = [];
  try {
    clientDirs = fs.readdirSync(APPLICATIONS_ROOT, { withFileTypes: true });
  } catch {
    return targets;
  }
  for (const clientDir of clientDirs) {
    if (!clientDir.isDirectory()) continue;
    const clientId = normalizeId(clientDir.name);
    const product = clientId ? products.get(clientId) : null;
    if (!product) continue;
    const gameplayRoot = path.join(APPLICATIONS_ROOT, clientId, 'Gameplay');
    let userDirs = [];
    try {
      userDirs = fs.readdirSync(gameplayRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const userDir of userDirs) {
      if (!userDir.isDirectory()) continue;
      const gameplayDir = path.join(gameplayRoot, userDir.name);
      const gameplayDbPath = path.join(gameplayDir, 'gameplay.db');
      if (!fs.existsSync(gameplayDbPath)) continue;
      targets.push({
        appid: product.productId,
        name: product.title || `GOG ${product.productId}`,
        gameplayDir,
        gameplayDbPath,
      });
    }
  }
  return targets;
}

function cacheFile(appid) {
  return path.join(cacheDir, `gog-${String(appid).replace(/[^\w.-]/g, '_')}.json`);
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
    debug.warn(`[gog] cache save failed for ${appid}: ${err}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// SQLite writes land in bursts (main db + -wal); read with a settle delay and retry SQLITE_BUSY.
async function readSettled(target) {
  await sleep(750);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return read(target);
    } catch (err) {
      if (attempt === 2) throw err;
      await sleep(500);
    }
  }
  return null;
}

async function handleChange(target, ctx) {
  try {
    const list = await readSettled(target);
    if (!list || list.length === 0) return;

    const achievedNow = list.filter((a) => a.earned);
    const cache = cacheLoad(target.appid);
    const isFirstObservation = !cache || !Array.isArray(cache.unlocked);

    // First observation of a game: baseline silently so a pre-existing library of unlocks doesn't
    // toast-storm on startup. Only real new unlocks notify afterwards.
    if (!isFirstObservation) {
      const prev = new Set(cache.unlocked);
      let delay = 0;
      for (const a of achievedNow) {
        if (prev.has(a.key)) continue;
        debug.log(`[gog] Unlocked: ${target.name} - ${a.displayName}`);
        await ctx.notify(
          {
            source: 'GOG Galaxy',
            appid: target.appid,
            gameDisplayName: target.name,
            achievementName: a.key,
            achievementDisplayName: a.displayName,
            achievementDescription: a.description,
            icon: a.icon,
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
              attribution: 'Achievement',
            },
            prefetch: true, // icons are GOG CDN URLs
            rumble: ctx.options.notification.rumble,
          }
        );
        delay += 1;
      }
    }

    cacheSave(target.appid, achievedNow.map((a) => a.key));
  } catch (err) {
    debug.warn(`[gog] handleChange failed for ${target.appid}: ${err}`);
  }
}

// Tear down any existing watchers and (re)start from the current options. Safe to call on every
// settings reload. Gated by the GOG-official source flag + the master notify switch.
module.exports.start = async (ctx) => {
  module.exports.stop();

  if (!ctx || !ctx.options) return;
  if (ctx.options.achievement_source && ctx.options.achievement_source.gogOfficial === false) return;
  if (ctx.options.notification && ctx.options.notification.notify === false) return;
  if (typeof ctx.notify !== 'function') return;
  if (!DatabaseSync) {
    debug.warn('[gog] node:sqlite unavailable — GOG official live toasts disabled');
    return;
  }

  let targets;
  try {
    targets = discover();
  } catch (err) {
    debug.warn(`[gog] discovery failed: ${err}`);
    return;
  }
  if (targets.length === 0) return;

  for (const target of targets) {
    // Seed the baseline up front so we never replay a back-catalogue of unlocks on launch.
    if (!cacheLoad(target.appid)) {
      try {
        const list = read(target);
        cacheSave(target.appid, list.filter((a) => a.earned).map((a) => a.key));
      } catch (err) {
        debug.warn(`[gog] baseline read failed for ${target.appid}: ${err}`);
      }
    }
    try {
      // WAL mode: an unlock may only touch gameplay.db-wal, so watch every gameplay.db* sibling.
      const w = watch(target.gameplayDir, { recursive: false, filter: /gameplay\.db/i }, (evt) => {
        if (evt !== 'update') return;
        handleChange(target, ctx);
      });
      watchers.push(w);
      debug.log(`[gog] watching achievements for ${target.name} (${target.appid})`);
    } catch (err) {
      debug.warn(`[gog] failed to watch ${target.gameplayDir}: ${err}`);
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
module.exports._internal = { read, discover, readProductsByClientId };
