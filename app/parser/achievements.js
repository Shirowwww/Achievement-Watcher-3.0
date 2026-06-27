'use strict';

const { crc32 } = require('crc');
const path = require('path');
const fs = require('fs');
const appPath = __dirname;
const gog = require(path.join(appPath, 'gog.js'));
const epic = require(path.join(appPath, 'epic.js'));
const ea = require(path.join(appPath, 'ea.js'));
const steam = require(path.join(appPath, 'steam.js'));
const uplay = require(path.join(appPath, 'uplay.js'));
const rpcs3 = require(path.join(appPath, 'rpcs3.js'));
const shadps4 = require(path.join(appPath, 'shadps4.js'));
const xenia = require(path.join(appPath, 'xenia.js'));
const greenluma = require(path.join(appPath, 'greenluma.js'));
const userDir = require(path.join(appPath, 'userDir.js'));
const libraryDirs = require(path.join(appPath, 'libraryDirs.js'));
const blacklist = require(path.join(appPath, 'blacklist.js'));
const watchdog = require(path.join(appPath, 'watchdog.js'));
const goldberg = require(path.join(appPath, 'goldberg.js'));
const gbeInstaller = require(path.join(appPath, 'gbeInstaller.js'));
const pe = require(path.join(appPath, '..', 'util', 'pe.js'));
const steamless = require(path.join(appPath, 'steamless.js'));
const apiCheckBypass = require(path.join(appPath, 'apiCheckBypass.js'));
const crackFix = require(path.join(appPath, 'crackFix.js'));
const genEmuConfig = require(path.join(appPath, 'genEmuConfig.js'));
const gameIndex = require(path.join(appPath, 'gameIndex.js'));
const exeDetect = require(path.join(appPath, 'exeDetect.js'));
const installState = require(path.join(appPath, 'installState.js'));
let debug;
let _userDataPath = null; // cache root for automatic emulator setup and downloaded tools

module.exports.initDebug = ({ isDev, userDataPath }) => {
  if (debug) {
    return;
  }
  _userDataPath = userDataPath;
  userDir.setUserDataPath(userDataPath);
  libraryDirs.setUserDataPath(userDataPath);
  gog.initDebug({ isDev, userDataPath });
  epic.initDebug({ isDev, userDataPath });
  ea.initDebug({ isDev, userDataPath });
  steam.initDebug({ isDev, userDataPath });
  uplay.initDebug({ isDev, userDataPath }); // was missing — left uplay's `debug` undefined (every UPLAY* game threw and was skipped)
  blacklist.initDebug({ isDev, userDataPath });
  debug = new (require('@xan105/log'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/parser.log'),
  });
};

// Interpret an emulator "unlocked" flag that may be a boolean, a number or a string.
// Accepts true / 1 / "1" / "true" (any case); everything else (false, 0, "0", "false", "") is locked.
function isTruthyFlag(v) {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === '1' || s === 'true';
  }
  return false;
}

// Coerce a possibly non-string game name into a usable display title (issue #54).
// Handles a plain string, a { name: "…" } wrapper, a localized { english: "…", … } map
// (preferring english), and falls back to the appid so a title is never blank/"[object Object]".
function normalizeGameName(name, appid) {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    if (typeof name.name === 'string' && name.name.trim()) return name.name;
    if (typeof name.english === 'string' && name.english.trim()) return name.english;
    const firstString = Object.values(name).find((v) => typeof v === 'string' && v.trim());
    if (firstString) return firstString;
  }
  if (typeof name === 'number') return String(name);
  return String(appid);
}

function cloneDiscoveryRecord(record) {
  if (!record || record.appid == null) return null;
  const copy = { ...record };
  if (record.data && typeof record.data === 'object') copy.data = { ...record.data };
  delete copy._sources;
  return copy;
}

function sourceKey(record) {
  const data = (record && record.data) || {};
  return [
    String(record && record.appid),
    String(record && record.source),
    String(data.type || ''),
    String(data.path || ''),
    String(data.root || ''),
    String(data.gameDir || ''),
    String(data.steamSettings || ''),
  ].join('\n');
}

function mergeDiscoveryData(target, incoming) {
  if (!incoming || typeof incoming !== 'object') return target || incoming;
  const data = target && typeof target === 'object' ? target : {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || value === '') continue;
    if (key === 'needsSchema' || key === 'trustedInstalled' || key === 'hasSteamApiDll') {
      data[key] = !!data[key] || !!value;
    } else if (data[key] == null || data[key] === '') {
      data[key] = value;
    }
  }
  return data;
}

function mergeDiscoveryRecord(target, incoming) {
  if (!target || !incoming) return target || incoming;

  if (!Array.isArray(target._sources)) target._sources = [cloneDiscoveryRecord(target)];
  const seen = new Set(target._sources.map(sourceKey));
  const incomingSources = Array.isArray(incoming._sources) && incoming._sources.length > 0 ? incoming._sources : [incoming];
  for (const rawSource of incomingSources) {
    const source = cloneDiscoveryRecord(rawSource);
    if (!source) continue;
    const key = sourceKey(source);
    if (!seen.has(key)) {
      target._sources.push(source);
      seen.add(key);
    }
  }

  if (!target.name && incoming.name) target.name = incoming.name;
  if (!target.source && incoming.source) target.source = incoming.source;
  if (!target.steamappid && incoming.steamappid) target.steamappid = incoming.steamappid;
  target.data = mergeDiscoveryData(target.data || {}, incoming.data || {});
  if (incoming.name && incoming.data && incoming.data.gameDir && !target.name) target.name = incoming.name;
  return target;
}

function consolidateDiscoveryList(list) {
  const byAppid = new Map();
  const order = [];
  for (const raw of list || []) {
    const record = cloneDiscoveryRecord(raw);
    if (!record || record.appid == null) continue;
    const key = String(record.appid);
    if (!byAppid.has(key)) {
      record._sources = [cloneDiscoveryRecord(record)];
      byAppid.set(key, record);
      order.push(key);
      continue;
    }
    byAppid.set(key, mergeDiscoveryRecord(byAppid.get(key), record));
  }
  const result = order.map((key) => byAppid.get(key)).filter(Boolean);
  const before = (list || []).length;
  if (debug && before !== result.length) debug.log(`[discover] consolidated ${before} source entr${before === 1 ? 'y' : 'ies'} into ${result.length} game(s)`);
  return result;
}

function getDiscoverySources(record, cachedList) {
  if (record && Array.isArray(record._sources) && record._sources.length > 0) return record._sources.map(cloneDiscoveryRecord).filter(Boolean);
  if (record && !record.data && cachedList) {
    const matches = cachedList.filter((a) => String(a.appid) === String(record.appid));
    if (matches.length > 0) {
      return matches.flatMap((match) => (Array.isArray(match._sources) ? match._sources : [match])).map(cloneDiscoveryRecord).filter(Boolean);
    }
  }
  return [cloneDiscoveryRecord(record)].filter(Boolean);
}

// Build the list of library roots to auto-scan for installed-but-never-launched Goldberg/GBE games:
// the user's configured library roots (Settings > Folder > Library Folders, default C:\Jeux), the
// Folder-tab save-dirs (kept for backward compat — those often already point inside a game install),
// and the Desktop. Deduplicated, existing-only. A game installed there but never run has no %APPDATA%
// save folder, so the normal save-folder scan can't see it — this is what makes those games show up regardless.
async function goldbergScanRoots() {
  const roots = [];
  const add = (p) => {
    if (p && !roots.some((r) => r.toLowerCase() === String(p).toLowerCase())) roots.push(p);
  };
  try {
    for (const dir of await libraryDirs.get()) add(dir);
  } catch (err) {
    debug.log(`[goldberg-scan] could not read library folders: ${err}`);
  }
  if (process.env['USERPROFILE']) add(path.join(process.env['USERPROFILE'], 'Desktop'));
  if (process.env['PUBLIC']) add(path.join(process.env['PUBLIC'], 'Desktop'));
  try {
    for (const dir of await userDir.get()) add(dir.path);
  } catch (err) {
    debug.log(`[goldberg-scan] could not read user folders: ${err}`);
  }
  return roots;
}

// Direct child folders of every scan root, built once per makeList run. Lets us resolve an install
// dir by NAME for games that carry no steam_settings/steam_appid.txt (GOG/standalone like LEGO
// Batman, or a bare crack) — the Goldberg scan can't see those, so without this they'd never get a
// gameDir and their exe would never be detected.
let _folderIndex = null;
// Install folders already linked to a game by authoritative appid (steam_api dll / steam_appid.txt),
// populated by scanInstalledGoldbergGames. The name-based fallback must NOT match these, otherwise a
// similarly-named game (e.g. "Forza Horizon 5") could steal another game's folder ("Forza Horizon 6").
let _claimedDirs = new Set();

// Short-TTL cache of the discovery phase (the recursive C:\Jeux / Desktop / library disk walks), so a
// settings-save rescan or a refresh moments later skips redoing them. Keyed (in makeList) on sources,
// the chosen Steam account, the user/library folders and the blacklist — any of those changing forces
// a fresh scan. Per-game unlock state is always read fresh, so a cache hit never hides a new unlock.
let _discoverCache = null; // { key, time, appidList, folderIndex, claimedDirs }
const DISCOVER_TTL_MS = 15000;
const GAME_LOAD_TIMEOUT_MS = 45000;

