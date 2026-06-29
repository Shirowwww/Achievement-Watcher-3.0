'use strict';

/*
  Goldberg / GBE Fork install validation & repair helpers.

  These are pure, side-effect-light functions (one optional network download in repair) so the
  achievement logic can be unit-tested without the Electron UI. They let the app answer
  "is this game's emulator achievement setup actually correct, and what's missing?" and
  produce a GBE-Fork-compatible achievements.json (verified field shape against
  Detanup01/gbe_fork steam_settings.EXAMPLE: name/displayName/description/hidden("0"|"1")/icon/icongray).
*/

const fs = require('fs');
const path = require('path');
const exeDetect = require(path.join(__dirname, 'exeDetect.js'));

const APPID_CONFIG_FILES = new Set([
  'steam_appid.txt',
  'steam_emu.ini',
  'ali213.ini',
  'valve.ini',
  'steamconfig.ini',
  'hlm.ini',
  'ds.ini',
  'steam_api.ini',
  'cpy.ini',
  'coldclientloader.ini',
  'smartsteamemu.ini',
  'coldapi.ini',
  'tenoke.ini',
]);
const AUXILIARY_SETTINGS_DIRS = new Set([
  '__overlay',
  'overlay',
  '__installer',
  '_commonredist',
  'commonredist',
  'redist',
  'directx',
  'dotnet',
  'vc',
  'vcredist',
  'prerequisites',
  'prereq',
  'support',
  'tools',
]);

// Subfolder name fragments that mark a *companion tool* shipped beside a game (with its own Steam app
// id) rather than the game itself: modding editors, SDKs, level/world editors, creation/dev kits,
// authoring & workshop tools, dedicated servers, benchmarks. The nested-appid walk never descends into
// these, so e.g. "The Divinity Engine 2" (435730, bundled inside Divinity: Original Sin 2 = 435150)
// can't hijack the game's identity. Each fragment is matched on word boundaries and tolerates
// space/underscore/hyphen separators. Multi-word fragments are *qualified* (e.g. "creation kit",
// "dedicated server" — never a bare "kit"/"server"/"tools") so a real game's own folder, or a game
// whose title merely contains one of these words, is not mistaken for a tool and hidden.
const TOOL_SUBDIR = new RegExp(
  [
    '\\bengine\\b',
    '\\beditor\\b',
    '\\bsdks?\\b',
    '\\btoolkit\\b',
    '\\bmodkit\\b',
    '\\bbenchmark\\b',
    '\\b(?:level|map|world)[\\s_-]?editor\\b', // also catches concatenated "LevelEditor"
    '\\b(?:mod|dev|creation|construction)[\\s_-]?kit\\b',
    '\\b(?:mod|dev|authoring|workshop|server)[\\s_-]?tools?\\b',
    '\\bdedicated[\\s_-]?server\\b',
  ].join('|'),
  'i'
);

function parseAppidFromConfig(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    if (path.basename(file).toLowerCase() === 'steam_appid.txt') {
      const match = content.match(/^\s*([0-9]+)/);
      return match ? match[1] : null;
    }
    const patterns = [
      /^\s*app(?:id|ID)\s*=\s*([0-9]+)/im,
      /^\s*AppId\s*=\s*([0-9]+)/im,
      /^\s*AppID\s*=\s*([0-9]+)/im,
      /^\s*appid\s*=\s*([0-9]+)/im,
      /^\s*id\s*=\s*([0-9]+)/im,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) return match[1];
    }
  } catch {
    /* ignore unreadable config */
  }
  return null;
}

// Locate the steam_settings folder for a game. GBE Fork keeps it next to the emu .dll, which may be
// at the game root or nested under engine subfolders (e.g. Unreal's <Name>/Binaries/Win64). Returns
// the first match (shallowest), or null.
function findSteamSettings(gameDir, maxDepth = 6) {
  if (!gameDir || !fs.existsSync(gameDir)) return null;
  const direct = path.join(gameDir, 'steam_settings');
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) return direct;

  let best = null;
  let bestScore = -Infinity;
  let bestDepth = Infinity;
  const scoreSteamSettings = (dir, depth) => {
    let score = -depth;
    try {
      const entries = fs.readdirSync(dir).map((e) => e.toLowerCase());
      if (entries.includes('achievements.json')) score += 100;
      if (entries.some((e) => GBE_CONFIG_FILES.includes(e) || CLASSIC_CONFIG_FILES.includes(e))) score += 50;
      if (entries.includes('steam_appid.txt')) score += 20;
      if (entries.includes('steam_interfaces.txt')) score += 5;
      const relativeParts = path
        .relative(gameDir, dir)
        .split(/[\\/]+/)
        .map((p) => p.toLowerCase())
        .filter(Boolean);
      if (relativeParts.some((p) => AUXILIARY_SETTINGS_DIRS.has(p))) score -= 200;
    } catch {
      /* unreadable steam_settings remains a weak candidate */
    }
    return score;
  };
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.toLowerCase() === 'steam_settings') {
        const candidate = path.join(dir, e.name);
        const score = scoreSteamSettings(candidate, depth);
        if (score > bestScore || (score === bestScore && depth < bestDepth)) {
          best = candidate;
          bestScore = score;
          bestDepth = depth;
        }
        continue; // no need to descend into a steam_settings folder
      }
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  walk(gameDir, 0);
  return best;
}

// GBE Fork (Detanup01) keeps its configuration in INI files named configs.*.ini, in steam_settings
// and/or the global GSE Saves/settings folder. Classic Goldberg (mr_goldberg) used loose .txt files
// (force_account_name.txt, user_steam_id.txt, …) and a settings/ subfolder instead. The presence of
// any configs.*.ini is the most reliable on-disk tell that this is the fork rather than the original.
const GBE_CONFIG_FILES = ['configs.main.ini', 'configs.user.ini', 'configs.app.ini', 'configs.overlay.ini'];
const CLASSIC_CONFIG_FILES = ['force_account_name.txt', 'user_steam_id.txt', 'account_name.txt', 'language.txt', 'listen_port.txt'];
const EMU_DLL_NAMES = ['steam_api.dll', 'steam_api64.dll'];

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function copyIntoBackup(source, gameDir, backupDir) {
  const relative = path.relative(gameDir, source);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`backup: path is outside the game folder: ${source}`);
  }
  const destination = path.join(backupDir, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, errorOnExist: false, force: true });
  return relative;
}

