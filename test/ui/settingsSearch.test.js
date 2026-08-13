'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const htmlParser = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'node-html-parser'));

/*
  The settings panel is translated POSITIONALLY: locale/loader.js binds most labels with
  `li:nth-child(n)` inside a list, and the two elements the search feature adds sit right next to
  bindings that use a bare `span` selector. Both make ordinary-looking markup edits able to silently
  break the UI in every language, so the contract is pinned here instead of being rediscovered.
*/

const appDir = path.join(__dirname, '..', '..', 'app');
const searchRules = require(path.join(appDir, 'util', 'settingsSearch.js'));
const root = htmlParser.parse(fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8'));
const settings = root.querySelector('#settings');

// Replays the filter settings.js runs, against the real markup: which tab does a given query hit,
// and how many rows in it? Catches a selector that stops matching the panel it was written for.
function search(query) {
  const terms = searchRules.parseTerms(query);
  const perTab = {};
  for (const section of settings.querySelectorAll('.container > section.content')) {
    const view = section.getAttribute('data-view');
    let hits = 0;
    const all = section.querySelectorAll(searchRules.ROW_SELECTOR);
    for (const row of all) {
      // Only outermost matches are rows; a match inside another one is part of it (see the module).
      if (all.some((other) => other !== row && other.querySelectorAll(searchRules.ROW_SELECTOR).includes(row))) continue;
      const haystack = searchRules.buildHaystack({
        text: row.text,
        ids: row.querySelectorAll('[id]').map((el) => el.getAttribute('id')),
        placeholders: row.querySelectorAll('input[placeholder]').map((el) => el.getAttribute('placeholder')),
      });
      if (searchRules.matches(haystack, terms)) hits++;
    }
    if (hits > 0) perTab[view] = hits;
  }
  return perTab;
}

test('the settings search field exists and is wired to the panel', () => {
  assert.ok(settings, 'the settings section must exist');
  assert.ok(settings.querySelector('#settings-search-input'), 'search input');
  assert.ok(settings.querySelector('#settings-search-clear'), 'clear button');
  assert.ok(settings.querySelector('#settings-search-empty-text'), 'no-results message');

  const js = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');
  assert.match(js, /#settings-search-input/, 'settings.js must handle the search input');
  assert.match(js, /search-hidden/, 'filtering must hide rows with a class, never remove them');
  assert.doesNotMatch(js, /\$\('#settings[^']*'\)[^\n]*\.remove\(\)/, 'rows must never be removed: nth-child i18n counts them');
});

test('the header title binding still resolves to exactly one span', () => {
  // loader.js: $('#settings .box .header span').text(template.settings.title)
  const header = settings.querySelector('.box .header');
  assert.strictEqual(header.querySelectorAll('span').length, 1, 'a second span in the header would be overwritten by the title');
});

test('each nav entry keeps exactly one span for its label and a non-span counter', () => {
  // loader.js: $("#settingNav li[data-view='…'] span").text(…) — a counter <span> would be clobbered.
  const items = settings.querySelectorAll('#settingNav li[data-view]');
  assert.ok(items.length >= 7, 'the settings nav must list every tab');
  for (const item of items) {
    const view = item.getAttribute('data-view');
    assert.strictEqual(item.querySelectorAll('span').length, 1, `${view}: exactly one label span`);
    const count = item.querySelectorAll('.nav-count');
    assert.strictEqual(count.length, 1, `${view}: one match counter`);
    assert.strictEqual(count[0].rawTagName, 'b', `${view}: the counter must not be a <span>`);
  }
});

test('the settings nav uses group headers to stay readable', () => {
  const groups = settings.querySelectorAll('#settingNav li.nav-group');
  assert.ok(groups.length >= 4, `the sidebar should group its tabs, got ${groups.length}`);
  for (const group of groups) {
    assert.strictEqual(group.querySelectorAll('span, .nav-count').length, 0, 'group headers are labels, not tabs');
  }
});

test('every nav entry points at a real content section, and vice versa', () => {
  const navViews = settings.querySelectorAll('#settingNav li[data-view]').map((li) => li.getAttribute('data-view'));
  const sectionViews = settings.querySelectorAll('.container > section.content').map((s) => s.getAttribute('data-view'));
  assert.deepStrictEqual(navViews.slice().sort(), sectionViews.slice().sort(), 'a tab with no section (or a section with no tab) is unreachable');
});

test('a query finds the rows it names, in the tab that owns them', () => {
  // By option id — the language-independent handle, and the reason ids are part of the haystack.
  const byId = search('steamlessAutoUnpack');
  assert.deepStrictEqual(Object.keys(byId), ['emulator']);
  assert.strictEqual(byId.emulator, 1, 'an option id must identify exactly one row');

  // By words in the label, in any order.
  assert.ok(search('overlay preset').notification > 0, 'label words should match');
  assert.deepStrictEqual(search('preset overlay'), search('overlay preset'), 'term order must not matter');

  // A term nothing carries matches nothing, which is what drives the empty state.
  assert.deepStrictEqual(search('zzzznotasetting'), {}, 'an unmatched query must find nothing');

  // An empty query is not a filter at all — settings.js clears the search instead of hiding rows.
  assert.deepStrictEqual(searchRules.parseTerms('   '), []);
});

test('rows are found across several tabs, so the nav counters have something to point at', () => {
  const hits = search('e');
  assert.ok(Object.keys(hits).length >= 4, `a common letter should match rows in most tabs, got ${JSON.stringify(hits)}`);
});

test('the search placeholder and empty message are translated in every locale', () => {
  const langDir = path.join(appDir, 'locale', 'lang');
  for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
    assert.ok(String(locale.settings.search.placeholder || '').trim(), `${file}: settings.search.placeholder`);
    assert.ok(String(locale.settings.search.empty || '').trim(), `${file}: settings.search.empty`);
  }
});
