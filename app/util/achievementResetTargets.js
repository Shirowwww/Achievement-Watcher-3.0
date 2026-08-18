'use strict';

/*
  What a per-game achievement reset is allowed to touch, and how.

  Deliberately pure: no fs, no Electron. It answers two questions - "may this source be reset at
  all?" and "what does this file need?" - so both can be tested without a game install, and so the
  fs side (parser/achievementReset.js) never has to reason about formats.

  Three kinds of file exist, and confusing them is how a reset destroys a library:

    state only     the emulator rewrites it from scratch on the next unlock, so deleting it is the
                   reset. Every Steam/Uplay/SocialClub emulator save works this way, as does RPCS3's
                   TROPUSR.DAT (its schema lives beside it in TROPCONF.SFM).
    state + schema ShadPS4's TROP*.XML and Xenia's .gpd carry the achievement list itself. Deleting
                   one takes the game's achievements with it, so those are edited in place by their
                   own parser (shadps4.clearTrophyXml / xenia.clearGpdBuffer).
    schema only    TROPCONF.SFM, UserGameStatsSchema_*.bin, steam_settings/achievements.json. Never
                   a target: they hold no unlock state, and rewriting one breaks the game's setup.
*/

const ACTION = {
  DELETE: 'delete',
  CLEAR_SHADPS4_XML: 'clear-shadps4-xml',
  CLEAR_XENIA_GPD: 'clear-xenia-gpd',
};

/*
  Emulator save files, mirroring the list the Watchdog watches (watchdog/monitor.js `files.achievement`
  plus the console/cascade entries). Matched case-insensitively because the same emulator ships both
  spellings across builds.

  The stats files are included on purpose: for progressive achievements ("travel 1000 km") the
  counter IS the achievement progress, and leaving it at 100% either re-fires the unlock instantly or
  makes it unreachable. Everything here is backed up before it is touched.
*/
const SAVE_FILES = new Set(
  [
    'achievements.ini',
    'achievements.json',
    'achiev.ini',
    'stats.ini',
    'achievements.bin',
    'achieve.dat',
    'stats.bin',
    'user_stats.ini',
    'stats.json',
    // RPCS3 keeps unlock state apart from the schema, so this one is safe to remove outright.
    'tropusr.dat',
  ].map((name) => name.toLowerCase())
);

// Schema files that live in the same folders and must survive every reset.
const PROTECTED_FILES = new Set(['tropconf.sfm', 'trophy.trp', 'appid.txt', 'steam_appid.txt']);

/*
  Libraries whose unlocks are held by the platform, not by a file on this PC. Steam, GOG Galaxy,
  Ubisoft Connect, EA, Epic and Xbox all re-synchronise from the account, so there is nothing a reset
  here could achieve - deleting a local cache would only make the next sync put it back. Saying so is
  the honest answer; offering a button that appears to work would not be.
*/
const OFFICIAL_PLATFORM_SOURCES = /^(?:steam\s*\(|gog(?:\s|$)|gog galaxy|epic(?:-official)?$|ea$|ubisoft connect|xbox)/i;

function isOfficialPlatformSource(source) {
  return OFFICIAL_PLATFORM_SOURCES.test(String(source || '').trim());
}

// The app's own manual-unlock overrides are not a save file; they are cleared separately.
function isManualSource(source) {
  return String(source || '').trim().toLowerCase() === 'manual';
}

/*
  What this file needs for the game's achievements to be lockable again, or null when it is none of
  the reset's business. `fileName` is a base name; the caller has already decided the folder belongs
  to this game.
*/
function resetActionFor(fileName) {
  const name = String(fileName || '').trim().toLowerCase();
  if (!name || PROTECTED_FILES.has(name)) return null;
  if (SAVE_FILES.has(name)) return ACTION.DELETE;
  // ShadPS4 ships one file per language (TROP.XML, TROP_01.XML, …); all of them carry the state.
  if (/^trop(_\d+)?\.xml$/.test(name)) return ACTION.CLEAR_SHADPS4_XML;
  if (name.endsWith('.gpd')) return ACTION.CLEAR_XENIA_GPD;
  return null;
}

/*
  Split a game's resolved achievement folders into the ones a reset can work on and the ones it
  cannot, with the reason. `dataPaths` is what the scan recorded for the game
  (util/achievementDataPath.js), so this follows exactly where the unlocks are really read from
  rather than guessing from the source label.
*/
function classifySources(dataPaths = []) {
  const resettable = [];
  const blocked = [];
  for (const entry of Array.isArray(dataPaths) ? dataPaths : []) {
    if (!entry || !entry.path) continue;
    const source = String(entry.source || '');
    if (isOfficialPlatformSource(source)) {
      blocked.push({ source, path: entry.path, reason: 'official-platform' });
      continue;
    }
    if (isManualSource(source)) continue; // handled by clearing the overrides, not by touching files
    resettable.push({ source, path: entry.path });
  }
  return { resettable, blocked };
}

module.exports = {
  ACTION,
  SAVE_FILES,
  PROTECTED_FILES,
  OFFICIAL_PLATFORM_SOURCES,
  isOfficialPlatformSource,
  isManualSource,
  resetActionFor,
  classifySources,
};