// Install folders whose first-run emulator setup (download/run generate_emu_config + Steamless +
// install the GBE DLL + write achievements.json) is currently running in the BACKGROUND, keyed by
// `appid:gameDir`. That setup can take ~70s the first time a game is seen, so it is fired-and-forgotten
// instead of awaited inside the per-game load (see the needsSchema/needsRuntimeFix block in
// getSavedAchievementsForAppid): awaiting it used to blow the 45s GAME_LOAD_TIMEOUT_MS, which both
// dropped the freshly detected game from that scan AND stretched the whole makeList to ~48s. This set
// stops repeated scans from relaunching the same setup while it is still in flight; once it finishes,
// the written schema/DLL is on disk and the next scan reflects the fixed state.
let _emuFixInFlight = new Set();

// detectEmulator() does a recursive disk walk (findDll + findSteamSettings); the same gameDir is
// inspected by multiple stages of one scan (e.g. the type-'file' emulator detect and the playtime
// auto-seed both run on the same resolvedGameDir). Memoize per gameDir for the run — the filesystem
// doesn't change mid-scan, and repair() only writes achievements.json (never dlls/configs), so a
// cached {type,dll,steamSettings} stays valid. Cleared at the top of makeList.
let _emuCache = new Map();
let _seededGameDirs = new Set();

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Apply the same non-interactive emulator setup used by the right-click action. It runs for newly
// detected installs with a missing schema, and for an already-known setup whose runtime DLL is
// missing the architecture the detected exe needs. The emulator is always applied standalone (the
// SteamAutoCrack way): strip any SteamStub with Steamless, then replace steam_api(64).dll. There is
// no ColdClient path.
// Opt-in CrakFiles community fix ("crakfiles detecte jeu : si trouve, on applique, puis dll"). Detects
// the game in the community list and, on a confident match with an auto-installable fix, applies it.
// crackFix.applyBestFix enforces the safety rules (confident name match only, pixeldrain links only,
// best variant for the architecture, and idempotency via the game-folder marker so the same fix is
// never re-downloaded). This only wires AW's cache dir / arch detection / logging. Never throws;
// returns true only when a fix was actually applied this run.
// PlayStation-PSPC ports (The Last of Us Part II, God of War, …) route achievements through Sony's PSPC
// SDK and never call the Steam API, so the Goldberg/GBE emulator can't track them — only a crack with a
// PSN bypass (e.g. RUNE) can. Detect them by the SDK files they ship next to the exe.
function isPspcGame(gameDir) {
  try {
    for (const f of fs.readdirSync(gameDir)) {
      if (/^PlayStationSdk\.dll$/i.test(f) || /^PsPcSdk.*\.(dll|exe|msi)$/i.test(f) || /pspc_sdk_runtime/i.test(f)) return true;
    }
  } catch {
    /* unreadable folder — treat as non-PSPC */
  }
  return false;
}

async function tryApplyCrackFix({ gameDir, gameName, appid, detectedExe, proxyFallback = true }) {
  try {
    const arch = (detectedExe && detectedExe.full && pe.exeArch(detectedExe.full)) || null;
    const cf = await crackFix.applyBestFix({
      cacheDir: path.join(_userDataPath, 'cache/crackfiles'),
      gameName: gameName || '',
      gameDir,
      arch,
      proxyFallback,
      log: debug,
    });
    if (cf && cf.applied) {
      debug.log(
        `[${appid}] CrakFiles: applied "${cf.entry && cf.entry.name}" (${cf.fix && cf.fix.filename}, ${(cf.files || []).length} file(s)) — installing GBE DLL on top`
      );
      return true;
    }
    debug.log(`[${appid}] CrakFiles auto-apply did nothing (${cf && cf.reason})`);
    return false;
  } catch (e) {
    debug.log(`[${appid}] CrakFiles auto-apply failed => ${e}`);
    return false;
  }
}

// Called when a background emulator setup finishes successfully, with { appid, name }. The daemon
// (init.js) registers this to fire its "emulator fix applied" toast — previously driven by the
// non-enumerable `emulatorJustFixed` marker on the game object, which no longer works now that the
// setup runs after the per-game load returns (it is fired-and-forgotten to avoid the scan timeout).
let _onEmulatorFixed = null;
module.exports.setEmulatorFixedHandler = (fn) => {
  _onEmulatorFixed = typeof fn === 'function' ? fn : null;
};

// Exposed so the Settings → Advanced "Fix all games" action can run the same fix chain the
// per-scan auto-apply uses, over every detected game with a known install folder.
module.exports.autoApplyEmulatorFix = autoApplyEmulatorFix;
async function autoApplyEmulatorFix({ gameDir, gameName, appid, steamSettings, option, detectedEmu = null, detectedExe = null }) {
  if (!gameDir || !_userDataPath) throw new Error('game folder/user data path unavailable');
  const cfg = option.emulator || {};
  detectedEmu = detectedEmu || goldberg.detectEmulator(gameDir);
  detectedExe = detectedExe || exeDetect.detect(gameDir, gameName || '', { dllPaths: detectedEmu.dll });
  // STEP 1 — CrakFiles community fix FIRST (opt-in). When the game is confidently in the list, apply
  // the crack before anything else: it provides a DRM-free/cracked runtime, so the GBE DLL installed
  // on top below makes achievements work. A crack makes Steamless/SteamStub handling unnecessary.
  // Re-detect afterwards because the crack may have added steam_api or a steam_settings folder.
  // Idempotent + confident-only, so games not in the list (or already cracked) simply fall through.
  // Always try a confident community-crack match (CrakFiles) before the emulator install. It only ever
  // acts on an EXACT name match with an auto-applicable (pixeldrain) fix, backs up overwritten files and
  // is idempotent — so it's a no-op for the vast majority of games (no confident match) and a safe
  // one-time apply for the few that match. Set emulator.autoApplyCrackFix=false to opt out. PSPC games
  // still get the full Goldberg/GBE setup below (unconditional) on top — the crack is just what can make
  // their PSN-trophy unlocks reach a tracker at all.
  const pspc = isPspcGame(gameDir);
  if (pspc) debug.log(`[${appid}] PlayStation-PSPC game detected — applying Goldberg/GBE anyway, plus trying a community crack; note PSN trophies never reach the Steam API, so live tracking needs a RUNE release`);
  let crackApplied = false;
  if (cfg.autoApplyCrackFix !== false) {
    crackApplied = await tryApplyCrackFix({ gameDir, gameName, appid, detectedExe, proxyFallback: cfg.pixeldrainProxyFallback !== false });
    if (crackApplied) {
      detectedEmu = goldberg.detectEmulator(gameDir);
      detectedExe = exeDetect.detect(gameDir, gameName || '', { dllPaths: detectedEmu.dll }) || detectedExe;
    } else if (pspc) {
      debug.log(`[${appid}] PSPC: no confident community crack for "${gameName}" — install a RUNE release; AW tracks it via %PUBLIC%\\Documents\\Steam\\RUNE`);
    }
  }

  // STEP 2 — SteamStub DRM. AW applies the emulator the SteamAutoCrack way: strip the stub with
  // Steamless so the plain GBE steam_api DLL loads, then replace the DLL below. There is no ColdClient
  // fallback — if Steamless can't strip a detected stub the DLL is still installed (the game may fail
  // to launch, the same tradeoff SteamAutoCrack makes).
  const hasSteamStub = !crackApplied && !!(detectedExe && detectedExe.full && pe.detectSteamStub(detectedExe.full));
  const shouldRunSteamless = !crackApplied && !!(detectedExe && detectedExe.full && (cfg.steamlessAutoUnpack || hasSteamStub));
  if (shouldRunSteamless) {
    let stripped = false;
    let reason = '';
    try {
      const cli = await steamless.ensureSteamless({ cacheDir: path.join(_userDataPath, 'cache/steamless'), log: debug });
      const r = await steamless.stripDrm({ steamless: cli, exePath: detectedExe.full, experimental: !!cfg.steamlessExperimental, log: debug });
      stripped = !!(r && r.stripped);
      reason = (r && r.reason) || '';
      const prefix = hasSteamStub ? 'SteamStub' : 'Steamless';
      debug.log(`[${appid}] ${prefix}: Steamless ${stripped ? 'stripped the exe; using the plain DLL' : `did not strip (${reason})`}`);
    } catch (e) {
      reason = e.message || String(e);
      debug.log(`[${appid}] SteamStub: Steamless failed => ${e}`);
    }
    if (hasSteamStub && !stripped) {
      debug.log(`[${appid}] SteamStub: not stripped (${reason || 'unknown'}); installing the plain DLL anyway — the game may fail to launch`);
    }
  }

  const cacheDir = path.join(_userDataPath, 'cache/gse_fork');
  // Automatic discovery must never force a full release download for every new game. The cache
  // helper already performs the configured daily update check; `force` is reserved for the explicit
  // right-click action. Forcing here could leave the final worker stuck at 98% on a large .7z.
  const dlls = await gbeInstaller.ensureEmulatorDlls({ cacheDir, force: false, log: debug });
  const steamSettingsDirs = [];

  // Official GSE setup requires steam_interfaces.txt generated from the ORIGINAL game DLL. Do this
  // before replacement; generateInterfaces also prefers AW's one-time .bak on repeat/manual repairs.
  const interfaceDlls = detectedEmu.dll.filter((file) => /^steam_api(64)?\.dll$/i.test(path.basename(file)));
  for (const dllPath of interfaceDlls) {
    const dest = path.join(path.dirname(dllPath), 'steam_settings');
    const interfaces = await gbeInstaller.generateInterfaces({ dllPath, steamSettings: dest, dlls, log: debug });
    if (!interfaces.generated) debug.log(`[${appid}] steam_interfaces.txt skipped (${interfaces.reason})`);
  }

  // ── Standalone (replace steam_api dll) — the only emulator-apply path ──
  const fallbackDllDir =
    steamSettings && path.basename(steamSettings).toLowerCase() === 'steam_settings'
      ? path.dirname(steamSettings)
      : gameDir;
  const dllDirs = detectedEmu.dll.length > 0
    ? [...new Set(detectedEmu.dll.map((file) => path.dirname(file)))]
    : [fallbackDllDir];
  const wantedArch = (detectedExe && detectedExe.full ? pe.exeArch(detectedExe.full) : 'x64') || 'x64';
  const wantedFile = gbeInstaller.ARCH[wantedArch] && gbeInstaller.ARCH[wantedArch].file;
  const hasWantedDll = wantedFile && detectedEmu.dll.some((file) => path.basename(file).toLowerCase() === wantedFile);
  gbeInstaller.installDlls({ dllDirs, dlls, writeIfMissing: wantedArch, log: debug });
  if (wantedArch && wantedFile && detectedEmu.dll.length > 0 && !hasWantedDll) {
    const exeDir = detectedExe && detectedExe.full ? path.dirname(detectedExe.full) : fallbackDllDir;
    gbeInstaller.installDlls({ dllDirs: [exeDir], dlls, ensureArch: wantedArch, log: debug });
    if (!dllDirs.some((dir) => dir.toLowerCase() === exeDir.toLowerCase())) dllDirs.push(exeDir);
    debug.log(`[${appid}] seeded missing ${wantedFile} beside ${detectedExe && detectedExe.name ? detectedExe.name : 'the detected executable'}`);
  }
  steamSettingsDirs.push(...dllDirs.map((dir) => path.join(dir, 'steam_settings')));
  if (steamSettings) steamSettingsDirs.push(steamSettings);

  // Pre-create the GBE runtime save folder (%APPDATA%\GSE Saves\<appid>) — the standard community step
  // ("make a folder named after the appid in the emu saves dir"). It makes the game show in AW at 0%
  // right away (even before its first unlock, and even when the install lives outside AW's scan roots)
  // and gives the watchdog a folder to watch from the first launch. The emulator fills it on play.
  try {
    const saveFolder = goldbergSaveFolder('gbe', appid);
    if (saveFolder) fs.mkdirSync(saveFolder, { recursive: true });
  } catch (e) {
    debug.log(`[${appid}] could not pre-create GSE Saves folder => ${e}`);
  }

  // Optional, opt-in (off by default): SteamAutoCrack's Steam API ownership-check bypass. Drops the
  // proxy DLL + SteamAPICheckBypass.json for games that re-check the original steam_api/exe after the
  // swap. No-op if the bypass DLL can't be fetched; never fails the fix.
  if (cfg.apiCheckBypass && detectedExe && detectedExe.full) {
    try {
      const bypassDlls = await apiCheckBypass.ensureBypassDlls({ cacheDir: path.join(_userDataPath, 'cache/api_check_bypass'), log: debug });
      const r = apiCheckBypass.applyBypass({ gameDir, exePath: detectedExe.full, dlls: bypassDlls, log: debug });
      debug.log(`[${appid}] Steam API check bypass: ${r.applied ? `applied (${r.dll}, ${r.arch})` : `skipped (${r.reason})`}`);
    } catch (e) {
      debug.log(`[${appid}] Steam API check bypass failed => ${e}`);
    }
  }

  // Advanced background setup is anonymous and best-effort. A stored Steam login can require a
  // Steam Guard prompt, which must stay in the explicit right-click flow; silently waiting for it
  // would stall discovery. Also do not fail the whole emulator fix if the optional advanced
  // generator times out: the regular GSE install + AW schema/config repair below are enough to make
  // achievements work.
  if (cfg.steamSettingsMode === 'advanced') {
    try {
      const tool = await genEmuConfig.ensureGenerateEmuConfig({
        cacheDir: path.join(_userDataPath, 'cache/gse_emu_config'),
        preferredTag: dlls.tag || null,
        log: debug,
      });
      // Unattended here (login: null, no onPrompt), so cap the run well below the 5-minute interactive
      // default: a hung anonymous generation must not stall the per-scan auto-apply — nor the bulk
      // "Fix all games" batch — for minutes per game. Best-effort: the Simple schema/DLC repair below
      // already makes achievements work when this is skipped.
      const generated = await genEmuConfig.generate({ tool, appid, login: null, timeout: 90000, log: debug });
      try {
        for (const dir of new Set(steamSettingsDirs)) genEmuConfig.mergeIntoGame(generated.steamSettings, dir);
      } finally {
        try { fs.rmSync(generated.workDir, { recursive: true, force: true }); } catch {}
      }
    } catch (err) {
      debug.log(`[${appid}] advanced steam_settings skipped => ${err}`);
    }
  }

  const refreshedEmu = refreshEmulatorCache(gameDir);
  return { tag: dlls.tag || '', steamSettingsDirs: [...new Set(steamSettingsDirs)], emulator: refreshedEmu };
}
function setEmulatorCache(gameDir, result) {
  if (!gameDir || !result) return result;
  _emuCache.set(gameDir.toLowerCase(), result);
  return result;
}
function refreshEmulatorCache(gameDir) {
  if (!gameDir) return goldberg.detectEmulator(gameDir);
  return setEmulatorCache(gameDir, goldberg.detectEmulator(gameDir));
}
function detectEmulatorCached(gameDir) {
  if (!gameDir) return goldberg.detectEmulator(gameDir);
  const key = gameDir.toLowerCase();
  const hit = _emuCache.get(key);
  if (hit) return hit;
  const r = goldberg.detectEmulator(gameDir);
  return setEmulatorCache(gameDir, r);
}

