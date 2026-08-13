'use strict';

// One conservative gate for every place that proposes an initial GBE configuration. Repair and
// diagnostic actions deliberately remain separate: this module answers only whether a game has no
// existing platform/fix ownership and is therefore safe to offer as a first-time GBE target.

const fs = require('fs');
const path = require('path');
const crackLoaderDetect = require('./crackLoaderDetect.js');
const launcherDetect = require('../parser/launcherDetect.js');
const uplayR2 = require('../parser/uplayR2.js');

const ALLOWED_SYSTEMS = new Set(['', 'pc', 'windows', 'steam']);
const NON_GBE_SOURCES = /^(?:gog|epic|ea|xbox|playstation|rpcs3|shadps4|xenia|ubisoft|uplay|social\s*club)/i;
const OWN_EMULATOR_SOURCES = /(?:onlinefix|tenoke|ali213|smartsteamemu|universelan|hoodlum|codex|rune)/i;

function hasSteamApiDll(gameDir, { maxDepth = 4, maxDirectories = 600 } = {}) {
  if (!gameDir || !fs.existsSync(gameDir)) return false;
  const queue = [{ dir: path.resolve(gameDir), depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxDirectories) {
    const { dir, depth } = queue.shift();
    visited++;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && /^steam_api(?:64)?\.dll$/i.test(entry.name)) return true;
      if (entry.isDirectory() && depth < maxDepth) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return false;
}

function findExistingFix(gameDir, { maxDepth = 4, maxDirectories = 600 } = {}) {
  if (!gameDir || !fs.existsSync(gameDir)) return null;
  const queue = [{ dir: path.resolve(gameDir), depth: 0 }];
  let visited = 0;
  while (queue.length && visited < maxDirectories) {
    const { dir, depth } = queue.shift();
    visited++;
    const loader = crackLoaderDetect.detectWorkingCrackLoader(dir);
    if (loader) return { kind: 'loader', name: loader.name, path: dir };
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.toLowerCase() === 'steam_settings') {
        return { kind: 'steam-settings', name: 'GBE / Goldberg', path: path.join(dir, entry.name) };
      }
      if (depth < maxDepth) queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
    }
  }
  return null;
}

function inspect({ gameDir, source = '', system = '', isUbisoft = false, manual = false, allowManual = false } = {}) {
  const normalizedSource = String(source || '').trim();
  const normalizedSystem = String(system || '').trim().toLowerCase();
  const isManualEntry = manual || /^manual$/i.test(normalizedSource);
  if (!gameDir || !fs.existsSync(gameDir)) return { eligible: false, reason: 'unknown-install-folder' };
  // Automatic/bulk generation must never target manual entries. The renderer may opt a single
  // manual PC game in explicitly from its context menu; every existing-fix/platform guard below
  // still applies before the write action is offered.
  if ((isManualEntry && !allowManual) || NON_GBE_SOURCES.test(normalizedSource)) return { eligible: false, reason: 'unsupported-source' };
  if (OWN_EMULATOR_SOURCES.test(normalizedSource)) return { eligible: false, reason: 'existing-source-fix' };
  if (!ALLOWED_SYSTEMS.has(normalizedSystem)) return { eligible: false, reason: 'unsupported-platform' };
  if (isUbisoft || normalizedSystem === 'uplay') return { eligible: false, reason: 'ubisoft' };
  // A manual executable can be an emulator or any ordinary desktop program. Only expose the GBE
  // write action when the selected folder already proves that the program actually uses Steam API.
  if (isManualEntry && allowManual && !hasSteamApiDll(gameDir)) return { eligible: false, reason: 'no-steam-api' };
  if (/^Steam\s*\(/i.test(normalizedSource) || launcherDetect.isOfficialLauncherInstall(gameDir)) {
    return { eligible: false, reason: 'official-launcher' };
  }
  if (uplayR2.detectEmulator(gameDir).type !== 'none') return { eligible: false, reason: 'uplay-r2' };
  const existingFix = findExistingFix(gameDir);
  if (existingFix) return { eligible: false, reason: 'existing-fix', existingFix };
  return { eligible: true, reason: 'unconfigured' };
}

module.exports = { findExistingFix, hasSteamApiDll, inspect, isEligible: (game) => inspect(game).eligible };
