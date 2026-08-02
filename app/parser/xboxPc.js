'use strict';

/*
  Xbox PC support (ported from PSerban93/Achievements utils/xbox-pc.js).

  Flow:
  1. The user connects a Microsoft / Xbox Network account (Settings > Sources). The OAuth code is
     exchanged for an Xbox Live session (XSTS token) and stored encrypted in cfg/xbox-auth.json.
  2. "Import Xbox PC library" lists local Xbox PC installs (XboxGames folders, .GamingRoot markers,
     Appx packages) plus the account's title history, fetches each PC title's achievements from the
     Xbox Live API and caches them under steam_cache/xbox/<titleId>/ (schema.json + state.json).
  3. The normal library scan reads those caches like any other local source.

  Live polling of running titles (watchdog notifications) is intentionally not part of this first
  port; a library refresh/import re-syncs unlock state.
*/

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const XBOX_PC_PLATFORM = 'xbox-pc';
const XBOX_PC_SOURCE = 'Xbox PC';
const XBOX_PC_CLIENT_ID =
  String(process.env.XBOX_PC_CLIENT_ID || '').trim() || '388ea51c-0b25-4029-aae2-17df49d23905';
const XBOX_PC_OAUTH_SCOPE = 'Xboxlive.signin Xboxlive.offline_access';
const XBOX_PC_REDIRECT_URI = 'http://localhost:8080/auth/callback';
const XBOX_PC_RELYING_PARTY = 'http://xboxlive.com';
const XBOX_ACHIEVEMENTS_URL = 'https://achievements.xboxlive.com';
const XBOX_TITLEHUB_URL = 'https://titlehub.xboxlive.com';
const XBOX_ACHIEVEMENTS_CONTRACT_VERSION = '4';

const XBOX_SCHEMA_LANGUAGE_LOCALES = Object.freeze({
  arabic: 'ar-SA',
  schinese: 'zh-CN',
  tchinese: 'zh-TW',
  czech: 'cs-CZ',
  danish: 'da-DK',
  dutch: 'nl-NL',
  english: 'en-US',
  finnish: 'fi-FI',
  french: 'fr-FR',
  german: 'de-DE',
  greek: 'el-GR',
  hungarian: 'hu-HU',
  indonesian: 'id-ID',
  italian: 'it-IT',
  japanese: 'ja-JP',
  koreana: 'ko-KR',
  norwegian: 'nb-NO',
  polish: 'pl-PL',
  portuguese: 'pt-PT',
  brazilian: 'pt-BR',
  romanian: 'ro-RO',
  russian: 'ru-RU',
  spanish: 'es-ES',
  latam: 'es-MX',
  swedish: 'sv-SE',
  thai: 'th-TH',
  turkish: 'tr-TR',
  ukrainian: 'uk-UA',
  vietnamese: 'vi-VN',
});

let userDataPath = null;
function setUserDataPath(p) {
  userDataPath = p;
}