async function getFolderIndex() {
  if (_folderIndex) return _folderIndex;
  const index = [];
  const seen = new Set();
  for (const root of await goldbergScanRoots()) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = path.join(root, e.name);
      const key = dir.toLowerCase();
      if (seen.has(key)) continue;
      if (_claimedDirs.has(key)) continue; // already linked by appid — never name-match it
      seen.add(key);
      index.push({ dir, name: e.name });
    }
  }
  _folderIndex = index;
  return index;
}

// Resolve a game's install folder purely by matching its name against the scan-root folder names.
// Returns a full path or null. Conservative threshold (exeDetect.FOLDER_MATCH_THRESHOLD) to avoid
// false matches against unrelated folders (e.g. on the Desktop).
async function resolveGameDirByName(gameName) {
  if (!gameName) return null;
  try {
    return exeDetect.bestFolderMatch(gameName, await getFolderIndex());
  } catch {
    return null;
  }
}

// Map a detected emulator type to its runtime save folder for an appid. A never-launched game has no
// folder here yet (so it shows 0% / all-locked); once the game runs and the emulator writes its save,
// this exact path holds the unlock state — and the regular save-folder scan would also pick it up,
// which is why discover() dedupes by appid (auto-detected entries yield to already-found ones).
function goldbergSaveFolder(emulator, appid) {
  const appdata = process.env['APPDATA'];
  if (!appdata) return null;
  const dirName = emulator === 'goldberg' ? 'Goldberg SteamEmu Saves' : 'GSE Saves';
  return path.join(appdata, dirName, String(appid));
}

// Discover Goldberg/GBE games sitting in install folders (Objective 3) and returns brand-new
// discover()-shaped items (games not found by any other source). It ALSO mutates the already-known
// items in `data`: for every install whose steam_settings/achievements.json schema is missing or
// empty, it attaches { steamSettings, needsSchema } so getSavedAchievementsForAppid can auto-write
// the schema later — that way a game that was launched once (found via its save folder) but whose
// install schema is broken still gets repaired, not just the never-launched ones.
async function scanInstalledGoldbergGames(data) {
  const additions = [];
  try {
    const roots = await goldbergScanRoots();
    if (roots.length === 0) return additions;
    debug.log(`[goldberg-scan] scanning ${roots.length} root(s): ${roots.join(', ')}`);

    const found = goldberg.findCompatibleGames(roots);
    for (const g of found) if (g.gameDir) _claimedDirs.add(g.gameDir.toLowerCase());
    const byAppid = new Map(data.map((g) => [String(g.appid), g]));
    let attached = 0;

    for (const g of found) {
      const appid = g.appid && /^[0-9]+$/.test(String(g.appid)) ? String(g.appid) : null;
      if (!appid) continue; // no steam_appid.txt -> can't identify the game, skip

      const existing = byAppid.get(appid);
      if (existing) {
        // Already discovered (save folder / other source). Always attach the install steam_settings so
        // the offline description backfill can read its local schema; flag for repair only if broken.
        if (existing.data) {
          if (!existing.data.steamSettings && g.steamSettings) existing.data.steamSettings = g.steamSettings;
          if (!existing.data.gameDir && g.gameDir) existing.data.gameDir = g.gameDir;
          if (!g.hasSchema && !existing.data.needsSchema) {
            existing.data.needsSchema = true;
            attached++;
          }
        }
        continue;
      }

      const item = {
        appid,
        source: g.emulator === 'gbe' ? 'GBE Fork' : 'Goldberg',
        data: {
          type: 'file',
          path: goldbergSaveFolder(g.emulator, appid),
          steamSettings: g.steamSettings,
          gameDir: g.gameDir,
          needsSchema: !g.hasSchema, // schema achievements.json missing/empty -> repair it lazily
        },
      };
      byAppid.set(appid, item);
      additions.push(item);
    }
    debug.log(`[goldberg-scan] ${found.length} install(s) found; added ${additions.length} new, flagged ${attached} for schema repair`);
  } catch (err) {
    debug.log(`[goldberg-scan] failed: ${err}`);
  }
  return additions;
}

