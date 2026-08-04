'use strict';

const fs = require('fs');
const path = require('path');
const listDrive = require(path.join(__dirname, '..', 'util', 'listDrive.js'));
const { readRegistryString, readRegistryStringAndExpand } = require(path.join(__dirname, '..', 'util', 'reg.js'));

function addUnique(out, candidate) {
  if (!candidate) return;
  const value = String(candidate).trim();
  if (!value) return;
  const key = path.normalize(value).toLowerCase();
  if (out.some((p) => path.normalize(p).toLowerCase() === key)) return;
  out.push(value);
}

function envPath(envName, ...segments) {
  const base = process.env[envName];
  if (!base) return null;
  return path.join(base, ...segments);
}

const steamSourceFolderNames = ['RUNE', 'CODEX'];

function expandKnownSteamSourceRoots(root) {
  const roots = [];
  if (!root) return roots;
  addUnique(roots, root);

  for (const name of steamSourceFolderNames) {
    const child = path.join(root, name);
    try {
      if (fs.existsSync(child) && fs.statSync(child).isDirectory()) addUnique(roots, child);
    } catch {
      /* Optional community save folders may be unreadable or missing. */
    }
  }

  return roots;
}

function documentsPath() {
  return readRegistryStringAndExpand('HKCU', 'Software/Microsoft/Windows/CurrentVersion/Explorer/User Shell Folders', 'Personal');
}

function defaultSteamEmuSaveRoots({ existingOnly = false, expandProgramDataSteam = false } = {}) {
  const roots = [];
  [
    envPath('PUBLIC', 'Documents', 'OnlineFix'),
    envPath('PUBLIC', 'Documents', 'Steam', 'RUNE'),
    envPath('PUBLIC', 'Documents', 'Steam', 'CODEX'),
    envPath('PUBLIC', 'Documents', 'EMPRESS'),
    envPath('APPDATA', 'Goldberg SteamEmu Saves'),
    envPath('APPDATA', 'Goldberg UplayEmu Saves'),
    envPath('APPDATA', 'GSE Saves'),
    envPath('APPDATA', 'EMPRESS'),
    envPath('APPDATA', 'Steam', 'CODEX'),
    envPath('APPDATA', 'SmartSteamEmu'),
    envPath('APPDATA', 'CreamAPI'),
    envPath('LOCALAPPDATA', 'SKIDROW'),
    envPath('LOCALAPPDATA', 'anadius', 'LSX emu', 'achievement_watcher'),
  ].forEach((p) => addUnique(roots, p));

  const docs = documentsPath();
  if (docs) addUnique(roots, path.join(docs, 'SkidRow'));

  const programDataSteam = envPath('PROGRAMDATA', 'Steam');
  if (programDataSteam) {
    if (expandProgramDataSteam) {
      try {
        for (const ent of fs.readdirSync(programDataSteam, { withFileTypes: true })) {
          if (ent.isDirectory()) addUnique(roots, path.join(programDataSteam, ent.name));
        }
      } catch {
        /* ProgramData Steam layout is optional. */
      }
    } else {
      addUnique(roots, programDataSteam);
    }
  }

  return existingOnly ? roots.filter((p) => fs.existsSync(p)) : roots;
}

function defaultSteamScanRoots(additionalSearch = []) {
  const roots = defaultSteamEmuSaveRoots({ expandProgramDataSteam: true });
  for (const dir of additionalSearch || []) {
    for (const root of expandKnownSteamSourceRoots(dir)) addUnique(roots, root);
  }
  return roots;
}

function readSteamInstallPath() {
  return (
    readRegistryString('HKCU', 'Software/Valve/Steam', 'SteamPath') ||
    readRegistryString('HKCU', 'Software/Valve/Steam', 'InstallPath') ||
    envPath('ProgramFiles(x86)', 'Steam') ||
    envPath('ProgramFiles', 'Steam')
  );
}

function parseSteamLibraryFolders(steamPath) {
  const roots = [];
  if (!steamPath) return roots;
  addUnique(roots, steamPath);
  const vdf = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
  let raw = '';
  try {
    raw = fs.readFileSync(vdf, 'utf8');
  } catch {
    return roots;
  }

  const modern = /"path"\s*"([^"]+)"/gi;
  let match;
  while ((match = modern.exec(raw))) {
    addUnique(roots, match[1].replace(/\\\\/g, '\\'));
  }

  const legacy = /^\s*"\d+"\s*"([^"]+)"\s*$/gim;
  while ((match = legacy.exec(raw))) {
    addUnique(roots, match[1].replace(/\\\\/g, '\\'));
  }

  return roots;
}

// A path is "Steam-ish" when its normalized name contains a Steam library/install segment
// (steam, steamapps, steamlibrary, "steam library", "steam games"). Automatic detection must
// never add these as library roots: legit Steam games are handled by the Steam source, not by
// the emulator scans. A neutral folder like C:\Games that merely *contains* a steamapps
// subtree stays eligible — the scans skip that subtree themselves.
function isSteamLikePath(p) {
  const value = String(p || '');
  if (!value) return false;
  const normalized = value.replace(/\//g, path.sep);
  return /(?:^|[\\/])(steam|steamapps|steamlibrary|steam library|steam games)(?:[\\/]|$)/i.test(normalized);
}

// Common game-library folder names probed on every fixed drive by Smart Find. `Program Files`
// variants are only added under their Games subfolder so the scanner never treats the whole
// Windows install (Steam, Office, …) as a game library.
const GAME_LIBRARY_FOLDER_NAMES = [
  'Games',
  'Jeux',
  'GOG Games',
  'Epic Games',
  path.join('Program Files', 'Games'),
  path.join('Program Files (x86)', 'Games'),
];

async function discoverLibraryRoots() {
  const roots = [];

  let drives = [];
  try {
    drives = await listDrive({ ignoreSystemDrive: false });
  } catch {
    drives = [];
  }

  for (const drive of drives) {
    for (const name of GAME_LIBRARY_FOLDER_NAMES) {
      addUnique(roots, path.join(`${drive}\\`, name));
    }
  }

  return roots.filter((p) => {
    try {
      return !isSteamLikePath(p) && fs.existsSync(p) && fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  });
}

module.exports = {
  defaultSteamEmuSaveRoots,
  defaultSteamScanRoots,
  discoverLibraryRoots,
  expandKnownSteamSourceRoots,
  isSteamLikePath,
};
