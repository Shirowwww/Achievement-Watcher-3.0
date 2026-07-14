'use strict';

/*
  Goldberg Uplay R2 ("demde" build) install validation & repair helpers — the Ubisoft/uPlay
  counterpart of goldberg.js, used instead of GBE Fork for Ubisoft-sourced games (there is no
  steam_api.dll in a uPlay game, so the Steam emulator fix never applies there).

  The trick (reverse-engineered from a community setup script, verified against the actual emulator
  binary's strings and its default uplay_r2.ini): the emulator writes achievement unlock state to
  achievements.json (earned/earned_time — literally GBE Fork's own field names) in a save directory it
  fully controls via AchSaveType/AchSavePath. If we redirect that path to
  %APPDATA%\GSE Saves\<steamAppid> — the exact folder AW's existing Steam/GBE scan
  (app/parser/steam.js -> app/parser/saveRoots.js) already reads — and make the local
  achievements_schema.json use the REAL Steam achievement api-names as keys, AW displays these
  Ubisoft-only unlocks with zero changes to the read path: icons, descriptions and notifications all
  come from the ordinary Steam/GBE pipeline. The Ubisoft game is looked up against its Steam release via
  app/assets/uplay-steam.json (uplay_id <-> steam_appid), and the mapping only works when this
  particular game's Steam api-names end in "<prefix><digits>" — the digits are the internal Ubisoft
  objective id the game itself passes to UPC_AchievementUnlock. Not every game follows that
  convention; diagnose() reports UNSUPPORTED_ID_SCHEME instead of guessing when it doesn't.
*/

const fs = require('fs');
const path = require('path');
const { parseIni, stringifyIni, getIniSection, upsertIniSection, upsertIniKeys, sanitizeIniValue } = require(path.join(__dirname, '..', 'util', 'emuIni.js'));
const fuzzyAppid = require(path.join(__dirname, '..', 'util', 'fuzzyAppid.js'));
const goldberg = require(path.join(__dirname, 'goldberg.js'));

const EMU_DLL_NAMES = ['uplay_r2_loader.dll', 'uplay_r2_loader64.dll', 'upc_r2_loader.dll', 'upc_r2_loader64.dll'];
const INI_NAMES = ['uplay_r2.ini', 'upc_r2.ini'];
const UPLAY_INSTALL_MARKERS = ['uplay_install.manifest', 'uplay_install.state', 'upc.cfg', ...INI_NAMES];

// The demde build's own shipped default (captured from a real release) — used as the starting
// document when a game has no ini yet, so repair() produces a fully faithful file (comments
// included), the same spirit as GBE Fork's steam_settings.EXAMPLE in goldberg.js.
const DEFAULT_INI_TEMPLATE = `[Settings]
Username = Goldberg
Email = goldberg@gmail.com
UserId = 80f33a39-e682-4d1f-b693-39267e890df2

;Country probably has to be country short ISO code (currently no game uses the func this value will provide)
;Country = US

;Valid languages:
; es-MX zh-TW ru-RU pt-PT ot-OT it-IT en-US es-ES ko-KR
; el-GR fr-FR pt-BR ja-JP ro-RO no-NO ko-KO zh-CN pl-PL
; nl-NL da-DK fi-FI th-TH sv-SE de-DE ar-SA ar-AA
Language = en-US
; avatar must be png for best results use 64x64, 128x128, 256x256
Avatar = avatar.png

;0 = disabled
;1 = enabled (you must also provide achievements_schema.json in the same folder as the .ini)
; check the example file for the structure
Achievements = 0

;Prefix to apply for the achievements_schema.json keys - default uses only achievement id as key
; The achievements_schema.json keys must also have the prefix in them
; Example: FenyxRising_Ach_
AchKeyPrefix =

;0 = same as SaveType/SavePath
;1 = Custom (AchSavePath)
AchSaveType = 0
AchSavePath =

;Emu Logging
;0 = disabled
;1 = enabled
Logging = 0

;0 = appdata\\roaming\\Goldberg UplayEmu Saves
;1 = SavePath in game folder
;2 = Custom (SavePath)
SaveType = 0
SavePath =
SaveExtension = .save

[DLC]

[Items]

[Chunks]
`;

