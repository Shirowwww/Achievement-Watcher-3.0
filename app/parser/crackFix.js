'use strict';

/*
  "Fixes & Bypasses" from the community CrakFiles list (KoriaPolis/CrakFiles), the same source SteaMidra
  uses. crackfiles.json is an array of:
    { buildid, name, source_crack:[url], original_download:[url], fixes:[{ href, filename, badges:[] }] }
  Matched by game NAME (there is no appid in the list), reusing AW's fuzzy name matcher. Its fixes are
  pixeldrain-hosted and auto-applicable; hostOf()/isApplicableHost() keep AW honest about any other host
  (which would be opened in a browser instead of auto-downloaded).

  IMPORTANT: this is a SEPARATE, complementary helper — it does NOT touch the emulated steam_api/GSE
  Fork setup that actually detects achievements. A community crack can overwrite steam_api(64).dll, so
  applying one may require re-running "Apply emulator fix" to restore achievement detection; the UI
  warns about this. Files this overwrites are backed up under <gameDir>/.aw-crackfix-backups/<ts>/.

  Automatic use (achievements.js autoApplyEmulatorFix, always tried unless emulator.autoApplyCrackFix is
  explicitly set false): applyBestFix
  is the high-level entry point. It only ever auto-commits a CONFIDENT name match (exact / strong token
  — same bar as fuzzyAppid.bestConfidentAppid), only applies an auto-installable (pixeldrain) fix, picks
  the best fix for the game's architecture, and writes an idempotency marker (.aw-crackfix-applied.json)
  so the same fix is never re-downloaded/re-applied on every scan. The emulator fix runs AFTER the crack
  so the GBE steam_api it installs is what survives — keeping achievement detection working.

  Renderer-side (request-zero / node-7z for zip|7z / node-unrar-js for the common .rar format the bundled
  7za can't open), but it also runs in the headless tray daemon's background auto-fix pass. Pure helpers
  (list fetch/match/pick, pixeldrain URL) are testable without the network.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('request-zero');
const fuzzy = require(path.join(__dirname, '..', 'util', 'fuzzyAppid.js'));

// Community fix list source(s), fetched + merged (one for now; the loop keeps adding another trivial).
// Each entry is tagged with its `_source`.
const LIST_SOURCES = [
  { name: 'CrakFiles', url: 'https://raw.githubusercontent.com/KoriaPolis/CrakFiles/main/crackfiles.json' },
];
const LIST_TTL_MS = 6 * 60 * 60 * 1000; // re-fetch the lists at most every 6h

// Auto-updating pixeldrain proxy list (LAST-RESORT download fallback only — see downloadAndApply). When
// BOTH pixeldrain-owned hosts (.com + .net) fail for a file, AW can fall back to a community proxy that
// re-serves the pixeldrain CDN past the rate limit. Those proxy domains die/rotate over time (the old
// `cdn.pd8.workers.dev` was taken down), so instead of hardcoding one we pull the current list from the
// same auto-updating source the "Pixeldrain Download Bypass Enhanced" userscript uses, cached for 24h
// (matching that script) with a stale-cache + hardcoded fallback. Kept last in the host order so the vast
// majority of downloads go through pixeldrain itself and never touch a third party.
const PIXELDRAIN_PROXY_LIST_URL = 'https://pixeldrain-bypass.gamedrive.org/api/proxy.json';
const PIXELDRAIN_PROXY_TTL_MS = 24 * 60 * 60 * 1000;
const PIXELDRAIN_PROXY_FALLBACK = ['https://cdn.pixeldrain.eu.cc/']; // used only if the list fetch + cache both fail

const noopLog = { log() {}, error() {} };

function resolveUnpackedBinary(binPath) {
  const normalized = String(binPath || '');
  const unpacked = normalized.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : normalized;
}

// Extract the file id from a pixeldrain "view" link (pixeldrain.com/u/<id>), or null.
function pixeldrainFileId(href) {
  const m = String(href || '').match(/pixeldrain\.com\/u\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

// Convert a pixeldrain "view" link (pixeldrain.com/u/<id>) to its direct-download API URL. Other
// hosts (cs.rin.ru, etc.) are returned as-is — they usually need a browser, so the UI opens them.
function pixeldrainDirectUrl(href) {
  const id = pixeldrainFileId(href);
  return id ? `https://pixeldrain.com/api/file/${id}?download` : null;
}

// Map a pixeldrain `availability` code to a short human reason.
function availabilityMessage(reason) {
  const r = String(reason || '');
  if (/rate_limited|captcha/i.test(r)) return 'pixeldrain rate-limited this file (captcha / paid download required)';
  if (/virus/i.test(r)) return 'pixeldrain flagged this file and blocks direct download';
  return `pixeldrain blocked this file (${r})`;
}

// Pixeldrain throttles heavily-downloaded ("hotlinked") files: once a file is flagged, the direct API
// download returns 403 (`file_rate_limited_captcha_required`, `virus_detected`, …) and only a browser
// (captcha) or a paid account can fetch it — a Referer/User-Agent won't help. The /info endpoint reports
// this up-front via `availability` ('' = freely downloadable), so we probe it before attempting a
// download and surface an actionable error instead of a bare 403. Returns { available, reason }; a probe
// that can't reach /info is treated as available (don't block on a transient failure — let the download
// try and fail loudly).
async function pixeldrainAvailability(href, { log = noopLog } = {}) {
  const id = pixeldrainFileId(href);
  if (!id) return { available: true, reason: '' };
  try {
    const info = await request.getJson(`https://pixeldrain.com/api/file/${id}/info`, { timeout: 15000 });
    const reason = (info && info.availability) || '';
    return { available: !reason, reason };
  } catch (e) {
    log.log(`[crackfix] pixeldrain availability probe failed (${id}) => ${e && (e.message || e)}`);
    return { available: true, reason: '' };
  }
}

// Normalise a proxy entry from proxy.json ("cdn.pixeldrain.eu.cc", "https://x/", …) to an absolute base
// URL ending in "/", so `<base><fileId>` is a valid download URL. Returns null for junk entries.
function normalizeProxyBase(entry) {
  if (!entry || typeof entry !== 'string') return null;
  let e = entry.trim();
  if (!e) return null;
  if (!/^https?:\/\//i.test(e)) e = `https://${e}`;
  return e.endsWith('/') ? e : `${e}/`;
}

// Fetch the auto-updating pixeldrain proxy list (see PIXELDRAIN_PROXY_LIST_URL), cached in
// <cacheDir>/pixeldrain-proxies.json for PIXELDRAIN_PROXY_TTL_MS. Order of preference: fresh cache →
// remote fetch → stale cache → hardcoded PIXELDRAIN_PROXY_FALLBACK. Returns an array of base URLs
// (possibly empty if everything fails and there's no fallback). Never throws.
async function fetchPixeldrainProxies({ cacheDir, force = false, log = noopLog } = {}) {
  const cacheFile = cacheDir ? path.join(cacheDir, 'pixeldrain-proxies.json') : null;
  if (cacheFile && !force) {
    try {
      if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < PIXELDRAIN_PROXY_TTL_MS) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(cached) && cached.length) return cached;
      }
    } catch {
      /* corrupt cache — refetch */
    }
  }
  try {
    const json = await request.getJson(PIXELDRAIN_PROXY_LIST_URL, { timeout: 15000 });
    let list = [];
    if (json && Array.isArray(json.proxies)) list = json.proxies;
    else if (Array.isArray(json)) list = json;
    else if (json && typeof json.proxy === 'string') list = [json.proxy];
    const normalized = [...new Set(list.map(normalizeProxyBase).filter(Boolean))];
    if (normalized.length) {
      if (cacheFile) {
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(cacheFile, JSON.stringify(normalized));
        } catch {
          /* cache write is best-effort */
        }
      }
      return normalized;
    }
  } catch (e) {
    log.log(`[crackfix] pixeldrain proxy list fetch failed => ${e && (e.message || e)}`);
  }
  // remote down/empty — fall back to the last good cache, then the hardcoded list
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached) && cached.length) return cached;
    } catch {
      /* ignore */
    }
  }
  return PIXELDRAIN_PROXY_FALLBACK.map(normalizeProxyBase).filter(Boolean);
}

