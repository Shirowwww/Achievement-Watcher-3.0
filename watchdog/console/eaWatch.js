'use strict';

// Live toasts for EA Desktop achievements. EA writes both schemas and unlock events to
// %LOCALAPPDATA%/Electronic Arts/EA Desktop/Logs/EADesktopVerbose.log (+ .bak after rotation).
// This module is intentionally self-contained so the packaged watchdog does not need to require the
// renderer parser from app.asar. It seeds a per-achievement baseline on first observation, then notifies
// only achievements that appear later in the log.

const fs = require('fs');
const path = require('path');
const watch = require('node-watch');
const moment = require('moment');
const debug = require('../util/log.js');
const waitForFileStable = require('../util/waitForFileStable.js');

const APPDATA = process.env['APPDATA'] || '';
const LOCALAPPDATA = process.env['LOCALAPPDATA'] || '';
const cacheDir = path.join(APPDATA, 'Achievement Watcher/steam_cache/console');
const EA_LOGS_ROOT = LOCALAPPDATA ? path.join(LOCALAPPDATA, 'Electronic Arts', 'EA Desktop', 'Logs') : '';
const EA_VERBOSE_LOG_NAME = 'EADesktopVerbose.log';
const EA_VERBOSE_BAK_NAME = 'EADesktopVerbose.bak';
const EA_ICON_BASE = 'https://achievements.gameservices.ea.com/achievements/icons';

let watchers = [];
let cached = { key: '', parsed: null };

function decodeXml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttrs(fragment) {
  const out = {};
  const re = /([A-Za-z0-9_:-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(String(fragment || '')))) out[m[1]] = decodeXml(m[2]);
  return out;
}

function normalizeEpochSeconds(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 10_000_000_000 ? Math.floor(n / 1000) : Math.floor(n);
}

function parseGrantSeconds(value) {
  const raw = String(value || '').trim();
  if (!raw || /^0{4}-0{2}-0{2}t0{2}:0{2}:0{2}$/i.test(raw)) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
}

function normalizeImageId(value) {
  return String(value || '').trim().replace(/^achieve:/i, '');
}

function parseImageId(value) {
  const raw = normalizeImageId(value);
  const m = raw.match(/^(.+)-(\d+)$/);
  if (!m) return { achievementSet: '', achievementId: '' };
  return { achievementSet: String(m[1] || '').trim(), achievementId: String(m[2] || '').trim() };
}

function parseContentIdFromSet(setName) {
  const raw = String(setName || '').trim();
  const strict = raw.match(/^\d+_(\d+)_\d+$/);
  if (strict && strict[1]) return strict[1];
  const parts = raw.split('_').filter(Boolean);
  return parts.length >= 2 && /^\d+$/.test(parts[1]) ? parts[1] : '';
}

