'use strict';

// Standalone locale helper for the Watchdog process. The Watchdog runs as its own Node process
// (spawned next to the app), so it cannot require the renderer's locale loader; it ships a small
// mirror of the `watchdog` section (watchdog/locale.json, generated from app/locale/lang) and
// resolves strings by the configured Steam language, degrading to English like the app.

const fs = require('fs');
const path = require('path');

const localeFile = path.join(__dirname, '..', 'locale.json');
let cache = null;

function loadAll() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(localeFile, 'utf8'));
  } catch (err) {
    cache = {};
  }
  return cache;
}

function forLang(lang) {
  const all = loadAll();
  const base = all.english || {};
  const requested = all[lang] || {};
  return Object.assign({}, base, requested);
}

function interpolate(template, params) {
  if (!params || typeof params !== 'object') return template;
  return String(template).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

// App locale ids -> humanize-duration locale codes (subset supported by the bundled package).
const HUMANIZE_LOCALES = {
  english: 'en',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  latam: 'es',
  italian: 'it',
  portuguese: 'pt',
  brazilian: 'pt',
  czech: 'cs',
  slovak: 'sk',
  hungarian: 'hu',
  polish: 'pl',
  russian: 'ru',
  ukrainian: 'uk',
  turkish: 'tr',
  thai: 'th',
  japanese: 'ja',
  schinese: 'zh_CN',
};

function humanizeLocale(lang) {
  return HUMANIZE_LOCALES[String(lang || '').toLowerCase()] || 'en';
}

module.exports = { forLang, interpolate, humanizeLocale };
