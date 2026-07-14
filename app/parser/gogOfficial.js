'use strict';

// GOG Galaxy OFFICIAL achievement source. Unlike parser/gog.js (NemirtingasGalaxyEmu saves mapped
// onto Steam appids), this reads the real GOG Galaxy client data, entirely offline:
//   %ProgramData%\GOG.com\Galaxy\storage\galaxy-2.0.db      ← owned/installed products, titles,
//                                                             install dirs, launch tasks (SQLite)
//   %LOCALAPPDATA%\GOG.com\Galaxy\Applications\<clientId>\Gameplay\<userId>\gameplay.db
//                                                           ← per-game achievement schema + unlock
//                                                             state + rarity, localized (SQLite)
// So GOG games get their native achievement set (names/descriptions in the Galaxy language, GOG CDN
// icons, real unlock times) with no Steam mapping and no network — covers/rarity work offline too
// (rarity is baked into gameplay.db and seeded into the shared rarity sidecar cache).
//
// Ported from PSerban93/Achievements (JokerVerse) utils/gog-galaxy-local.js — MIT-licensed; see
// THIRD_PARTY_NOTICES.md. Adapted to Achievement Watcher's parser contract (scan / getGameData / getAchievements
// / initDebug); axios dropped for request-zero; the schema-file writer (ensureGogOfficialSchema) is
// not needed here because the schema is served straight from the DB on every scan. SQLite access
// uses the runtime's built-in node:sqlite (Electron 43 / Node ≥22.5) — no native dependency.

const fs = require('fs');
const path = require('path');
const request = require('request-zero');

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

const DEFAULT_STORAGE_DB_PATH = path.join(process.env['ProgramData'] || 'C:\\ProgramData', 'GOG.com', 'Galaxy', 'storage', 'galaxy-2.0.db');
const DEFAULT_APPLICATIONS_ROOT = path.join(process.env['LOCALAPPDATA'] || '', 'GOG.com', 'Galaxy', 'Applications');
const GAMEPLAY_DB_NAME = 'gameplay.db';
const IMAGES_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ---- SQLite helpers ----------------------------------------------------------------------------

// node:sqlite ships with the runtime but only from Node 22.5; keep the require guarded so merely
// loading this parser can never crash an unexpected runtime — sources just come back empty.
let DatabaseSync = null;
try {
  DatabaseSync = require('node:sqlite').DatabaseSync;
} catch {
  DatabaseSync = null;
}

function openReadOnly(dbPath) {
  if (!DatabaseSync) throw 'GOG official source requires a runtime with node:sqlite';
  if (!dbPath || !fs.existsSync(dbPath)) throw `sqlite file missing: ${dbPath}`;
  return new DatabaseSync(dbPath, { readOnly: true });
}

// Galaxy ids (clientId/userId, gameplay achievement ids) exceed Number.MAX_SAFE_INTEGER, and
// node:sqlite THROWS on such columns unless the statement reads BigInts (verified live).
function prepareAll(db, sql) {
  const stmt = db.prepare(sql);
  if (typeof stmt.setReadBigInts === 'function') stmt.setReadBigInts(true);
  return stmt.all();
}

function safeClose(db) {
  try {
    if (db) db.close();
  } catch {
    /* ignore */
  }
}

// ---- galaxy-2.0.db (product catalog) -----------------------------------------------------------

function normalizeId(value) {
  const raw = String(value ?? '').trim();
  return /^[0-9]+$/.test(raw) ? raw : '';
}

