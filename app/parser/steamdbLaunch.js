'use strict';

// Parse and rank SteamDB launch options for Windows executable detection.

const htmlParser = require('node-html-parser');

function normalizeText(value) {
  return String(value || '')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A launch-option row map ({ Executable, Arguments, "Operating System", "Launch Type", ... }) →
// normalized shape.
function normalizeLaunchOption(raw = {}) {
  return {
    executable: normalizeText(raw.Executable || raw.executable),
    arguments: normalizeText(raw.Arguments || raw.arguments),
    workingDirectory: normalizeText(raw['Working Directory'] || raw.workingDirectory),
    launchType: normalizeText(raw['Launch Type'] || raw.launchType),
    operatingSystem: normalizeText(raw['Operating System'] || raw.operatingSystem).toLowerCase(),
    cpuArchitecture: normalizeText(raw['CPU Architecture'] || raw.cpuArchitecture),
  };
}

function scoreLaunchOption(option) {
  const os = String(option?.operatingSystem || '').toLowerCase();
  const launchType = String(option?.launchType || '').toLowerCase();
  let score = 0;
  if (option?.executable) score += 100;
  if (os.includes('windows')) score += 50;
  if (launchType.includes('default')) score += 25;
  if (launchType.includes('launch')) score += 10;
  return score;
}

function getSortedLaunchOptions(options = []) {
  const normalized = options.map(normalizeLaunchOption).filter((option) => option.executable);
  if (!normalized.length) return null;
  normalized.sort((a, b) => scoreLaunchOption(b) - scoreLaunchOption(a));
  return normalized;
}

function pickBestLaunchOption(options = []) {
  const sorted = getSortedLaunchOptions(options);
  return sorted?.[0] || null;
}

// Windows-preferred, non-DLC candidates (the process names the watchdog could see running).
function getCandidateLaunchOptions(options = []) {
  const sorted = getSortedLaunchOptions(options) || [];
  if (!sorted.length) return [];
  const windowsPreferred = sorted.filter((option) => {
    const os = String(option?.operatingSystem || '').toLowerCase();
    return !os || os.includes('windows');
  });
  const osFiltered = windowsPreferred.length ? windowsPreferred : sorted;
  const nonDlcPreferred = osFiltered.filter((option) => !String(option?.launchType || '').toLowerCase().includes('dlc'));
  return nonDlcPreferred.length ? nonDlcPreferred : osFiltered;
}

const path = require('path');

// De-duplicated, ';'-joined process-name string (the watchdog matches any of them).
function collectProcessNames(options = []) {
  const names = [];
  const seen = new Set();
  for (const option of getCandidateLaunchOptions(options)) {
    const base = path.win32.basename(String(option.executable).replace(/\//g, '\\'));
    const key = base.toLowerCase();
    if (base && !seen.has(key)) {
      seen.add(key);
      names.push(base);
    }
  }
  return names.join(';');
}

// Single best process name (basename only) - gameIndex/the watchdog match one filename per appid.
function bestProcessName(options = []) {
  const best = pickBestLaunchOption(options);
  if (!best?.executable) return '';
  return path.win32.basename(String(best.executable).replace(/\//g, '\\'));
}

function toLaunchMetadata(appid, options = []) {
  const best = pickBestLaunchOption(options);
  if (!best?.executable) return null;
  return {
    appid: String(appid || ''),
    process_name: collectProcessNames(options),
    best_process_name: bestProcessName(options),
    arguments: String(best.arguments || ''),
  };
}

// Parse the "Launch Options" section HTML (one .panel.launch-option per option, each a table of
// key/value rows) into an array of row maps.
function parseLaunchOptionsFromHtml(html) {
  const root = htmlParser.parse(String(html || ''));
  const panels = root.querySelectorAll('.launch-option');
  const out = [];
  for (const panel of panels) {
    const rows = {};
    for (const tr of panel.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) continue;
      const key = normalizeText(cells[0].text);
      // The value is the second column; SteamDB wraps it in <code>. Trailing cells are tooltip
      // icons (SVG, no text) - read the value cell specifically rather than joining everything.
      const valueCell = cells[1];
      const code = valueCell.querySelector('code');
      const value = normalizeText(code ? code.text : valueCell.text);
      if (key && value) rows[key] = value;
    }
    if (Object.keys(rows).length) out.push(rows);
  }
  return out;
}

// Full parse → metadata from a captured section HTML string.
function launchMetadataFromHtml(appid, html) {
  return toLaunchMetadata(appid, parseLaunchOptionsFromHtml(html));
}

// Steam's own product info publishes the same launch options SteamDB republishes, as
// appinfo.config.launch: entries keyed "0","1",... of { executable, arguments, type, config.oslist }.
// Reading them needs no browser, so this is the preferred source and the scrape is the fallback.
function parseLaunchOptionsFromAppInfo(launchSection) {
  if (!launchSection || typeof launchSection !== 'object') return [];
  return Object.values(launchSection)
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      executable: entry.executable,
      arguments: entry.arguments,
      operatingSystem: (entry.config && entry.config.oslist) || '',
      launchType: entry.type || '',
    }));
}

// Full parse → metadata from an appinfo.config.launch section.
function launchMetadataFromAppInfo(appid, launchSection) {
  return toLaunchMetadata(appid, parseLaunchOptionsFromAppInfo(launchSection));
}

module.exports = {
  normalizeLaunchOption,
  scoreLaunchOption,
  getSortedLaunchOptions,
  pickBestLaunchOption,
  getCandidateLaunchOptions,
  collectProcessNames,
  bestProcessName,
  toLaunchMetadata,
  parseLaunchOptionsFromHtml,
  launchMetadataFromHtml,
  parseLaunchOptionsFromAppInfo,
  launchMetadataFromAppInfo,
};