function listShallow(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

// Find the Uplay R2 loader dll(s) shallow under a game root (same bounded walk as
// goldberg.detectEmulator's findDll). Returns { type: 'uplayR2' | 'none', dll: [...] }.
function detectEmulator(gameDir) {
  const result = { type: 'none', dll: [] };
  if (!gameDir || !fs.existsSync(gameDir)) return result;

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
        findDll(path.join(dir, e.name), depth + 1);
      } else if (e.isFile() && EMU_DLL_NAMES.includes(lower)) {
        result.dll.push(path.join(dir, e.name));
      }
    }
  };
  findDll(gameDir, 0);

  if (result.dll.length > 0) result.type = 'uplayR2';
  return result;
}

// Classify the install independently from its folder name or from Steam artifacts. Ubisoft builds
// carry uplay_install.* / upc.cfg, while already-cracked installs may only expose the Uplay R2 loader
// or ini. This is deliberately separate from resolveSteamMapping(): an unknown Ubisoft game must
// still be identified as Ubisoft so the UI never offers the incompatible Steam/GBE Fork repair.
function isUbisoftInstall(gameDir) {
  if (!gameDir || !fs.existsSync(gameDir)) return false;
  if (UPLAY_INSTALL_MARKERS.some((name) => fs.existsSync(path.join(gameDir, name)))) return true;
  return detectEmulator(gameDir).type === 'uplayR2';
}

// Renderer-safe classification for already-discovered game records. Discovery persists both a
// dedicated flag and system="uplay"; the source/appid checks keep legacy UPLAY/Lumaplay records
// compatible. Keeping this rule here gives the context menu one authoritative GBE-vs-Uplay decision.
function isUbisoftGame(game, fallbackAppid) {
  const source = String((game && game.source) || '');
  const system = String((game && game.system) || '').toLowerCase();
  const appid = game && game.appid != null ? game.appid : fallbackAppid;
  return !!(
    (game && game.uplayR2) ||
    system === 'uplay' ||
    /uplay|ubisoft|lumaplay/i.test(source) ||
    /^UPLAY/i.test(String(appid || ''))
  );
}

// Resolve the two ids a Ubisoft game can carry in the UI: the native Ubisoft product id and the
// mapped Steam catalog id used for schema, cover and community links. Renderer records differ by
// source (UPLAY65043, uplay-65043, or a promoted numeric Steam appid), so keep that normalization in
// one tested place instead of making every context-menu action guess independently.
function resolveGameIdentity(game, fallbackAppid) {
  const record = game && typeof game === 'object' ? game : {};
  const appid = record.appid != null ? record.appid : fallbackAppid;
  const appidText = String(appid == null ? '' : appid).trim();
  const data = record.data && typeof record.data === 'object' ? record.data : {};
  const embeddedMatch = appidText.match(/^(?:UPLAY|uplay-)(\d+)$/i);
  const explicitUplayId = record.ubisoftProductId || record.uplayId || data.uplayId || (embeddedMatch && embeddedMatch[1]) || '';
  const mapping = resolveSteamMapping({
    appid: explicitUplayId ? `UPLAY${explicitUplayId}` : appid,
    name: record.name,
    gameDir: record.gameDir || data.gameDir,
  });
  const explicitSteamAppid = record.steamappid != null ? String(record.steamappid).trim() : '';
  const promotedSteamAppid = record.uplayR2 && /^\d+$/.test(appidText) ? appidText : '';
  const steamAppid = explicitSteamAppid || (mapping && String(mapping.steam_appid)) || promotedSteamAppid;
  const uplayId = String(explicitUplayId || (mapping && mapping.uplay_id) || '');

  return {
    uplayId: /^\d+$/.test(uplayId) ? uplayId : '',
    steamAppid: /^\d+$/.test(steamAppid) ? steamAppid : '',
    mapping,
  };
}

// Paths exposed by the Ubisoft context menu. The loader may live below the install root, so config
// and schema actions must follow the actual DLL directory rather than assume every repack is flat.
function getGameToolPaths(game, fallbackAppid) {
  const record = game && typeof game === 'object' ? game : {};
  const data = record.data && typeof record.data === 'object' ? record.data : {};
  const gameDir = record.gameDir || data.gameDir || '';
  const identity = resolveGameIdentity(record, fallbackAppid);
  const emulator = detectEmulator(gameDir);
  const runtimeDir = emulator.dll.length > 0 ? path.dirname(emulator.dll[0]) : gameDir;
  const configFiles = runtimeDir ? INI_NAMES.map((name) => path.join(runtimeDir, name)) : [];

  return {
    ...identity,
    gameDir,
    runtimeDir,
    loaderFiles: emulator.dll,
    configFiles,
    configFile: configFiles.find((file) => fs.existsSync(file)) || configFiles[0] || '',
    schemaFile: runtimeDir ? path.join(runtimeDir, 'achievements_schema.json') : '',
    saveDir: identity.steamAppid ? defaultSavePath(identity.steamAppid) : '',
  };
}

