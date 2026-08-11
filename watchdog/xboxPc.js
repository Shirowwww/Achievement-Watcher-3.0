'use strict';

// Background Xbox PC client: refresh the shared session and poll running titles.

const fs = require('fs');
const path = require('path');
const aes = require('./util/aes.js');

const CLIENT_ID = String(process.env.XBOX_PC_CLIENT_ID || '').trim() || '388ea51c-0b25-4029-aae2-17df49d23905';
const OAUTH_SCOPE = 'Xboxlive.signin Xboxlive.offline_access';
const REDIRECT_URI = 'http://localhost:8080/auth/callback';
const RELYING_PARTY = 'http://xboxlive.com';
const ACHIEVEMENTS_URL = 'https://achievements.xboxlive.com';
const CONTRACT_VERSION = '4';

function appDataRoot() {
  return require('./util/userData.js').userDataDir();
}

function authFile() {
  return path.join(appDataRoot(), 'cfg', 'xbox-auth.json');
}

function titleCacheDir(titleId) {
  return path.join(appDataRoot(), 'steam_cache', 'xbox', String(titleId || ''));
}

function stateFile(titleId) {
  return path.join(titleCacheDir(titleId), 'state.json');
}

function schemaFile(titleId) {
  return path.join(titleCacheDir(titleId), 'schema.json');
}