// Which file host a fix href points at → 'pixeldrain' | 'buzzheavier' | 'vikingfile' | null. Lets the
// UI label a fix and decide download vs open-in-browser.
function hostOf(href) {
  const h = String(href || '');
  if (/pixeldrain\.com/i.test(h)) return 'pixeldrain';
  if (/buzzheavier\.com/i.test(h)) return 'buzzheavier';
  if (/vikingfile\.com/i.test(h)) return 'vikingfile';
  return null;
}

// True only for hosts AW can download without a browser — pixeldrain. Any other host (buzzheavier, which
// is behind a Cloudflare challenge headless automation can't clear; vikingfile; cs.rin.ru; …) is surfaced
// to the UI to open in a browser instead of silently failing.
function isApplicableHost(href) {
  return hostOf(href) === 'pixeldrain';
}

// One source, two attempts. Returns the parsed array, or null when the source errored (distinct from a
// legitimately empty list) so the caller can tell "all sources down" from "lists are empty".
async function fetchOne(url, log) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await request.getJson(url, { timeout: 20000 });
      return Array.isArray(data) ? data : [];
    } catch (e) {
      lastErr = e;
    }
  }
  log.log(`[crackfix] list fetch failed (${url}) => ${lastErr && (lastErr.message || lastErr)}`);
  return null;
}

