'use strict';

// Epic Games OFFICIAL achievement source. Unlike parser/epic.js (NemirtingasEpicEmu saves mapped
// onto Steam appids), this reads the real Epic ecosystem:
//   - installed games from the launcher's local manifests
//     (%ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item),
//   - each game's native achievement schema (names/descriptions/icons/rarity, localized) from Epic's
//     PUBLIC GraphQL endpoint keyed by sandbox id — no login required,
//   - the player's unlock state from the authenticated GraphQL playerProfile query WHEN the user has
//     connected their Epic account (see util/epicAuth.js); without a token every achievement simply
//     shows locked, exactly like a legit Ubisoft game.
//
// So Epic-exclusive games (no Steam equivalent) get their real achievement set with rarity, offline
// for the schema and public rarity, and live unlock state once connected.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/epic-api.js + epic-official.js +
// epic-local-installations.js — MIT-licensed; see THIRD_PARTY_NOTICES.md. Trimmed to the read paths AW needs and
// moved off axios onto the runtime's global fetch (no new dependency).

const fs = require('fs');
const path = require('path');

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

const EPIC_GRAPHQL_URL = 'https://launcher.store.epicgames.com/graphql';
const EPIC_PUBLIC_ACHIEVEMENTS_BASE = 'https://api.epicgames.dev/epic/achievements/v1/public/achievements';
const EPIC_MANIFESTS_DIR = path.join(process.env['ProgramData'] || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
const SCHEMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// steam-api language names → Epic locale codes (Epic serves "fr", "en", "pt-BR" …)
const EPIC_LOCALE_MAP = {
  english: 'en', french: 'fr', german: 'de', italian: 'it', spanish: 'es', latam: 'es-419',
  portuguese: 'pt-PT', brazilian: 'pt-BR', russian: 'ru', polish: 'pl', japanese: 'ja',
  koreana: 'ko', schinese: 'zh-Hans', tchinese: 'zh-Hant', dutch: 'nl', danish: 'da',
  finnish: 'fi', swedish: 'sv', norwegian: 'no', czech: 'cs', hungarian: 'hu', romanian: 'ro',
  turkish: 'tr', ukrainian: 'uk', greek: 'el', thai: 'th', vietnamese: 'vi', arabic: 'ar',
};

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

// ---- local install discovery (from epic-local-installations.js) ---------------------------------

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// [{title, namespace, catalogItemId, appName, installLocation, executablePath, processName}]
function buildEpicLocalInstallIndex(manifestsDir = EPIC_MANIFESTS_DIR) {
  const entries = [];
  let files = [];
  try {
    if (!fs.existsSync(manifestsDir)) return entries;
    files = fs.readdirSync(manifestsDir);
  } catch {
    return entries;
  }
  for (const file of files) {
    if (!String(file || '').toLowerCase().endsWith('.item')) continue;
    const item = readJsonFile(path.join(manifestsDir, file));
    if (!item || typeof item !== 'object') continue;
    const installLocation = firstNonEmpty(item.InstallLocation, item.installLocation);
    const launchExecutable = firstNonEmpty(item.LaunchExecutable, item.launchExecutable);
    entries.push({
      title: firstNonEmpty(item.DisplayName, item.displayName),
      namespace: firstNonEmpty(item.CatalogNamespace, item.catalogNamespace),
      catalogItemId: firstNonEmpty(item.CatalogItemId, item.catalogItemId),
      appName: firstNonEmpty(item.AppName, item.appName),
      installLocation,
      executablePath: installLocation && launchExecutable ? path.join(installLocation, launchExecutable) : '',
      processName: launchExecutable ? path.basename(launchExecutable) : '',
    });
  }
  return entries;
}

// ---- Epic API (from epic-api.js, fetch-based) ---------------------------------------------------

async function epicFetchJson(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', 'User-Agent': 'EpicGamesLauncher', ...headers },
      body,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// Public, unauthenticated: full localized achievement schema (name, texts, icons, XP, rarity).
async function fetchEpicAchievementSchemaBySandbox(sandboxId, locale = 'en') {
  const query = `
    query Achievement($SandboxId: String!, $Locale: String!) {
      Achievement {
        productAchievementsRecordBySandbox(sandboxId: $SandboxId, locale: $Locale) {
          productId
          sandboxId
          totalAchievements
          achievements {
            achievement {
              name
              unlockedDisplayName
              unlockedDescription
              unlockedIconLink
              lockedIconLink
              hidden
              rarity { percent }
            }
          }
        }
      }
    }`;
  const { status, data } = await epicFetchJson(EPIC_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { SandboxId: String(sandboxId), Locale: String(locale) } }),
  });
  if (status >= 400) throw `Epic GraphQL ${status}`;
  const record = data?.data?.Achievement?.productAchievementsRecordBySandbox;
  if (!record) return null;
  return {
    productId: String(record.productId || '').trim(),
    sandboxId: String(record.sandboxId || sandboxId).trim(),
    achievements: Array.isArray(record.achievements) ? record.achievements : [],
  };
}