// Create a portable, user-requested backup of the files AW may touch for a Goldberg/GBE setup.
// Relative paths are preserved so nested Unreal/Unity DLL locations can be restored unambiguously.
function backupSetup({ gameDir, destinationRoot, steamSettings } = {}) {
  if (!gameDir || !fs.existsSync(gameDir) || !fs.statSync(gameDir).isDirectory()) {
    throw new Error(`backup: game folder not found: ${gameDir}`);
  }
  if (!destinationRoot) throw new Error('backup: destination folder is required');

  const resolvedGameDir = path.resolve(gameDir);
  const resolvedDestination = path.resolve(destinationRoot);
  const destinationInsideGame = resolvedDestination === resolvedGameDir || resolvedDestination.startsWith(resolvedGameDir + path.sep);
  if (destinationInsideGame) throw new Error('backup: choose a destination outside the game folder');

  const emu = detectEmulator(gameDir);
  const settingsDir = steamSettings || emu.steamSettings || findSteamSettings(gameDir);
  const sources = [...emu.dll];
  if (settingsDir && fs.existsSync(settingsDir)) sources.push(settingsDir);
  if (sources.length === 0) throw new Error('backup: no steam_settings or Steam API DLL was found');

  const safeName = path.basename(path.resolve(gameDir)).replace(/[\\/:*?"<>|]/g, '_') || 'game';
  let backupDir = path.join(destinationRoot, `${safeName} - GBE backup - ${backupTimestamp()}`);
  let suffix = 2;
  while (fs.existsSync(backupDir)) backupDir = path.join(destinationRoot, `${safeName} - GBE backup - ${backupTimestamp()} (${suffix++})`);
  fs.mkdirSync(backupDir, { recursive: true });

  const files = sources.map((source) => copyIntoBackup(source, gameDir, backupDir));
  const manifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    gameDir: resolvedGameDir,
    emulator: emu.type,
    files,
  };
  fs.writeFileSync(path.join(backupDir, 'backup.json'), JSON.stringify(manifest, null, 2));
  return { backupDir, files, manifest };
}

// Restore a portable backup created by backupSetup back into a game folder. Reads the backup.json
// manifest and copies each recorded relative path back over the live files (DLLs + steam_settings),
// preserving the nested Unreal/Unity DLL locations the backup captured. Restores into the manifest's
// recorded gameDir by default; pass `gameDir` to redirect to a relocated install. A tampered manifest
// can't escape the target folder — the same containment guard as copyIntoBackup is applied per path.
function restoreSetup({ backupDir, gameDir } = {}) {
  if (!backupDir || !fs.existsSync(backupDir) || !fs.statSync(backupDir).isDirectory()) {
    throw new Error(`restore: backup folder not found: ${backupDir}`);
  }
  const manifestFile = path.join(backupDir, 'backup.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error('restore: backup.json manifest is missing — not an Achievement Watcher GBE backup');
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (e) {
    throw new Error(`restore: backup.json is not valid JSON: ${e.message}`);
  }

  const targetGameDir = gameDir || manifest.gameDir;
  if (!targetGameDir) throw new Error('restore: no target game folder (manifest has no gameDir and none was provided)');
  const resolvedGameDir = path.resolve(targetGameDir);

  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) throw new Error('restore: the manifest lists no files to restore');

  fs.mkdirSync(resolvedGameDir, { recursive: true });
  const restored = [];
  for (const relative of files) {
    const destination = path.resolve(resolvedGameDir, relative);
    if (destination !== resolvedGameDir && !destination.startsWith(resolvedGameDir + path.sep)) {
      throw new Error(`restore: manifest path is outside the game folder: ${relative}`);
    }
    const source = path.join(backupDir, relative);
    if (!fs.existsSync(source)) continue; // tolerate a partial/hand-edited backup
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true, force: true });
    restored.push(relative);
  }
  return { gameDir: resolvedGameDir, files: restored, manifest };
}

function listShallow(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// Identify which Steam emulator a game folder is set up with, by inspecting on-disk signatures.
// Returns { type: 'gbe' | 'goldberg' | 'none', steamSettings, dll: [...], configs: [...] }.
// 'gbe' = GBE Fork (configs.*.ini present), 'goldberg' = classic Goldberg (steam_settings but only
// the legacy loose-file config style), 'none' = no recognizable emulator setup.
function detectEmulator(gameDir) {
  const result = { type: 'none', steamSettings: null, dll: [], configs: [] };
  if (!gameDir || !fs.existsSync(gameDir)) return result;

  // Replaced steam_api dll(s) anywhere shallow under the game root (the dll sits next to the binary).
  // Read each directory once with dirents instead of a statSync() per entry — a syscall-per-file walk
  // over a large game folder dominated detectEmulator's cost; this matches findSteamSettings/walk below.
  const findDll = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const lower = e.name.toLowerCase();
      if (e.isDirectory()) {
        if (lower !== 'steam_settings') findDll(path.join(dir, e.name), depth + 1);
      } else if (e.isFile() && EMU_DLL_NAMES.includes(lower)) {
        result.dll.push(path.join(dir, e.name));
      }
    }
  };
  findDll(gameDir, 0);

  const steamSettings = findSteamSettings(gameDir);
  result.steamSettings = steamSettings;
  if (!steamSettings) {
    // No steam_settings but a replaced dll still means an emulator is present (just unconfigured).
    if (result.dll.length) result.type = 'goldberg';
    return result;
  }

  const entries = listShallow(steamSettings).map((e) => e.toLowerCase());
  result.configs = entries.filter((e) => GBE_CONFIG_FILES.includes(e));
  if (result.configs.length > 0) {
    result.type = 'gbe';
  } else if (entries.length > 0) {
    result.type = 'goldberg';
  } else {
    result.type = result.dll.length ? 'goldberg' : 'none';
  }
  return result;
}