function fileSignature(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

// One-entry memo keyed on db+wal+shm signatures — Galaxy writes in WAL mode, so all three files
// participate in "has anything changed".
let productCache = { key: '', value: null };

function galaxyCacheKey(storageDbPath) {
  return [storageDbPath, fileSignature(storageDbPath), fileSignature(`${storageDbPath}-wal`), fileSignature(`${storageDbPath}-shm`)].join('|');
}

function scoreLaunchCandidate(row) {
  const executablePath = String(row?.executablePath || '').trim();
  if (!executablePath || !/\.exe$/i.test(executablePath)) return -1000;
  let score = 1000;
  if (Number(row?.isPrimary) === 1) score += 250;
  const type = String(row?.taskType || '').toLowerCase();
  if (type === 'builtinprimary') score += 150;
  else if (type === 'builtin') score += 75;
  else if (type === 'custom') score += 25;
  const baseName = path.win32.basename(executablePath.replace(/\//g, '\\')).toLowerCase();
  if (/(updater|update|patch|launcher|setup|install|unins|uninstall)/i.test(baseName)) score -= 500;
  if (/(editor|benchmark|settings|config|crash|reporter|support|server)/i.test(baseName)) score -= 250;
  const order = Number(row?.taskOrder);
  if (Number.isFinite(order)) score -= Math.max(0, Math.min(order, 100));
  return score;
}

function titleScore(row) {
  if (!row) return -1;
  let score = 0;
  if (String(row.languageId) === '16') score += 5; // Galaxy's "default" language row
  if (Number.isFinite(Number(row.stored_at))) score += Number(row.stored_at) / 1e15;
  return score;
}

function readGogGalaxyProducts(options = {}) {
  const storageDbPath = options.storageDbPath ? path.resolve(options.storageDbPath) : DEFAULT_STORAGE_DB_PATH;
  const cacheKey = galaxyCacheKey(storageDbPath);
  if (productCache.key === cacheKey && productCache.value) return productCache.value;

  const db = openReadOnly(storageDbPath);
  try {
    const authRows = prepareAll(
      db,
      `SELECT pa.productId AS productId, pa.clientId AS clientId,
              ibp.installationPath AS installationPath,
              ptrk.releaseKey AS releaseKey
       FROM ProductAuthorizations pa
       LEFT JOIN InstalledBaseProducts ibp ON ibp.productId = pa.productId
       LEFT JOIN ProductsToReleaseKeys ptrk ON ptrk.gogId = pa.productId`
    );

    const titleRows = prepareAll(
      db,
      `SELECT productId, title, languageId, stored_at FROM LimitedDetails
       WHERE title IS NOT NULL AND TRIM(title) <> ''`
    );
    const titleByProductId = new Map();
    for (const row of titleRows) {
      const productId = normalizeId(row?.productId);
      const title = String(row?.title || '').trim();
      if (!productId || !title) continue;
      const prev = titleByProductId.get(productId);
      if (!prev || titleScore(row) > titleScore(prev)) titleByProductId.set(productId, row);
    }

    const launchRows = prepareAll(
      db,
      `SELECT ptrk.gogId AS productId, pt.isPrimary AS isPrimary, pt."order" AS taskOrder,
              ptt.type AS taskType, ptlp.executablePath AS executablePath
       FROM ProductsToReleaseKeys ptrk
       INNER JOIN PlayTasks pt ON pt.gameReleaseKey = ptrk.releaseKey
       LEFT JOIN PlayTaskTypes ptt ON ptt.id = pt.typeId
       INNER JOIN PlayTaskLaunchParameters ptlp ON ptlp.playTaskId = pt.id
       WHERE ptlp.executablePath IS NOT NULL AND TRIM(ptlp.executablePath) <> ''`
    );
    const launchByProductId = new Map();
    for (const row of launchRows) {
      const productId = normalizeId(row?.productId);
      if (!productId) continue;
      const score = scoreLaunchCandidate(row);
      if (score <= 0) continue;
      const prev = launchByProductId.get(productId);
      if (!prev || score > prev.score) launchByProductId.set(productId, { row, score });
    }

    const byClientId = new Map();
    const rows = [];
    for (const row of authRows) {
      const productId = normalizeId(row?.productId);
      const clientId = normalizeId(row?.clientId);
      if (!productId || !clientId) continue;
      const launch = launchByProductId.get(productId);
      const entry = {
        productId,
        clientId,
        title: String(titleByProductId.get(productId)?.title || '').trim(),
        installationPath: String(row?.installationPath || '').trim(),
        releaseKey: String(row?.releaseKey || '').trim(),
        executablePath: String(launch?.row?.executablePath || '').trim(),
      };
      rows.push(entry);
      byClientId.set(clientId, entry);
    }

    const result = { rows, byClientId };
    productCache = { key: cacheKey, value: result };
    return result;
  } finally {
    safeClose(db);
  }
}

// ---- gameplay.db (per-game achievements) -------------------------------------------------------

function parseUnlockTimeSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const epochMs = Date.parse(raw);
  return Number.isFinite(epochMs) && epochMs > 0 ? Math.floor(epochMs / 1000) : 0;
}

function readGogGameplayDb(gameplayDbPath) {
  const db = openReadOnly(gameplayDbPath);
  try {
    const databaseInfo = {};
    for (const row of prepareAll(db, `SELECT key, value FROM database_info`)) {
      const key = String(row?.key || '').trim();
      if (key) databaseInfo[key] = row?.value != null ? String(row.value) : '';
    }
    const achievements = prepareAll(
      db,
      `SELECT id, key, name, description, visible_while_locked, unlock_time,
              image_url_locked, image_url_unlocked, rarity, rarity_level_slug
       FROM achievement ORDER BY id ASC`
    );
    return { databaseInfo, achievements };
  } finally {
    safeClose(db);
  }
}

function isGameplayReady(gameplay) {
  if (!Array.isArray(gameplay?.achievements) || gameplay.achievements.length === 0) return false;
  return String(gameplay?.databaseInfo?.achievements_retrieved ?? '').trim() !== '0';
}

function listGameplayEntries(options = {}) {
  const applicationsRoot = options.applicationsRoot ? path.resolve(options.applicationsRoot) : DEFAULT_APPLICATIONS_ROOT;
  if (!applicationsRoot || !fs.existsSync(applicationsRoot)) return [];
  const products = readGogGalaxyProducts(options);
  const out = [];

  let clientDirs = [];
  try {
    clientDirs = fs.readdirSync(applicationsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const clientDir of clientDirs) {
    if (!clientDir.isDirectory()) continue;
    const clientId = normalizeId(clientDir.name);
    if (!clientId) continue;
    const product = products.byClientId.get(clientId);
    if (!product?.productId) continue;
    const gameplayRoot = path.join(applicationsRoot, clientId, 'Gameplay');
    let userDirs = [];
    try {
      userDirs = fs.readdirSync(gameplayRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const userDir of userDirs) {
      if (!userDir.isDirectory()) continue;
      const userId = normalizeId(userDir.name);
      if (!userId) continue;
      const gameplayDir = path.join(gameplayRoot, userId);
      const gameplayDbPath = path.join(gameplayDir, GAMEPLAY_DB_NAME);
      if (!fs.existsSync(gameplayDbPath)) continue;
      out.push({
        productId: product.productId,
        clientId,
        userId,
        title: product.title || '',
        installationPath: product.installationPath || '',
        executablePath: product.executablePath || '',
        gameplayDir,
        gameplayDbPath,
      });
    }
  }
  return out;
}

// ---- images (GOG public API, disk-cached) ------------------------------------------------------

function absoluteUrl(u) {
  const raw = String(u || '').trim();
  if (!raw) return null;
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw;
}

async function resolveGogImages(productId) {
  const cacheFile = path.join(cacheRoot || '', 'steam_cache', 'gogOfficial', `${productId}.json`);
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < IMAGES_CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch {
    /* stale/corrupt cache -> refetch */
  }

  const img = { header: null, background: null, portrait: null, icon: null };
  try {
    const v2 = await request.getJson(`https://api.gog.com/v2/games/${productId}`, { timeout: 15000 });
    const links = v2?._links || {};
    img.portrait = absoluteUrl(links.boxArtImage?.href);
    img.background = absoluteUrl(links.backgroundImage?.href);
    img.header = absoluteUrl(links.logo?.href);
  } catch (err) {
    debug.log(`[${productId}] GOG v2 games lookup failed => ${err.code || err}`);
  }
  try {
    const v1 = await request.getJson(`https://api.gog.com/products/${productId}?expand=images`, { timeout: 15000 });
    const images = v1?.images || {};
    img.header = img.header || absoluteUrl(images.logo2x || images.logo);
    img.background = img.background || absoluteUrl(images.background);
    img.icon = absoluteUrl(images.sidebarIcon2x || images.sidebarIcon);
  } catch (err) {
    debug.log(`[${productId}] GOG products lookup failed => ${err.code || err}`);
  }

  if (Object.values(img).some(Boolean)) {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(img, null, 2));
    } catch {
      /* cache write failure is non-fatal */
    }
  } else if (fs.existsSync(cacheFile)) {
    // offline: serve the stale cache rather than nothing
    try {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    } catch {
      /* fall through */
    }
  }
  return img;
}

// ---- parser contract ----------------------------------------------------------------------------

// One entry per installed-and-played GOG game. When several Galaxy users have gameplay data for the
// same product, the most recently written gameplay.db wins (one tile per game).
module.exports.scan = () => {
  let entries;
  try {
    entries = listGameplayEntries();
  } catch (err) {
    debug.log(`GOG official scan skipped => ${err}`);
    return [];
  }

  const byProduct = new Map();
  for (const entry of entries) {
    let gameplay;
    try {
      gameplay = readGogGameplayDb(entry.gameplayDbPath);
    } catch (err) {
      debug.log(`[${entry.productId}] unreadable gameplay.db (${entry.gameplayDbPath}) => ${err}`);
      continue;
    }
    if (!isGameplayReady(gameplay)) continue;
    const mtimeOf = (p) => {
      try {
        return fs.statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    const prev = byProduct.get(entry.productId);
    if (prev && mtimeOf(prev.data.gameplayDbPath) >= mtimeOf(entry.gameplayDbPath)) continue;
    byProduct.set(entry.productId, {
      appid: entry.productId,
      source: 'GOG Galaxy',
      data: {
        type: 'gogOfficial',
        path: entry.gameplayDir,
        gameplayDbPath: entry.gameplayDbPath,
        clientId: entry.clientId,
        userId: entry.userId,
        title: entry.title,
        // feeds the shared playtime auto-seed / installed-on-disk machinery in achievements.js
        gameDir: entry.installationPath && fs.existsSync(entry.installationPath) ? entry.installationPath : null,
      },
    });
  }
  return Array.from(byProduct.values());
};

module.exports.getGameData = async (appid) => {
  const data = appid.data || {};
  const gameplay = readGogGameplayDb(data.gameplayDbPath);
  if (!isGameplayReady(gameplay)) throw `No GOG achievement data yet for ${appid.appid}`;

  // Galaxy flags most achievements "not visible while locked" even when its own UI shows them all
  // (database_info.achievements_mode = all_visible) — honor the mode, not just the per-row flag,
  // or entire games would render as spoiler-masked "…" rows.
  const allVisible = String(gameplay.databaseInfo.achievements_mode || '').trim() === 'all_visible';

  const list = gameplay.achievements.map((row, index) => {
    const key = String(row?.key || '').trim() || `gog_${index}`;
    const icon = String(row?.image_url_unlocked || '').trim();
    const icongray = String(row?.image_url_locked || '').trim();
    return {
      name: key,
      hidden: allVisible || Number(row?.visible_while_locked) ? 0 : 1,
      displayName: String(row?.name || '').trim(),
      description: String(row?.description || '').trim(),
      icon: icon || icongray,
      icongray: icongray || icon,
    };
  });

  // Rarity is baked into gameplay.db — seed the shared sidecar cache so the detail view paints
  // tiers instantly and fully offline (the online GOG rarity endpoint needs an access token).
  try {
    const entries = gameplay.achievements
      .map((row) => {
        const name = String(row?.key || '').trim();
        const percent = Number(row?.rarity);
        if (!name || !Number.isFinite(percent)) return null;
        return { name, percent: Number(Math.min(100, Math.max(0, percent)).toFixed(4)) };
      })
      .filter(Boolean);
    if (entries.length > 0) require('../util/rarity.js').writeRarityCache(appid.appid, entries, 'gog');
  } catch (err) {
    debug.log(`[${appid.appid}] rarity sidecar seed failed => ${err}`);
  }

  const img = await resolveGogImages(appid.appid);

  return {
    name: data.title || `GOG ${appid.appid}`,
    appid: appid.appid,
    img: {
      header: img.header,
      background: img.background,
      portrait: img.portrait,
      icon: img.icon,
    },
    achievement: {
      total: list.length,
      list,
    },
  };
};

// Unlock state map consumed by the shared merge in achievements.js: {key: {earned, earned_time(s)}}.
module.exports.getAchievements = (appid) => {
  const gameplay = readGogGameplayDb(appid.data.gameplayDbPath);
  const out = {};
  for (const row of gameplay.achievements || []) {
    const key = String(row?.key || '').trim();
    if (!key) continue;
    const earnedTime = parseUnlockTimeSeconds(row?.unlock_time);
    out[key] = { earned: earnedTime > 0, earned_time: earnedTime };
  }
  return out;
};

// Exposed for unit tests and for the watchdog live watcher.
module.exports._internal = {
  readGogGalaxyProducts,
  listGameplayEntries,
  readGogGameplayDb,
  isGameplayReady,
  parseUnlockTimeSeconds,
};
