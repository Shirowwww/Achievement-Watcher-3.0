'use strict';

/*
  Uninstall helpers shared by the game-list right-click menu.

  Pure/dependency-free on purpose (only Node core) so the detection rules and URI
  helpers can be unit-tested without Electron. The Windows registry helpers are
  loaded lazily: on machines where the native `registry-js` module is unavailable
  the helpers return null instead of throwing.
*/

const path = require('path');
const fs = require('fs');
const os = require('os');

// Inno Setup uninstallers are named unins000.exe, unins001.exe, … and ship a
// matching uninsNNN.dat next to them. They accept /VERYSILENT uninstall.
const INNO_UNINSTALLER_RE = /^unins\d{3}\.exe$/i;
const INNO_DATA_RE = /^unins\d{3}\.dat$/i;

// NSIS uninstallers: Uninstall.exe / uninstaller.exe. Silent flag is /S.
const NSIS_UNINSTALLER_RE = /^uninstall(?:er)?\.exe$/i;

// Generic uninstallers (GOG/Ubisoft/EA and others): uninst.exe, uninstall_x64.exe,
// Uninstaller-64.exe, uninstall32.exe, … no reliable silent flag — run them visible.
const GENERIC_UNINSTALLER_RE = /^unins(?:t(?:al(?:l)?(?:er)?)?)?(?:[-_ ]?(?:x(?:64|86)|(?:64|32)|[0-9]+))?\.exe$/i;

// Never offer to trash folders that hold achievement saves or an entire drive root.
const SAVE_FOLDER_RE = /[\\/](?:gse saves|goldberg steamemu saves)(?:[\\/]|$)/i;
// Folders that must never be offered as a trash target even if a scan somehow
// resolved them (user profile, system, or generic personal folders).
const BLOCKED_BASE = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'users',
  'user',
  'appdata',
  'desktop',
  'documents',
  'downloads',
  'pictures',
  'music',
  'videos',
  'public',
  'gse saves',
  'goldberg steamemu saves',
]);