// Build the GBE-Fork achievements.json array from an Achievement Watcher schema.
// imagePrefix is the on-disk folder name the icons live in (default "images").
function buildAchievementsJson(schema, imagePrefix = 'images') {
  const list = (schema && schema.achievement && Array.isArray(schema.achievement.list) && schema.achievement.list) || [];
  return list.map((a) => ({
    description: a.description || '',
    displayName: a.displayName || a.name,
    hidden: a.hidden == 1 ? '1' : '0',
    icon: a.icon ? `${imagePrefix}/${path.parse(String(a.icon).split('?')[0]).base}` : '',
    icongray: a.icongray ? `${imagePrefix}/${path.parse(String(a.icongray).split('?')[0]).base}` : '',
    name: a.name,
  }));
}

function hasRichProgressSchema(steamSettings, schema) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'));
    if (!Array.isArray(parsed)) return false;
    if (!parsed.some((item) => item && item.progress && item.progress.value && item.progress.value.operand1)) return false;
    const expected = (schema && schema.achievement && Array.isArray(schema.achievement.list) && schema.achievement.list) || [];
    if (expected.length === 0) return true;
    const names = new Set(parsed.filter((item) => item && item.name != null).map((item) => String(item.name).toUpperCase()));
    return expected.every((item) => item && item.name != null && names.has(String(item.name).toUpperCase()));
  } catch {
    return false;
  }
}

// Default runtime save roots, newest emulator first. GBE Fork writes to GSE Saves; classic Goldberg
// to "Goldberg SteamEmu Saves". Both keep one <appid>/ subfolder with an achievements.json holding
// only the unlock STATE ({ "<apiname>": { "earned": true, "earned_time": ... } }) — this is separate
// from the steam_settings/achievements.json SCHEMA. A missing/empty save just means a 0% game.
function defaultSavesRoots() {
  const appdata = process.env['APPDATA'];
  if (!appdata) return [];
  return [
    { type: 'gbe', root: path.join(appdata, 'GSE Saves') },
    { type: 'goldberg', root: path.join(appdata, 'Goldberg SteamEmu Saves') },
  ];
}

// Inspect the runtime save folder(s) for an appid and report whether the emulator has actually
// written any unlocked-achievement state yet. Explains the common "achievements show locked even
// though GBE Fork files are present" case: the save is simply absent/empty (nothing unlocked).
function inspectSaveState(appid, savesRoots = defaultSavesRoots()) {
  const state = { root: null, type: null, file: null, earned: 0, total: 0, exists: false };
  if (appid == null) return state;
  for (const { type, root } of savesRoots) {
    const file = path.join(root, String(appid), 'achievements.json');
    if (!fs.existsSync(file)) continue;
    state.root = root;
    state.type = type;
    state.file = file;
    state.exists = true;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const entries = Array.isArray(data) ? data : Object.values(data || {});
      state.total = entries.length;
      state.earned = entries.filter(
        (e) => e && (e.earned === true || e.Achieved === true || e.earned === 1 || e.unlocked === true || String(e.earned) === '1')
      ).length;
    } catch {
      /* unreadable save — leave counts at 0 */
    }
    break;
  }
  return state;
}

function schemaAchievementsForRuntime({ schema, steamSettings } = {}) {
  const local = readLocalSchema(steamSettings);
  if (local.length > 0) return local;
  return (schema && schema.achievement && Array.isArray(schema.achievement.list) && schema.achievement.list) || [];
}