let _uplaySteamMap = null;
function loadUplaySteamMap() {
  if (_uplaySteamMap) return _uplaySteamMap;
  try {
    _uplaySteamMap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'uplay-steam.json'), 'utf8'));
  } catch {
    _uplaySteamMap = [];
  }
  return _uplaySteamMap;
}

function mappingResult(hit) {
  return hit ? { uplay_id: String(hit.uplay_id), steam_appid: hit.steam_appid, steam_name: hit.steam_name } : null;
}

// uplay_install.state is a small protobuf-like binary written by Ubisoft's installer. It contains
// the canonical product title as UTF-8 even when a repack renamed the parent folder. Match the
// longest known title embedded in the file; longest-first avoids a base title stealing a remaster or
// edition whose name contains it. No protobuf schema is required and malformed files fail closed.
function resolveMappingFromInstallState(gameDir, map) {
  if (!gameDir) return null;
  const stateFile = path.join(gameDir, 'uplay_install.state');
  try {
    const stat = fs.statSync(stateFile);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 8 * 1024 * 1024) return null;
    const stateText = fs.readFileSync(stateFile, 'utf8').toLocaleLowerCase();
    const candidates = map
      .flatMap((entry) => [entry.uplay_name, entry.steam_name].filter(Boolean).map((title) => ({ entry, title: String(title) })))
      .sort((a, b) => Buffer.byteLength(b.title, 'utf8') - Buffer.byteLength(a.title, 'utf8'));
    const match = candidates.find(({ title }) => stateText.includes(title.toLocaleLowerCase()));
    return match ? mappingResult(match.entry) : null;
  } catch {
    return null;
  }
}

// Resolve a Ubisoft game's Steam equivalent via app/assets/uplay-steam.json. Prefers an exact
// uplay_id match (the numeric id the game itself passes to UPC_Init — also the appid used in
// UPLAY<id> and the raw Ubisoft folder name under "Goldberg UplayEmu Saves"); falls back to a
// exact title embedded in uplay_install.state, then a high-confidence fuzzy name match, same tiering
// steam.findAppidByName uses. The install-state lookup makes renamed repack folders deterministic.
// Returns { uplay_id, steam_appid, steam_name } | null.
function resolveSteamMapping({ appid, name, gameDir } = {}) {
  const map = loadUplaySteamMap();
  if (map.length === 0) return null;

  const rawId = appid != null ? String(appid).replace(/^UPLAY/i, '') : null;
  if (rawId && /^\d+$/.test(rawId)) {
    const hit = map.find((e) => String(e.uplay_id) === rawId);
    if (hit) return mappingResult(hit);
  }

  const installStateHit = resolveMappingFromInstallState(gameDir, map);
  if (installStateHit) return installStateHit;

  if (name && String(name).trim()) {
    const apps = map.map((e) => ({ appid: e.steam_appid, name: e.uplay_name }));
    const steamAppid = fuzzyAppid.bestConfidentAppid(name, apps);
    if (steamAppid != null) {
      const hit = map.find((e) => e.steam_appid === steamAppid);
      if (hit) return mappingResult(hit);
    }
  }

  return null;
}

// Given the Steam schema's achievement list ([{name, ...}]), verify every api-name ends in
// "<one shared prefix><digits>" — the convention the Ubisoft objective id is embedded in for many
// Ubisoft-published Steam ports. Returns { prefix, count } when the whole list agrees, else null
// (this game isn't auto-supported; diagnose() surfaces that instead of writing a broken schema).
function derivePrefixedIds(achievementList) {
  const list = Array.isArray(achievementList) ? achievementList : [];
  if (list.length === 0) return null;

  let prefix = null;
  for (const a of list) {
    const nm = a && a.name != null ? String(a.name) : '';
    const m = nm.match(/^(.*?)(\d+)$/);
    if (!m) return null;
    if (prefix === null) prefix = m[1];
    else if (prefix !== m[1]) return null;
  }
  return { prefix: prefix || '', count: list.length };
}

