'use strict';

/*
  Optional SteamAutoCrack "Steam API Check Bypass": a proxy DLL + JSON rules that redirect the game's
  integrity checks back to the original DLL/exe and hide steam_settings. Off by default; does not help
  PlayStation-PSPC titles. RAR extraction is routed to the main process.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('request-zero');
const pe = require(path.join(__dirname, '..', 'util', 'pe.js'));

const RELEASE_API = 'https://api.github.com/repos/SteamAutoCracks/Steam-API-Check-Bypass/releases/latest';
const RECHECK_TTL_MS = 24 * 60 * 60 * 1000; // ask GitHub for a newer bypass build at most once per day
const USER_AGENT = 'Achievement-Watcher';

// The two prebuilt proxy DLLs inside the release RAR. x64 = SteamAPICheckBypass.dll, x86 = _x32.
const BYPASS_DLL = { x64: 'SteamAPICheckBypass.dll', x86: 'SteamAPICheckBypass_x32.dll' };
// Valid hijack names the proxy can masquerade as; winmm is SteamAutoCrack's default.
const HIJACK_NAMES = ['winmm.dll', 'version.dll', 'winhttp.dll'];
// steam_settings entries hidden from the game's own checks (verbatim from SteamAutoCrack).
const STEAM_SETTINGS_FILES = [
  'achievements.json', 'branches.json', 'configs.app.ini', 'configs.main.ini', 'configs.overlay.ini',
  'configs.user.ini', 'default_items.json', 'items.json', 'stats.txt', 'steam_appid.txt',
  'supported_languages.txt', 'achievement_images',
];

const noopLog = { log() {}, error() {} };

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

// Cached pair for a tag (under <cacheDir>/<tag>/), or null if not both present.
function cachedDlls(cacheDir, tag) {
  if (!tag) return null;
  const dir = path.join(cacheDir, tag);
  const x64 = path.join(dir, BYPASS_DLL.x64);
  const x86 = path.join(dir, BYPASS_DLL.x86);
  return fs.existsSync(x64) && fs.existsSync(x86) ? { tag, dir, x64, x86 } : null;
}

// Pick the two bypass DLLs out of a node-unrar-js extraction result. Pure (no I/O) so it can be
// unit-tested without a real RAR fixture; `files` is node-unrar-js's `extractor.extract({...}).files`.
function pickBypassDllEntries(files) {
  const picked = [];
  for (const file of files || []) {
    if (!file || !file.extraction) continue;
    const base = path.basename(file.fileHeader.name);
    if (base === BYPASS_DLL.x64 || base === BYPASS_DLL.x86) {
      picked.push({ name: base, data: Buffer.from(file.extraction) });
    }
  }
  return picked;
}

// Extract the proxy DLLs from the release RAR5 with node-unrar-js, loaded lazily. Must run in a Node
// context: its Emscripten glue uses new Function(), which the renderer CSP forbids — a renderer goes
// through extractDllsFromRar / the IPC handler.
async function extractDllsFromRarDirect(rarPath, destDir) {
  const { createExtractorFromData } = require('node-unrar-js');
  const buf = fs.readFileSync(rarPath);
  const extractor = await createExtractorFromData({ data: Uint8Array.from(buf).buffer });
  const names = [...extractor.getFileList().fileHeaders].filter((h) => !h.flags.directory).map((h) => h.name);
  const extracted = extractor.extract({ files: names });
  const picked = pickBypassDllEntries([...extracted.files]);
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of picked) fs.writeFileSync(path.join(destDir, entry.name), entry.data);
  return picked.length;
}

// Renderer-safe entry point: delegates the actual extraction to the main process over IPC (CSP blocks
// node-unrar-js in the renderer — see extractDllsFromRarDirect); runs directly in main/plain-Node.
async function extractDllsFromRar(rarPath, destDir) {
  if (typeof process !== 'undefined' && process.type === 'renderer') {
    const { ipcRenderer } = require('electron');
    const res = await ipcRenderer.invoke('apicheckbypass-extract-rar', { rarPath, destDir });
    if (res && res.error) throw new Error(res.error);
    return (res && res.wrote) || 0;
  }
  return extractDllsFromRarDirect(rarPath, destDir);
}

async function downloadAndCache(cacheDir, tag, rarUrl) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-bypass-'));
  try {
    const dl = await request.download(rarUrl, tmpDir);
    if (!dl || !dl.path) throw new Error('download produced no file');
    const destDir = path.join(cacheDir, tag);
    const wrote = await extractDllsFromRar(dl.path, destDir);
    if (wrote < 2) throw new Error('release RAR did not contain both bypass DLLs');
    fs.writeFileSync(path.join(cacheDir, 'latest.txt'), tag);
    fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    return cachedDlls(cacheDir, tag);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

/*
  Ensure the bypass proxy DLLs are available locally and return { tag, dir, x64, x86 }. Hits GitHub at
  most once per day; falls back to whatever is cached on any failure (so a one-time download then works
  offline). Throws only when nothing is cached and the download fails.
*/
async function ensureBypassDlls({ cacheDir, force = false, log = noopLog } = {}) {
  if (!cacheDir) throw new Error('ensureBypassDlls: cacheDir is required');
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachedTag = readText(path.join(cacheDir, 'latest.txt'));
  const lastCheck = parseInt(readText(path.join(cacheDir, '.last-check')), 10) || 0;
  const fresh = Date.now() - lastCheck < RECHECK_TTL_MS;
  const cached = cachedDlls(cacheDir, cachedTag);
  if (cached && fresh && !force) return cached;

  let release;
  try {
    release = await request.getJson(RELEASE_API, { headers: { 'User-Agent': USER_AGENT }, timeout: 30000 });
  } catch (e) {
    if (cached) {
      log.log(`[bypass] GitHub unreachable (${e.message || e}); using cached build ${cachedTag}`);
      return cached;
    }
    throw new Error(`Could not reach GitHub to fetch the Steam API Check Bypass: ${e.message || e}`);
  }

  const tag = release && release.tag_name ? release.tag_name : null;
  const asset = release && Array.isArray(release.assets) ? release.assets.find((a) => /\.rar$/i.test(a.name)) : null;
  if (!tag || !asset || !asset.browser_download_url) {
    if (cached) return cached;
    throw new Error('Steam API Check Bypass release has no .rar asset');
  }
  if (cached && tag === cachedTag && !force) {
    fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    return cached;
  }
  log.log(`[bypass] downloading Steam API Check Bypass ${tag}`);
  return downloadAndCache(cacheDir, tag, asset.browser_download_url);
}

