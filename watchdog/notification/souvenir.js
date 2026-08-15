'use strict';

// Souvenir screenshot (simple): capture the desktop a moment after an achievement unlocks (so an
// on-screen toast or overlay popup is included), and save it under a per-game subfolder named after the
// achievement and time:  <dir>/<game>/<date> - <achievement>.png. Best-effort - any failure (no display,
// fullscreen-exclusive game, missing native helper) is swallowed so notifications never break.

const path = require('path');
const fs = require('fs');
const os = require('os');
const debug = require('../util/log.js');

let screenshot = null; // null = not tried, false = unavailable, fn = loaded
function loadScreenshot() {
  if (screenshot === null) {
    try {
      screenshot = require('screenshot-desktop');
    } catch (err) {
      screenshot = false;
      debug.warn('[souvenir] screenshot-desktop unavailable: ' + (err.message || err));
    }
  }
  return screenshot;
}

// Names Windows refuses whatever the extension, so a game called "NUL" or "COM1" would lose its
// screenshots entirely.
const RESERVED_NAME = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/*
  Strip characters illegal in Windows file/folder names; keep spaces; cap the length.

  Trailing dots and spaces matter as much as the illegal characters: Windows silently drops them
  from the name it actually creates, so a title ending in one ("Mr. Do." or "Sam & Max ") would
  have the write land somewhere other than the path returned here - and the caller checks that
  path when picking a non-colliding name.
*/
function sanitize(s) {
  const cleaned = String(s || '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\p{Cc}/gu, '') // control characters are illegal in a Windows name too
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, '');
  if (!cleaned) return 'Unknown';
  return RESERVED_NAME.test(cleaned) ? cleaned + '_' : cleaned;
}

// Never overwrite an earlier souvenir: several achievements can unlock within the same second, and
// the same one can be unlocked again after a reset.
function uniquePath(dir, base) {
  let file = path.join(dir, `${base}.png`);
  for (let n = 2; fs.existsSync(file) && n < 1000; n++) file = path.join(dir, `${base} (${n}).png`);
  return file;
}

// Kept in sync with souvenirDefaultDir() in app/ui/settings.js and SOUVENIR_DIR_NAME in
// app/util/migrateUserData.js, which links shots from the pre-rename folder into this one.
function defaultDir() {
  return path.join(os.homedir(), 'Pictures', 'Achievement Watcher Next');
}

// Capture the full desktop and write it to <dir>/<game>/<date> - <achievement>.png. Returns the path or null.
module.exports.capture = async function ({ game, achievement, dir } = {}) {
  const shot = loadScreenshot();
  if (!shot) return null;
  try {
    const baseDir = dir && String(dir).trim() ? String(dir).trim() : defaultDir();
    const gameDir = path.join(baseDir, sanitize(game));
    fs.mkdirSync(gameDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', ' ').slice(0, 19); // e.g. 2026-06-23 23-10-05
    const file = uniquePath(gameDir, ts + ' - ' + sanitize(achievement));
    const img = await shot({ format: 'png' });
    fs.writeFileSync(file, img);
    debug.log('[souvenir] saved ' + file);
    return file;
  } catch (err) {
    debug.error('[souvenir] capture failed: ' + (err.message || err));
    return null;
  }
};

// Exported for the tests: both decide the path a screenshot is written to.
module.exports._sanitize = sanitize;
module.exports._uniquePath = uniquePath;