// Folders never worth descending into / treating as games (redist, engine, tool and launcher-data
// folders that would otherwise surface utilities as "games"). steamapps is skipped because legit
// Steam library games are handled by the Steam source.
const UNCONFIG_SKIP_DIR = /^(_?CommonRedist|_?Redist|redist|DirectX|dx|dotnet|prerequisites|prereq|Installers|__Installer|steam_settings|steamapps|common|games|SaveConverter|tools|Extras|Updater|app|bin|backups|cache|httpcache|media|Patches|support|Redistributables|Binaries|Engine|plugins|Modding)$/i;

// Discover INSTALLED games that carry no usable appid (no steam_appid.txt / steam_settings), so they
// can still be shown in the app (e.g. to right-click → Install GBE Fork). Two signals: a folder with
// a replaced steam_api dll (emulated, just not configured), or a "leaf" folder holding a real game
// .exe. Folders already claimed by an appid install (_claimedDirs) are skipped. Keyed by a stable
// selector-safe synthetic id ("local-<crc>") since there is no appid. Reuses goldbergScanRoots() so
// user-configured Folder-tab dirs aren't skipped, but drops the Desktop roots: the appid-based scan
// can trust Desktop because it requires a strict marker (steam_api dll), while this scan matches on
// "looks like a game exe" alone, which is too loose for a Desktop full of shortcuts/random folders.
async function scanUnconfiguredInstalls(linkedExes = []) {
  const out = [];
  // Folders that already host a game configured under a real appid (from exeList): never surface them
  // again as "unconfigured", or the same game shows twice (e.g. LEGO Batman).
  const linked = linkedExes.map((p) => String(p).toLowerCase());
  const isLinkedSubtree = (dir) => {
    const d = dir.toLowerCase();
    return linked.some((p) => p === d || p.startsWith(d + path.sep) || p.startsWith(d + '/'));
  };
  const desktopDirs = [process.env['USERPROFILE'] && path.join(process.env['USERPROFILE'], 'Desktop'), process.env['PUBLIC'] && path.join(process.env['PUBLIC'], 'Desktop')]
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  const roots = (await goldbergScanRoots()).filter((r) => !desktopDirs.includes(r.toLowerCase()));

  const hasDll = (entries) => entries.some((e) => e.isFile() && /^steam_api(64)?\.dll$/i.test(e.name));
  const hasAppidMarker = (entries) =>
    entries.some((e) => (e.isFile() && e.name.toLowerCase() === 'steam_appid.txt') || (e.isDirectory() && e.name.toLowerCase() === 'steam_settings'));

  const readEntries = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
  };

  const isGameFolder = (dir, entries) => (entries && hasDll(entries)) || !!exeDetect.shallowGameExe(dir);

  const emit = (dir, entries) => {
    if (_claimedDirs.has(dir.toLowerCase())) return;
    if (isLinkedSubtree(dir)) return; // this folder already hosts a real-appid game (avoid duplicate)
    const exe = exeDetect.detect(dir, path.basename(dir), {});
    if (!exe) return;
    const folderName = path.basename(dir);
    const name = /^[0-9]+$/.test(folderName) || folderName.length < 3 ? exe.name.replace(/\.exe$/i, '') : folderName;
    const id = 'local-' + (crc32(dir.toLowerCase()) >>> 0).toString(16);
    out.push({
      appid: id,
      name,
      source: 'Unconfigured',
      data: { type: 'unconfigured', gameDir: dir, exe: exe.full, hasSteamApiDll: hasDll(entries || []) },
    });
  };

  const walk = (dir, depth) => {
    if (depth > 4) return;
    if (_claimedDirs.has(dir.toLowerCase())) return;
    const entries = readEntries(dir);
    if (!entries) return;
    if (hasAppidMarker(entries)) return; // appid path handles this folder
    const subdirs = entries.filter((e) => e.isDirectory() && !UNCONFIG_SKIP_DIR.test(e.name));
    const childGameFolders = subdirs.filter((e) => {
      const cd = path.join(dir, e.name);
      return !_claimedDirs.has(cd.toLowerCase()) && isGameFolder(cd, readEntries(cd));
    });
    if (isGameFolder(dir, entries) && childGameFolders.length === 0) {
      emit(dir, entries); // leaf game folder
      return;
    }
    for (const e of subdirs) walk(path.join(dir, e.name), depth + 1);
  };

  for (const root of roots) {
    if (root && fs.existsSync(root)) {
      const entries = readEntries(root);
      if (!entries) continue;
      for (const e of entries) {
        if (e.isDirectory() && !UNCONFIG_SKIP_DIR.test(e.name)) walk(path.join(root, e.name), 1);
      }
    }
  }
  return out;
}

function unconfiguredNameCandidates(u) {
  const values = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (!s || values.some((x) => x.toLowerCase() === s.toLowerCase())) return;
    values.push(s);
  };
  add(u && u.name);
  if (u && u.data) {
    add(path.basename(u.data.gameDir || ''));
    add(path.basename(u.data.exe || '').replace(/\.exe$/i, ''));
  }
  return values.filter((name) => !/^[0-9]+$/.test(name) && name.length >= 3);
}