function unescapeLoggedPath(value) {
  return String(value || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
}

function isEarned(attrs) {
  const count = Number(attrs.Count || 0);
  const progress = Number(attrs.Progress || 0);
  const total = Number(attrs.Total || 0);
  return count > 0 || (total > 0 && progress >= total);
}

function normalizeAchievement(attrs) {
  const imageId = normalizeImageId(attrs.ImageId || '');
  const imageInfo = parseImageId(imageId);
  const id = String(attrs.Id || imageInfo.achievementId || '').trim();
  if (!id) return null;
  return {
    id,
    name: String(attrs.Name || '').trim(),
    description: String(attrs.Description || attrs.HowTo || '').trim(),
    imageId,
    achievementSet: String(imageInfo.achievementSet || '').trim(),
    earned: isEarned(attrs),
    earnedTime: parseGrantSeconds(attrs.GrantDate),
  };
}

function logFiles(logsRoot = EA_LOGS_ROOT) {
  const out = [];
  if (!logsRoot) return out;
  const bak = path.join(logsRoot, EA_VERBOSE_BAK_NAME);
  const current = path.join(logsRoot, EA_VERBOSE_LOG_NAME);
  if (fs.existsSync(bak)) out.push(bak);
  if (fs.existsSync(current)) out.push(current);
  return out;
}

function gameInfoFromLog(text) {
  const byContentId = new Map();
  const merge = (contentId, patch) => {
    if (!contentId) return;
    const current = byContentId.get(contentId) || {};
    byContentId.set(contentId, { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v)) });
  };

  for (const line of text.split(/\r?\n/)) {
    let m = line.match(/Processing launch request:\s+offerId\[([^\]]+)\]\s+contentId\[(\d+)\]\s+exe\[([^\]]+)\]\s+cwd\[([^\]]*)\]/i);
    if (m) merge(String(m[2]).trim(), { offerId: String(m[1]).trim(), exePath: unescapeLoggedPath(m[3]), processName: path.basename(unescapeLoggedPath(m[3])) });

    m = line.match(/Launched game details:\s+titleName\[([^\]]+)\]\s+offerId\[([^\]]+)\]\s+masterTitleId\[(\d+)\]/i);
    if (m) merge(String(m[3]).trim(), { gameName: String(m[1]).trim(), offerId: String(m[2]).trim() });

    m = line.match(/Connection Details:\s+idIsOffer\[true\]\s+contentId\[([^\]]+)\]\s+masterTitleId\[(\d+)\]\s+titleName\[([^\]]+)\]\s+offerId\[([^\]]+)\]/i);
    if (m) merge(String(m[2]).trim(), { gameName: String(m[3]).trim(), offerId: String(m[4]).trim() });

    m = line.match(/<Game\b[^>]*displayName="([^"]+)"[^>]*contentID="([^"]+)"/i);
    if (m) {
      const offerId = String(m[2] || '').trim();
      const idMatch = offerId.match(/(\d+)\s*$/);
      if (idMatch) merge(idMatch[1], { gameName: String(m[1]).trim(), offerId });
    }
  }

  return byContentId;
}

function parseLog(logsRoot = EA_LOGS_ROOT) {
  const files = logFiles(logsRoot);
  if (files.length === 0) return { entries: [], snapshots: new Map() };

  const key = files
    .map((file) => {
      try {
        const st = fs.statSync(file);
        return `${file.toLowerCase()}:${st.mtimeMs}:${st.size}`;
      } catch {
        return `${file.toLowerCase()}:missing`;
      }
    })
    .join('|');
  if (cached.key === key && cached.parsed) return cached.parsed;

  const text = files.map((file) => {
    try {
      return fs.readFileSync(file, 'utf8').replace(/\0/g, '');
    } catch {
      return '';
    }
  }).join('\n');

  const games = gameInfoFromLog(text);
  const entries = [];
  const setRe = /<AchievementSet\b([^>]*)>([\s\S]*?)<\/AchievementSet>/gi;
  let setMatch;
  while ((setMatch = setRe.exec(text))) {
    const attrs = parseAttrs(setMatch[1]);
    const achievementSet = String(attrs.Name || '').trim();
    if (!achievementSet) continue;
    const appid = parseContentIdFromSet(achievementSet);
    const info = games.get(appid) || {};
    const achievements = [];
    const achRe = /<Achievement\b([^>]*)\/>/gi;
    let achMatch;
    while ((achMatch = achRe.exec(setMatch[2]))) {
      const achievement = normalizeAchievement(parseAttrs(achMatch[1]));
      if (achievement) achievements.push(achievement);
    }
    if (!appid || achievements.length === 0) continue;
    entries.push({
      appid,
      achievementSet,
      name: String(attrs.GameName || info.gameName || appid).trim(),
      processName: info.processName || '',
      achievements,
      order: setMatch.index,
    });
  }

  const events = new Map();
  const respRe = /<Response\b[^>]*>\s*<Achievement\b([^>]*?)\/>\s*<\/Response>/gis;
  let respMatch;
  while ((respMatch = respRe.exec(text))) {
    const achievement = normalizeAchievement(parseAttrs(respMatch[1]));
    if (!achievement || !achievement.achievementSet || !achievement.earned) continue;
    const list = events.get(achievement.achievementSet) || [];
    list.push({ id: achievement.id, time: achievement.earnedTime, order: respMatch.index });
    events.set(achievement.achievementSet, list);
  }

  const snapshots = new Map();
  for (const entry of entries) {
    const state = new Map();
    for (const achievement of entry.achievements) {
      if (achievement.earned) state.set(achievement.id, achievement.earnedTime || 0);
    }
    for (const event of events.get(entry.achievementSet) || []) {
      if (event.order <= entry.order) continue;
      const prev = state.get(event.id);
      if (!prev || (event.time && event.time < prev)) state.set(event.id, event.time || 0);
    }
    snapshots.set(cacheKey(entry), state);
  }

  const parsed = { entries, snapshots };
  cached = { key, parsed };
  return parsed;
}