/*
  Build SteamAPICheckBypass.json (pure): redirects the exe to its backup and steam_api to <dll>.bak,
  hides steam_settings, using Windows-relative paths per SteamAutoCrack's rules.
*/
function buildBypassConfig({ exeName, exeBackup = null, steamApiDlls = [], mode = 'nth_time_only', nthTimes = [1] } = {}) {
  const cfg = {};
  if (exeName && exeBackup) {
    cfg[exeName] = { mode: 'file_redirect', to: exeBackup, file_must_exist: true };
  }
  for (const dll of steamApiDlls) {
    const dir = path.win32.dirname(dll);
    const settingsDir = dir === '.' ? 'steam_settings' : path.win32.join(dir, 'steam_settings');
    cfg[settingsDir] = { mode: 'file_hide' };
    for (const f of STEAM_SETTINGS_FILES) {
      cfg[path.win32.join(settingsDir, f)] = { mode: 'file_hide', hook_times_mode: 'not_nth_time_only', hook_time_n: '1' };
    }
    const rule = { mode: 'file_redirect', to: `${dll}.bak`, file_must_exist: true };
    if (mode !== 'all') {
      rule.hook_times_mode = mode;
      rule.hook_time_n = nthTimes;
    }
    cfg[dll] = rule;
  }
  return cfg;
}

// Find the kept exe backup AW left next to the exe (Steamless writes <exe>.steamstub.bak; some flows
// keep a plain <exe>.bak). Returns the basename or null.
function findExeBackup(exePath) {
  for (const suffix of ['.steamstub.bak', '.bak']) {
    if (fs.existsSync(exePath + suffix)) return path.basename(exePath) + suffix;
  }
  return null;
}

/*
  Apply the bypass to a game folder: drop the arch-matching proxy DLL under the hijack name and write
  SteamAPICheckBypass.json beside the exe. No-op when a hijack DLL already exists.
*/
function applyBypass({ gameDir, exePath, dlls, dllVariant = 'winmm', mode = 'nth_time_only', nthTimes = [1], log = noopLog } = {}) {
  if (!dlls || !dlls.x64 || !dlls.x86) throw new Error('applyBypass: bypass DLLs unavailable');
  if (!exePath || !fs.existsSync(exePath)) throw new Error(`applyBypass: game exe not found: ${exePath}`);
  const exeDir = path.dirname(exePath);

  for (const name of HIJACK_NAMES) {
    if (fs.existsSync(path.join(exeDir, name))) {
      log.log(`[bypass] ${name} already present beside the exe — skipping (won't clobber an existing proxy/real DLL)`);
      return { applied: false, reason: 'hijack-dll-exists' };
    }
  }

  const arch = pe.exeArch(exePath) === 'x86' ? 'x86' : 'x64';
  const src = dlls[arch];
  const targetName = HIJACK_NAMES.includes(`${dllVariant}.dll`) ? `${dllVariant}.dll` : 'winmm.dll';
  fs.copyFileSync(src, path.join(exeDir, targetName));

  const steamApiDlls = fs
    .readdirSync(exeDir)
    .filter((f) => /^steam_api(64)?\.dll$/i.test(f));
  const config = buildBypassConfig({
    exeName: path.basename(exePath),
    exeBackup: findExeBackup(exePath),
    steamApiDlls: steamApiDlls.length ? steamApiDlls : ['steam_api64.dll'],
    mode,
    nthTimes,
  });
  fs.writeFileSync(path.join(exeDir, 'SteamAPICheckBypass.json'), JSON.stringify(config, null, 2));

  log.log(`[bypass] applied ${targetName} (${arch}) + SteamAPICheckBypass.json in ${exeDir}`);
  return { applied: true, dir: exeDir, dll: targetName, arch };
}

// Remove a bypass setup from a game folder: delete the hijack DLL(s) and the json. Leaves steam_api
// and steam_settings untouched (shared with the emulator install).
function revertBypass({ gameDir, exePath, log = noopLog } = {}) {
  const dir = exePath ? path.dirname(exePath) : gameDir;
  if (!dir || !fs.existsSync(dir)) return { removed: [] };
  const removed = [];
  for (const name of [...HIJACK_NAMES, 'SteamAPICheckBypass.json']) {
    const file = path.join(dir, name);
    try {
      if (fs.existsSync(file)) {
        fs.rmSync(file, { force: true });
        removed.push(name);
      }
    } catch (e) {
      log.error(`[bypass] revert ${name} failed => ${e}`);
    }
  }
  return { removed };
}

module.exports = {
  ensureBypassDlls,
  buildBypassConfig,
  applyBypass,
  revertBypass,
  findExeBackup,
  pickBypassDllEntries,
  extractDllsFromRarDirect,
};