async function resolveUnconfiguredSteamAppid(u) {
  for (const name of unconfiguredNameCandidates(u)) {
    try {
      const sid = await steam.findAppidByName(name);
      if (sid) return { appid: String(sid), matchedName: name };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function discover(source, steamAccFilter) {
  let data = [];

  //UserCustomDir
  let additionalSearch = [];
  try {
    for (let dir of await userDir.get()) {
      debug.log(`[userdir] ${dir.path}`);

      let scanned = [];
      if (source.rpcs3) scanned = await rpcs3.scan(dir.path);
      if (scanned.length > 0) debug.log('-> RPCS3 data added');
      if (scanned.length === 0 && source.shadps4) {
        scanned = await shadps4.scan(dir.path);
        if (scanned.length > 0) debug.log('-> ShadPS4 data added');
      }
      if (scanned.length === 0 && source.xenia) {
        scanned = await xenia.scan(dir.path);
        if (scanned.length > 0) debug.log('-> Xenia data added');
      }
      if (scanned.length > 0) {
        data = data.concat(scanned);
        debug.log('-> emulator data added');
      } else if (source.steamEmu) {
        scanned = await userDir.scan(dir.path);
        if (scanned.length > 0) {
          data = data.concat(scanned);
          debug.log('-> Steam emu data added');
        } else {
          additionalSearch.push(dir.path);
          debug.log('-> will be scanned for appid folder(s)');
        }
      }
    }
  } catch (err) {
    debug.log(err);
  }

  //ShadPS4 stores trophies in %APPDATA%/shadPS4 regardless of where the .exe lives — auto-scan that
  //known location so the user doesn't have to add it as a watched folder. De-dupe against anything the
  //watched-folder pass already found (portable installs that keep game_data next to the binary).
  if (source.shadps4) {
    try {
      const known = await shadps4.scan(path.join(process.env['APPDATA'] || '', 'shadPS4'));
      const have = new Set(data.map((g) => `${g.source}:${g.appid}`));
      const extra = known.filter((g) => !have.has(`${g.source}:${g.appid}`));
      if (extra.length > 0) {
        data = data.concat(extra);
        debug.log(`-> ShadPS4 (APPDATA) data added (${extra.length})`);
      }
    } catch (err) {
      debug.log(err);
    }
  }

  //Non-Legit Steam
  if (source.steamEmu) {
    try {
      data = data.concat(await steam.scan(additionalSearch));
    } catch (err) {
      debug.error(err);
    }
  }

  //GreenLuma
  if (source.greenLuma) {
    try {
      data = data.concat(await greenluma.scan());
    } catch (err) {
      debug.error(err);
    }
  }

  //Legit Steam
  if (source.legitSteam > 0) {
    try {
      data = data.concat(await steam.scanLegit(source.legitSteam, steamAccFilter));
    } catch (err) {
      debug.error(err);
    }
  }

  if (source.lumaPlay) {
    //Lumaplay (emulated/cracked Ubisoft — the actual point of this source toggle)
    try {
      data = data.concat(await uplay.scan());
    } catch (err) {
      debug.error(err);
    }

    // NOTE: uplay.scanLegit() (legit Ubisoft Connect cache) is intentionally NOT called here.
    // Legit Ubisoft Connect exposes no local unlock-state, so those entries always resolve to
    // root = {} (see getAchievements 'uplay' branch) and show as permanent 0% clutter — games
    // the user owns legitimately but for which we can never report progress. The "Émulateur
    // Ubisoft Connect" toggle is for emulated saves only.
  }

  if (source.gog) {
    try {
      data = data.concat(await gog.scan());
    } catch (err) {
      debug.error(err);
    }
  }

  if (source.epic) {
    try {
      data = data.concat(await epic.scan());
    } catch (err) {
      debug.error(err);
    }
  }

  if (source.ea) {
    try {
      data = data.concat(await ea.scan());
    } catch (err) {
      debug.error(err);
    }
  }

  if (source.importCache) {
    try {
      data = data.concat(await watchdog.scan());
    } catch (err) {
      debug.error(err);
    }
  }

  //Installed Goldberg/GBE games never launched yet (no %APPDATA% save folder) — Objective 3.
  //Runs last so it can dedupe against every other source by appid.
  if (source.steamEmu) {
    try {
      data = data.concat(await scanInstalledGoldbergGames(data));
    } catch (err) {
      debug.error(err);
    }

    // Installed games with no usable appid (no steam_appid.txt/steam_settings): surface them anyway so
    // they show in the app and can be right-clicked (Install GBE Fork, etc.). Runs after the Goldberg
    // scan so _claimedDirs is populated and these don't duplicate appid-identified installs.
    try {
      let linkedExes = [];
      try {
        const exeList = require(path.join(appPath, 'exeList.js'));
        linkedExes = (await exeList.list()).filter((e) => e.exe && /^[0-9]+$/.test(String(e.appid))).map((e) => e.exe);
      } catch {
        /* no exeList yet */
      }
      const unconfigured = await scanUnconfiguredInstalls(linkedExes);
      // Resolve identity by name BEFORE makeList's concurrent per-game fetch starts (not lazily inside
      // getSavedAchievementsForAppid): that ran in the same Promise.all as the already-identified game
      // it was lending gameDir to, so the lend frequently lost the race — the real entry had already
      // computed hasResolvedExe=false (no gameDir yet) by the time the gameDir arrived, leaving the
      // game correctly de-duplicated but permanently missing from the "installed only" filter (it
      // never got a chance to detect its exe). Doing it here, synchronously before any per-game fetch
      // begins, means the real entry sees its gameDir from the start.
      let added = 0,
        merged = 0;
      for (const u of unconfigured) {
        let real = null;
        let resolved = null;
        try {
          resolved = await resolveUnconfiguredSteamAppid(u);
          if (resolved) real = data.find((g) => String(g.appid) === String(resolved.appid));
        } catch {
          /* no match — keep as unconfigured */
        }
        if (real) {
          if (real.data) {
            if (!real.data.gameDir) real.data.gameDir = u.data.gameDir;
            if (!real.data.exe) real.data.exe = u.data.exe;
            if (u.data.hasSteamApiDll) real.data.hasSteamApiDll = true;
          }
          merged++;
          debug.log(`[unconfigured-scan] matched "${u.name}" (${resolved.matchedName}) to existing appid ${resolved.appid}`);
        } else if (resolved) {
          // findAppidByName only returns confident exact/strong-token matches. Promote that detected
          // game even when steam_api is entirely absent: the full setup must be able to seed the
          // architecture-matching GSE DLL, not require the file it is responsible for creating.
          data.push({
            appid: String(resolved.appid),
            source: 'GBE Fork',
            data: {
              type: 'file',
              path: goldbergSaveFolder('gbe', resolved.appid),
              steamSettings: path.join(u.data.gameDir, 'steam_settings'),
              gameDir: u.data.gameDir,
              exe: u.data.exe,
              hasSteamApiDll: !!u.data.hasSteamApiDll,
              needsSchema: true,
            },
          });
          merged++;
          debug.log(`[unconfigured-scan] promoted "${u.name}" (${resolved.matchedName}) to appid ${resolved.appid}`);
        } else {
          data.push(u);
          added++;
        }
      }
      if (added + merged > 0) {
        debug.log(`[unconfigured-scan] surfaced ${added} install(s) without an appid, merged ${merged} into already-known appid(s)`);
      }
    } catch (err) {
      debug.error(err);
    }
  }

  data = consolidateDiscoveryList(data);

  //AppID Blacklisting
  try {
    let exclude = await blacklist.get();
    data = data.filter((appid) => {
      return !exclude.some((id) => id == appid.appid);
    });
  } catch (err) {
    debug.error(err);
  }

  return data;
}

module.exports.getGameFromCache = async (appid, source, option) => {
  let result;
  switch (source) {
    case 'gog':
      return gog.getCachedData({ appID: appid, lang: option.achievement.lang });
    case 'epic':
      return epic.getCachedData({ appID: appid, lang: option.achievement.lang });
    case 'uplay':
      return uplay.getGameFromCache(appid);
    case 'steam':
    default:
      result = await steam.getCachedData({ appID: appid, lang: option.achievement.lang });
  }
  return result;
};

module.exports.saveGameToCache = async (info, lang) => {
  switch (info.source) {
    case 'steam':
    default:
      let cfg = info.game;
      cfg.lang = lang;
      cfg.appid = info.appid;
      steam.saveGameToCache(cfg);
  }
};

module.exports.getAchievementsForAppid = async (option, requestedAppid) => {
  try {
    let game;
    if (/^[0-9]+$/.test(requestedAppid)) {
      game = await steam.getGameData({ appID: requestedAppid, lang: option.achievement.lang, key: option.steam.apiKey });
    } else {
      game = await epic.getGameData({ appID: requestedAppid });
    }
    return game;
  } catch (err) {
    debug.log(err);
    return {};
  }
};

module.exports.getSavedAchievementsForAppid = async (option, requestedAppid, cachedList) => {
  let game;
  let isDuplicate = false;

  try {
    const appidList = cachedList || (await discover(option.achievement_source, option.steam.main));
    let appids = getDiscoverySources(requestedAppid, appidList);
    let appid =
      cloneDiscoveryRecord(appidList.find((a) => String(a.appid) === String(requestedAppid.appid))) ||
      cloneDiscoveryRecord(requestedAppid) ||
      appids[0];
    for (const sourceRecord of appids) appid = mergeDiscoveryRecord(appid, sourceRecord);
    if (!appid) return;

    // Unconfigured install (no appid): there is no Steam schema to fetch — return a minimal game so it
    // shows in the list (achievement-less) and can be right-clicked. Empty img fields are tolerated by
    // the renderer (guarded `if (game.img.*)`), so the box keeps its placeholder background.
    if (appid.data && appid.data.type === 'unconfigured') {
      const uname = appid.name || path.basename(appid.data.gameDir || '');
      // Borrow real Steam store art when the name resolves to a known appid (free GetAppList lookup),
      // otherwise leave img empty and the box keeps its placeholder background.
      let img = { header: '', icon: '', background: '', portrait: '' };
      let steamappid = null;
      try {
        const sid = await steam.findAppidByName(uname);
        if (sid) {
          steamappid = sid;
          img = {
            header: `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/header.jpg`,
            background: `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/page_bg_generated_v6b.jpg`,
            portrait: `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/library_600x900.jpg`,
            icon: `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/capsule_231x87.jpg`,
          };

        }
      } catch {
        /* no art — placeholder */
      }
      return {
        appid: appid.appid,
        steamappid,
        name: uname,
        source: appid.source || 'Unconfigured',
        gameDir: appid.data.gameDir,
        unconfigured: true,
        installed: true,
        img,
        achievement: { total: 0, unlocked: 0, list: [] },
      };
    }

    if (appid.data.type === 'rpcs3') {
      game = await rpcs3.getGameData(appid.data.path);
    } else if (appid.data.type === 'shadps4') {
      game = await shadps4.getGameData(appid.data.path, option.achievement.lang);
    } else if (appid.data.type === 'xenia') {
      game = await xenia.getGameData(appid.data.path);
    } else if (appid.data.type === 'uplay' || appid.data.type === 'lumaplay') {
      game = await uplay.getGameData(appid.appid, option.achievement.lang);
      // If local image extraction yielded no header (e.g. Uplay configurations YAML doesn't carry
      // image filenames for newer titles), fall back to Steam store art looked up by game name —
      // same pattern used for unconfigured installs. Uses the in-memory appList (no extra request
      // when already loaded) so the cost is a single find() on the cached array.
      if (game && game.name && game.img && !game.img.header) {
        try {
          const sid = await steam.findAppidByName(game.name);
          if (sid) {
            game.steamappid = game.steamappid || sid;
            game.img.header = `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/header.jpg`;
            game.img.background = game.img.background || `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/page_bg_generated_v6b.jpg`;
            game.img.portrait = game.img.portrait || `https://cdn.akamai.steamstatic.com/steam/apps/${sid}/library_600x900.jpg`;
          }
        } catch {}
      }
    } else if (appid.data.type === 'ea') {
      game = await ea.getGameData(appid, option.achievement.lang);
    } else if (appid.source === 'epic') {
      game = await epic.getGameData({ appID: appid.appid, steamappid: appid.steamappid, lang: option.achievement.lang });
    } else {
      game = await steam.getGameData({
        appID: appid.appid,
        lang: option.achievement.lang,
        key: option.steam.apiKey,
        showHidden: !!(option.achievement && option.achievement.showHidden),
      });
    }
    if (!game) return;

    // Game titles are strings by contract, but some language-specific fetch/cache paths can leave
    // game.name as a non-string (e.g. a localized {english:"…", turkish:"…"} object), which renders
    // as "object"/"[object Object]" in the UI and only for certain languages (issue #54). Normalize
    // to a plain string at this single chokepoint so every consumer (list, header, notifications)
    // gets a usable title, and log the raw value to pin down the upstream source if it ever happens.
    if (typeof game.name !== 'string') {
      const raw = game.name;
      game.name = normalizeGameName(raw, appid.appid);
      debug.warn(`[${appid.appid}] schema 'name' was ${raw === null ? 'null' : typeof raw}, coerced to "${game.name}". Raw: ${JSON.stringify(raw)}`);
    }

    if (appid.steamappid) game.steamappid = appid.steamappid;
    game.source = appid.source;
    if (!option.achievement.mergeDuplicate && appid.source) game.source = appid.source;
    const dataType = appid.data && appid.data.type;

    // Surface the auto-discovered install folder on the game object itself so the renderer
    // (Play button, Diagnose, Install GBE Fork) can reuse it instead of asking the user to
    // re-browse to a path the app already found during discover().
    // Prefer the folder found by the Goldberg scan; fall back to a name-based folder match so
    // non-Goldberg installs (GOG/standalone, bare cracks) also get an install dir.
    let resolvedGameDir = appid.data && appid.data.gameDir ? appid.data.gameDir : null;
    if (!resolvedGameDir && game.name) resolvedGameDir = await resolveGameDirByName(game.name);
    if (resolvedGameDir) game.gameDir = resolvedGameDir;
    if (appid.data && appid.data.steamSettings) game.steamSettings = appid.data.steamSettings;
    let resolvedEmu = null;
    let resolvedExe = null;
    if (appid.data && appid.data.exe) {
      try {
        if (fs.existsSync(appid.data.exe)) {
          resolvedExe = {
            name: path.basename(appid.data.exe),
            full: appid.data.exe,
            size: fs.statSync(appid.data.exe).size,
            score: 0,
          };
        }
      } catch {
        resolvedExe = null;
      }
    }

    // Auto-detect the emulator for games whose install dir we resolved but that didn't go through the
    // strict Goldberg-scan appid match (e.g. a save found under Public Documents/OnlineFix/Codex/etc.,
    // where the install dir itself is only found via the name-based fallback above). Without this, only
    // games discovered by scanInstalledGoldbergGames ever got steamSettings/needsSchema set, so the
    // auto-repair below silently skipped every other crack source even though a steam_api dll is right
    // there (reported bug: diagnose/repair only worked when manually triggered, never automatically).
    // Restricted to type 'file' (the generic emulated-save sources) — never touches rpcs3/uplay/legit-
    // Steam install dirs, which aren't Goldberg/GBE setups.
    if (appid.data && appid.data.type === 'file') {
      // Every emulated/cracked ('file') game gets a definite boolean so the UI dot is CONSISTENT
      // (it used to be set only when an install dir happened to resolve, so the dot appeared on some
      // crack games and not others). Default false (= no dll verified, red dot); flipped true below
      // when a steam_api(64).dll is actually found. Legit Steam / RPCS3 / Uplay stay undefined (no dot).
      game.hasSteamApiDll = false;
      if (resolvedGameDir) {
        try {
          resolvedEmu = detectEmulatorCached(resolvedGameDir);
          game.hasSteamApiDll = resolvedEmu.dll.length > 0;
          if ((resolvedEmu.dll.length > 0 || resolvedEmu.steamSettings) && !appid.data.steamSettings) {
            const steamSettingsDir = resolvedEmu.steamSettings || path.join(path.dirname(resolvedEmu.dll[0]), 'steam_settings');
            game.steamSettings = steamSettingsDir;
            appid.data.steamSettings = steamSettingsDir;
            appid.data.needsSchema = goldberg.readLocalSchema(steamSettingsDir).length === 0;
          }
        } catch (err) {
          debug.log(`[${appid.appid}] emulator auto-detect on resolved gameDir failed => ${err}`);
        }
      }
    }

    // Auto-repair an installed Goldberg/GBE game whose steam_settings/achievements.json schema is
    // missing or empty (flagged by scanInstalledGoldbergGames). Now that we hold the fetched schema
    // (names/descriptions/hidden), write it so in-game pop-ups work. Idempotent: once written the
    // file has entries, so next scan's findCompatibleGames sets hasSchema=true and we skip it. Icons
    // aren't downloaded here (kept fast/non-surprising for a per-scan path) — the Debug-tab scan and
    // the diagnose dialog still offer full repair-with-icons on demand.
    // Offline description backfill (Objective 4 finish): when visible achievements still have blank
    // descriptions and we know this game's install steam_settings, fill them from the local
    // achievements.json schema on disk. This is the only source that works with no Steam Web API key
    // and no internet — and it runs before repair so a freshly written schema carries them too. Only
    // empties are filled (a real fetched description is never overwritten). When showHidden is enabled
    // we also fill descriptions for hidden achievements (they are intentionally blank from the Steam
    // API, but the local schema and the GBE Fork file on disk carry them — Task 3).
    if (appid.data && appid.data.steamSettings && game.achievement && Array.isArray(game.achievement.list)) {
      const showHidden = !!(option.achievement && option.achievement.showHidden);
      const hasBlank = game.achievement.list.some(
        (ac) => (ac.hidden != 1 || showHidden) && (!ac.description || String(ac.description).trim() === '')
      );
      if (hasBlank) {
        try {
          const local = goldberg.readLocalSchema(appid.data.steamSettings);
          if (local.length > 0) {
            const byName = new Map(local.filter((a) => a && a.name != null).map((a) => [String(a.name).toUpperCase(), a]));
            let filled = 0;
            for (const ac of game.achievement.list) {
              if (ac.hidden == 1 && !showHidden) continue; // skip hidden unless toggle is on
              const l = byName.get(String(ac.name).toUpperCase());
              if (!l) continue;
              if ((!ac.description || String(ac.description).trim() === '') && l.description && String(l.description).trim()) {
                ac.description = l.description;
                filled++;
              }
              if ((!ac.displayName || String(ac.displayName).trim() === '') && l.displayName && String(l.displayName).trim()) ac.displayName = l.displayName;
            }
            if (filled > 0) debug.log(`[${appid.appid}] backfilled ${filled} blank description(s) from local steam_settings schema`);
          }
        } catch (err) {
          debug.log(`[${appid.appid}] local schema backfill failed => ${err}`);
        }
      }
    }

    // Runtime GSE configs are required even when achievements.json already existed before AW saw the
    // game. Previously they lived inside the needsSchema block, so a valid schema permanently skipped
    // DLC + identity/language generation. Create missing files independently and keep user identity
    // synchronized without repatching the emulator DLL or rewriting the achievement schema.
    if (appid.data && appid.data.steamSettings && /^[0-9]+$/.test(String(appid.appid))) {
      const steamSettings = appid.data.steamSettings;
      try {
        const appConfigFile = path.join(steamSettings, 'configs.app.ini');
        let needsDlcConfig = true;
        try {
          const current = fs.readFileSync(appConfigFile, 'utf8');
          needsDlcConfig = !/^\s*\[app::dlcs\][\s\S]*?^\s*unlock_all\s*=\s*1\s*$/im.test(current);
        } catch {}
        if (needsDlcConfig) {
          let dlcs = [];
          try { dlcs = await steam.getDLCList(appid.appid); } catch {}
          const dlc = goldberg.writeDlcConfig({ steamSettings, dlcs, unlockAll: true });
          debug.log(`[${appid.appid}] created configs.app.ini (unlock_all=1, ${dlc.count} DLC(s))`);
        }
        const user = goldberg.writeUserConfig({
          steamSettings,
          accountName: option.general && option.general.username,
          language: option.achievement && option.achievement.lang,
        });
        if (user && user.changed) debug.log(`[${appid.appid}] updated configs.user.ini (${user.accountName || 'default'}, ${user.language || 'default'})`);
      } catch (err) {
        debug.log(`[${appid.appid}] runtime GSE config generation failed => ${err}`);
      }
    }

    const hasSteamAchievementSchema = !!(game.achievement && Array.isArray(game.achievement.list) && game.achievement.list.length > 0);
    let needsRuntimeFix = false;
    let runtimeFixReason = '';
    if (
      appid.data &&
      appid.data.type === 'file' &&
      resolvedGameDir &&
      hasSteamAchievementSchema &&
      /^[0-9]+$/.test(String(appid.appid)) &&
      option.emulator &&
      option.emulator.autoApplyNewGames !== false
    ) {
      try {
        resolvedEmu = resolvedEmu || detectEmulatorCached(resolvedGameDir);
        resolvedExe = resolvedExe || exeDetect.detect(resolvedGameDir, game.name || '', { dllPaths: resolvedEmu.dll });
        const arch = (resolvedExe && resolvedExe.full && pe.exeArch(resolvedExe.full)) || 'x64';
        const wanted = gbeInstaller.ARCH[arch] && gbeInstaller.ARCH[arch].file;
        const hasWantedDll = wanted && resolvedEmu.dll.some((file) => path.basename(file).toLowerCase() === wanted);
        needsRuntimeFix = !!wanted && !hasWantedDll && !!appid.data.steamSettings;
        runtimeFixReason = needsRuntimeFix ? `missing-${wanted}` : '';
      } catch (err) {
        debug.log(`[${appid.appid}] runtime emulator fix check failed => ${err}`);
      }
    }

    if (
      appid.data &&
      appid.data.steamSettings &&
      hasSteamAchievementSchema &&
      (appid.data.needsSchema || needsRuntimeFix)
    ) {
      // Run the full right-click setup (autoApplyEmulatorFix = download/run generate_emu_config +
      // Steamless + install the matching GBE DLL, then goldberg.repair = write achievements.json so
      // in-game pop-ups work) in the BACKGROUND, not inline. None of it is needed to DISPLAY the game —
      // its schema is already loaded above — only for in-game unlocks to work, and the first run can
      // take ~70s. Awaiting it here blew the 45s per-game timeout, which dropped the freshly detected
      // game from the scan AND stretched the whole makeList to ~48s (e.g. LEGO Batman / 2215200). So
      // fire-and-forget: the game shows immediately this scan, and the next scan reflects the fixed
      // state from disk (written schema → needsSchema clears, installed DLL → green dot). Guarded by
      // _emuFixInFlight so repeated scans don't relaunch the same setup while it is still running.
      // The DLL swap (autoApplyEmulatorFix) is still gated on autoApplyNewGames; the schema write runs
      // regardless of that toggle for a needsSchema game, exactly as before.
      const canAutoApply = !!(option.emulator && option.emulator.autoApplyNewGames !== false && resolvedGameDir && _userDataPath);
      const fixKey = `${appid.appid}:${resolvedGameDir || appid.data.steamSettings}`;
      if (_emuFixInFlight.has(fixKey)) {
        debug.log(`[${appid.appid}] emulator setup already running in background — will appear fixed on a later scan`);
      } else {
        _emuFixInFlight.add(fixKey);
        const bgAppid = appid.appid;
        const bgGameDir = resolvedGameDir;
        const bgSteamSettings = appid.data.steamSettings;
        const bgNeedsSchema = !!appid.data.needsSchema;
        const bgGameName = game.name;
        const bgEmu = resolvedEmu;
        const bgExe = resolvedExe;
        // Snapshot the schema (shallow-copied list entries) so goldberg.repair reads a stable copy and
        // never races the foreground unlock-state merge that mutates the original list elements below.
        const bgSchema = {
          name: game.name,
          achievement: {
            total: game.achievement && game.achievement.total,
            list: game.achievement && Array.isArray(game.achievement.list) ? game.achievement.list.map((a) => ({ ...a })) : [],
          },
        };
        (async () => {
          let fixedSteamSettingsDirs = [];
          let fixApplied = false;
          if (canAutoApply) {
            try {
              const setup = await autoApplyEmulatorFix({
                gameDir: bgGameDir,
                gameName: bgGameName,
                appid: bgAppid,
                steamSettings: bgSteamSettings,
                option,
                detectedEmu: bgEmu,
                detectedExe: bgExe,
              });
              fixedSteamSettingsDirs = setup.steamSettingsDirs || [];
              fixApplied = true;
              debug.log(
                `[${bgAppid}] automatic emulator fix complete (GBE Fork ${setup.tag || 'cached'}${runtimeFixReason ? `, ${runtimeFixReason}` : ''})`
              );
            } catch (err) {
              debug.log(`[${bgAppid}] automatic emulator fix failed => ${err}`);
            }
          }

          const schemaRepairDirs = new Set();
          if (bgNeedsSchema) schemaRepairDirs.add(bgSteamSettings);
          for (const dir of fixedSteamSettingsDirs) {
            if (dir && (bgNeedsSchema || goldberg.readLocalSchema(dir).length === 0)) schemaRepairDirs.add(dir);
          }

          if (schemaRepairDirs.size > 0) {
            const downloadIcon =
              option.achievement && option.achievement.goldbergDownloadIcons
                ? (() => {
                    const request = require('request-zero');
                    return async (url, dir) => {
                      const r = await request.download(url, dir);
                      return r && r.path;
                    };
                  })()
                : undefined;
            for (const steamSettingsDir of schemaRepairDirs) {
              try {
                const summary = await goldberg.repair({
                  steamSettings: steamSettingsDir,
                  appid: bgAppid,
                  schema: bgSchema,
                  downloadIcon,
                  fetchDlc: (id) => steam.getDLCList(id),
                  accountName: option.general && option.general.username,
                  language: option.achievement && option.achievement.lang,
                });
                debug.log(
                  `[${bgAppid}] wrote missing achievements.json schema (${summary.achievementsJson.length} entries) to ${steamSettingsDir}` +
                    (downloadIcon ? ` + icons: ${summary.icons.downloaded} dl, ${summary.icons.failed} fail` : '') +
                    (summary.dlc ? ` + ${summary.dlc.count} DLC(s)` : '') +
                    (summary.user && summary.user.language ? ` + lang ${summary.user.language}` : '')
                );
              } catch (err) {
                debug.log(`[${bgAppid}] could not auto-write achievements.json schema to ${steamSettingsDir} => ${err}`);
              }
            }
          }

          // Notify the daemon so it can fire the "emulator fix applied" toast (the old in-band
          // emulatorJustFixed marker can't reach it anymore — this setup finishes after onGame ran).
          if (fixApplied && _onEmulatorFixed) {
            try {
              _onEmulatorFixed({ appid: bgAppid, name: bgGameName });
            } catch (err) {
              debug.log(`[${bgAppid}] emulator-fixed handler failed => ${err}`);
            }
          }
        })()
          .catch((err) => debug.log(`[${bgAppid}] background emulator setup error => ${err}`))
          .finally(() => _emuFixInFlight.delete(fixKey));
      }
    }

    // Auto-seed playtime tracking: when we know the game's install folder, detect its main
    // executable and pre-register it in the watchdog gameIndex so playtime is tracked without
    // the user having to launch the game once first (Task 1).
    // The same exe detection also doubles as the "really installed" disk proof used by the
    // "show installed only" toggle (see game.installed below).
    let hasResolvedExe = false;
    if (resolvedGameDir && game.name) {
      try {
        const gameDirKey = path.resolve(resolvedGameDir).toLowerCase();
        if (_seededGameDirs.has(gameDirKey)) {
          debug.log(`[${appid.appid}] playtime auto-seed skipped: install folder already has a detected executable`);
        } else {
          const emu = resolvedEmu || detectEmulatorCached(resolvedGameDir);
          const exeInfo = resolvedExe || exeDetect.detect(resolvedGameDir, game.name, { dllPaths: emu.dll });
          resolvedExe = exeInfo || resolvedExe;
          hasResolvedExe = !!exeInfo;
          if (exeInfo) {
            _seededGameDirs.add(gameDirKey);
            const iconHash =
              game.img && game.img.icon ? String(game.img.icon).split('/').pop().split('.')[0] : '';
            gameIndex.upsert({ appid: appid.appid, name: game.name, binary: exeInfo.name, icon: iconHash });
            debug.log(`[${appid.appid}] auto-seeded playtime tracking: binary="${exeInfo.name}"`);
          }
        }
      } catch (err) {
        debug.log(`[${appid.appid}] playtime auto-seed failed: ${err}`);
      }
    }

    for (let appid of appids) {
      if (isDuplicate && !option.achievement.mergeDuplicate) continue;

      let root = {};
      try {
        if (appid.data.type === 'file') {
          root = await steam.getAchievementsFromFile(appid.data.path);
          //Note to self: Empty file should be considered as a 0% game -> do not throw an error just issue a warning
          if (root.constructor === Object && Object.entries(root).length === 0)
            debug.warn(`[${appid.appid}] Warning ! Achievement file in '${appid.data.path}' is probably empty`);
        } else if (appid.data.type === 'reg') {
          root = await greenluma.getAchievements(appid.data.root, appid.data.path);
        } else if (appid.data.type === 'steamAPI') {
          root = await steam.getAchievementsFromAPI({
            appID: appid.appid,
            user: appid.data.userID,
            path: appid.data.cachePath,
            key: option.steam.apiKey,
          });
        } else if (appid.data.type === 'rpcs3') {
          root = await rpcs3.getAchievements(appid.data.path, game.achievement.total);
        } else if (appid.data.type === 'shadps4') {
          root = await shadps4.getAchievements(appid.data.path);
        } else if (appid.data.type === 'xenia') {
          root = await xenia.getAchievements(appid.data.path);
        } else if (appid.data.type === 'lumaplay') {
          root = uplay.getAchievementsFromLumaPlay(appid.data.root, appid.data.path);
        } else if (appid.data.type === 'ea') {
          root = await ea.getAchievements(appid);
        } else if (appid.data.type === 'cached') {
          root = await watchdog.getAchievements(appid.appid);
        } else if (appid.data.type === 'uplay') {
          // Legit Ubisoft Connect exposes no local unlock-state file the way the Steam emus do, so
          // only the schema is available (already loaded into `game`). Show the game with everything
          // locked instead of throwing a misleading "Not yet implemented" FAIL on every scan.
          root = {};
        } else {
          throw 'Not yet implemented';
        }
      } catch (err) {
        // A missing save file is the normal 0%-game case (emulator made the folder but nothing is
        // unlocked yet) — the game still shows with its full schema, all locked. Log it as info, not
        // a scary error, so the debug log highlights real parse failures instead of expected 0% games.
        if (String(err).includes('No achievement file found')) {
          debug.log(`[${appid.appid}] No unlocked achievements yet (0%) in '${appid.data.path}'`);
        } else {
          debug.error(`[${appid.appid}] Error parsing local achievements data => ${err}`);
        }
      }

      for (let i in root) {
        if (Object.prototype.hasOwnProperty.call(root, i)) {
          try {
            let achievement = game.achievement.list.find((elem) => {
              if (root[i].crc) {
                return root[i].crc.includes(crc32(elem.name).toString(16)); //(SSE) crc module removes leading 0 when dealing with anything below 0x1000 -.-'
              } else {
                let apiname = root[i].id || root[i].apiname || root[i].name || root[i].AchievementId || i;
                return elem.name == apiname || elem.name.toString().toUpperCase() == apiname.toString().toUpperCase(); //uppercase == uppercase : cdx xcom chimera (apiname doesn't match case with steam schema)
              }
            });
            if (!achievement) throw 'ACH_NOT_FOUND_IN_SCHEMA';

            // Does this entry carry an explicit unlocked/locked flag? Newer emu save formats
            // (e.g. UniverseLAN for GOG) write every achievement with Unlocked=true/false, so we
            // must trust that flag rather than assume "present == unlocked" (issue #48).
            const hasExplicitState =
              root[i] != null &&
              typeof root[i] === 'object' &&
              ['Achieved', 'achieved', 'State', 'HaveAchieved', 'Unlocked', 'unlocked', 'earned'].some((k) => k in root[i]);

            let parsed = {
              Achieved:
                isTruthyFlag(root[i].Achieved) ||
                isTruthyFlag(root[i].achieved) ||
                root[i].State == 1 ||
                isTruthyFlag(root[i].HaveAchieved) ||
                isTruthyFlag(root[i].Unlocked) ||
                isTruthyFlag(root[i].unlocked) ||
                isTruthyFlag(root[i].earned) ||
                root[i] === '1'
                  ? true
                  : false,
              CurProgress: root[i].CurProgress || root[i].progress || 0,
              MaxProgress: root[i].MaxProgress || root[i].max_progress || 0,
              UnlockTime:
                root[i].UnlockTime ||
                root[i].unlocktime ||
                root[i].HaveAchievedTime ||
                root[i].HaveHaveAchievedTime ||
                root[i].Time ||
                root[i].earned_time ||
                root[i].unlock_time ||
                root[i].timestamp ||
                0,
            };

            //CODEX Gears5 (09/2019) && Gears tactics (05/2020): progress maxed out but the
            //Achieved flag was never written -> treat a fully completed progress bar as unlocked.
            if (!parsed.Achieved && parsed.MaxProgress != 0 && parsed.CurProgress != 0 && parsed.MaxProgress == parsed.CurProgress) {
              parsed.Achieved = true;
            }

            //Legacy GOG/Epic emu saves list ONLY unlocked achievements with no explicit flag, so a
            //bare entry means "unlocked". But formats that DO carry an explicit Unlocked=true/false
            //(e.g. UniverseLAN) must be trusted instead of blanket-unlocking everything (issue #48).
            if ((game.source === 'gog' || game.source === 'epic') && !hasExplicitState) {
              parsed.Achieved = true;
            }

            if (isDuplicate) {
              if (parsed.Achieved && !achievement.Achieved) {
                achievement.Achieved = true;
              }

              if (
                (!achievement.CurProgress && parsed.CurProgress > 0) ||
                (parsed.CurProgress > 0 && parsed.MaxProgress == achievement.MaxProgress && parsed.CurProgress > achievement.CurProgress)
              ) {
                achievement.CurProgress = parsed.CurProgress;
              }

              if (!achievement.MaxProgress && parsed.MaxProgress > 0) {
                achievement.MaxProgress = parsed.MaxProgress;
              }

              if (option.achievement.timeMergeRecentFirst) {
                if (!achievement.UnlockTime || achievement.UnlockTime == 0 || parsed.UnlockTime > achievement.UnlockTime) {
                  //More recent first
                  achievement.UnlockTime = parsed.UnlockTime;
                }
              } else {
                if (!achievement.UnlockTime || achievement.UnlockTime == 0 || (parsed.UnlockTime > 0 && parsed.UnlockTime < achievement.UnlockTime)) {
                  //Oldest first
                  achievement.UnlockTime = parsed.UnlockTime;
                }
              }
            } else {
              Object.assign(achievement, parsed);
              isDuplicate = true;
            }
          } catch (err) {
            if (err === 'ACH_NOT_FOUND_IN_SCHEMA') {
              debug.warn(`[${appid.appid}] Achievement not found in game schema data ?! ... Achievement was probably deleted or renamed over time`);
            } else {
              debug.error(`[${appid.appid}] Unexpected Error: ${err}`);
            }
          }
        }
      }
    }
    game.achievement.unlocked = game.achievement.list.filter((ach) => ach.Achieved == 1).length;
    // Reconcile the denominator with the real achievement list. A schema/list desync could leave
    // `total` at 0 (or below the number actually displayed), producing the "39 / 0" the UI shows for a
    // completed game and percentages above 100%. The list is what the detail view renders, so it is the
    // authoritative count; never let total be smaller than it. (Objective 6/7 — display reliability.)
    if (!Number.isFinite(game.achievement.total) || game.achievement.total < game.achievement.list.length) {
      game.achievement.total = game.achievement.list.length;
    }

    // Flag whether this game is really installed, to drive the "show installed only" toggle.
    // steamAPI/rpcs3 entries are always real installs; a legit Ubisoft Connect game counts only
    // when the launcher's Installs registry confirms it (scanLegit lists OWNED games, not installed);
    // everything else (emulator save folders incl. Goldberg/GSE and the gog/epic Nemirtingas emus,
    // cache imports, greenluma, lumaplay) needs on-disk proof: a resolved install folder with a valid
    // exe. The exeList signal (a still-living configured launch exe) is OR'd in by the renderer after
    // exeList.reconcile() has cleaned dead paths.
    game.installed = installState.isInstalled({
      dataType,
      hasResolvedExe,
      trustedInstalled:
        !!(appid.data && appid.data.trustedInstalled) ||
        (dataType === 'uplay' ? uplay.isInstalled(appid.appid) : false),
    });

    return game;
    //loop appid
  } catch (err) {
    debug.error(`[${requestedAppid}] Error parsing local achievements data => ${err} > SKIPPING`);
  }
};

// Lightweight discovery-only pass: runs the same folder/library walk makeList uses but skips the
// heavy per-game achievement/icon loading. Returns the list of discovered appids (as strings).
// Used by the renderer's periodic background detection to spot newly-installed games cheaply and
// decide whether a full refresh (which re-seeds the watchdog gameIndex) is worth running.
module.exports.detectInstalledAppids = async (option) => {
  try {
    const list = await discover(option.achievement_source, option.steam.main);
    return list.map((g) => String(g.appid));
  } catch (err) {
    debug.error(`detectInstalledAppids failed => ${err}`);
    return [];
  }
};

module.exports.makeList = async (option, callbackProgress, onGame = () => {}) => {
  try {
    debug.log('Scanning for games ...');
    _emuCache = new Map();
    _seededGameDirs = new Set();
    const scanStart = Date.now();

    let result = [];

    // Reuse the discovery phase if an identical scan ran within DISCOVER_TTL_MS (e.g. a settings-save
    // rescan moments after load). The key covers everything that changes the resulting game set, so
    // any real change forces a fresh scan; _folderIndex / _claimedDirs are restored alongside the list
    // so the per-game phase below behaves exactly as on a fresh scan.
    let appidList;
    let cacheKey = null;
    try {
      cacheKey = JSON.stringify({
        src: option.achievement_source,
        main: option.steam.main,
        udirs: (await userDir.get()).map((d) => d.path),
        ldirs: await libraryDirs.get(),
        bl: await blacklist.get(),
      });
    } catch {
      cacheKey = null; // can't build a key -> always scan fresh
    }
    if (cacheKey && _discoverCache && _discoverCache.key === cacheKey && Date.now() - _discoverCache.time < DISCOVER_TTL_MS) {
      appidList = _discoverCache.appidList;
      _folderIndex = _discoverCache.folderIndex;
      _claimedDirs = _discoverCache.claimedDirs;
      debug.log(`[discover] reusing cached scan (${((Date.now() - _discoverCache.time) / 1000).toFixed(1)}s old)`);
    } else {
      _folderIndex = null; // rebuild the name-match folder index for this scan
      _claimedDirs = new Set();
      appidList = await discover(option.achievement_source, option.steam.main);
      if (cacheKey) _discoverCache = { key: cacheKey, time: Date.now(), appidList, folderIndex: _folderIndex, claimedDirs: _claimedDirs };
    }
    let finalList = appidList;
    if (option.achievement.mergeDuplicate) {
      const seen = new Map();
      const duplicates = new Set();
      const result = [];
      for (const game of appidList) {
        if (seen.has(game.appid)) {
          duplicates.add(game.appid);
        } else {
          seen.set(game.appid, game);
        }
      }
      for (const game of appidList) {
        if (duplicates.has(game.appid)) {
          if (!result.some((g) => g.appid === game.appid)) {
            result.push({
              appid: game.appid,
              source: game.source,
            });
          }
        } else {
          result.push(game);
        }
      }
      finalList = result;
    }
    if (finalList.length > 0) {
      let count = 0;
      // Bounded concurrency. The old code fired every game at once (Promise.all over the whole list,
      // staggered by 10ms): with a Web API key that is a burst of N parallel fetches, and the disk
      // reads / sockets / file handles all spike together. A small worker pool caps how many games
      // load in parallel while they still stream into the UI via onGame as each one resolves.
      const CONCURRENCY = 6;
      let cursor = 0;
      const worker = async () => {
        while (cursor < finalList.length) {
          const appid = finalList[cursor++];
          const startTime = Date.now();
          debug.log(`[${appid.appid}] loading data...`);
          let game;
          try {
            game = await withTimeout(
              this.getSavedAchievementsForAppid(option, appid, appidList),
              GAME_LOAD_TIMEOUT_MS,
              `[${appid.appid}] timed out after ${GAME_LOAD_TIMEOUT_MS / 1000}s`
            );
          } catch (err) {
            debug.error(`[${appid.appid}] load failed => ${err}`);
          }
          const endTime = Date.now();
          if (!game) {
            // Do NOT auto-blacklist on a failed load (issue #55): getGameData() swallows every
            // error (missing API key, network hiccup, rate-limit, CDN down) and returns undefined,
            // so a single transient failure used to permanently hide a real game. Just skip it for
            // this scan and let it be retried next time. Intentional exclusions (hardcoded bogus
            // list, server list, manual "blacklist" action) keep working untouched.
            debug.log(`[${appid.appid}] could not load (will retry next scan) - took ${(endTime - startTime) / 1000} seconds.`);
          }
          // Keep a game if it has achievements, OR it's a genuine on-disk install even with none
          // (e.g. UNDERTALE has zero Steam achievements) — same rationale as unconfigured installs.
          // Non-installed 0-achievement entries (phantom cache imports) are still filtered out.
          if (game && (game.unconfigured || game.installed || (game.achievement && game.achievement.total > 0))) {
            result.push(game);
            // requestAnimationFrame is a renderer-only API. The daemon runs makeList headless (no
            // window) to apply emulator fixes in the background, so fall back to a direct call there.
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => onGame?.(game));
            } else {
              onGame?.(game);
            }

            debug.log(`[${game.appid}] ${game.name} took ${(endTime - startTime) / 1000} seconds.`);
          }
          count++;
          callbackProgress(Math.floor((count / finalList.length) * 100));
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, finalList.length) }, () => worker()));
    }
    debug.log(`makeList: ${result.length} game(s) in ${((Date.now() - scanStart) / 1000).toFixed(2)}s`);
    callbackProgress(100);
    await new Promise((r) => setTimeout(r, 10));
    return result;
  } catch (err) {
    debug.error(err);
    throw err;
  }
};