function safeReadDir(gameDir) {
  try {
    return fs.readdirSync(gameDir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function silentArgsFor(kind, gameDir) {
  if (kind === 'inno') {
    // `_?=` must be the LAST argument and keeps the uninstaller from copying
    // itself into %TEMP% before running.
    return ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', `_?=${gameDir}`];
  }
  if (kind === 'nsis') {
    return ['/S', `_?=${gameDir}`];
  }
  return [];
}

/**
 * List every uninstaller found directly inside `gameDir`, best first.
 * Each entry: { file, name, kind, args, silent }.
 */
function findUninstallers(gameDir) {
  if (!gameDir || typeof gameDir !== 'string') return [];
  let resolved;
  try {
    resolved = path.resolve(gameDir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return [];
  } catch {
    return [];
  }

  const entries = safeReadDir(resolved);
  const names = entries.filter((e) => e.isFile() && /\.exe$/i.test(e.name)).map((e) => e.name);
  const lowerFiles = new Set(entries.filter((e) => e.isFile()).map((e) => e.name.toLowerCase()));
  const found = [];

  for (const name of names) {
    let kind = null;
    if (INNO_UNINSTALLER_RE.test(name)) {
      kind = 'inno';
    } else if (NSIS_UNINSTALLER_RE.test(name)) {
      kind = 'nsis';
    } else if (GENERIC_UNINSTALLER_RE.test(name)) {
      kind = 'generic';
    }
    if (!kind) continue;

    // An Inno uninstaller without its .dat sibling is almost always a leftover or
    // a false name match; still accept it, but only after a real Inno pair.
    if (kind === 'inno') {
      const dat = name.replace(/\.exe$/i, '.dat').toLowerCase();
      if (!lowerFiles.has(dat)) kind = 'generic';
    }

    found.push({
      file: path.join(resolved, name),
      name,
      kind,
      args: silentArgsFor(kind, resolved),
      silent: kind !== 'generic',
    });
  }

  const priority = { inno: 0, nsis: 1, generic: 2 };
  return found.sort((a, b) => priority[a.kind] - priority[b.kind] || a.name.localeCompare(b.name));
}

/** Best single local uninstaller for a game folder, or null. */
function findLocalUninstaller(gameDir) {
  const list = findUninstallers(gameDir);
  return list[0] || null;
}

/**
 * Best-effort cleanup after a silent Inno/NSIS uninstall. The `_?=` wait argument also stops the
 * uninstaller from deleting itself, which would otherwise leave unins000.exe/.dat behind forever.
 */
function cleanupSilentUninstaller(local) {
  if (!local || !local.silent || !local.file) return;
  try {
    if (fs.existsSync(local.file)) fs.unlinkSync(local.file);
  } catch {
    /* best-effort: file may still be locked briefly after exit */
  }
  if (local.kind === 'inno') {
    try {
      const dat = local.file.replace(/\.exe$/i, '.dat');
      if (fs.existsSync(dat)) fs.unlinkSync(dat);
    } catch {
      /* best-effort */
    }
  }
  try {
    const dir = path.dirname(local.file);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    /* folder not empty (uninstall left other files) or already gone — fine either way */
  }
}

/** Steam browser-protocol URL that asks the Steam client to uninstall an appid. */
function steamUninstallUrl(appid) {
  const id = String(appid == null ? '' : appid);
  if (!/^[0-9]+$/.test(id)) return null;
  return `steam://uninstall/${id}`;
}

let regModule = null;
function getReg() {
  if (regModule === null) {
    try {
      regModule = require('./reg');
    } catch {
      regModule = false;
    }
  }
  return regModule || null;
}

/** Steam install path from HKCU\Software\Valve\Steam, or null when unavailable. */
function getSteamPath() {
  const reg = getReg();
  if (!reg || typeof reg.readRegistryString !== 'function') return null;
  try {
    return reg.readRegistryString('HKCU', 'Software/Valve/Steam', 'SteamPath') || null;
  } catch {
    return null;
  }
}

/**
 * Whether the Steam client currently considers `appid` installed.
 * Returns true/false when the registry says so, or null when it cannot be read.
 */
function isSteamAppInstalled(appid) {
  const reg = getReg();
  if (!reg || typeof reg.readRegistryInteger !== 'function') return null;
  try {
    const value = reg.readRegistryInteger('HKCU', `Software/Valve/Steam/Apps/${String(appid)}`, 'Installed');
    return value === null ? null : value === 1;
  } catch {
    return null;
  }
}

/** One-shot lookup used by the context menu: URL, Steam path, installed state. */
function getSteamUninstallInfo(appid) {
  return {
    url: steamUninstallUrl(appid),
    steamPath: getSteamPath(),
    installed: isSteamAppInstalled(appid),
  };
}

/**
 * Safety gate for the "move folder to Recycle Bin" fallback: must be an existing
 * directory, not a drive root or a known save-folder, and never a system path.
 */
function isSafeTrashTarget(gameDir) {
  if (!gameDir || typeof gameDir !== 'string') return false;
  try {
    const resolved = path.resolve(gameDir);
    const parsed = path.parse(resolved);
    if (parsed.root === resolved) return false; // drive root (C:\)
    if (resolved.length <= 3) return false;
    if (os.homedir && path.resolve(os.homedir()) === resolved) return false;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return false;
    const base = parsed.base.toLowerCase();
    if (BLOCKED_BASE.has(base)) return false;
    if (SAVE_FOLDER_RE.test(resolved)) return false;
    if (!base) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  findUninstallers,
  findLocalUninstaller,
  cleanupSilentUninstaller,
  steamUninstallUrl,
  getSteamPath,
  isSteamAppInstalled,
  getSteamUninstallInfo,
  isSafeTrashTarget,
};