// Fetch + merge every LIST_SOURCES list, tagging each entry with its `_source`. Cached as one merged
// crackfiles.json. Returns [] only when all sources error AND no cache exists.
async function fetchList({ cacheDir, force = false, log = noopLog } = {}) {
  const cacheFile = cacheDir ? path.join(cacheDir, 'crackfiles.json') : null;
  if (cacheFile && !force) {
    try {
      if (fs.existsSync(cacheFile) && Date.now() - fs.statSync(cacheFile).mtimeMs < LIST_TTL_MS) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (Array.isArray(cached)) return cached;
      }
    } catch {
      /* corrupt cache — refetch */
    }
  }
  const merged = [];
  let anyOk = false;
  for (const src of LIST_SOURCES) {
    const list = await fetchOne(src.url, log);
    if (list === null) continue; // this source errored — keep whatever the others give
    anyOk = true;
    for (const entry of list) if (entry && entry.name) merged.push({ ...entry, _source: src.name });
  }
  if (anyOk) {
    if (cacheFile && merged.length) {
      try {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(merged));
      } catch {
        /* cache write is best-effort */
      }
    }
    return merged;
  }
  // every source down — fall back to the last good cache
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(cached)) return cached;
    } catch {
      /* ignore */
    }
  }
  return [];
}

// Rank CrakFiles entries against a game name (reusing the fuzzy AppID matcher over entry names).
// Returns the best matching entries, best first, each with a _score/_tier.
function findFixes(list, gameName, { limit = 5 } = {}) {
  if (!Array.isArray(list) || !gameName) return [];
  const apps = list.map((entry, i) => ({ appid: i, name: entry && entry.name }));
  const ranked = fuzzy.rankAppidCandidates(gameName, apps, { limit, minScore: 0.5 });
  return ranked.map((r) => ({ ...list[r.appid], _score: r.score, _tier: r.tier }));
}

// The single best entry for AUTOMATIC use, or null. Unlike findFixes (which returns ranked candidates
// for the user to confirm, accepting fuzzy hits), this only trusts a high-confidence match — an exact
// normalized-name equality or a near-length token containment — exactly the bar fuzzyAppid uses before
// it will auto-write a steam_appid. A fuzzy guess is never auto-cracked. Requires the entry to actually
// carry at least one fix. Returns { entry, score, tier } or null.
function findBestMatch(list, gameName) {
  if (!Array.isArray(list) || !gameName) return null;
  const apps = list.map((entry, i) => ({ appid: i, name: entry && entry.name }));
  const ranked = fuzzy.rankAppidCandidates(gameName, apps, { limit: 10, minScore: 0.6 });
  const hit = ranked.find((r) => r.tier === 'exact') || ranked.find((r) => r.tier === 'token' && r.score >= 0.9);
  if (!hit) return null;
  const entry = list[hit.appid];
  if (!entry || !Array.isArray(entry.fixes) || entry.fixes.length === 0) return null;
  return { entry, score: hit.score, tier: hit.tier };
}

