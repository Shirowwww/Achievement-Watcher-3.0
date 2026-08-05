'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadOverlayLocale } = require('../app/util/overlayLocale.js');

const repoLocaleDir = path.join(__dirname, '..', 'app', 'locale', 'lang');

async function run() {
  // English is the base payload the overlay starts from.
  const english = loadOverlayLocale({ localeDir: repoLocaleDir, lang: 'english' });
  assert.equal(english.lang, 'english');
  assert.equal(english.strings.icon, 'Icon');
  assert.equal(english.strings.achievement, 'Achievement');
  assert.equal(english.strings.status, 'Status');
  assert.equal(english.strings.selectConfig, 'Select a config!');
  assert.equal(english.strings.locked, 'Locked');
  assert.equal(english.strings.unlocked, 'Unlocked');
  assert.equal(english.strings.progress, 'Progress');
  assert.equal(english.strings.hidden, 'Hidden');
  assert.equal(english.strings.na, 'N/A');

  // A real locale overrides the overlay strings used by the in-game list.
  const french = loadOverlayLocale({ localeDir: repoLocaleDir, lang: 'french' });
  assert.equal(french.lang, 'french');
  assert.equal(french.strings.icon, 'Icône');
  assert.equal(french.strings.achievement, 'Succès');
  assert.equal(french.strings.status, 'Statut');
  assert.equal(french.strings.selectConfig, 'Sélectionnez une configuration !');
  assert.equal(french.strings.locked, 'Verrouillé');
  assert.equal(french.strings.unlocked, 'Débloqué');
  assert.equal(french.strings.progress, 'Progression');
  assert.equal(french.strings.hidden, 'Masqué');
  assert.equal(french.strings.na, 'N/A');

  // A missing per-language file degrades to English (same policy as the rest of the UI).
  const missing = loadOverlayLocale({ localeDir: repoLocaleDir, lang: 'klingon' });
  assert.equal(missing.lang, 'klingon');
  assert.deepEqual(missing.strings, english.strings);

  // A partial locale fills untranslated keys from English instead of dropping them.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-overlay-locale-'));
  try {
    fs.copyFileSync(path.join(repoLocaleDir, 'english.json'), path.join(tmp, 'english.json'));
    fs.writeFileSync(path.join(tmp, 'partial.json'), JSON.stringify({ overlay: { icon: 'Icône partielle' } }));
    const partial = loadOverlayLocale({ localeDir: tmp, lang: 'partial' });
    assert.equal(partial.strings.icon, 'Icône partielle');
    assert.equal(partial.strings.achievement, 'Achievement');
    assert.equal(partial.strings.locked, 'Locked');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('PASS: overlayLocale payload');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