function getUserDataPath() {
  if (userDataPath) return userDataPath;
  try {
    const { app } = require('@electron/remote');
    return app.getPath('userData');
  } catch {
    return process.env['APPDATA'] ? path.join(process.env['APPDATA'], 'Achievement Watcher') : '';
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeTitleId(value) {
  const raw = String(value ?? '').trim();
  if (/^0x[0-9a-f]{1,16}$/i.test(raw)) {
    try {
      return BigInt(raw).toString(10);
    } catch {
      return '';
    }
  }
  return /^\d{1,20}$/.test(raw) ? raw : '';
}

function normalizeXuid(value) {
  const raw = String(value ?? '').trim();
  return /^\d{8,20}$/.test(raw) ? raw : '';
}

function normalizeXboxClientId(value) {
  const raw = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw) ? raw : '';
}

function sanitizeSegment(value, fallback = 'xbox-pc') {
  const result = String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
  return result || fallback;
}

function authFile() {
  return path.join(getUserDataPath(), 'cfg', 'xbox-auth.json');
}

function cacheDir(titleId) {
  return path.join(getUserDataPath(), 'steam_cache', 'xbox', sanitizeSegment(titleId));
}

function schemaCacheFile(titleId) {
  return path.join(cacheDir(titleId), 'schema.json');
}

function stateCacheFile(titleId) {
  return path.join(cacheDir(titleId), 'state.json');
}

// ---- Auth (Microsoft OAuth -> Xbox Live XSTS session) ----

function buildXboxDirectAuthorizeUrl(clientId, state = '') {
  const normalized = normalizeXboxClientId(clientId || XBOX_PC_CLIENT_ID);
  if (!normalized) throw new Error('xbox-pc-client-id-invalid');
  const { live } = require('@xboxreplay/xboxlive-auth');
  const url = new URL(live.getAuthorizeUrl(normalized, XBOX_PC_OAUTH_SCOPE, 'code', XBOX_PC_REDIRECT_URI));
  if (state) url.searchParams.set('state', String(state));
  return url.toString();
}

function extractXboxDirectAuthResult(rawUrl, expectedState = '') {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return null;
  }
  const expectedRedirect = new URL(XBOX_PC_REDIRECT_URI);
  if (url.origin !== expectedRedirect.origin || url.pathname.toLowerCase() !== expectedRedirect.pathname.toLowerCase()) {
    return null;
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const getParameter = (name) => fragment.get(name) || url.searchParams.get(name) || '';
  const state = getParameter('state');
  if (expectedState && state !== expectedState) return { error: 'xbox-pc-oauth-state-mismatch' };
  const error = getParameter('error');
  if (error) return { error: getParameter('error_description') || error || 'xbox-pc-oauth-failed' };
  const code = getParameter('code');
  return code ? { code } : null;
}

function xboxAuthExpiry(expiresIn) {
  return Date.now() + Math.max(0, Number(expiresIn) || 0) * 1000;
}

async function exchangeLiveTokenForXboxSession(liveTokens, clientId) {
  const { xnet } = require('@xboxreplay/xboxlive-auth');
  const accessToken = String(liveTokens?.access_token || '').trim();
  const refreshToken = String(liveTokens?.refresh_token || '').trim();
  if (!accessToken || !refreshToken) throw new Error('xbox-pc-oauth-token-invalid');

  let userToken = null;
  let userTokenError = null;
  for (const preamble of ['d', 't']) {
    try {
      userToken = await xnet.exchangeRpsTicketForUserToken(accessToken, preamble);
      break;
    } catch (error) {
      userTokenError = error;
    }
  }
  if (!userToken?.Token) throw userTokenError || new Error('xbox-pc-user-token-invalid');

  const xsts = await xnet.exchangeTokenForXSTSToken(userToken.Token, {
    XSTSRelyingParty: XBOX_PC_RELYING_PARTY,
    sandboxId: 'RETAIL',
  });
  const claims = xsts?.DisplayClaims?.xui?.[0] || {};
  const session = {
    clientId,
    refreshToken,
    accessToken,
    accessExpiresAt: xboxAuthExpiry(liveTokens.expires_in),
    xstsToken: xsts?.Token,
    xstsExpiresAt: Date.parse(xsts?.NotAfter) || 0,
    xuid: claims.xid,
    uhs: claims.uhs,
    gamertag: claims.gtg,
  };
  if (!session.xstsToken || !session.xuid || !session.uhs) throw new Error('xbox-pc-xsts-claims-invalid');
  return session;
}

async function completeXboxDirectAuthentication(authResult) {
  const clientId = normalizeXboxClientId(XBOX_PC_CLIENT_ID);
  if (!clientId) throw new Error('xbox-pc-client-id-invalid');
  const { live } = require('@xboxreplay/xboxlive-auth');
  let liveTokens = authResult?.tokens || null;
  if (!liveTokens && authResult?.code) {
    liveTokens = await live.exchangeCodeForAccessToken(String(authResult.code), clientId, XBOX_PC_OAUTH_SCOPE, XBOX_PC_REDIRECT_URI);
  }
  if (!liveTokens) throw new Error('xbox-pc-oauth-result-invalid');
  const auth = await exchangeLiveTokenForXboxSession(liveTokens, clientId);
  saveAuth(auth);
  return auth;
}

function saveAuth(auth) {
  if (!auth || !auth.xuid) return;
  try {
    fs.mkdirSync(path.dirname(authFile()), { recursive: true });
    const payload = JSON.stringify(auth);
    fs.writeFileSync(authFile(), require(path.join(__dirname, '..', 'util', 'aes.js')).encrypt(payload), 'utf8');
  } catch {}
}

function loadAuth() {
  try {
    const raw = fs.readFileSync(authFile(), 'utf8');
    const payload = raw.includes(':') ? require(path.join(__dirname, '..', 'util', 'aes.js')).decrypt(raw) : raw;
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function clearAuth() {
  try {
    fs.unlinkSync(authFile());
  } catch {}
}

async function ensureXboxDirectSession(options = {}) {
  let auth = options.auth || loadAuth();
  if (!auth) throw new Error('xbox-pc-microsoft-login-required');
  const { live } = require('@xboxreplay/xboxlive-auth');
  const minimumValidityMs = Math.max(60000, Number(options.minimumValidityMs) || 300000);
  if (auth.xstsToken && auth.xuid && auth.uhs && auth.xstsExpiresAt > Date.now() + minimumValidityMs) {
    return auth;
  }
  let refreshed;
  try {
    refreshed = await live.refreshAccessToken(auth.refreshToken, auth.clientId, XBOX_PC_OAUTH_SCOPE);
  } catch (error) {
    clearAuth();
    throw error;
  }
  if (!refreshed.refresh_token) refreshed.refresh_token = auth.refreshToken;
  auth = await exchangeLiveTokenForXboxSession(refreshed, auth.clientId);
  saveAuth(auth);
  return auth;
}

function buildXboxAuthorizationHeader(auth) {
  const uhs = String(auth.uhs || '').trim();
  const token = String(auth.xstsToken || '').trim();
  if (!uhs || !token) throw new Error('xbox-pc-xsts-required');
  return `XBL3.0 x=${uhs};${token}`;
}

async function xboxServiceGet(baseUrl, endpoint, options = {}) {
  const auth = options.auth || (await ensureXboxDirectSession(options));
  const url = `${baseUrl}/${String(endpoint || '').replace(/^\/+/, '')}`;
  const contractVersion = /^\d+$/.test(String(options.contractVersion || '2')) ? String(options.contractVersion) : '2';
  const res = await fetch(url, {
    signal: AbortSignal.timeout(Math.max(3000, Number(options.timeoutMs) || 15000)),
    headers: {
      Authorization: buildXboxAuthorizationHeader(auth),
      'x-xbl-contract-version': contractVersion,
      Accept: 'application/json',
      'Accept-Language': options.locale || 'en-US,en',
    },
  });
  if (!res.ok) {
    const error = new Error(`xbox-network-http-${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function extractArray(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload)) return payload;
  return [];
}

async function xboxServiceGetAll(baseUrl, endpoint, keys, options = {}) {
  const rows = [];
  const seenTokens = new Set();
  let continuationToken = '';
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(endpoint, `${baseUrl}/`);
    if (continuationToken) url.searchParams.set('continuationToken', continuationToken);
    const payload = await xboxServiceGet(baseUrl, `${url.pathname.replace(/^\/+/, '')}${url.search}`, options);
    rows.push(...extractArray(payload, keys));
    continuationToken = String(payload?.pagingInfo?.continuationToken || '').trim();
    if (!continuationToken || seenTokens.has(continuationToken)) break;
    seenTokens.add(continuationToken);
  }
  return rows;
}

async function fetchXboxTitleHistory(options = {}) {
  const auth = options.auth || (await ensureXboxDirectSession(options));
  try {
    return await xboxServiceGetAll(
      XBOX_TITLEHUB_URL,
      `users/xuid(${auth.xuid})/titles/titleHistory/decoration/GamePass,TitleHistory,Achievement,Stats,Image?maxItems=1000`,
      ['titles', 'titleHistory', 'items'],
      { ...options, auth }
    );
  } catch {
    return xboxServiceGetAll(
      XBOX_ACHIEVEMENTS_URL,
      `users/xuid(${auth.xuid})/history/titles?maxItems=1000`,
      ['titles', 'titleHistory', 'items'],
      { ...options, auth }
    );
  }
}

async function fetchXboxTitleAchievements(xuid, titleId, options = {}) {
  const safeXuid = normalizeXuid(xuid);
  const safeTitleId = normalizeTitleId(titleId);
  if (!safeXuid) throw new Error('xbox-xuid-required');
  if (!safeTitleId) throw new Error('xbox-title-id-required');
  const auth = options.auth || (await ensureXboxDirectSession(options));
  const unlockedFilter = options.unlockedOnly ? '&unlockedOnly=true' : '';
  return xboxServiceGetAll(
    XBOX_ACHIEVEMENTS_URL,
    `users/xuid(${safeXuid})/achievements?titleId=${encodeURIComponent(safeTitleId)}&maxItems=1000${unlockedFilter}`,
    ['achievements', 'items'],
    { ...options, auth, contractVersion: XBOX_ACHIEVEMENTS_CONTRACT_VERSION }
  );
}

function normalizeXboxAchievement(raw = {}) {
  const id = firstNonEmpty(raw?.id, raw?.name, raw?.scid);
  if (!id) return null;
  const progressState = raw?.progressState || raw?.progression?.state || '';
  const earned = /achieved/i.test(String(progressState));
  const earnedTime = Number(raw?.progression?.timeUnlocked || raw?.unlockTime || raw?.timeUnlocked || 0);
  const progressCurrent = Number(raw?.progression?.current || raw?.progress || 0);
  const progressMax = Number(raw?.progression?.target || raw?.maxProgress || 0);
  const rarity = Number(raw?.rarity?.currentPercentage ?? raw?.rarityPercentage ?? raw?.rarity?.percentage);
  const media = raw?.mediaAssets || raw?.media || [];
  const icon = firstNonEmpty(
    raw?.icon,
    media.find((m) => /icon/i.test(String(m?.mediaType || m?.type || '')))?.url,
    media[0]?.url
  );
  return {
    id: String(id),
    displayName: firstNonEmpty(raw?.name, raw?.displayName, id),
    description: firstNonEmpty(raw?.description, raw?.blurb, ''),
    hidden: /secret/i.test(String(raw?.isSecret || raw?.hidden || '')),
    icon,
    gamerscore: Number(raw?.rewards?.[0]?.value ?? raw?.gamerscore) || 0,
    rarity: Number.isFinite(rarity) ? Math.min(100, Math.max(0, rarity)) : null,
    snapshot: {
      earned,
      earned_time: earnedTime > 0 ? earnedTime : undefined,
      progress: Number.isFinite(progressCurrent) ? progressCurrent : undefined,
      max_progress: Number.isFinite(progressMax) ? progressMax : undefined,
    },
  };
}

// ---- Local install discovery ----

function parseMicrosoftGameConfig(configPath) {
  const xml = fs.readFileSync(configPath, 'utf8');
  const pick = (names) => {
    for (const name of names) {
      const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(xml);
      if (m) return m[1].trim();
    }
    return '';
  };
  const titleIdAttr = /titleid\s*=\s*"((?:0x)?[0-9A-Fa-f]{1,16})"/i.exec(xml)?.[1] || '';
  const titleIdTag = /<titleid[^>]*>((?:0x)?[0-9A-Fa-f]{1,16})<\/titleid>/i.exec(xml)?.[1] || '';
  const titleIdHex = titleIdAttr || titleIdTag;
  const packageFamilyName = pick(['PackageFamilyName', 'packageFamilyName']);
  const applicationId = pick(['AppId', 'appId']);
  return {
    titleId: titleIdHex ? normalizeTitleId(titleIdHex) : '',
    title: firstNonEmpty(pick(['name', 'Name']), path.basename(path.dirname(configPath))),
    installLocation: path.dirname(configPath),
    executable: pick(['executable', 'Executable']),
    packageFamilyName,
    applicationId,
    aumid: packageFamilyName && applicationId ? `${packageFamilyName}!${applicationId}` : '',
    processName: pick(['executable', 'Executable']) ? path.basename(pick(['executable', 'Executable'])) : '',
  };
}

function parseGamingRootMarker(markerPath) {
  try {
    const bytes = fs.readFileSync(markerPath);
    if (bytes.length <= 8 || bytes.subarray(0, 4).toString('ascii') !== 'RGBX') return '';
    const relativePath = bytes.subarray(8).toString('utf16le').replace(/\0+$/g, '').trim();
    if (!relativePath) return '';
    const driveRoot = path.parse(path.resolve(markerPath)).root;
    const resolved = path.resolve(driveRoot, relativePath);
    if (!driveRoot || path.parse(resolved).root.toLowerCase() !== driveRoot.toLowerCase()) return '';
    return resolved;
  } catch {
    return '';
  }
}

function listXboxGamesRoots() {
  const roots = [];
  const seen = new Set();
  const addRoot = (candidate) => {
    const resolved = String(candidate || '').trim();
    if (!resolved || !fs.existsSync(resolved)) return;
    const key = path.resolve(resolved).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roots.push(resolved);
  };
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      addRoot(path.join(drive, 'XboxGames'));
      addRoot(parseGamingRootMarker(path.join(drive, '.GamingRoot')));
    } catch {}
  }
  return roots;
}

function findMicrosoftGameConfigs(root, maxDepth = 4) {
  const found = [];
  const walk = (current, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'microsoftgame.config') {
        found.push(fullPath);
      } else if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}

function execFileJson(file, args, options = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: Number(options.timeoutMs) || 30000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error || !String(stdout || '').trim()) return resolve([]);
        try {
          const parsed = JSON.parse(stdout);
          resolve(Array.isArray(parsed) ? parsed : parsed ? [parsed] : []);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

async function listPackagedGameConfigPaths() {
  if (process.platform !== 'win32') return [];
  const command =
    "Get-AppxPackage | Where-Object { $_.InstallLocation } | " +
    "ForEach-Object { $p = Join-Path $_.InstallLocation 'MicrosoftGame.config'; " +
    "if (Test-Path -LiteralPath $p) { [pscustomobject]@{ Path=$p; PackageFamilyName=$_.PackageFamilyName } } } | " +
    'ConvertTo-Json -Compress';
  return execFileJson('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeoutMs: 30000 });
}

async function discoverXboxPcInstallations(options = {}) {
  const candidates = new Map();
  for (const root of listXboxGamesRoots()) {
    for (const configPath of findMicrosoftGameConfigs(root, 4)) {
      candidates.set(configPath.toLowerCase(), { path: configPath, packageFamilyName: '' });
    }
  }
  if (!options.skipAppx) {
    for (const entry of await listPackagedGameConfigPaths()) {
      const configPath = String(entry?.Path || '').trim();
      if (configPath) candidates.set(configPath.toLowerCase(), { path: configPath, packageFamilyName: String(entry?.PackageFamilyName || '').trim() });
    }
  }

  const byTitleId = new Map();
  const withoutTitleId = [];
  for (const candidate of candidates.values()) {
    try {
      const parsed = parseMicrosoftGameConfig(candidate.path);
      if (!parsed.packageFamilyName && candidate.packageFamilyName) {
        parsed.packageFamilyName = candidate.packageFamilyName;
        if (parsed.applicationId) parsed.aumid = `${candidate.packageFamilyName}!${parsed.applicationId}`;
      }
      if (!parsed.titleId) {
        withoutTitleId.push(parsed);
        continue;
      }
      if (!byTitleId.has(parsed.titleId)) byTitleId.set(parsed.titleId, parsed);
    } catch {}
  }
  return [...byTitleId.values(), ...withoutTitleId];
}

// ---- Title history / platform filtering ----

function normalizeDeviceNames(title = {}) {
  const devices = [
    ...(Array.isArray(title?.devices) ? title.devices : []),
    ...(Array.isArray(title?.deviceTypes) ? title.deviceTypes : []),
    title?.deviceType,
    title?.platform,
  ];
  return devices
    .map((entry) =>
      String(typeof entry === 'object' ? entry?.name || entry?.type || entry?.deviceType : entry || '')
        .trim()
        .toLowerCase()
    )
    .filter(Boolean);
}

function isWindowsPcTitle(title, installedTitleIds = new Set()) {
  const titleId = normalizeTitleId(title?.titleId ?? title?.id);
  const devices = normalizeDeviceNames(title);
  if (titleId && installedTitleIds.has(titleId)) return true;
  if (devices.some((device) => device === 'win32')) return false;
  return devices.some((device) => /(?:^|[^a-z])(pc|windows|windowsonecore)(?:$|[^a-z])/.test(device));
}

function xboxLocaleForLang(lang) {
  return XBOX_SCHEMA_LANGUAGE_LOCALES[String(lang || '').toLowerCase()] || 'en-US';
}

async function fetchXboxLocalizedTitleAchievements(xuid, titleId, lang, options = {}) {
  const locale = xboxLocaleForLang(lang);
  const achievements = await fetchXboxTitleAchievements(xuid, titleId, { ...options, locale });
  const rows = [];
  for (const raw of achievements) {
    const achievement = normalizeXboxAchievement(raw);
    if (achievement) rows.push(achievement);
  }
  return { achievements: rows, languages: [locale] };
}

// ---- Caches (schema + unlock state) ----

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function resolveXboxTitleArtwork(title = {}) {
  const images = Array.isArray(title?.images) ? title.images : [];
  const find = (types) => {
    for (const type of types) {
      const match = images.find(
        (image) =>
          String(image?.type || '').toLowerCase() === type.toLowerCase() && /^https?:\/\//i.test(String(image?.url || ''))
      );
      if (match) return String(match.url).trim();
    }
    return '';
  };
  const displayImage = firstNonEmpty(title?.displayImage, title?.image, title?.titleImage, title?.titleImageUrl);
  const coverUrl = find(['Poster', 'BoxArt', 'BrandedKeyArt', 'FeaturePromotionalSquareArt']) || displayImage;
  const headerUrl = find(['TitledHeroArt', 'SuperHeroArt', 'BrandedKeyArt', 'Hero']) || displayImage || coverUrl;
  return { coverUrl, headerUrl };
}

async function importLibrary(options = {}) {
  const lang = String(options.lang || 'english').trim() || 'english';
  const auth = await ensureXboxDirectSession(options);
  const account = { xuid: auth.xuid, gamertag: auth.gamertag };

  const installations = await discoverXboxPcInstallations();
  const installedByTitleId = new Map(installations.filter((e) => e.titleId).map((e) => [e.titleId, e]));
  const history = await fetchXboxTitleHistory({ ...options, auth });
  const pcTitles = new Map();
  for (const title of history) {
    if (!isWindowsPcTitle(title, new Set(installedByTitleId.keys()))) continue;
    const titleId = normalizeTitleId(title?.titleId ?? title?.id);
    if (titleId) pcTitles.set(titleId, title);
  }
  for (const installation of installations) {
    if (!installation.titleId || pcTitles.has(installation.titleId)) continue;
    pcTitles.set(installation.titleId, {
      titleId: installation.titleId,
      name: installation.title,
      devices: ['PC'],
      discoveredLocally: true,
    });
  }

  const result = {
    provider: 'Microsoft / Xbox Network',
    account,
    installedDetected: installations.length,
    historyTotal: history.length,
    pcTitles: pcTitles.size,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
  };
  const titles = [...pcTitles.values()];
  let index = 0;
  for (const title of titles) {
    index += 1;
    const titleId = normalizeTitleId(title?.titleId ?? title?.id);
    const titleName = firstNonEmpty(title?.name, title?.titleName, title?.displayName, `Xbox ${titleId}`);
    options.onProgress?.({
      current: index,
      total: titles.length,
      percent: Math.round((index / Math.max(1, titles.length)) * 100),
      detail: titleName,
      appid: titleId,
    });
    if (!titleId) {
      result.skipped += 1;
      continue;
    }
    try {
      const localized = await fetchXboxLocalizedTitleAchievements(account.xuid, titleId, lang, { ...options, auth });
      if (!localized.achievements.length) {
        result.skipped += 1;
        continue;
      }
      const artwork = resolveXboxTitleArtwork(title);
      const schema = {
        titleId,
        name: titleName,
        source: XBOX_PC_SOURCE,
        img: {
          header: artwork.headerUrl || '',
          portrait: artwork.coverUrl || '',
          icon: artwork.coverUrl || '',
          background: artwork.headerUrl || '',
        },
        achievement: {
          total: localized.achievements.length,
          list: localized.achievements.map((a) => ({
            name: a.id,
            displayName: a.displayName,
            description: a.description,
            hidden: a.hidden ? 1 : 0,
            icon: a.icon || '',
            icongray: a.icon || '',
            rarityPct: a.rarity,
            points: a.gamerscore || undefined,
          })),
        },
      };
      const previous = readJson(schemaCacheFile(titleId));
      writeJson(schemaCacheFile(titleId), schema);
      writeJson(stateCacheFile(titleId), readJson(stateCacheFile(titleId)) || {});
      if (previous) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.failed += 1;
    }
  }
  return result;
}

// ---- Reading for the library scan ----

function listCachedTitles() {
  const root = path.join(getUserDataPath(), 'steam_cache', 'xbox');
  let entries = [];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return [];
  }
  return entries.filter((name) => fs.existsSync(path.join(root, name, 'schema.json')));
}

async function getGameData(appid, lang) {
  const titleId = normalizeTitleId(appid);
  if (!titleId) return null;
  const schema = readJson(schemaCacheFile(titleId));
  if (!schema || !schema.achievement || !Array.isArray(schema.achievement.list)) return null;
  const state = readJson(stateCacheFile(titleId)) || {};
  const list = schema.achievement.list.map((a) => {
    const entry = state[a.name] || {};
    return {
      ...a,
      Achieved: entry.earned === true,
      UnlockTime: Number(entry.earned_time) || 0,
    };
  });
  return {
    appid: titleId,
    name: schema.name || `Xbox ${titleId}`,
    source: XBOX_PC_SOURCE,
    img: schema.img || {},
    achievement: {
      total: list.length,
      unlocked: list.filter((a) => a.Achieved).length,
      list,
    },
  };
}

function status() {
  const auth = loadAuth();
  if (!auth) return { connected: false, provider: 'Microsoft / Xbox Network' };
  return { connected: true, gamertag: auth.gamertag || '', xuid: auth.xuid || '', provider: 'Microsoft / Xbox Network' };
}

module.exports = {
  setUserDataPath,
  XBOX_PC_PLATFORM,
  XBOX_PC_SOURCE,
  XBOX_PC_CLIENT_ID,
  XBOX_PC_REDIRECT_URI,
  buildXboxDirectAuthorizeUrl,
  extractXboxDirectAuthResult,
  completeXboxDirectAuthentication,
  ensureXboxDirectSession,
  saveAuth,
  loadAuth,
  clearAuth,
  discoverXboxPcInstallations,
  parseMicrosoftGameConfig,
  parseGamingRootMarker,
  listXboxGamesRoots,
  normalizeTitleId,
  normalizeXuid,
  normalizeXboxClientId,
  normalizeXboxAchievement,
  isWindowsPcTitle,
  resolveXboxTitleArtwork,
  importLibrary,
  getGameData,
  listCachedTitles,
  status,
};
