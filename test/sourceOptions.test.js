'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const appHtml = fs.readFileSync(path.join(__dirname, '..', 'app', 'view', 'app.html'), 'utf8');
const loaderJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'locale', 'loader.js'), 'utf8');
const settingsJs = fs.readFileSync(path.join(__dirname, '..', 'app', 'settings.js'), 'utf8');
const localeDir = path.join(__dirname, '..', 'app', 'locale', 'lang');

// The <ul> holding the Sources tab's rows, in document order.
function sourceListItems() {
  const start = appHtml.indexOf('<ul id="options-source">');
  const end = appHtml.indexOf('</ul>', start);
  assert.ok(start > 0 && end > start, 'the source options list must exist in app.html');
  return appHtml
    .slice(start, end)
    .split('<li class="hasHelper">')
    .slice(1)
    .map((item) => {
      const id = item.match(/id="option_(\w+)"/);
      return { key: id ? id[1] : null, html: item };
    });
}

// Keys of the achievement_source block in the settings defaults.
function configuredSources() {
  const block = settingsJs.match(/achievement_source:\s*\{([^}]*)\}/);
  assert.ok(block, 'settings.js must declare achievement_source defaults');
  return block[1]
    .split('\n')
    .map((line) => (line.match(/^\s*(\w+)\s*:/) || [])[1])
    .filter(Boolean);
}

// Every source the scanner honours must be switchable from Settings. Seven of them (Ubisoft
// Connect, GOG Galaxy, Epic, the two Nemirtingas emulators, shadPS4, Xenia) had no row at all: they
// defaulted to on and could only be turned off by hand-editing options.ini, which is why a Ubisoft
// entry could not be hidden through the UI (issue #20).
test('every achievement source has a toggle in the Sources tab', () => {
  const rows = new Set(sourceListItems().map((item) => item.key));
  for (const key of configuredSources()) {
    assert.ok(rows.has(key), `achievement_source.${key} has no #option_${key} row in app.html`);
  }
});

test('no source row exists without a matching setting', () => {
  const configured = new Set(configuredSources());
  for (const { key } of sourceListItems()) {
    assert.ok(key, 'every source row must carry an #option_<key> select');
    assert.ok(configured.has(key), `#option_${key} has no achievement_source.${key} setting`);
  }
});

// The Sources rows are localized positionally (`li:nth-child(N)`), so inserting a row anywhere but
// the end silently relabels its neighbours. Pin each position to the source it is meant to describe.
test('positional locale bindings still point at the row they describe', () => {
  const start = loaderJs.indexOf("selector = $('#options-source');");
  assert.ok(start > 0, 'loader.js must localize the source list');
  const end = loaderJs.indexOf('selector = $(', start + 1);
  const region = loaderJs.slice(start, end > start ? end : undefined);

  const rows = sourceListItems();
  let checked = 0;
  for (const line of region.split('\n')) {
    const position = line.match(/li:nth-child\((\d+)\)/);
    const source = line.match(/template\.settings\.source\.(\w+)/);
    if (!position || !source) continue;
    const row = rows[Number(position[1]) - 1];
    assert.ok(row, `loader.js localizes row ${position[1]}, which does not exist`);
    assert.strictEqual(row.key, source[1], `row ${position[1]} is #option_${row.key}, localized as "${source[1]}"`);
    checked += 1;
  }
  assert.ok(checked >= 9, `expected the positional bindings to be covered, only saw ${checked}`);
});

// Rows added after the positional block are bound by id instead; each needs its help element and a
// description in every bundled locale, or it renders as an unexplained blank switch.
test('id-bound source rows have a help element and a description in every locale', () => {
  const idBound = [...loaderJs.matchAll(/#source-help-\$\{key\}[\s\S]*?/g)];
  assert.ok(idBound.length > 0, 'loader.js must bind the newer source rows by id');
  const keys = (loaderJs.match(/for \(const key of \[([^\]]+)\]\)/) || [])[1];
  assert.ok(keys, 'loader.js must list the id-bound source keys');
  const list = keys.split(',').map((k) => k.trim().replace(/^'|'$/g, '')).filter(Boolean);
  assert.deepStrictEqual(list, ['ubisoftOfficial', 'gogOfficial', 'epicOfficial', 'gog', 'epic', 'shadps4', 'xenia']);

  const rows = new Map(sourceListItems().map((item) => [item.key, item.html]));
  for (const key of list) {
    assert.ok(rows.has(key), `#option_${key} row is missing`);
    assert.ok(rows.get(key).includes(`id="source-help-${key}"`), `#option_${key} has no #source-help-${key} element`);
  }

  for (const file of fs.readdirSync(localeDir).filter((f) => f.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    for (const key of list) {
      const description = locale.settings.source[key] && locale.settings.source[key].description;
      assert.ok(String(description || '').trim(), `${file}: settings.source.${key}.description must be translated`);
    }
  }
});

// settings.js reads the tab back with `$('#options-source .right').children('select')`, so a row
// whose select is not a direct child of .right would be silently dropped on save.
test('every source select is a direct child of its .right container', () => {
  for (const { key, html } of sourceListItems()) {
    const right = html.slice(html.indexOf('<div class="right">'));
    const beforeSelect = right.slice(0, right.indexOf(`id="option_${key}"`));
    const openDivs = (beforeSelect.match(/<div/g) || []).length;
    const closeDivs = (beforeSelect.match(/<\/div>/g) || []).length;
    assert.strictEqual(openDivs - closeDivs, 1, `#option_${key} must sit directly inside .right, not in a nested div`);
  }
});