function uniqueGameNames(names) {
  const raw = Array.isArray(names) ? names : [names];
  const out = [];
  for (const value of raw) {
    const name = String(value || '').trim();
    if (!name || out.some((existing) => existing.toLowerCase() === name.toLowerCase())) continue;
    out.push(name);
  }
  return out;
}

// Automatic CrakFiles lookup can safely try several local names (AW title, install folder, main exe)
// while keeping findBestMatch's strict confidence gate for each one.
function findBestMatchForNames(list, gameNames) {
  for (const name of uniqueGameNames(gameNames)) {
    const match = findBestMatch(list, name);
    if (match) return { ...match, matchedName: name };
  }
  return null;
}

const ARCH_HINT = {
  x64: /(x64|win64|64\s*bit|64-bit|amd64)/,
  x86: /(x86|win32|32\s*bit|32-bit|ia32)/,
};

// Pick the best single fix from an entry's `fixes` array (which can hold several variants: a full
// crack, a steam_api emu, an arch-specific build, an "update only" file, etc.). Ranking, high → low:
//   * auto-installable (a pixeldrain link AW can download+apply) over a host that needs a browser
//   * matches the game's architecture when `arch` is known (and penalised for the opposite arch)
//   * looks like a real crack/bypass/emu over a bare "update"
// With requireApplicable, non-pixeldrain fixes are excluded entirely (the automatic path can only act
// on links it can fetch). Ties keep the first listed (the list's own preferred order). Returns a fix
// object or null.
function pickBestFix(entry, { arch = null, requireApplicable = false } = {}) {
  if (!entry || !Array.isArray(entry.fixes)) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const fix of entry.fixes) {
    if (!fix || !fix.href) continue;
    const applicable = isApplicableHost(fix.href);
    if (requireApplicable && !applicable) continue;
    let score = applicable ? 100 : 0;
    const hay = `${fix.filename || ''} ${Array.isArray(fix.badges) ? fix.badges.join(' ') : ''}`.toLowerCase();
    if (arch === 'x64' || arch === 'x86') {
      const other = arch === 'x64' ? 'x86' : 'x64';
      if (ARCH_HINT[arch].test(hay)) score += 10;
      if (ARCH_HINT[other].test(hay)) score -= 5;
    }
    if (/(crack|bypass|emu|goldberg|steamless|fix)/.test(hay)) score += 5;
    if (/\bupdate\b/.test(hay) && !/(crack|bypass)/.test(hay)) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = fix;
    }
  }
  return best;
}

// Idempotency marker so an already-applied community fix is never silently re-downloaded and
// re-overwritten on every background scan. One JSON file at the game root listing each fix applied,
// keyed by filename+href so a genuinely different/newer fix still applies.
const MARKER_FILE = '.aw-crackfix-applied.json';
function markerPath(gameDir) {
  return path.join(gameDir, MARKER_FILE);
}
function fixKey(fix) {
  return `${String((fix && fix.filename) || '').toLowerCase()}|${String((fix && fix.href) || '').toLowerCase()}`;
}
function readMarker(gameDir) {
  try {
    const m = JSON.parse(fs.readFileSync(markerPath(gameDir), 'utf8'));
    return m && Array.isArray(m.applied) ? m : { applied: [] };
  } catch {
    return { applied: [] };
  }
}
function isAlreadyApplied(gameDir, fix) {
  const key = fixKey(fix);
  return readMarker(gameDir).applied.some((a) => a && a.key === key);
}
function recordApplied(gameDir, fix, info = {}) {
  const m = readMarker(gameDir);
  const key = fixKey(fix);
  m.applied = m.applied.filter((a) => a && a.key !== key);
  m.applied.push({
    key,
    name: info.name || null,
    filename: (fix && fix.filename) || null,
    href: (fix && fix.href) || null,
    appliedAt: new Date().toISOString(),
    files: info.files || [],
    backupDir: info.backupDir || null,
  });
  try {
    fs.writeFileSync(markerPath(gameDir), JSON.stringify(m, null, 2));
  } catch {
    /* marker is best-effort */
  }
}

