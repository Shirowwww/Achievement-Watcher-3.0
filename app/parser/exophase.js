'use strict';

// Fetch localized achievement metadata from Exophase.
// It enriches schemas; it does not scan saves or provide unlock state.

const fs = require('fs');
const path = require('path');
const request = require('request-zero');
const htmlParser = require('node-html-parser');

let debug = { log() {}, warn() {}, error() {} };

module.exports.initDebug = ({ isDev, userDataPath }) => {
  debug = new (require('../util/logger'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

const BASE_EXOPHASE_URL = 'https://www.exophase.com/game/';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36';
const STATIC_TIMEOUT_MS = 15000;
const BROWSER_WAIT_MS = 30000;

// PS3/PS4 pages live under /trophies/ without a platform suffix requirement; everything else is
// slug-<platform>/achievements/. Upstream mapped xenia/rpcs3; shadps4 is ours (validated live).
const EXOPHASE_PLATFORM_MAP = {
  xenia: 'xbox-360',
  rpcs3: 'ps3',
  shadps4: 'ps4',
};

const TROPHY_PLATFORMS = new Set(['ps3', 'ps4', 'ps5']);
const EXOPHASE_RARITY_SOURCE = 'exophase';

// Exophase language path segments, keyed by the Steam API language names the whole app already
// uses (settings `lang`, steam_cache/schema/<lang>). Keep in sync with locale/steam.json.
const EXOPHASE_LANG_MAP = {
  arabic: 'ar',
  bulgarian: 'bg',
  brazilian: 'pt_BR',
  czech: 'cs',
  danish: 'dk',
  dutch: 'nl',
  english: 'us',
  finnish: 'fi',
  french: 'fr',
  german: 'de',
  greek: 'el',
  hungarian: 'hu',
  indonesian: 'in',
  italian: 'it',
  japanese: 'jp',
  koreana: 'ko',
  latam: 'es_MX',
  norwegian: 'no',
  polish: 'pl',
  portuguese: 'pt',
  romanian: 'ro',
  russian: 'ru',
  spanish: 'es',
  schinese: 'zh-CN',
  tchinese: 'zh-TW',
  thai: 'th',
  turkish: 'tr',
  swedish: 'se',
  ukrainian: 'uk',
  vietnamese: 'vi',
};

const EXOPHASE_LANG_KEYS = Object.keys(EXOPHASE_LANG_MAP);

function mapExophasePlatform(platform) {
  const key = String(platform || '')
    .trim()
    .toLowerCase();
  if (!key) return '';
  return EXOPHASE_PLATFORM_MAP[key] || key;
}

function buildExophaseSlug(input) {
  const raw = String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, ' s')
    .replace(/['’]/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw || 'game';
}

const ROMAN_NUMERAL_MAP = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
  xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16', xvii: '17', xviii: '18', xix: '19', xx: '20',
};

function replaceRomanNumerals(input) {
  return String(input || '').replace(/\b[ivxlcdm]+\b/g, (match) => {
    const key = match.toLowerCase();
    return ROMAN_NUMERAL_MAP[key] || match;
  });
}

function slugify(input) {
  const raw = String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw || 'game';
}

function buildExophaseSlugVariants(input) {
  const rawBase = String(input || '').trim();
  const cleaned = rawBase
    .replace(/\b(trophies?|trophy)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || rawBase;
  if (!base) return ['game'];
  const normalized = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const lower = normalized.toLowerCase();

  const variants = new Set();
  variants.add(buildExophaseSlug(base));
  variants.add(slugify(lower.replace(/['’]s\b/g, ' s')));
  variants.add(slugify(replaceRomanNumerals(lower)));
  variants.add(slugify(replaceRomanNumerals(lower.replace(/['’]s\b/g, ' s'))));
  const noApos = lower.replace(/['’]/g, '');
  variants.add(slugify(noApos));
  variants.add(slugify(replaceRomanNumerals(noApos)));

  return Array.from(variants).filter(Boolean);
}

// PlayStation suffixes aren't uniform on Exophase (hades-psn vs bloodborne-ps4), so trophy
// platforms get several base-URL candidates per slug.
function buildBaseUrlCandidates(slug, platform) {
  if (TROPHY_PLATFORMS.has(platform)) {
    return [
      `${BASE_EXOPHASE_URL}${slug}-${platform}/trophies/`,
      `${BASE_EXOPHASE_URL}${slug}-psn/trophies/`,
      `${BASE_EXOPHASE_URL}${slug}/trophies/`,
    ];
  }
  return [`${BASE_EXOPHASE_URL}${slug}-${platform}/achievements/`];
}

function ensureLangUrl(baseUrl, code) {
  let u = baseUrl;
  if (!u.endsWith('/')) u += '/';
  u = u.replace(/\/achievements\/[^/]+\/$/i, '/achievements/');
  u = u.replace(/\/trophies\/[^/]+\/$/i, '/trophies/');
  return u + encodeURIComponent(code) + '/';
}

function looksBlocked(html, status) {
  if (status === 403 || status === 429 || status === 503) return true;
  const lower = String(html || '').toLowerCase();
  if (!lower) return false;
  if (lower.includes('error 403') || lower.includes('access denied') || lower.includes('request blocked')) return true;
  if (lower.includes('attention required') && lower.includes('cloudflare')) return true;
  return false;
}

function cleanText(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(u, baseUrl) {
  try {
    return new URL(u, baseUrl).toString();
  } catch {
    return u;
  }
}

// ---- Rarity (global unlock %) — Exophase serves it on every award card ----

function normalizeExophaseRarityPct(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Number(Math.min(100, Math.max(0, value)).toFixed(4)) : null;
  }
  if (typeof value === 'string') {
    const match = value.replace(',', '.').trim().match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? Number(Math.min(100, Math.max(0, parsed)).toFixed(4)) : null;
  }
  return null;
}

function elementLooksLikeRarityNode(el) {
  const haystack = [
    el.rawTagName,
    el.getAttribute('class'),
    el.getAttribute('id'),
    el.getAttribute('title'),
    el.getAttribute('aria-label'),
    el.getAttribute('data-title'),
    el.getAttribute('data-label'),
    el.getAttribute('data-percent'),
    el.getAttribute('data-percentage'),
    el.getAttribute('data-rarity'),
  ]
    .filter(Boolean)
    .join(' ');
  return /\b(rarity|rare|percent|percentage|unlock|unlocked|earned|owners|players|completion|completed)\b/i.test(haystack);
}

function extractRarityPctFromCard(card) {
  // 1) The ".award-average.text-center > span" summary row.
  const average = card.querySelector('.award-average.text-center > span');
  if (average) {
    const pct = normalizeExophaseRarityPct(cleanText(average.text));
    if (pct !== null) return pct;
  }
  // 2) Any element whose attributes/text look like a rarity value.
  for (const node of card.querySelectorAll('*')) {
    if (!elementLooksLikeRarityNode(node)) continue;
    const values = [
      node.getAttribute('data-percent'),
      node.getAttribute('data-percentage'),
      node.getAttribute('data-rarity'),
      node.getAttribute('title'),
      node.getAttribute('aria-label'),
      cleanText(node.text),
    ];
    for (const value of values) {
      const pct = normalizeExophaseRarityPct(value);
      if (pct !== null) return pct;
    }
  }
  // 3) Fallback: remaining card text after removing the title/description.
  const titleEl = card.querySelector('[class*=award-title]');
  const descEl = card.querySelector('[class*=award-description]');
  let rest = cleanText(card.text);
  if (titleEl) rest = rest.replace(cleanText(titleEl.text), '');
  if (descEl) rest = rest.replace(cleanText(descEl.text), '');
  return normalizeExophaseRarityPct(rest);
}

// The award list markup (one <li> per achievement):
//   <li ...><img class="award-image trophy-image" src="..."/>
//     <div class="... award-details ..."><div class="... award-title ...">name</div>
//       <div class="award-description ..."><p>text</p></div></div></li>
function extractAchievementsFromHtml(html, baseUrl) {
  const root = htmlParser.parse(String(html || ''));
  const details = root.querySelectorAll('[class*=award-detail]');
  const items = [];

  details.forEach((detail, idx) => {
    const titleEl = detail.querySelector('[class*=award-title]');
    const title = cleanText(titleEl ? titleEl.text : '');
    if (!title) return;
    const descEl = detail.querySelector('[class*=award-description]');
    const description = cleanText(descEl ? descEl.text : '');

    let card = detail;
    while (card && card.tagName !== 'LI') card = card.parentNode;
    if (!card) card = detail.parentNode || detail;
    const rarityPct = extractRarityPctFromCard(card);

    let iconUrl = '';
    const img = card.querySelector('img[class*=award-image]') || card.querySelector('[class*=award-image] img');
    if (img) {
      iconUrl = absoluteUrl(img.getAttribute('src') || img.getAttribute('data-src') || '', baseUrl);
    } else {
      const imgEl = card.querySelector('[class*=award-image]');
      const style = (imgEl && imgEl.getAttribute('style')) || '';
      const m = style.match(/url\(["']?(.*?)["']?\)/i);
      if (m && m[1]) iconUrl = absoluteUrl(m[1], baseUrl);
    }

    items.push({
      index: idx + 1,
      title,
      description,
      icon_url: iconUrl,
      rarityPct,
      raritySource: rarityPct !== null ? EXOPHASE_RARITY_SOURCE : '',
    });
  });

  return items;
}

function extractGameTitleFromHtml(html) {
  const root = htmlParser.parse(String(html || ''));
  const h = root.querySelector('h1') || root.querySelector('h2');
  return cleanText(h ? h.text : '');
}

// ---- page loaders ----------------------------------------------------------------------------

async function loadPageStatic(url) {
  try {
    const { code, body } = await request(url, {
      timeout: STATIC_TIMEOUT_MS,
      maxRedirect: 5,
      headers: {
        'User-Agent': DEFAULT_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    return { html: body, status: code };
  } catch (err) {
    // request-zero rejects on non-2xx. A plain 404 is just a slug miss — report it as an empty
    // page so the caller tries the next candidate instead of escalating to the browser.
    if (err && err.code === 404) return { html: '', status: 404 };
    throw err;
  }
}

// Same installed-browser preference as init.js startPuppeteer (Chrome then Edge): drive a real
// local Chromium so no browser download is ever needed. Kept private here because this module
// must work from both the renderer (steam.js) and the main process.
function findInstalledEdge() {
  if (process.platform !== 'win32') return null;
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], 'C:\\Program Files (x86)', 'C:\\Program Files'];
  for (const root of roots) {
    if (!root) continue;
    const p = path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function launchBrowser() {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  const ChromeLauncher = require('chrome-launcher');
  const installedChromePath =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : ChromeLauncher.Launcher.getInstallations()[0];
  const browserPaths = [installedChromePath, findInstalledEdge()].filter(
    (browserPath, index, paths) => browserPath && fs.existsSync(browserPath) && paths.indexOf(browserPath) === index
  );
  if (browserPaths.length === 0) throw new Error('Exophase fallback requires Google Chrome or Microsoft Edge.');
  let lastError;
  for (const executablePath of browserPaths) {
    try {
      return await puppeteer.launch({
        headless: true,
        executablePath,
        args: ['--disable-blink-features=AutomationControlled', '--disable-extensions'],
      });
    } catch (err) {
      lastError = err;
      debug.log(`exophase: browser launch failed for ${executablePath} (${err.message})`);
    }
  }
  throw lastError;
}

async function newBrowserPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(DEFAULT_UA);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const type = req.resourceType();
    let host = '';
    try {
      host = new URL(req.url()).hostname;
    } catch {}
    if (type === 'document') return req.continue();
    if (['media', 'font', 'stylesheet'].includes(type)) return req.abort();
    if (type === 'image' && host && !host.endsWith('exophase.com')) return req.abort();
    return req.continue();
  });
  return page;
}

async function loadPageBrowser(page, url) {
  const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: BROWSER_WAIT_MS });
  await page.waitForSelector('[class*=award-detail]', { timeout: 15000 }).catch(() => {});
  const html = await page.content();
  return { html, status: resp ? resp.status() : 0 };
}

// ---- public API --------------------------------------------------------------------------------

// Download an achievement icon to disk (for emulator schema enrichment, where the schema must be
// fully local). Returns true on success.
async function downloadExophaseIcon(iconUrl, outPath) {
  if (!iconUrl || !outPath) return false;
  try {
    const resp = await fetch(iconUrl, { headers: { 'User-Agent': DEFAULT_UA } });
    if (!resp.ok) return false;
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buf);
    return true;
  } catch {
    return false;
  }
}

// Fetch achievement data in one or more languages and return a normalized list.
async function fetchExophaseAchievementsMultiLang(options = {}) {
  const platform = mapExophasePlatform(options.platform || '');
  if (!platform) throw new Error('Missing platform for Exophase');

  const slugCandidates =
    Array.isArray(options.slugCandidates) && options.slugCandidates.length
      ? options.slugCandidates
      : options.slug
        ? [options.slug]
        : buildExophaseSlugVariants(options.title || '');

  const langMap = options.langMap || EXOPHASE_LANG_MAP;
  const langKeys = (options.langKeys || EXOPHASE_LANG_KEYS).filter((k) => langMap[k]);
  if (!langKeys.includes('english')) langKeys.unshift('english');

  let browser = null;
  let browserPage = null;
  let useBrowser = false;

  // Static request first; on a block (Cloudflare/403) switch this whole fetch session over to the
  // stealth browser. `null` html with an ok status means "page loaded but no awards" (bad slug).
  const loadPage = async (url) => {
    if (!useBrowser) {
      try {
        const { html, status } = await loadPageStatic(url);
        if (!looksBlocked(html, status)) return { html, status };
        debug.log(`exophase: static fetch blocked (${status}) — switching to stealth browser`);
      } catch (err) {
        debug.log(`exophase: static fetch failed (${err.code || err.message || err}) — switching to stealth browser`);
      }
      useBrowser = true;
    }
    if (!browser) {
      browser = await launchBrowser();
      browserPage = await newBrowserPage(browser);
    }
    return loadPageBrowser(browserPage, url);
  };

  try {
    let baseUrl = null;
    let baseItems = [];
    let baseHtml = '';
    let firstErr = null;
    outer: for (const slug of slugCandidates) {
      for (const candidateBase of buildBaseUrlCandidates(slug, platform)) {
        const testUrl = ensureLangUrl(candidateBase, langMap.english);
        try {
          const { html } = await loadPage(testUrl);
          const items = extractAchievementsFromHtml(html, testUrl);
          if (items.length) {
            baseUrl = candidateBase;
            baseItems = items;
            baseHtml = html;
            break outer;
          }
        } catch (err) {
          firstErr = firstErr || err;
        }
      }
    }
    if (!baseUrl) throw firstErr || new Error('No working Exophase URL');

    const gameTitle = extractGameTitleFromHtml(baseHtml);

    const achievements = baseItems.map((it) => ({
      index: it.index,
      titles: { english: it.title },
      descriptions: { english: it.description },
      icon_url: it.icon_url || '',
      rarityPct: normalizeExophaseRarityPct(it.rarityPct),
      raritySource: normalizeExophaseRarityPct(it.rarityPct) !== null ? EXOPHASE_RARITY_SOURCE : '',
    }));

    const normalizePair = (a, b) => `${cleanText(a).toLowerCase()}|${cleanText(b).toLowerCase()}`;
    const englishSignature = baseItems.map((it) => normalizePair(it.title, it.description)).join('\n');

    for (const langKey of langKeys) {
      if (langKey === 'english') continue;
      const langUrl = ensureLangUrl(baseUrl, langMap[langKey]);
      let items = [];
      try {
        const { html } = await loadPage(langUrl);
        items = extractAchievementsFromHtml(html, langUrl);
      } catch (err) {
        debug.log(`exophase: ${langKey} load failed (${err.code || err.message || err})`);
        continue;
      }
      if (!items.length) continue;
      // Some games aren't translated: Exophase then serves the english text on every language
      // path. Skip those so callers can tell "translated" from "english fallback".
      const langSignature = items.map((it) => normalizePair(it.title, it.description)).join('\n');
      if (langSignature === englishSignature) continue;
      if (items.length !== achievements.length) {
        debug.log(`exophase: ${langKey} count mismatch (got ${items.length}, expected ${achievements.length})`);
      }
      const min = Math.min(items.length, achievements.length);
      for (let i = 0; i < min; i += 1) {
        achievements[i].titles[langKey] = items[i].title;
        achievements[i].descriptions[langKey] = items[i].description;
        if (achievements[i].rarityPct === null && normalizeExophaseRarityPct(items[i].rarityPct) !== null) {
          achievements[i].rarityPct = normalizeExophaseRarityPct(items[i].rarityPct);
          achievements[i].raritySource = EXOPHASE_RARITY_SOURCE;
        }
      }
    }

    return {
      baseUrl,
      gameTitle,
      items: achievements,
    };
  } finally {
    if (browserPage) await browserPage.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

// ---- Rarity lookup for emulator platforms (Xenia/RPCS3/ShadPS4) ----

function normalizeExophaseMatchText(value) {
  if (!value) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildExophaseMatchKey(title, description) {
  const t = normalizeExophaseMatchText(title);
  if (!t) return '';
  return `${t}|${normalizeExophaseMatchText(description)}`;
}

function getSchemaLocalizedTextForRarity(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object') {
    return (
      String(value.english || '').trim() ||
      Object.values(value)
        .map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''))
        .find(Boolean) ||
      ''
    );
  }
  return '';
}

function buildExophaseRaritySlugCandidates(title, platform) {
  const clean = String(title || '')
    .replace(/\((?:Xenia|RPCS3|PS4|shadps4)\)\s*$/i, '')
    .replace(/[™®©]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const variants = buildExophaseSlugVariants(clean);
  if (platform === 'shadps4') {
    return Array.from(new Set([...variants, ...variants.map((slug) => `${slug}-ps4`)]));
  }
  if (platform !== 'rpcs3') return variants;
  return Array.from(
    new Set([...variants, ...variants.map((slug) => `${slug}-ps3`), ...variants.map((slug) => `${slug}-psn`)])
  );
}

// Match fetched Exophase awards (titled items with rarityPct) against the game's achievement list
// and return [{ name, percent }] keyed by the schema's own achievement ids.
function matchExophaseRarityToAchievements(achievements, items) {
  const keyMap = new Map();
  const keyDupes = new Set();
  const titleMap = new Map();
  const titleDupes = new Set();
  const register = (map, dupes, key, item) => {
    if (!key) return;
    if (map.has(key) && map.get(key) !== item) dupes.add(key);
    else map.set(key, item);
  };
  for (const item of Array.isArray(items) ? items : []) {
    const titles = item?.titles || {};
    const descriptions = item?.descriptions || {};
    for (const langKey of Object.keys(titles)) {
      register(keyMap, keyDupes, buildExophaseMatchKey(titles[langKey], descriptions[langKey] || ''), item);
      register(titleMap, titleDupes, normalizeExophaseMatchText(titles[langKey]), item);
    }
  }

  const out = [];
  for (const ach of Array.isArray(achievements) ? achievements : []) {
    if (!ach || ach.name == null) continue;
    const title = getSchemaLocalizedTextForRarity(ach.displayName);
    const description = getSchemaLocalizedTextForRarity(ach.description);
    let match = null;
    const key = buildExophaseMatchKey(title, description);
    if (key && !keyDupes.has(key)) match = keyMap.get(key) || null;
    if (!match) {
      const titleKey = normalizeExophaseMatchText(title);
      if (titleKey && !titleDupes.has(titleKey)) match = titleMap.get(titleKey) || null;
    }
    const percent = normalizeExophaseRarityPct(match?.rarityPct);
    if (!match || percent === null) continue;
    out.push({ name: String(ach.name), percent });
  }
  return out;
}

// High-level emulator rarity fetch: tries every slug candidate, then matches awards to the schema.
async function fetchExophaseRarity({ gameName = '', platform = 'rpcs3', achievements = [] } = {}) {
  const platformKey = mapExophasePlatform(platform);
  if (!platformKey) return [];
  const slugCandidates = buildExophaseRaritySlugCandidates(gameName, platform);
  let exo = null;
  let firstErr = null;
  for (const slug of slugCandidates) {
    try {
      const result = await fetchExophaseAchievementsMultiLang({
        slug,
        platform: platformKey,
        langKeys: ['english'],
        langMap: EXOPHASE_LANG_MAP,
      });
      if (result && result.items && result.items.length) {
        exo = result;
        break;
      }
    } catch (err) {
      firstErr = firstErr || err;
    }
  }
  if (!exo) throw firstErr || new Error('No working Exophase URL');
  return matchExophaseRarityToAchievements(achievements, exo.items);
}

module.exports.EXOPHASE_LANG_KEYS = EXOPHASE_LANG_KEYS;
module.exports.EXOPHASE_LANG_MAP = EXOPHASE_LANG_MAP;
module.exports.EXOPHASE_RARITY_SOURCE = EXOPHASE_RARITY_SOURCE;
module.exports.mapExophasePlatform = mapExophasePlatform;
module.exports.buildExophaseSlug = buildExophaseSlug;
module.exports.buildExophaseSlugVariants = buildExophaseSlugVariants;
module.exports.extractAchievementsFromHtml = extractAchievementsFromHtml;
module.exports.fetchExophaseAchievementsMultiLang = fetchExophaseAchievementsMultiLang;
module.exports.downloadExophaseIcon = downloadExophaseIcon;
module.exports.normalizeExophaseRarityPct = normalizeExophaseRarityPct;
module.exports.buildExophaseRaritySlugCandidates = buildExophaseRaritySlugCandidates;
module.exports.matchExophaseRarityToAchievements = matchExophaseRarityToAchievements;
module.exports.fetchExophaseRarity = fetchExophaseRarity;