function loadAuth() {
  try {
    const raw = fs.readFileSync(authFile(), 'utf8');
    const payload = raw.includes(':') ? aes.decrypt(raw) : raw;
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function saveAuth(auth) {
  try {
    fs.mkdirSync(path.dirname(authFile()), { recursive: true });
    fs.writeFileSync(authFile(), aes.encrypt(JSON.stringify(auth)), 'utf8');
  } catch {}
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

function xboxAuthExpiry(expiresIn) {
  return Date.now() + Math.max(0, Number(expiresIn) || 0) * 1000;
}

async function exchangeLiveTokenForXboxSession(liveTokens) {
  const { xnet } = await import('@xboxreplay/xboxlive-auth');
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
    XSTSRelyingParty: RELYING_PARTY,
    sandboxId: 'RETAIL',
  });
  const claims = xsts?.DisplayClaims?.xui?.[0] || {};
  return {
    clientId: CLIENT_ID,
    refreshToken,
    accessToken,
    accessExpiresAt: xboxAuthExpiry(liveTokens.expires_in),
    xstsToken: xsts?.Token,
    xstsExpiresAt: Date.parse(xsts?.NotAfter) || 0,
    xuid: claims.xid,
    uhs: claims.uhs,
    gamertag: claims.gtg,
  };
}

// Refresh the session when the XSTS token is close to expiring; persists the refreshed session so
// the app and Watchdog share one token lifetime.
async function ensureSession(auth) {
  if (!auth) throw new Error('xbox-pc-microsoft-login-required');
  if (auth.xstsToken && auth.xuid && auth.uhs && auth.xstsExpiresAt > Date.now() + 60000) return auth;
  const { live } = await import('@xboxreplay/xboxlive-auth');
  let refreshed;
  try {
    refreshed = await live.refreshAccessToken(auth.refreshToken, auth.clientId || CLIENT_ID, OAUTH_SCOPE);
  } catch (error) {
    throw error;
  }
  if (!refreshed.refresh_token) refreshed.refresh_token = auth.refreshToken;
  const next = await exchangeLiveTokenForXboxSession(refreshed);
  saveAuth(next);
  return next;
}

function buildHeaders(auth) {
  const uhs = String(auth.uhs || '').trim();
  const token = String(auth.xstsToken || '').trim();
  if (!uhs || !token) throw new Error('xbox-pc-xsts-required');
  return {
    Authorization: `XBL3.0 x=${uhs};${token}`,
    'x-xbl-contract-version': CONTRACT_VERSION,
    Accept: 'application/json',
    'Accept-Language': 'en-US,en',
  };
}

async function fetchAchievements(auth, titleId, locale = 'en-US,en') {
  const xuid = normalizeXuid(auth && auth.xuid);
  const safeTitleId = normalizeTitleId(titleId);
  if (!xuid) throw new Error('xbox-xuid-required');
  if (!safeTitleId) throw new Error('xbox-title-id-required');

  const rows = [];
  const seenTokens = new Set();
  let continuationToken = '';
  for (let page = 0; page < 20; page += 1) {
    let endpoint = `users/xuid(${xuid})/achievements?titleId=${encodeURIComponent(safeTitleId)}&maxItems=1000`;
    if (continuationToken) endpoint += `&continuationToken=${encodeURIComponent(continuationToken)}`;
    const res = await fetch(`${ACHIEVEMENTS_URL}/${endpoint}`, {
      signal: AbortSignal.timeout(15000),
      headers: { ...buildHeaders(auth), 'Accept-Language': locale },
    });
    if (!res.ok) {
      const error = new Error(`xbox-network-http-${res.status}`);
      error.status = res.status;
      throw error;
    }
    const data = await res.json();
    rows.push(...(Array.isArray(data?.achievements) ? data.achievements : Array.isArray(data?.items) ? data.items : []));
    continuationToken = String(data?.pagingInfo?.continuationToken || '').trim();
    if (!continuationToken || seenTokens.has(continuationToken)) break;
    seenTokens.add(continuationToken);
  }
  return rows;
}

function normalizeAchievement(raw = {}) {
  const id = String(raw?.id || raw?.name || '').trim();
  if (!id) return null;
  const progressState = raw?.progressState || raw?.progression?.state || '';
  const earned = /achieved/i.test(String(progressState));
  const earnedTime = Number(raw?.progression?.timeUnlocked || raw?.unlockTime || raw?.timeUnlocked || 0);
  const progressRaw = raw?.progression?.current ?? raw?.progress;
  const progressMaxRaw = raw?.progression?.target ?? raw?.maxProgress;
  const progressCurrent = progressRaw !== undefined && progressRaw !== null ? Number(progressRaw) : NaN;
  const progressMax = progressMaxRaw !== undefined && progressMaxRaw !== null ? Number(progressMaxRaw) : NaN;
  const rarity = Number(raw?.rarity?.currentPercentage ?? raw?.rarityPercentage ?? raw?.rarity?.percentage);
  return {
    id,
    earned,
    earned_time: earnedTime > 0 ? earnedTime : 0,
    progress: Number.isFinite(progressCurrent) ? progressCurrent : undefined,
    max_progress: Number.isFinite(progressMax) ? progressMax : undefined,
    rarity: Number.isFinite(rarity) ? Math.min(100, Math.max(0, rarity)) : null,
  };
}

function buildSnapshot(rows) {
  const snapshot = {};
  for (const raw of Array.isArray(rows) ? rows : []) {
    const ach = normalizeAchievement(raw);
    if (!ach) continue;
    snapshot[ach.id] = {
      earned: ach.earned,
      ...(ach.earned_time ? { earned_time: ach.earned_time } : {}),
      ...(ach.progress !== undefined ? { progress: ach.progress } : {}),
      ...(ach.max_progress !== undefined ? { max_progress: ach.max_progress } : {}),
    };
  }
  return snapshot;
}

function diffSnapshots(previous = {}, next = {}) {
  const newUnlocked = [];
  let changed = false;
  const allKeys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  for (const key of allKeys) {
    const prev = previous[key] || {};
    const nxt = next[key] || {};
    if (Boolean(prev.earned) !== Boolean(nxt.earned) || Number(prev.earned_time || 0) !== Number(nxt.earned_time || 0)) changed = true;
    if (nxt.earned && !prev.earned) newUnlocked.push(key);
  }
  return { changed, newUnlocked };
}

function readState(titleId) {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(titleId), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(titleId, snapshot) {
  try {
    fs.mkdirSync(titleCacheDir(titleId), { recursive: true });
    fs.writeFileSync(stateFile(titleId), JSON.stringify(snapshot, null, 2), 'utf8');
  } catch {}
}

function readSchema(titleId) {
  try {
    return JSON.parse(fs.readFileSync(schemaFile(titleId), 'utf8'));
  } catch {
    return null;
  }
}

// One poll cycle: fetch the current unlock state, diff against the previous snapshot, persist.
async function pollOnce({ auth, titleId, previousSnapshot = {} }) {
  const rows = await fetchAchievements(auth, titleId);
  const snapshot = buildSnapshot(rows);
  const diff = diffSnapshots(previousSnapshot, snapshot);
  return { snapshot, ...diff };
}

module.exports = {
  authFile,
  loadAuth,
  saveAuth,
  ensureSession,
  normalizeTitleId,
  normalizeXuid,
  normalizeAchievement,
  buildSnapshot,
  diffSnapshots,
  fetchAchievements,
  pollOnce,
  readState,
  writeState,
  readSchema,
};