// Public REST fallback keyed by productId (used when we know the product but the sandbox query is empty).
async function fetchEpicPublicProductAchievements(productId, locale = 'en') {
  const url = `${EPIC_PUBLIC_ACHIEVEMENTS_BASE}/product/${encodeURIComponent(productId)}/locale/${encodeURIComponent(locale)}?includeAchievements=true`;
  const { status, data } = await epicFetchJson(url);
  if (status >= 400) throw `Epic public achievements ${status}`;
  return Array.isArray(data?.achievements) ? data.achievements : [];
}

// Authenticated: the player's unlock state for one product.
async function fetchEpicPlayerAchievements(epicAccountId, productId, accessToken, tokenType = 'bearer') {
  const query = `
    query playerProfileAchievementsByProductId($EpicAccountId: String!, $ProductId: String!) {
      PlayerProfile {
        playerProfile(epicAccountId: $EpicAccountId) {
          productAchievements(productId: $ProductId) {
            ... on PlayerProductAchievementsResponseSuccess {
              data {
                playerAchievements {
                  playerAchievement { achievementName unlocked unlockDate }
                }
              }
            }
          }
        }
      }
    }`;
  const { status, data } = await epicFetchJson(EPIC_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `${tokenType} ${accessToken}` },
    body: JSON.stringify({ query, variables: { EpicAccountId: String(epicAccountId), ProductId: String(productId) } }),
  });
  if (status >= 400) throw `Epic player achievements ${status}`;
  const profile = data?.data?.PlayerProfile?.playerProfile;
  const inner = profile?.productAchievements?.data || profile?.productAchievements || {};
  return Array.isArray(inner?.playerAchievements) ? inner.playerAchievements : [];
}

// ---- schema cache ------------------------------------------------------------------------------

function schemaCacheFile(sandboxId, locale) {
  return path.join(cacheRoot || '', 'steam_cache', 'epicOfficial', `${String(sandboxId).replace(/[^\w.-]/g, '_')}_${locale}.json`);
}

function localeFor(lang) {
  return EPIC_LOCALE_MAP[String(lang || '').toLowerCase()] || 'en';
}

// Resolve the localized schema (cached), returning { productId, list: [{name, displayName,
// description, hidden, icon, icongray, rarity}] }.
async function resolveSchema(sandboxId, lang) {
  const locale = localeFor(lang);
  const cacheFile = schemaCacheFile(sandboxId, locale);
  try {
    if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < SCHEMA_CACHE_TTL_MS) {
      return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    }
  } catch {
    /* stale/corrupt -> refetch */
  }

  let record = null;
  try {
    record = await fetchEpicAchievementSchemaBySandbox(sandboxId, locale);
  } catch (err) {
    debug.log(`[epic ${sandboxId}] sandbox schema fetch failed => ${err}`);
  }

  let productId = record?.productId || '';
  let rows = record?.achievements || [];
  if (!rows.length) {
    // fall back to the public product REST endpoint if we already know a productId
    if (productId) {
      try {
        rows = await fetchEpicPublicProductAchievements(productId, locale);
      } catch (err) {
        debug.log(`[epic ${sandboxId}] public product achievements fetch failed => ${err}`);
      }
    }
    if (!rows.length) {
      // serve a stale cache offline rather than nothing
      try {
        if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      } catch {}
      return null;
    }
  }

  const list = rows.map((entry) => {
    const a = entry?.achievement || entry || {};
    return {
      name: String(a.name != null ? a.name : '').trim(),
      displayName: firstNonEmpty(a.unlockedDisplayName, a.lockedDisplayName, a.name),
      description: firstNonEmpty(a.unlockedDescription, a.lockedDescription),
      hidden: a.hidden ? 1 : 0,
      icon: firstNonEmpty(a.unlockedIconLink, a.lockedIconLink),
      icongray: firstNonEmpty(a.lockedIconLink, a.unlockedIconLink),
      rarity: a.rarity && Number.isFinite(Number(a.rarity.percent)) ? Number(a.rarity.percent) : null,
    };
  });

  const result = { productId, list };
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
  } catch {
    /* cache write failure is non-fatal */
  }
  return result;
}

// ---- parser contract ----------------------------------------------------------------------------