function cacheKey(entry) {
  return `${entry.appid}-${String(entry.achievementSet || '').replace(/[^\w.-]/g, '_')}`;
}

function cacheFile(entry) {
  return path.join(cacheDir, `ea-${cacheKey(entry)}.json`);
}

function cacheLoad(entry) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(entry), 'utf8'));
  } catch {
    return null;
  }
}

function cacheSave(entry, unlocked) {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile(entry), JSON.stringify({ unlocked: Array.from(unlocked) }), 'utf8');
  } catch (err) {
    debug.warn(`[ea] cache save failed for ${entry.appid}: ${err}`);
  }
}

async function handleChange(changedFile, ctx) {
  try {
    if (changedFile) await waitForFileStable(changedFile);
    const { entries, snapshots } = parseLog();
    let delay = 0;

    for (const entry of entries) {
      const snapshot = snapshots.get(cacheKey(entry)) || new Map();
      const cache = cacheLoad(entry);
      const isFirstObservation = !cache || !Array.isArray(cache.unlocked);
      const prev = new Set(isFirstObservation ? [] : cache.unlocked.map(String));
      const unlockedNow = new Set(Array.from(snapshot.keys()).map(String));

      if (!isFirstObservation) {
        for (const achId of unlockedNow) {
          if (prev.has(achId)) continue;
          const achievement = entry.achievements.find((a) => a.id === achId);
          if (!achievement) continue;
          debug.log(`[ea] Unlocked: ${entry.name} - ${achievement.name || achId}`);
          await ctx.notify(
            {
              source: 'EA Desktop',
              appid: entry.appid,
              gameDisplayName: entry.name,
              achievementName: achievement.id,
              achievementDisplayName: achievement.name || achievement.id,
              achievementDescription: achievement.description,
              icon: achievement.imageId ? `${EA_ICON_BASE}/${normalizeImageId(achievement.imageId)}-208.png` : undefined,
              time: normalizeEpochSeconds(snapshot.get(achId)) || moment().unix(),
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
                attribution: (ctx.options.achievement.lang || '').toLowerCase().startsWith('fr') ? 'Succes EA' : 'EA Achievement',
              },
              prefetch: ctx.options.notification_advanced.iconPrefetch,
              rumble: ctx.options.notification.rumble,
              souvenir: ctx.options.souvenir || null,
            }
          );
          delay += 1;
        }
      }

      cacheSave(entry, unlockedNow);
    }
  } catch (err) {
    debug.warn(`[ea] handleChange failed: ${err}`);
  }
}

module.exports.start = async (ctx) => {
  module.exports.stop();

  if (!ctx || !ctx.options) return;
  if (ctx.options.achievement_source && ctx.options.achievement_source.ea === false) return;
  if (ctx.options.notification && ctx.options.notification.notify === false) return;
  if (typeof ctx.notify !== 'function') return;
  if (!EA_LOGS_ROOT || !fs.existsSync(EA_LOGS_ROOT)) return;

  await handleChange(null, ctx);

  try {
    const w = watch(EA_LOGS_ROOT, { recursive: false, filter: /EADesktopVerbose\.(log|bak)$/i }, (evt, name) => {
      if (evt !== 'update') return;
      handleChange(name, ctx);
    });
    watchers.push(w);
    debug.log(`[ea] watching ${EA_LOGS_ROOT}`);
  } catch (err) {
    debug.warn(`[ea] failed to watch ${EA_LOGS_ROOT}: ${err}`);
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

module.exports._internal = { parseAttrs, parseLog, normalizeAchievement, parseContentIdFromSet };
