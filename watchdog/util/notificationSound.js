'use strict';

// Mirrors app/util/notificationSounds.js for the standalone Watchdog process: resolves the
// notification sound the user picked in Settings > Notifications (Son / Son aléatoire) so
// Windows toasts play the same file (and honor the same volume) as the in-game overlay.

const fs = require('fs');
const path = require('path');
const { userDataDir } = require('./userData.js');

const SOUND_EXT_RE = /\.(?:wav|mp3|ogg|flac|m4a|aac)$/i;

function bundledSoundsDir() {
  if (process.env.AW_SOUNDS_DIR) {
    try {
      if (fs.statSync(process.env.AW_SOUNDS_DIR).isDirectory()) return process.env.AW_SOUNDS_DIR;
    } catch {
      /* fall through to the layout probes */
    }
  }
  // Dev checkout: watchdog/../app/sounds. Packaged: the watchdog sits inside app/, so
  // watchdog/../sounds is the app's sounds folder.
  for (const candidate of [path.join(__dirname, '../../app/sounds'), path.join(__dirname, '../sounds')]) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      /* try the next layout */
    }
  }
  return '';
}

function userSoundsDir() {
  return path.join(userDataDir(), 'sounds');
}

function resolveSoundFile(name) {
  if (!name) return '';
  for (const dir of [userSoundsDir(), bundledSoundsDir()]) {
    try {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) return file;
    } catch {
      /* try the next location */
    }
  }
  return '';
}

function listSoundFiles() {
  const byName = new Map();
  for (const dir of [userSoundsDir(), bundledSoundsDir()]) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!SOUND_EXT_RE.test(name)) continue;
      byName.set(name, path.join(dir, name));
    }
  }
  return [...byName.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([name, file]) => ({ name, file }));
}

function pickRandomSound() {
  const list = listSoundFiles();
  if (list.length === 0) return '';
  return list[Math.floor(Math.random() * list.length)].file;
}

module.exports = { bundledSoundsDir, userSoundsDir, resolveSoundFile, listSoundFiles, pickRandomSound };