// Build the demde achievements_schema.json from an AW schema (schema.achievement.list). Keys are the
// REAL Steam api-names (== "<prefix><digits>" when derivePrefixedIds validated the game), so once
// AchSaveType/AchSavePath redirects the runtime save into GSE Saves\<steamAppid>, the ordinary
// Steam/GBE read path matches them without any transform.
function buildAchievementsSchemaJson(schema) {
  const list = (schema && schema.achievement && Array.isArray(schema.achievement.list) && schema.achievement.list) || [];
  const out = {};
  for (const a of list) {
    if (!a || a.name == null) continue;
    out[String(a.name)] = {
      displayName: a.displayName || a.name,
      description: a.description || '',
      earned: 0,
    };
  }
  return out;
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function defaultSavePath(steamAppid) {
  const appdata = process.env['APPDATA'];
  if (!appdata) return '';
  return path.join(appdata, 'GSE Saves', String(steamAppid));
}

// Read-modify-write BOTH uplay_r2.ini and upc_r2.ini beside the loader dll — the demde binary
// variants are ambiguous about which filename they read (the archive ships both, identical), so
// writing both is cheap and always covers the one actually in use. Preserves every other key
// (UserId in particular — changing it would orphan the runtime save, same rule goldberg.writeUserConfig
// follows for account_steamid) and every unrelated section ([DLC]/[Items]/[Chunks]).
function writeSettingsConfig({ dir, steamAppid, prefix, accountName, language } = {}) {
  if (!dir) throw new Error('writeSettingsConfig: dir is required');
  if (steamAppid == null) throw new Error('writeSettingsConfig: steamAppid is required');
  fs.mkdirSync(dir, { recursive: true });

  const updates = {
    Achievements: '1',
    AchKeyPrefix: sanitizeIniValue(prefix || ''),
    AchSaveType: '1',
    AchSavePath: sanitizeIniValue(defaultSavePath(steamAppid)),
  };
  if (accountName && String(accountName).trim()) updates.Username = sanitizeIniValue(accountName);
  if (language && String(language).trim()) updates.Language = sanitizeIniValue(language);

  const written = [];
  for (const iniName of INI_NAMES) {
    const file = path.join(dir, iniName);
    const previous = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : DEFAULT_INI_TEMPLATE;
    const doc = parseIni(previous);
    let settings = getIniSection(doc, 'settings');
    if (!settings) {
      settings = { key: 'settings', header: '[Settings]', body: [] };
      doc.sections.unshift(settings);
    }
    settings.body = upsertIniKeys(settings.body, updates);
    const next = stringifyIni(doc);
    const changed = previous !== next;
    if (changed) fs.writeFileSync(file, next);
    written.push({ file, changed });
  }
  return { files: written, achSavePath: updates.AchSavePath, achKeyPrefix: updates.AchKeyPrefix };
}

/*
  Diagnose a Ubisoft game's Goldberg Uplay R2 setup.

  cfg: { gameDir, appid, name }
  Returns a structured report; report.issues is an array of { level, code, message }, same shape as
  goldberg.diagnose so app.js's dialog-building code can be reused.
*/
function diagnose({ gameDir, appid, name } = {}) {
  const report = {
    gameDir,
    dll: null,
    mapping: null,
    ok: false,
    issues: [],
    save: null,
  };
  const add = (level, code, message) => report.issues.push({ level, code, message });

  if (!gameDir || !fs.existsSync(gameDir)) {
    add('error', 'NO_GAME_DIR', `Game folder not found: ${gameDir}`);
    return report;
  }

  const emu = detectEmulator(gameDir);
  if (emu.type === 'none') {
    add('error', 'NO_UPLAY_R2_DLL', 'No uplay_r2_loader(64).dll / upc_r2_loader(64).dll found — Goldberg Uplay R2 is not installed here.');
    return report;
  }
  const dir = path.dirname(emu.dll[0]);
  report.dll = emu.dll;

  const mapping = resolveSteamMapping({ appid, name, gameDir });
  report.mapping = mapping;
  if (!mapping) {
    add('error', 'NO_STEAM_MAPPING', `No Steam equivalent found for this Ubisoft game in uplay-steam.json (appid=${appid}, name=${name}).`);
    return report;
  }

  const schemaFile = path.join(dir, 'achievements_schema.json');
  if (!fs.existsSync(schemaFile)) {
    add('error', 'NO_SCHEMA_JSON', 'achievements_schema.json is missing — run "Apply emulator fix (Uplay R2)" to generate it.');
  } else {
    try {
      JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
    } catch (e) {
      add('error', 'BAD_SCHEMA_JSON', `achievements_schema.json is not valid JSON: ${e.message}`);
    }
  }

  const iniFile = INI_NAMES.map((n) => path.join(dir, n)).find((f) => fs.existsSync(f));
  const expectedSavePath = defaultSavePath(mapping.steam_appid);
  if (!iniFile) {
    add('warning', 'NO_INI', 'No uplay_r2.ini/upc_r2.ini found beside the loader dll.');
  } else {
    const doc = parseIni(fs.readFileSync(iniFile, 'utf8'));
    const settings = getIniSection(doc, 'settings');
    const body = (settings && settings.body.join('\n')) || '';
    const achOn = /^\s*Achievements\s*=\s*1\s*$/im.test(body);
    if (!achOn) add('warning', 'ACHIEVEMENTS_DISABLED', 'Achievements=1 is not set in the ini.');
    const savePathMatch = body.match(/^\s*AchSavePath\s*=\s*(.+?)\s*$/im);
    const achSaveTypeMatch = body.match(/^\s*AchSaveType\s*=\s*(\d+)\s*$/im);
    if (!achSaveTypeMatch || achSaveTypeMatch[1] !== '1' || !savePathMatch || path.normalize(savePathMatch[1].toLowerCase()) !== path.normalize(expectedSavePath.toLowerCase())) {
      add('warning', 'BAD_SAVE_REDIRECT', `AchSaveType/AchSavePath is not redirected to ${expectedSavePath} — unlocks won't be picked up by Achievement Watcher.`);
    }
  }

  // Runtime unlock state lives under the ordinary Steam/GBE save root once redirected — reuse
  // goldberg's generic reader instead of re-implementing it.
  report.save = goldberg.inspectSaveState(mapping.steam_appid);
  if (report.save && report.save.exists) {
    add('info', 'SAVE_PRESENT', `Runtime save found: ${report.save.earned}/${report.save.total} unlocked.`);
  } else {
    add('info', 'NO_SAVE_YET', 'No runtime save has been written yet under GSE Saves for the mapped Steam AppID.');
  }

  report.ok = !report.issues.some((i) => i.level === 'error');
  return report;
}

/*
  Repair / auto-configure a Ubisoft game's Goldberg Uplay R2 setup so unlocks land in
  GSE Saves\<steamAppid> with real Steam api-name keys.

  cfg:
    dir          folder containing the loader dll (achievements_schema.json + ini are written here)
    steamAppid   the mapped Steam appid (from resolveSteamMapping)
    schema       AW game object with achievement.list (the source of truth — the Steam schema)
    prefix       pre-derived AchKeyPrefix (from derivePrefixedIds); required
    accountName  written to Username (optional)
    language     written to Language (optional)

  Returns { dir, achievementsSchemaJson, ini, wroteSchema, backupDir }.
*/
function repair({ dir, steamAppid, schema, prefix, accountName, language } = {}) {
  if (!dir) throw new Error('repair: dir is required');
  if (steamAppid == null) throw new Error('repair: steamAppid is required');
  if (prefix == null) throw new Error('repair: prefix is required (derive it with derivePrefixedIds first)');
  fs.mkdirSync(dir, { recursive: true });

  const achievementsSchemaJson = buildAchievementsSchemaJson(schema);
  const summary = { dir, achievementsSchemaJson, wroteSchema: false, backupDir: null, ini: null };

  const schemaFile = path.join(dir, 'achievements_schema.json');
  const filesToBackup = [schemaFile, ...INI_NAMES.map((n) => path.join(dir, n))].filter((f) => fs.existsSync(f));
  if (filesToBackup.length > 0) {
    summary.backupDir = path.join(dir, '.aw-backups', backupTimestamp());
    fs.mkdirSync(summary.backupDir, { recursive: true });
    for (const file of filesToBackup) fs.copyFileSync(file, path.join(summary.backupDir, path.basename(file)));
  }

  fs.writeFileSync(schemaFile, JSON.stringify(achievementsSchemaJson, null, 2));
  summary.wroteSchema = true;

  summary.ini = writeSettingsConfig({ dir, steamAppid, prefix, accountName, language });

  // Pre-create the runtime save folder so the game shows up immediately at 0%, same convention as
  // the GBE Fork install action.
  try {
    fs.mkdirSync(defaultSavePath(steamAppid), { recursive: true });
  } catch {
    /* best-effort */
  }

  return summary;
}

module.exports = {
  EMU_DLL_NAMES,
  INI_NAMES,
  UPLAY_INSTALL_MARKERS,
  detectEmulator,
  isUbisoftInstall,
  isUbisoftGame,
  resolveGameIdentity,
  getGameToolPaths,
  resolveSteamMapping,
  derivePrefixedIds,
  buildAchievementsSchemaJson,
  writeSettingsConfig,
  diagnose,
  repair,
};
