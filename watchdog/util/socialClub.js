'use strict';

const fs = require('fs');
const path = require('path');
const { userDataDir } = require('./userData.js');

// Achievement files the SocialClub parser can actually read (kept in sync with
// ACHIEVEMENT_FILE_GLOB in app/parser/socialclub.js — the watchdog has its own module tree and
// cannot require the app's parsers). Rockstar's own save blobs (SGTA*/SRDR*/cfg.dat) are
// deliberately NOT here: nothing can decode them yet, so waking the watchdog on every autosave
// would be pure churn during play.
const SOCIALCLUB_ACHIEVEMENT_FILES = [
  'achievements.ini',
  'achievements.json',
  'achiev.ini',
  'stats.ini',
  'Achievements.Bin',
  'achieve.dat',
  'achievement.dat',
  'achievements.dat',
  'accomplishments.json',
  'accomplishments.dat',
  'awards.json',
  'awards.dat',
  'Achievements.ini',
  'stats.bin',
  'user_stats.ini',
  'stats.json',
];

// Same slug the app derives in parser/socialclub.js (socialClubAppId). The folder name is the ONLY
// stable link from a changed save path back to a library entry, and the entry's `name` is the
// RESOLVED Steam title ("Grand Theft Auto V") rather than the folder ("GTA V") — so matching on the
// name alone never fires. The slug is derived from the folder name on both sides, so it always does.
function socialClubSlug(gameName) {
  const slug = String(gameName || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
  return `socialclub-${slug || 'unknown'}`;
}

const SOCIALCLUB_ROOT_RE = /^goldberg\s*social\s*club\s*emu\s*saves$/i;
const HEX_PROFILE_RE = /^[0-9a-fA-F]{6,12}$/;

// Which folder under the watched directory names the game. The user can add the SocialClub root OR
// a single game folder, so the answer is not simply "first segment below the watched dir":
//   - the emulator root is on the path        → the game is the segment right after it,
//   - the watched dir is itself a game folder → the game is that folder's own name.
function gameFolderName(rootDir, changedDir) {
  const segments = String(changedDir || '')
    .split(/[\\/]+/)
    .filter(Boolean);
  const rootIndex = segments.findIndex((segment) => SOCIALCLUB_ROOT_RE.test(segment));
  if (rootIndex >= 0) return segments[rootIndex + 1] || '';

  const root = String(rootDir || '');
  const rel = path.relative(root, String(changedDir || ''));
  if (rel.startsWith('..') || path.isAbsolute(rel)) return '';
  const parts = rel.split(path.sep).filter(Boolean);
  // No segment left, or straight into a hex profile folder: the watched directory IS the game.
  if (!parts.length || HEX_PROFILE_RE.test(parts[0])) return path.basename(root);
  return parts[0];
}

// Locate the Goldberg SocialClub entry for a changed save path.
function findIndexedSocialClubGame(rootDir, changedDir, options = {}) {
  const gameName = gameFolderName(rootDir, changedDir);
  if (!gameName) return null;

  const wantedAppid = socialClubSlug(gameName);
  const wantedName = gameName.toLowerCase();

  const files = Array.isArray(options.files)
    ? options.files
    : [path.join(userDataDir(), 'steam_cache', 'schema', 'gameIndex.json'), path.join(userDataDir(), 'cfg', 'gameIndex.json')];
  for (const file of files) {
    try {
      const list = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(list)) continue;
      const entries = list.filter((game) => game && String(game.source || '') === 'Goldberg SocialClub');
      const found =
        entries.find((game) => String(game.appid || '').toLowerCase() === wantedAppid) ||
        entries.find((game) => String(game.name || '').toLowerCase() === wantedName);
      if (found) return found;
    } catch {
      /* game index files are optional */
    }
  }
  return null;
}

module.exports = { findIndexedSocialClubGame, gameFolderName, socialClubSlug, SOCIALCLUB_ACHIEVEMENT_FILES };
