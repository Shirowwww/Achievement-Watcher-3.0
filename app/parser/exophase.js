'use strict';

// Exophase multi-language achievement metadata source. Exophase serves localized achievement
// names + descriptions (~30 languages, keyed by the same API language names Steam uses) for
// Steam/GOG/console games, which makes it a supplemental source for (a) key-less users whose
// schema scrape returned blank descriptions and (b) emulator platforms (RPCS3/Xenia/ShadPS4)
// that have no localized descriptions at all.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/exophase-scraper.js — MIT-licensed; see
// THIRD_PARTY_NOTICES.md. Rewritten for Achievement Watcher: the upstream Playwright + cheerio stack is
// replaced by a static request-zero fetch parsed with node-html-parser (Exophase serves the
// award list as static HTML), with a puppeteer-extra + stealth fallback (both already bundled
// for the SteamHunters scrape) when the static fetch is blocked. No new dependencies.
//
// This is a schema-enrichment source, not a save-file parser: there is no local directory to
// scan and no unlock state to read, so the scan/getGameData/getAchievements parts of the parser
// contract intentionally don't apply (same category as util/rarity.js).

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

// Fetch the achievement list in one or more languages.
//
// options:
//   platform       'steam' | 'gog' | 'rpcs3' | 'xenia' | 'shadps4' | native exophase suffix
//   title          game name — slug candidates are derived from it (or pass slugCandidates)
//   slugCandidates optional explicit slug list (see buildExophaseSlugVariants)
//   langKeys       Steam API language names to fetch (default: all known); english is always
//                  fetched first as the baseline
//
// Returns { baseUrl, gameTitle, items: [{ index, titles: {lang: ...}, descriptions: {lang: ...},
// icon_url }] }. A language whose page just serves the english text again is skipped, so its key
// is absent — callers should fall back to `english`. Throws when no slug candidate resolves.
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

module.exports.EXOPHASE_LANG_KEYS = EXOPHASE_LANG_KEYS;
module.exports.EXOPHASE_LANG_MAP = EXOPHASE_LANG_MAP;
module.exports.mapExophasePlatform = mapExophasePlatform;
module.exports.buildExophaseSlug = buildExophaseSlug;
module.exports.buildExophaseSlugVariants = buildExophaseSlugVariants;
module.exports.extractAchievementsFromHtml = extractAchievementsFromHtml;
module.exports.fetchExophaseAchievementsMultiLang = fetchExophaseAchievementsMultiLang;
module.exports.downloadExophaseIcon = downloadExophaseIcon;