function runtimeMaxProgress(achievement) {
  const raw =
    achievement &&
    (achievement.max_progress ??
      achievement.maxProgress ??
      (achievement.progress && (achievement.progress.max_val ?? achievement.progress.max ?? achievement.progress.maxValue)));
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function buildRuntimeAchievementsState({ schema, steamSettings } = {}) {
  const state = {};
  for (const achievement of schemaAchievementsForRuntime({ schema, steamSettings })) {
    if (!achievement || achievement.name == null) continue;
    const name = String(achievement.name);
    if (!name) continue;
    state[name] = {
      earned: false,
      earned_time: 0,
      max_progress: runtimeMaxProgress(achievement),
      progress: 0,
    };
  }
  return state;
}

function seedRuntimeSave({ appid, schema, steamSettings, savesRoots = defaultSavesRoots(), types = ['gbe'] } = {}) {
  const summary = { appid: appid != null ? String(appid) : null, entries: 0, roots: [], created: [], skipped: [] };
  if (summary.appid == null) return summary;

  const state = buildRuntimeAchievementsState({ schema, steamSettings });
  summary.entries = Object.keys(state).length;
  if (summary.entries === 0) return summary;

  const wantedTypes = new Set((Array.isArray(types) ? types : [types]).filter(Boolean));
  for (const rootInfo of savesRoots || []) {
    if (!rootInfo || !rootInfo.root) continue;
    const type = rootInfo.type || 'gbe';
    if (wantedTypes.size > 0 && !wantedTypes.has(type)) continue;

    const folder = path.join(rootInfo.root, summary.appid);
    const file = path.join(folder, 'achievements.json');
    summary.roots.push({ type, folder, file });
    fs.mkdirSync(folder, { recursive: true });
    if (type === 'gbe') fs.mkdirSync(path.join(folder, 'stats'), { recursive: true });

    if (fs.existsSync(file)) {
      summary.skipped.push({ type, file, reason: 'exists' });
      continue;
    }

    fs.writeFileSync(file, JSON.stringify(state, null, 2));
    summary.created.push({ type, file });
  }
  return summary;
}

/*
  Diagnose a game's Goldberg/GBE achievement setup.

  cfg: { gameDir, appid, schema, savesRoots? }  (schema = the AW game object with achievement.list)
  Returns a structured report; report.issues is an array of { level: 'error'|'warning', code, message }.
*/
function diagnose({ gameDir, appid, schema, savesRoots }) {
  const report = {
    gameDir,
    appid: appid != null ? String(appid) : null,
    steamSettings: null,
    emulator: 'none', // 'gbe' | 'goldberg' | 'none'
    save: null, // runtime unlock-state summary (from inspectSaveState)
    ok: false,
    issues: [],
    achievements: {
      expected: schema && schema.achievement ? schema.achievement.total ?? (schema.achievement.list || []).length : null,
      found: 0,
      missing: [], // schema achievement names absent from achievements.json
      missingIcons: [], // referenced icon files that don't exist on disk
    },
  };
  const add = (level, code, message) => report.issues.push({ level, code, message });

  // Runtime unlock state is independent of the steam_settings schema, so report it regardless.
  report.save = inspectSaveState(appid, savesRoots);

  if (!gameDir || !fs.existsSync(gameDir)) {
    add('error', 'NO_GAME_DIR', `Game folder not found: ${gameDir}`);
    return report;
  }

  const emu = detectEmulator(gameDir);
  report.emulator = emu.type;
  const steamSettings = emu.steamSettings || findSteamSettings(gameDir);
  report.steamSettings = steamSettings;
  if (!steamSettings) {
    add('error', 'NO_STEAM_SETTINGS', 'No steam_settings folder found beside the emulator — Goldberg/GBE is likely not set up.');
    return report;
  }

  // steam_appid.txt (GBE reads the appid from here or the dll name)
  const appidTxt = path.join(steamSettings, 'steam_appid.txt');
  if (fs.existsSync(appidTxt)) {
    const onDisk = fs.readFileSync(appidTxt, 'utf8').trim();
    if (report.appid && onDisk && onDisk !== report.appid) {
      add('warning', 'APPID_MISMATCH', `steam_appid.txt (${onDisk}) does not match the detected appid (${report.appid}).`);
    }
  } else {
    add('warning', 'NO_APPID_TXT', 'steam_appid.txt is missing in steam_settings.');
  }

  // These files are runtime configuration, not achievement schema. A valid achievements.json does
  // not make the setup complete when DLC ownership or the configured user identity is absent.
  const appConfigFile = path.join(steamSettings, 'configs.app.ini');
  if (!fs.existsSync(appConfigFile)) {
    add('warning', 'NO_DLC_CONFIG', 'configs.app.ini is missing — DLC unlock/enumeration is not configured.');
  } else {
    const appConfig = fs.readFileSync(appConfigFile, 'utf8');
    if (!/^\s*\[app::dlcs\][\s\S]*?^\s*unlock_all\s*=\s*1\s*$/im.test(appConfig)) {
      add('warning', 'BAD_DLC_CONFIG', 'configs.app.ini does not enable [app::dlcs] unlock_all=1.');
    }
  }
  const mainConfigFile = path.join(steamSettings, 'configs.main.ini');
  if (!fs.existsSync(mainConfigFile)) {
    add('warning', 'NO_MAIN_CONFIG', 'configs.main.ini is missing — modern Steam ticket/token compatibility is not configured.');
  } else {
    const mainConfig = fs.readFileSync(mainConfigFile, 'utf8');
    if (!/^\s*\[main::general\][\s\S]*?^\s*new_app_ticket\s*=\s*1\s*$/im.test(mainConfig)) {
      add('warning', 'NO_NEW_APP_TICKET', 'configs.main.ini does not enable [main::general] new_app_ticket=1.');
    }
    if (!/^\s*\[main::general\][\s\S]*?^\s*gc_token\s*=\s*1\s*$/im.test(mainConfig)) {
      add('warning', 'NO_GC_TOKEN', 'configs.main.ini does not enable [main::general] gc_token=1.');
    }
  }
  const userConfigFile = path.join(steamSettings, 'configs.user.ini');
  if (!fs.existsSync(userConfigFile)) {
    add('warning', 'NO_USER_CONFIG', 'configs.user.ini is missing — account name and language are not configured.');
  } else {
    const userConfig = fs.readFileSync(userConfigFile, 'utf8');
    if (!/^\s*\[user::general\]/im.test(userConfig) || !/^\s*account_name\s*=\s*\S/im.test(userConfig) || !/^\s*language\s*=\s*\S/im.test(userConfig)) {
      add('warning', 'BAD_USER_CONFIG', 'configs.user.ini is missing account_name and/or language under [user::general].');
    }
    const savePathMatch = userConfig.match(/^\s*local_save_path\s*=\s*(.+?)\s*$/im);
    if (savePathMatch && savePathMatch[1] && savePathMatch[1].trim()) {
      add('warning', 'CUSTOM_SAVE_PATH', `configs.user.ini sets local_save_path=${savePathMatch[1].trim()} — runtime saves may be written outside AW's monitored GSE Saves folder.`);
    }
  }

  // achievements.json
  const achFile = path.join(steamSettings, 'achievements.json');
  if (!fs.existsSync(achFile)) {
    add('error', 'NO_ACHIEVEMENTS_JSON', 'achievements.json is missing — in-game achievement pop-ups/icons will not work.');
    return report;
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(achFile, 'utf8'));
  } catch (e) {
    add('error', 'BAD_ACHIEVEMENTS_JSON', `achievements.json is not valid JSON: ${e.message}`);
    return report;
  }
  if (!Array.isArray(parsed)) {
    add('error', 'ACHIEVEMENTS_JSON_NOT_ARRAY', 'achievements.json must be a JSON array of achievement objects.');
    return report;
  }
  report.achievements.found = parsed.length;

  const byName = new Map(parsed.filter((a) => a && a.name != null).map((a) => [String(a.name).toUpperCase(), a]));

  // Cross-check against the known schema (if available)
  const schemaList = (schema && schema.achievement && schema.achievement.list) || [];
  for (const a of schemaList) {
    if (!byName.has(String(a.name).toUpperCase())) report.achievements.missing.push(a.name);
  }
  if (report.achievements.missing.length > 0) {
    add(
      'error',
      'MISSING_ACHIEVEMENTS',
      `${report.achievements.missing.length} achievement(s) from the schema are absent from achievements.json (fabricated/incomplete file).`
    );
  }

  // Entries with empty/placeholder names (fabricated files)
  const blankNames = parsed.filter((a) => !a || a.name == null || String(a.name).trim() === '').length;
  if (blankNames > 0) add('warning', 'BLANK_NAMES', `${blankNames} achievement entr(ies) have an empty name.`);

  // Icon files referenced but missing on disk
  for (const a of parsed) {
    for (const key of ['icon', 'icongray']) {
      const ref = a && a[key];
      if (ref && !/^https?:\/\//i.test(ref)) {
        const p = path.join(steamSettings, ref);
        if (!fs.existsSync(p)) report.achievements.missingIcons.push(ref);
      }
    }
  }
  if (report.achievements.missingIcons.length > 0) {
    add('warning', 'MISSING_ICONS', `${report.achievements.missingIcons.length} referenced icon file(s) are missing on disk.`);
  }

  const blankDesc = parsed.filter((a) => a && (!a.description || String(a.description).trim() === '')).length;
  if (blankDesc > 0) add('warning', 'BLANK_DESCRIPTIONS', `${blankDesc} achievement(s) have no description.`);

  // The schema can be perfectly valid while every achievement still shows locked: that just means
  // the emulator hasn't written any unlock state yet. Surface it as info so users stop reporting a
  // correct 0% game as a bug (it's the #1 "locked despite GBE files" confusion).
  if (report.save && report.save.exists) {
    add('info', 'SAVE_PRESENT', `Runtime save found (${report.save.type}): ${report.save.earned}/${report.save.total} unlocked.`);
  } else {
    add('info', 'NO_SAVE_YET', 'No runtime save has been written yet. If achievements unlocked in-game, the emulator/token may not be creating GSE/Goldberg save files or may be writing to a custom local_save_path.');
  }

  report.ok = !report.issues.some((i) => i.level === 'error');
  return report;
}

