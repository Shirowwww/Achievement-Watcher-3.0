'use strict';

/*
  SteamAPICheckBypass — optional, opt-in port of SteamAutoCrack's "Steam API Check Bypass".

  Some games run an extra ownership / integrity check on top of the Steam API: after you swap
  steam_api(64).dll for GBE Fork's, the game still reads the *original* DLL (or its own exe) to verify
  it, sees the emulator, and refuses to launch or never unlocks. The bypass is a proxy DLL
  (SteamAutoCracks/Steam-API-Check-Bypass) dropped into the game folder under a hijack name
  (winmm.dll / version.dll / winhttp.dll — auto-loaded by the game) plus a SteamAPICheckBypass.json
  that virtualises file access: it redirects reads of steam_api(64).dll to the kept ".bak" original,
  redirects the exe to its backup, and hides the steam_settings folder from the game's own checks.

  This mirrors SteamAutoCrack's ApplySteamAPICheckBypass (SteamStubUnpacker.cs) — same proxy DLLs (from
  the official release), same JSON rules. It is OFF by default (as in SteamAutoCrack); it does NOT help
  PlayStation-PSPC titles (their trophies never hit the Steam API). Renderer-side; fs + request-zero +
  node-unrar-js (the release ships the DLLs in a RAR5, which 7za can't open). Reverts cleanly.
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

// Extract the two proxy DLLs out of the release RAR5 with node-unrar-js (loaded lazily — only this
// feature needs it, and only when the user opts in).
async function extractDllsFromRar(rarPath, destDir) {
  const { createExtractorFromData } = require('node-unrar-js');
  const buf = fs.readFileSync(rarPath);
  const extractor = await createExtractorFromData({ data: Uint8Array.from(buf).buffer });
  const names = [...extractor.getFileList().fileHeaders].filter((h) => !h.flags.directory).map((h) => h.name);
  const extracted = extractor.extract({ files: names });
  fs.mkdirSync(destDir, { recursive: true });
  let wrote = 0;
  for (const file of extracted.files) {
    if (!file.extraction) continue;
    const base = path.basename(file.fileHeader.name);
    if (base === BYPASS_DLL.x64 || base === BYPASS_DLL.x86) {
      fs.writeFileSync(path.join(destDir, base), Buffer.from(file.extraction));
      wrote++;
    }
  }
  return wrote;
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
  Build the SteamAPICheckBypass.json object (pure — unit-tested). Keys are paths relative to the game
  exe, using Windows separators (what the proxy matches against). Mirrors SteamAutoCrack's rules:
    - exe        -> file_redirect to its kept backup (so integrity checks read the original)
    - steam_api  -> file_redirect to <dll>.bak, gated by hook_times_mode/hook_time_n
    - steam_settings dir + known files -> file_hide (revealed once so the emu can still read them)

  exeName        basename of the game exe (e.g. "game.exe")
  exeBackup      basename of the kept exe backup, or null to skip the exe rule
  steamApiDlls   array of steam_api(64).dll paths relative to the exe dir (e.g. ["steam_api64.dll"])
  mode           "nth_time_only" | "not_nth_time_only" | "all"
  nthTimes       array of 1-based occurrence numbers (e.g. [1])
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
  Apply the bypass to a game folder. Picks the proxy DLL matching the exe arch, drops it under the
  hijack name (default winmm.dll), and writes SteamAPICheckBypass.json next to the exe. No-op (returns
  applied:false) if a hijack DLL is already present, so it never double-applies or clobbers a real one.

  gameDir       install folder (steam_api + steam_settings live here for the common case)
  exePath       absolute path to the game exe (arch + config base dir)
  dlls          { x64, x86 } from ensureBypassDlls
  dllVariant    'winmm' | 'version' | 'winhttp' (default winmm)
  mode          bypass mode (default 'nth_time_only'); nthTimes default [1]
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

module.exports = { ensureBypassDlls, buildBypassConfig, applyBypass, revertBypass, findExeBackup };
