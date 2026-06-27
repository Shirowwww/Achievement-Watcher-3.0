'use strict';

const fs = require('fs');
const path = require('path');

const steamLanguages = require('./steam.json');

const langDir = path.join(__dirname, 'lang');

let cached;

function hasLanguageFile(api) {
  return typeof api === 'string' && fs.existsSync(path.join(langDir, `${api}.json`));
}

function all() {
  if (!cached) cached = steamLanguages.filter((language) => hasLanguageFile(language.api));
  return cached;
}

function has(api) {
  return all().some((language) => language.api === api);
}

function get(api) {
  return all().find((language) => language.api === api) || all().find((language) => language.api === 'english');
}

function bestForLocale(locale) {
  const normalized = String(locale || '').toLowerCase();
  if (!normalized) return get('english');

  return (
    all().find((language) => String(language.iso || '').toLowerCase() === normalized) ||
    all().find((language) => String(language.webapi || '').toLowerCase() === normalized) ||
    all().find((language) => normalized.startsWith(`${String(language.webapi || '').toLowerCase()}-`)) ||
    get('english')
  );
}

module.exports = { all, has, get, bestForLocale };