/*
  Minimal INI section editor used for GBE Fork's configs.*.ini. It preserves everything it doesn't
  explicitly touch — unknown sections, comments, blank lines and key order — so merging our DLC/user
  settings into a config a cracker already shipped never clobbers their other keys (account_steamid,
  ip_country, branch_name, …). A full INI library would reorder/strip comments; GBE's parser is
  line-based and section-scoped, so a line-faithful editor is both safer and simpler here.

  A "doc" is { preamble: [lines before the first [section]], sections: [{ key, header, body: [lines] }] }.
  `key` is the lower-cased section name (e.g. "app::dlcs"); `header` is the original "[…]" line.
*/
function parseIni(text) {
  const doc = { preamble: [], sections: [] };
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      current = { key: m[1].trim().toLowerCase(), header: line.trim(), body: [] };
      doc.sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      doc.preamble.push(line);
    }
  }
  return doc;
}

function stringifyIni(doc) {
  const blocks = [];
  const pre = doc.preamble.join('\n').replace(/\s+$/, '');
  if (pre) blocks.push(pre);
  for (const s of doc.sections) {
    const body = s.body.join('\n').replace(/\s+$/, '');
    blocks.push(body ? `${s.header}\n${body}` : s.header);
  }
  return blocks.join('\n\n') + '\n';
}

function getIniSection(doc, name) {
  return doc.sections.find((s) => s.key === name.toLowerCase());
}

function upsertIniSection(doc, name, body) {
  const existing = getIniSection(doc, name);
  if (existing) existing.body = body;
  else doc.sections.push({ key: name.toLowerCase(), header: `[${name}]`, body });
  return doc;
}

// Update existing `key=value` lines in place (preserving their indentation, comments and order) and
// append any keys that weren't present. `updates` keys are matched case-insensitively.
function upsertIniKeys(body, updates) {
  const remaining = new Map(Object.entries(updates).map(([k, v]) => [k.toLowerCase(), v]));
  const out = body.map((line) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
    if (m && remaining.has(m[2].toLowerCase())) {
      const key = m[2].toLowerCase();
      const value = remaining.get(key);
      remaining.delete(key);
      return `${m[1]}${m[2]}${m[3]}${value}`;
    }
    return line;
  });
  if (remaining.size > 0) {
    // Append new keys after the last real line so they stay inside the section block (no stray blank
    // line splitting the section when the source ended with a trailing newline).
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }
  return out;
}

