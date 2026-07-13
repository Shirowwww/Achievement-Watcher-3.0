'use strict';

// SteamDB launch-metadata fallback. When AW can't detect a game's executable locally (no install
// dir, or a scan that finds no matching .exe), the watchdog has no process name to match a running
// game against — so playtime/launch detection silently does nothing. SteamDB's per-app config page
// lists every launch option (executable, arguments, OS, launch type); this module picks the best
// Windows one and returns a process_name the watchdog can match.
//
// SteamDB 403s plain HTTP requests (Cloudflare) but loads fine through AW's existing
// puppeteer-extra + stealth browser, so the actual page fetch goes through the main process
// (init.js `get-steamdb-launch` IPC, which reuses the SteamHunters scrape browser). This module is
// the pure logic: parse the launch-options HTML and rank the candidates — unit-testable offline.
//
// Ported from PSerban93/Achievements (JokerVerse) utils/steamdb-launch-metadata.js — MIT-licensed;
// see NOTICE.md. Playwright's page.evaluate scraping is replaced by node-html-parser over the
// section HTML (no Playwright dependency).

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

// Single best process name (basename only) — gameIndex/the watchdog match one filename per appid.
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
      // icons (SVG, no text) — read the value cell specifically rather than joining everything.
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
};
