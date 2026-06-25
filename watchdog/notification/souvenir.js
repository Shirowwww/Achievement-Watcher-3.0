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

// Strip characters illegal in Windows file/folder names; keep spaces; cap the length.
function sanitize(s) {
  return String(s || '').replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Unknown';
}

function defaultDir() {
  return path.join(os.homedir(), 'Pictures', 'Achievement Watcher');
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
    const file = path.join(gameDir, ts + ' - ' + sanitize(achievement) + '.png');
    const img = await shot({ format: 'png' });
    fs.writeFileSync(file, img);
    debug.log('[souvenir] saved ' + file);
    return file;
  } catch (err) {
    debug.error('[souvenir] capture failed: ' + (err.message || err));
    return null;
  }
};
