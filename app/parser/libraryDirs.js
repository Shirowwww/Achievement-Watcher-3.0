'use strict';

const path = require('path');
const fs = require('fs');
const saveRoots = require(path.join(__dirname, 'saveRoots.js'));

// Library roots (e.g. C:\Jeux, D:\Games, E:\SteamLibrary): folders that hold many game install
// dirs, used by achievements.js as scan roots for Goldberg/GBE/unconfigured install detection.
// Distinct from userDir.js, which stores per-game SAVE folders validated against known emulator
// marker files — a library root has no such marker, it's just a folder full of game subfolders.
let file;
const DEFAULTS = ['C:\\Jeux'];

module.exports.setUserDataPath = async (p) => {
  file = path.join(p, 'cfg/librarydirs.db');
};

// Quarantine a corrupted config file (rename to <file>.corrupt-<timestamp>) so its raw bytes are
// preserved for manual recovery while a clean default is written in its place.
function quarantineCorruptConfig(f, err) {
  try {
    const backup = `${f}.corrupt-${Date.now()}`;
    fs.renameSync(f, backup);
    console.warn(`[libraryDirs] corrupt config ${f} (${err.message}); quarantined to ${backup}, reseeding defaults`);
  } catch (e) {
    try { fs.unlinkSync(f); } catch {}
    console.warn(`[libraryDirs] corrupt config ${f} (${err.message}); could not quarantine (${e.message}), overwriting`);
  }
}

module.exports.get = async () => {
  try {
    if (!fs.existsSync(file)) {
      await this.save(DEFAULTS);
      return [...DEFAULTS];
    }
    const raw = fs.readFileSync(file, 'utf8');
    try {
      return JSON.parse(raw);
    } catch (parseErr) {
      // Genuine corruption (e.g. a write interrupted by a crash/power loss). A transient I/O lock
      // throws before JSON.parse and is handled by the outer catch — so we never quarantine a good
      // file just because antivirus/the indexer held it open for a moment.
      quarantineCorruptConfig(file, parseErr);
      try { await this.save(DEFAULTS); } catch {}
      return [...DEFAULTS];
    }
  } catch (err) {
    // I/O error (file locked, permission issue, …) — degrade to defaults without destroying the file.
    console.warn(`[libraryDirs] could not read ${file}: ${err.message}`);
    return [...DEFAULTS];
  }
};

module.exports.find = async () => {
  return saveRoots.discoverLibraryRoots();
};

module.exports.save = async (data) => {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    throw err;
  }
};