function ts() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/*
  Download a single fix and apply it into the game folder. Files that already exist are backed up to
  <gameDir>/.aw-crackfix-backups/<ts>/ before being overwritten. Returns { applied:[...], backupDir }.

  fix       one entry from a CrakFiles `fixes` array ({ href, filename })
  gameDir   the game install folder
  cacheDir  scratch/download dir
  entryName the matched CrakFiles entry name, recorded in the idempotency marker (optional)
*/
async function downloadAndApply({ fix, gameDir, cacheDir, entryName = '', proxyFallback = true, log = noopLog } = {}) {
  if (!fix || !fix.href) throw new Error('crackfix: fix has no download link');
  if (!gameDir || !fs.existsSync(gameDir)) throw new Error(`crackfix: game folder not found: ${gameDir}`);
  if (!isApplicableHost(fix.href)) throw new Error('crackfix: this host needs a browser — open the page instead');
  const fileId = pixeldrainFileId(fix.href);
  if (!fileId) throw new Error('crackfix: malformed pixeldrain link');

  // pixeldrain.net is the same CDN as pixeldrain.com but is NOT subject to .com's hotlink/rate-limit
  // gate, so it doubles as a fallback when a popular file 403s on .com. Probe availability to choose the
  // host order: a rate-limited file goes straight to the .net mirror (skipping the doomed — and
  // internally-retried — .com hit); an available file uses .com first with .net as a backup.
  const avail = await pixeldrainAvailability(fix.href, { log });
  const officialHosts = avail.available ? ['pixeldrain.com', 'pixeldrain.net'] : ['pixeldrain.net', 'pixeldrain.com'];
  const candidates = officialHosts.map((host) => ({ label: host, url: `https://${host}/api/file/${fileId}?download` }));

  // LAST RESORT only: if BOTH pixeldrain-owned hosts fail (e.g. a rate-limited file with no captcha-free
  // path), fall back to the auto-updating community proxy list. These are third-party — kept strictly
  // last so a normal download never routes through one. Disabled with proxyFallback:false.
  if (proxyFallback) {
    try {
      const proxies = await fetchPixeldrainProxies({ cacheDir, log });
      for (const base of proxies) candidates.push({ label: `proxy ${base}`, url: `${base}${fileId}` });
    } catch (e) {
      log.log(`[crackfix] proxy list unavailable => ${e && (e.message || e)}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-crackfix-'));
  try {
    let dl = null;
    let lastErr = null;
    for (const cand of candidates) {
      try {
        log.log(`[crackfix] downloading ${fix.filename || fix.href} via ${cand.label}`);
        const r = await request.download(cand.url, tmpDir);
        if (r && r.path) {
          dl = r;
          break;
        }
      } catch (e) {
        lastErr = e;
        log.log(`[crackfix] ${cand.label} download failed => ${e && (e.message || e)}`);
      }
    }
    if (!dl || !dl.path) {
      // Every host (incl. proxies) failed. If pixeldrain had flagged the file, report it as the actionable
      // rate-limit case so the UI offers "open the page"; otherwise it's a plain download failure.
      if (!avail.available) {
        const err = new Error(`crackfix: ${availabilityMessage(avail.reason)} — open the page to download it manually`);
        err.code = 'PIXELDRAIN_UNAVAILABLE';
        err.availability = avail.reason;
        err.href = fix.href;
        throw err;
      }
      throw new Error(`crackfix: download failed${lastErr ? ` => ${lastErr.message || lastErr}` : ''}`);
    }
    // Hand the downloaded archive to the shared extract-and-apply path (same logic the manual
    // "I downloaded it myself" flow uses).
    return await applyLocalArchive({ archivePath: dl.path, gameDir, fix, entryName, log });
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/*
  Extract any supported crack archive into destDir, preserving its internal directory layout. RAR is the
  most common CrakFiles format and the bundled 7za CANNOT open RAR (it's the reduced standalone build), so
  .rar is routed through node-unrar-js (the same WASM lib apiCheckBypass already uses for RAR5); .zip/.7z/
  .tar/etc. go through node-7z + the bundled 7za. Throws on failure / empty archive.
*/
// Run the node-unrar-js (WASM) RAR extraction directly, writing every entry to destDir with its nested
// layout preserved. MUST run in a Node context (Electron main process or the watchdog) — NEVER the
// Chromium renderer: node-unrar-js's Emscripten/Embind glue calls `new Function()`, which the renderer's
// strict CSP forbids (and 'wasm-unsafe-eval' does NOT cover `new Function`). extractArchive() routes a
// renderer call here over IPC instead. Throws on an empty/garbage archive.
async function extractRarToDir(archivePath, destDir, { log = noopLog } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  log.log(`[crackfix] extracting RAR via node-unrar-js → ${destDir}`);
  const { createExtractorFromFile } = require('node-unrar-js');
  const extractor = await createExtractorFromFile({ filepath: archivePath, targetPath: destDir });
  // node-unrar-js is lazy: iterating the generator is what actually writes each entry to disk. Count real
  // files so an empty/corrupt archive fails loudly.
  let files = 0;
  for (const entry of extractor.extract().files) {
    if (entry && entry.fileHeader && !entry.fileHeader.flags.directory) files++;
  }
  if (files === 0) throw new Error('crackfix: RAR archive contained no files (corrupt or wrong password?)');
}

async function extractArchive(archivePath, destDir, { log = noopLog } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(archivePath).toLowerCase();
  if (ext === '.rar') {
    // RAR → node-unrar-js (WASM). In a renderer the CSP blocks it (`new Function`), so delegate the
    // extraction to the main process (no CSP) over IPC; in main / the watchdog (plain Node) run it here.
    if (typeof process !== 'undefined' && process.type === 'renderer') {
      const { ipcRenderer } = require('electron');
      const res = await ipcRenderer.invoke('crackfix-extract-rar', { archivePath, destDir });
      if (res && res.error) throw new Error(res.error);
      return;
    }
    return extractRarToDir(archivePath, destDir, { log });
  }
  const Seven = require('node-7z');
  const sevenBin = resolveUnpackedBinary(require('7zip-bin').path7za);
  if (!fs.existsSync(sevenBin)) throw new Error(`7za.exe not found at "${sevenBin}"`);
  await new Promise((resolve, reject) => {
    const stream = Seven.extractFull(archivePath, destDir, { $bin: sevenBin });
    stream.on('end', resolve);
    stream.on('error', reject);
  });
}

/*
  Extract an already-downloaded crack archive (.rar/.zip/.7z) and apply its files into the game folder —
  the local-file counterpart of downloadAndApply's second half, factored out so both share one code path.
  This is what powers the "pixeldrain wants a captcha → open the page, download it yourself, then point AW
  at the file" flow: the human solves the captcha, AW still does the tedious part (extract + back up
  overwritten files under <gameDir>/.aw-crackfix-backups/<ts>/ + install + idempotency marker).

  archivePath  path to the downloaded archive on disk
  gameDir      the game install folder
  fix          the CrakFiles fix object, for the idempotency marker (optional — synthesized from the file
               name when absent, e.g. a manually-picked archive)
  entryName    matched CrakFiles entry name recorded in the marker (optional)
  Returns { applied:[...], backedUp, backupDir }.
*/
async function applyLocalArchive({ archivePath, gameDir, fix = null, entryName = '', log = noopLog } = {}) {
  if (!archivePath || !fs.existsSync(archivePath)) throw new Error(`crackfix: archive not found: ${archivePath}`);
  if (!gameDir || !fs.existsSync(gameDir)) throw new Error(`crackfix: game folder not found: ${gameDir}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-crackfix-extract-'));
  try {
    const extractDir = path.join(tmpDir, 'extracted');
    log.log(`[crackfix] extracting ${path.basename(archivePath)} → applying into ${gameDir}`);
    await extractArchive(archivePath, extractDir, { log });

    const backupDir = path.join(gameDir, '.aw-crackfix-backups', ts());
    const applied = [];
    let backedUp = 0;
    const walk = (relDir) => {
      for (const entry of fs.readdirSync(path.join(extractDir, relDir), { withFileTypes: true })) {
        const rel = path.join(relDir, entry.name);
        if (entry.isDirectory()) {
          walk(rel);
        } else {
          const dest = path.join(gameDir, rel);
          if (fs.existsSync(dest)) {
            const bak = path.join(backupDir, rel);
            fs.mkdirSync(path.dirname(bak), { recursive: true });
            fs.copyFileSync(dest, bak);
            backedUp++;
          }
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(path.join(extractDir, rel), dest);
          applied.push(rel);
        }
      }
    };
    walk('');
    const result = { applied, backedUp, backupDir: backedUp > 0 ? backupDir : null };
    // Record what we applied so a later automatic pass skips re-applying. A manually-picked archive may
    // not carry a CrakFiles fix object; synthesize a marker key from the file name so it stays idempotent.
    const markerFix = fix && fix.href ? fix : { filename: path.basename(archivePath), href: `local:${path.basename(archivePath)}` };
    recordApplied(gameDir, markerFix, { name: entryName || path.basename(archivePath), files: applied, backupDir: result.backupDir });
    return result;
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/*
  High-level automatic entry point used by the per-scan / background auto-fix flow. Fetches (or reuses)
  the list, finds a CONFIDENT name match, picks the best auto-installable fix for the game's arch, skips
  it if the same fix was already applied, then downloads + applies it. Every "did nothing" path returns
  a structured reason instead of throwing, so the caller can log it and continue with the emulator fix.

  list      pre-fetched crackfiles.json (optional; fetched via cacheDir when omitted — lets tests run
            offline)
  gameName  the game's display name (matched against entry names)
  gameNames optional local name candidates (display name, folder name, exe basename)
  gameDir   the game install folder (also where the idempotency marker lives)
  arch      'x64' | 'x86' | null — biases fix selection toward the matching-arch build
  force     re-apply even if the marker shows this exact fix was already applied
  cacheDir  list cache + download scratch dir

  Returns one of:
    { applied:true, entry, fix, files:[...], backedUp, backupDir }
    { applied:false, skipped:true, reason:'already-applied', entry, fix }
    { applied:false, reason:'no-game-name' | 'no-game-dir' | 'no-confident-match' }
    { applied:false, reason:'no-applicable-fix', entry, fixes }   (a match exists but only via links
                                                                    that need a browser — caller may
                                                                    surface it to the user)
*/
async function applyBestFix({ list = null, cacheDir, gameName, gameNames = [], gameDir, arch = null, force = false, proxyFallback = true, log = noopLog } = {}) {
  const names = uniqueGameNames([...(Array.isArray(gameNames) ? gameNames : [gameNames]), gameName]);
  if (names.length === 0) return { applied: false, reason: 'no-game-name' };
  if (!gameDir || !fs.existsSync(gameDir)) return { applied: false, reason: 'no-game-dir' };
  const entries = Array.isArray(list) ? list : await fetchList({ cacheDir, log });
  const match = findBestMatchForNames(entries, names);
  if (!match) return { applied: false, reason: 'no-confident-match', names };
  const fix = pickBestFix(match.entry, { arch, requireApplicable: true });
  if (!fix) return { applied: false, reason: 'no-applicable-fix', entry: match.entry, fixes: match.entry.fixes || [], matchedName: match.matchedName };
  if (!force && isAlreadyApplied(gameDir, fix)) {
    return { applied: false, skipped: true, reason: 'already-applied', entry: match.entry, fix, matchedName: match.matchedName };
  }
  try {
    const res = await downloadAndApply({ fix, gameDir, cacheDir, entryName: match.entry.name, proxyFallback, log });
    return { applied: true, entry: match.entry, fix, files: res.applied, backedUp: res.backedUp, backupDir: res.backupDir, matchedName: match.matchedName };
  } catch (e) {
    // A pixeldrain-rate-limited file can't be auto-downloaded; surface it as a structured reason (with the
    // href to open in a browser) instead of throwing, so the background pass logs it and continues.
    if (e && e.code === 'PIXELDRAIN_UNAVAILABLE') {
      return { applied: false, reason: 'pixeldrain-unavailable', availability: e.availability, entry: match.entry, fix, href: fix.href, matchedName: match.matchedName };
    }
    throw e;
  }
}

module.exports = {
  fetchList,
  findFixes,
  findBestMatch,
  findBestMatchForNames,
  pickBestFix,
  pixeldrainDirectUrl,
  pixeldrainFileId,
  pixeldrainAvailability,
  normalizeProxyBase,
  fetchPixeldrainProxies,
  hostOf,
  isApplicableHost,
  downloadAndApply,
  extractRarToDir,
  applyLocalArchive,
  applyBestFix,
  isAlreadyApplied,
};