// INI values can't span lines and GBE splits a DLC entry on the first '='; strip CR/LF so a stray
// newline in a fetched name can't corrupt the file or smuggle in extra keys.
function sanitizeIniValue(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

/*
  Write/merge steam_settings/configs.app.ini so GBE Fork reports every DLC as owned.

  GBE's [app::dlcs] has two complementary mechanisms:
    - unlock_all=1 makes BIsDlcInstalled/BIsSubscribedApp return true for any id (covers games that
      just query "do I own DLC X?");
    - the id=name list is what the enumeration APIs (GetDLCCount/BGetDLCDataByIndex) return, so games
      that *list* their DLCs only see the ones spelled out here.
  We set both: unlock_all=1 plus the full id=name list (existing entries are preserved and unioned
  with the fetched ones, so a curated list a cracker shipped is never lost). Verified against
  Detanup01/gbe_fork steam_settings.EXAMPLE/configs.app.EXAMPLE.ini.
*/
function writeDlcConfig({ steamSettings, dlcs = [], unlockAll = true } = {}) {
  if (!steamSettings) throw new Error('writeDlcConfig: steamSettings path is required');
  const file = path.join(steamSettings, 'configs.app.ini');
  const doc = parseIni(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

  // Preserve any id=name entries already in the file, then union the fetched list on top.
  const map = new Map();
  const existing = getIniSection(doc, 'app::dlcs');
  if (existing) {
    for (const line of existing.body) {
      const m = line.match(/^\s*(\d+)\s*=\s*(.*)$/);
      if (m) map.set(m[1], sanitizeIniValue(m[2]));
    }
  }
  for (const d of Array.isArray(dlcs) ? dlcs : []) {
    const id = d && d.appid != null ? String(d.appid).trim() : '';
    if (/^\d+$/.test(id) && !map.has(id)) map.set(id, sanitizeIniValue(d.name) || `DLC ${id}`);
  }

  const body = [
    '; Managed by Achievement Watcher — enable all DLCs for this game.',
    "; unlock_all=1 reports every DLC as owned; the id=name list below lets games that enumerate",
    '; their DLCs (GetDLCCount/BGetDLCDataByIndex) see them too.',
    `unlock_all=${unlockAll ? '1' : '0'}`,
    ...[...map.entries()].map(([id, name]) => `${id}=${name}`),
  ];
  upsertIniSection(doc, 'app::dlcs', body);

  fs.mkdirSync(steamSettings, { recursive: true });
  fs.writeFileSync(file, stringifyIni(doc));
  return { file, count: map.size, unlockAll: !!unlockAll };
}

/*
  Write/merge steam_settings/configs.main.ini with the modern GBE switches needed by newer
  Steamworks/PSPC titles. The values mirror the community-tested generate_emu_config `-token` setup:
  use the newer auth ticket and embed a Game Coordinator token. Existing unrelated keys/comments are
  preserved, and we deliberately leave achievements_bypass at the user's existing value because
  forcing SetAchievement() true is a compatibility workaround, not the default.
*/
function writeMainConfig({ steamSettings } = {}) {
  if (!steamSettings) throw new Error('writeMainConfig: steamSettings path is required');
  const file = path.join(steamSettings, 'configs.main.ini');
  const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const doc = parseIni(previous);
  let general = getIniSection(doc, 'main::general');
  if (!general) {
    general = { key: 'main::general', header: '[main::general]', body: [] };
    doc.sections.push(general);
  }
  general.body = upsertIniKeys(general.body, { new_app_ticket: '1', gc_token: '1' });

  let stats = getIniSection(doc, 'main::stats');
  if (!stats) {
    stats = { key: 'main::stats', header: '[main::stats]', body: [] };
    doc.sections.push(stats);
  }
  stats.body = upsertIniKeys(stats.body, { stat_achievement_progress_functionality: '1', save_only_higher_stat_achievement_progress: '1' });

  fs.mkdirSync(steamSettings, { recursive: true });
  const next = stringifyIni(doc);
  const changed = previous !== next;
  if (changed) fs.writeFileSync(file, next);
  return { file, changed, newAppTicket: true, gcToken: true };
}

// Append a language to supported_languages.txt only when the file already exists and lacks it. GBE
// ignores a configured language that isn't listed there — but if the file is ABSENT there's nothing
// to restrict, so we deliberately don't create one (creating a single-line file would hide every
// other language the game actually supports).
function ensureSupportedLanguage(steamSettings, language) {
  const file = path.join(steamSettings, 'supported_languages.txt');
  if (!language || !fs.existsSync(file)) return false;
  const langs = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (langs.some((l) => l.toLowerCase() === String(language).toLowerCase())) return false;
  langs.push(language);
  fs.writeFileSync(file, langs.join('\n') + '\n');
  return true;
}

/*
  GBE's steam_settings.EXAMPLE/configs.user.EXAMPLE.ini ships [user::saves] with the example value
  local_save_path=./path/relative/to/dll. Repacks that copy the template verbatim leave it active, and
  GBE then "completely ignores the global settings folder" (its own words) — writing the save to that
  bogus relative path instead of %APPDATA%\GSE Saves\<appid>. AW's watchdog only watches the global emu
  roots, so it never sees an unlock there and never notifies. Blank the placeholder so saves land back
  in the monitored folder. Only the known template placeholder is matched — a custom save path the user
  set on purpose is left untouched. Returns true if a line was changed.
*/
function neutralizePlaceholderSavePath(doc) {
  const section = getIniSection(doc, 'user::saves');
  if (!section) return false;
  let fixed = false;
  section.body = section.body.map((line) => {
    const m = line.match(/^(\s*local_save_path\s*=\s*)(.*)$/i);
    if (!m) return line;
    const norm = m[2].trim().replace(/^[.\\/]+/, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (norm !== 'path/relative/to/dll') return line;
    fixed = true;
    return m[1].replace(/\s+$/, ''); // keep "local_save_path=", drop the placeholder value
  });
  return fixed;
}

/*
  Write/merge steam_settings/configs.user.ini so the emulator reports the identity configured in
  Achievement Watcher: account_name = the app's username, language = the app's achievement language
  (options.achievement.lang is already a Steam API language code like "french"/"english", which is
  exactly what GBE wants here). account_steamid and every other existing key are preserved untouched —
  changing the steamid would orphan the runtime save folder. Verified against
  Detanup01/gbe_fork steam_settings.EXAMPLE/configs.user.EXAMPLE.ini ([user::general]).
*/
function writeUserConfig({ steamSettings, accountName, language } = {}) {
  if (!steamSettings) throw new Error('writeUserConfig: steamSettings path is required');
  const updates = {};
  if (accountName && String(accountName).trim()) updates.account_name = sanitizeIniValue(accountName);
  if (language && String(language).trim()) updates.language = sanitizeIniValue(language);
  const file = path.join(steamSettings, 'configs.user.ini');
  const fileExists = fs.existsSync(file);
  // Nothing to stamp and no existing file to repair the save path in.
  if (Object.keys(updates).length === 0 && !fileExists) {
    return { file: null, accountName: null, language: null, changed: false, savePathFixed: false };
  }

  const previous = fileExists ? fs.readFileSync(file, 'utf8') : '';
  const doc = parseIni(previous);
  if (Object.keys(updates).length > 0) {
    let section = getIniSection(doc, 'user::general');
    if (!section) {
      section = { key: 'user::general', header: '[user::general]', body: [] };
      doc.sections.push(section);
    }
    section.body = upsertIniKeys(section.body, updates);
  }
  // Repair a repack's template placeholder local_save_path so saves land in the monitored GSE Saves.
  const savePathFixed = neutralizePlaceholderSavePath(doc);

  fs.mkdirSync(steamSettings, { recursive: true });
  const next = stringifyIni(doc);
  const changed = previous !== next;
  if (changed) fs.writeFileSync(file, next);
  if (updates.language) ensureSupportedLanguage(steamSettings, updates.language);
  return { file, accountName: updates.account_name || null, language: updates.language || null, changed, savePathFixed };
}

/*
  Repair / auto-configure a game's steam_settings so GBE Fork can show every achievement with its
  icon and description. Pure except for the injected `downloadIcon` so it stays unit-testable.

  cfg:
    steamSettings  destination steam_settings folder (created if missing)
    appid          steam appid (written to steam_appid.txt when missing)
    schema         AW game object with achievement.list (the source of truth)
    imagePrefix    icon subfolder name inside steam_settings (default "images")
    downloadIcon   async (url, destDir) => savedAbsolutePath | null  (skipped when omitted)
    writeAppId     also write steam_appid.txt (default true)
    writeDlc       also write configs.app.ini to unlock all DLCs (default true)
    dlcs           pre-resolved DLC list [{ appid, name }] to write (optional)
    fetchDlc       async (appid) => [{ appid, name }] used to fetch the DLC list when `dlcs` is omitted
    unlockAllDlc   value of [app::dlcs] unlock_all (default true)
    accountName    written to configs.user.ini [user::general] account_name (optional)
    language       written to configs.user.ini [user::general] language — a Steam API code (optional)

  Returns { steamSettings, achievementsJson, wroteAppId, icons, dlc, main, user }.
*/
async function repair({
  steamSettings,
  appid,
  schema,
  imagePrefix = 'images',
  downloadIcon,
  writeAppId = true,
  writeDlc = true,
  writeMain = true,
  dlcs,
  fetchDlc,
  unlockAllDlc = true,
  accountName,
  language,
}) {
  if (!steamSettings) throw new Error('repair: steamSettings path is required');
  fs.mkdirSync(steamSettings, { recursive: true });

  const achievementsJson = buildAchievementsJson(schema, imagePrefix);
  const preserveRichSchema = hasRichProgressSchema(steamSettings, schema);
  const summary = { steamSettings, achievementsJson, preservedRichSchema: preserveRichSchema, wroteAppId: false, backupDir: null, icons: { downloaded: 0, failed: 0, skipped: 0 }, dlc: null, main: null, user: null };

  // A manual repair can replace a malformed or incomplete schema. Keep the previous files beside
  // steam_settings before changing them; missing files need no backup and the normal auto-repair
  // therefore stays quiet for newly detected games.
  const filesToReplace = preserveRichSchema ? [] : [path.join(steamSettings, 'achievements.json')];
  if (writeAppId && appid != null) filesToReplace.push(path.join(steamSettings, 'steam_appid.txt'));
  if (writeDlc) filesToReplace.push(path.join(steamSettings, 'configs.app.ini'));
  if (writeMain) filesToReplace.push(path.join(steamSettings, 'configs.main.ini'));
  if ((accountName && String(accountName).trim()) || (language && String(language).trim())) {
    filesToReplace.push(path.join(steamSettings, 'configs.user.ini'));
  }
  const existing = filesToReplace.filter((file) => fs.existsSync(file));
  if (existing.length > 0) {
    summary.backupDir = path.join(steamSettings, '.aw-backups', backupTimestamp());
    fs.mkdirSync(summary.backupDir, { recursive: true });
    for (const file of existing) fs.copyFileSync(file, path.join(summary.backupDir, path.basename(file)));
  }

  if (downloadIcon) {
    const imgDir = path.join(steamSettings, imagePrefix);
    fs.mkdirSync(imgDir, { recursive: true });
    const list = (schema && schema.achievement && schema.achievement.list) || [];
    for (const a of list) {
      for (const key of ['icon', 'icongray']) {
        const url = a && a[key];
        if (!url || !/^https?:\/\//i.test(String(url))) {
          summary.icons.skipped++;
          continue;
        }
        try {
          const saved = await downloadIcon(String(url), imgDir);
          if (saved) summary.icons.downloaded++;
          else summary.icons.failed++;
        } catch {
          summary.icons.failed++;
        }
      }
    }
  }

  if (!preserveRichSchema) {
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), JSON.stringify(achievementsJson, null, 2));
  }

  if (writeAppId && appid != null) {
    const appidTxt = path.join(steamSettings, 'steam_appid.txt');
    if (!fs.existsSync(appidTxt)) {
      fs.writeFileSync(appidTxt, String(appid));
      summary.wroteAppId = true;
    }
  }

  // Enable all DLCs (configs.app.ini). Resolve the list from the injected fetcher when one wasn't
  // passed in; a failed/absent fetch still writes unlock_all=1, which alone covers the common
  // "do I own this DLC?" check. Kept best-effort so a network hiccup never aborts the schema repair.
  if (writeDlc) {
    let dlcList = Array.isArray(dlcs) ? dlcs : [];
    if (dlcList.length === 0 && typeof fetchDlc === 'function' && appid != null) {
      try {
        const fetched = await fetchDlc(appid);
        if (Array.isArray(fetched)) dlcList = fetched;
      } catch {
        /* offline / rate-limited — fall back to unlock_all only */
      }
    }
    try {
      summary.dlc = writeDlcConfig({ steamSettings, dlcs: dlcList, unlockAll: unlockAllDlc });
    } catch {
      summary.dlc = null;
    }
  }

  if (writeMain) {
    try {
      summary.main = writeMainConfig({ steamSettings });
    } catch {
      summary.main = null;
    }
  }

  // Stamp the app's identity (account name + language) into configs.user.ini, preserving account_steamid.
  if ((accountName && String(accountName).trim()) || (language && String(language).trim())) {
    try {
      summary.user = writeUserConfig({ steamSettings, accountName, language });
    } catch {
      summary.user = null;
    }
  }

  return summary;
}

// Read the on-disk GBE/Goldberg SCHEMA (steam_settings/achievements.json — the array of
// {name, displayName, description, hidden, icon, icongray}). This is a fully offline source of
// achievement names and descriptions: useful to fill blanks when there's no Steam Web API key and no
// internet. Returns [] if the file is absent, unreadable, or not a JSON array.
function readLocalSchema(steamSettings) {
  if (!steamSettings) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/*
  Walk one or more library roots and report Steam-emulator game installs, flagging the ones that are
  compatible but not properly configured (no schema achievements.json). A folder is treated as a game
  install root when it directly contains a replaced Steam API dll (steam_api(64).dll) OR a
  steam_settings subfolder — the dll is the authoritative "this is an emulated game" signal, so games
  whose appid lives in a root-level steam_appid.txt (no steam_settings) are caught too. The appid is
  read from the game root's steam_appid.txt, falling back to steam_settings/steam_appid.txt.
  Bounded depth keeps it cheap. Returns [{ gameDir, steamSettings, appid, emulator, hasSchema, schemaCount }].
*/
function findCompatibleGames(roots, { maxDepth = 5 } = {}) {
  const list = Array.isArray(roots) ? roots : [roots];
  const found = [];
  const seen = new Set();

  const readAppid = (...candidates) => {
    for (const p of candidates) {
      if (!p || !fs.existsSync(p)) continue;
      try {
        const v = parseAppidFromConfig(p);
        if (v) return v;
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  const findNestedAppid = (gameDir, rootName = '', maxSearchDepth = 4) => {
    const candidates = [];
    const walk = (dir, depth) => {
      if (depth > maxSearchDepth) return;
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isFile() && APPID_CONFIG_FILES.has(e.name.toLowerCase())) {
          const full = path.join(dir, e.name);
          const appid = parseAppidFromConfig(full);
          if (appid) candidates.push({ appid, file: full, dir, depth });
        }
      }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const lower = e.name.toLowerCase();
        if (lower === 'steam_settings') continue;
        if (TOOL_SUBDIR.test(e.name)) continue; // editor/SDK/dedicated-server shipped with the game — not the game
        walk(path.join(dir, e.name), depth + 1);
      }
    };
    walk(gameDir, 0);
    if (candidates.length === 0) return null;
    // Light tiebreak only: prefer an appid whose folder name resembles the game's root folder, else the
    // shallowest. Folder names are often renamed/scene-tagged, so this never *filters* — it just orders.
    candidates.sort(
      (a, b) =>
        exeDetect.nameSimilarity(rootName, path.basename(b.dir)) - exeDetect.nameSimilarity(rootName, path.basename(a.dir)) ||
        a.depth - b.depth
    );
    return candidates[0];
  };

  const parentGameRootFor = (markerDir) => {
    let current = markerDir;
    for (let i = 0; i < 3; i++) {
      const parent = path.dirname(current);
      if (!parent || parent === current) break;
      try {
        if (exeDetect.detect(parent, path.basename(parent), {})) return parent;
      } catch {
        /* keep walking */
      }
      current = parent;
    }
    return markerDir;
  };

  const consider = (gameDir, marker = {}) => {
    const resolvedGameDir = marker.gameDir || gameDir;
    const key = resolvedGameDir.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const emu = detectEmulator(resolvedGameDir);
    const ssDir = path.join(resolvedGameDir, 'steam_settings');
    const steamSettings = fs.existsSync(ssDir) ? ssDir : emu.steamSettings || null;
    const appid = readAppid(
      marker.appidFile,
      path.join(resolvedGameDir, 'steam_appid.txt'),
      steamSettings && path.join(steamSettings, 'steam_appid.txt')
    ) || marker.appid || (findNestedAppid(resolvedGameDir, path.basename(resolvedGameDir)) || {}).appid;
    let hasSchema = false;
    let schemaCount = 0;
    if (steamSettings) {
      const achFile = path.join(steamSettings, 'achievements.json');
      if (fs.existsSync(achFile)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(achFile, 'utf8'));
          if (Array.isArray(parsed) && parsed.length > 0) {
            hasSchema = true;
            schemaCount = parsed.length;
          }
        } catch {
          /* malformed schema counts as "no schema" */
        }
      }
    }
    found.push({ gameDir: resolvedGameDir, steamSettings, appid, emulator: emu.type, hasSchema, schemaCount });
  };

  // A game's install root is where its identity files live: a steam_settings folder or a
  // steam_appid.txt. The replaced steam_api dll usually sits here too, but the dll alone is NOT used
  // as the anchor — it frequently lives in a nested engine folder (bin/, Binaries/, x86_64/), which
  // would mis-anchor gameDir and miss the root-level appid. A dll with no nearby appid file can't be
  // identified anyway.
  const gameRootMarker = (dir, entries) => {
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase() === 'steam_appid.txt') return { gameDir: dir, appidFile: path.join(dir, e.name) };
      if (e.isDirectory() && e.name.toLowerCase() === 'steam_settings') return { gameDir: dir };
    }
    const hasSteamApi = entries.some((e) => e.isFile() && EMU_DLL_NAMES.includes(e.name.toLowerCase()));
    const appidConfig = entries.find((e) => e.isFile() && APPID_CONFIG_FILES.has(e.name.toLowerCase()));
    if (hasSteamApi && appidConfig) {
      const appidFile = path.join(dir, appidConfig.name);
      const appid = parseAppidFromConfig(appidFile);
      if (appid) return { gameDir: parentGameRootFor(dir), appid, appidFile };
    }
    if (exeDetect.shallowGameExe(dir)) {
      const nestedAppid = findNestedAppid(dir, path.basename(dir));
      if (nestedAppid) {
        const emu = detectEmulator(dir);
        if (emu.dll.length > 0) return { gameDir: dir, appid: nestedAppid.appid, appidFile: nestedAppid.file };
      }
    }
    return null;
  };

  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const marker = gameRootMarker(dir, entries);
    if (marker) {
      consider(marker.gameDir, marker); // this folder belongs to one game install; don't split nested dll/config dirs
      return;
    }
    for (const e of entries) {
      if (e.isDirectory() && e.name.toLowerCase() !== 'steam_settings') walk(path.join(dir, e.name), depth + 1);
    }
  };

  for (const root of list) {
    if (root && fs.existsSync(root)) walk(root, 0);
  }
  return found;
}

/*
  Find the most likely game executable inside a game folder. Thin wrapper around the shared
  exeDetect module — kept for the existing call sites that only have a gameDir + emulator dll(s)
  and no game name. Pass a game name to exeDetect.detect directly for name-aware scoring.

  Returns { name, full, size, score } or null.
*/
function findGameExe(gameDir, dllPaths) {
  return exeDetect.detect(gameDir, '', { dllPaths });
}

module.exports = {
  findSteamSettings,
  detectEmulator,
  buildAchievementsJson,
  backupSetup,
  restoreSetup,
  repair,
  writeDlcConfig,
  writeMainConfig,
  writeUserConfig,
  diagnose,
  inspectSaveState,
  buildRuntimeAchievementsState,
  seedRuntimeSave,
  findCompatibleGames,
  readLocalSchema,
  findGameExe,
};