// One entry per installed Epic game that carries a sandbox (namespace). appid = namespace (stable,
// used for the sandbox schema query and the rarity sidecar).
module.exports.scan = () => {
  let entries;
  try {
    entries = buildEpicLocalInstallIndex();
  } catch (err) {
    debug.log(`Epic official scan skipped => ${err}`);
    return [];
  }
  const byNamespace = new Map();
  for (const entry of entries) {
    if (!entry.namespace) continue;
    if (byNamespace.has(entry.namespace)) continue;
    byNamespace.set(entry.namespace, {
      appid: entry.namespace,
      source: 'epic-official',
      data: {
        type: 'epicOfficial',
        namespace: entry.namespace,
        catalogItemId: entry.catalogItemId,
        appName: entry.appName,
        title: entry.title,
        gameDir: entry.installLocation && fs.existsSync(entry.installLocation) ? entry.installLocation : null,
        exe: entry.executablePath && fs.existsSync(entry.executablePath) ? entry.executablePath : null,
      },
    });
  }
  return Array.from(byNamespace.values());
};

module.exports.getGameData = async (appid, lang) => {
  const data = appid.data || {};
  const schema = await resolveSchema(data.namespace, lang);
  if (!schema || !schema.list.length) throw `No Epic achievement schema for ${appid.appid}`;

  // seed the shared rarity sidecar from the public schema (keyed on the namespace, source epic)
  try {
    const entries = schema.list
      .filter((a) => a.name && a.rarity != null)
      .map((a) => ({ name: a.name, percent: Number(Math.min(100, Math.max(0, a.rarity)).toFixed(4)) }));
    if (entries.length > 0) require('../util/rarity.js').writeRarityCache(appid.appid, entries, 'epic');
  } catch (err) {
    debug.log(`[${appid.appid}] epic rarity sidecar seed failed => ${err}`);
  }

  // images: reuse the renderer's SteamGridDB-by-title bridge (same path parser/epic.js uses)
  let img = { header: null, background: null, portrait: null, icon: null };
  try {
    const { ipcRenderer } = require('electron');
    const links = ipcRenderer.sendSync('get-images-for-game', { name: data.title }) || {};
    img = { header: links.landscape, background: links.background, portrait: links.portrait, icon: links.icon };
    if (links.background) ipcRenderer.send('stylize-background-for-appid', { background: links.background, appid: appid.appid });
  } catch {
    /* image enrichment is best-effort */
  }

  return {
    name: data.title || `Epic ${appid.appid}`,
    appid: appid.appid,
    img,
    achievement: {
      total: schema.list.length,
      list: schema.list.map((a) => ({
        name: a.name,
        displayName: a.displayName,
        description: a.description,
        hidden: a.hidden,
        icon: a.icon,
        icongray: a.icongray,
      })),
    },
  };
};

// Unlock state map {achievementName: {earned, earned_time(s)}}. Requires a connected Epic account;
// without a token every achievement stays locked (returns {}), which the UI renders as 0%.
module.exports.getAchievements = async (appid) => {
  const data = appid.data || {};
  let epicAuth;
  try {
    epicAuth = require('../util/epicAuth.js');
  } catch {
    return {};
  }
  let token;
  try {
    token = await epicAuth.ensureEpicAccessToken({ userDataDir: cacheRoot });
  } catch {
    return {}; // not connected — everything locked
  }
  const accountId = epicAuth.normalizeEpicAccountId(token?.account_id);
  if (!accountId || !token?.access_token) return {};

  // the player query is keyed by productId; resolve it from the cached schema (sandbox → productId)
  let productId = '';
  try {
    const cached = await resolveSchema(data.namespace, 'english');
    productId = cached?.productId || '';
  } catch {}
  if (!productId) return {};

  let players;
  try {
    players = await fetchEpicPlayerAchievements(accountId, productId, token.access_token, token.token_type || 'bearer');
  } catch (err) {
    debug.log(`[${appid.appid}] epic player achievements fetch failed => ${err}`);
    return {};
  }

  const out = {};
  for (const entry of players) {
    const pa = entry?.playerAchievement || entry || {};
    const name = String(pa.achievementName || '').trim();
    if (!name) continue;
    const unlocked = pa.unlocked === true || Number(pa.progress) >= 100;
    const epochMs = pa.unlockDate ? Date.parse(pa.unlockDate) : 0;
    out[name] = { earned: unlocked, earned_time: unlocked && Number.isFinite(epochMs) && epochMs > 0 ? Math.floor(epochMs / 1000) : 0 };
  }
  return out;
};

// Exposed for unit tests.
module.exports._internal = {
  buildEpicLocalInstallIndex,
  resolveSchema,
  fetchEpicAchievementSchemaBySandbox,
  localeFor,
};
