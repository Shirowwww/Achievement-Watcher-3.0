'use strict';

// Shared sound-file helpers for notification audio (ported format list from PSerban93/Achievements:
// .wav/.mp3/.ogg now also accept .flac/.m4a/.aac, which Windows Media Foundation can play).

const fs = require('fs');
const path = require('path');

const SOUND_EXTENSIONS = ['.wav', '.mp3', '.ogg', '.flac', '.m4a', '.aac'];
const SOUND_EXT_RE = /\.(?:wav|mp3|ogg|flac|m4a|aac)$/i;

// List sound files across the given directories. User-imported dirs listed AFTER bundled dirs shadow
// same-named bundled files (callers pass [bundledSoundsDir, userSoundsDir]).
function listSoundFiles(dirs) {
  const byName = new Map();
  for (const dir of [].concat(dirs || [])) {
    if (!dir) continue;
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

// Pick a uniformly random sound file from the merged list; '' when none are available.
function pickRandomSound(dirs) {
  const list = listSoundFiles(dirs);
  if (list.length === 0) return '';
  return list[Math.floor(Math.random() * list.length)].file;
}

module.exports = { SOUND_EXTENSIONS, SOUND_EXT_RE, listSoundFiles, pickRandomSound };
