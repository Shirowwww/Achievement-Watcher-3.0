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
  assert.equal(english.strings.title, 'Achievements');
  assert.equal(english.strings.search, 'Search achievements…');
  assert.equal(english.strings.filterAll, 'All');
  assert.equal(english.strings.filterUnlocked, 'Unlocked');
  assert.equal(english.strings.filterLocked, 'Locked');
  assert.equal(english.strings.filterProgress, 'In progress');
  assert.equal(english.strings.statsOf, 'of');
  assert.equal(english.strings.settingsTitle, 'Overlay options');
  assert.equal(english.strings.settingsTheme, 'Accent');
  assert.equal(english.strings.settingsDensity, 'Density');
  assert.equal(english.strings.densityCompact, 'Compact');
  assert.equal(english.strings.densityCozy, 'Cozy');
  assert.equal(english.strings.densitySpacious, 'Spacious');
  assert.equal(english.strings.settingsIconSize, 'Icon size');
  assert.equal(english.strings.iconSmall, 'Small');
  assert.equal(english.strings.iconMedium, 'Medium');
  assert.equal(english.strings.iconLarge, 'Large');
  assert.equal(english.strings.settingsZoom, 'Zoom');
  assert.equal(english.strings.settingsShowStats, 'Stats bar');
  assert.equal(english.strings.settingsShowProgress, 'Progress bars');
  assert.equal(english.strings.settingsShowRarity, 'Rarity');
  assert.equal(english.strings.settingsShowDescriptions, 'Descriptions');
  assert.equal(english.strings.settingsReset, 'Reset defaults');
  assert.equal(english.strings.noResults, 'No achievements match your search.');

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
  assert.equal(french.strings.title, 'Succès');
  assert.equal(french.strings.search, 'Rechercher des succès…');
  assert.equal(french.strings.filterAll, 'Tous');
  assert.equal(french.strings.filterUnlocked, 'Débloqués');
  assert.equal(french.strings.filterLocked, 'Verrouillés');
  assert.equal(french.strings.filterProgress, 'En cours');
  assert.equal(french.strings.statsOf, 'sur');
  assert.equal(french.strings.settingsTitle, 'Options de l’overlay');
  assert.equal(french.strings.settingsTheme, 'Accent');
  assert.equal(french.strings.settingsDensity, 'Densité');
  assert.equal(french.strings.densityCompact, 'Compact');
  assert.equal(french.strings.densityCozy, 'Confortable');
  assert.equal(french.strings.densitySpacious, 'Aéré');
  assert.equal(french.strings.settingsIconSize, 'Taille des icônes');
  assert.equal(french.strings.iconSmall, 'Petite');
  assert.equal(french.strings.iconMedium, 'Moyenne');
  assert.equal(french.strings.iconLarge, 'Grande');
  assert.equal(french.strings.settingsZoom, 'Zoom');
  assert.equal(french.strings.settingsShowStats, 'Barre de statistiques');
  assert.equal(french.strings.settingsShowProgress, 'Barres de progression');
  assert.equal(french.strings.settingsShowRarity, 'Rareté');
  assert.equal(french.strings.settingsShowDescriptions, 'Descriptions');
  assert.equal(french.strings.settingsReset, 'Réinitialiser');
  assert.equal(french.strings.noResults, 'Aucun succès ne correspond à votre recherche.');

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
