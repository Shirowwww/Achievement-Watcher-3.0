'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const htmlParser = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'node-html-parser'));

/*
  Collapsible settings sections. The whole feature rests on two assumptions about the real markup:
  every section card starts with one of three header shapes, and every section can be named by a
  stable id. Both are pinned here, against app.html, because a card added without a header would
  silently become permanently expanded and a duplicate key would make two cards share one state.
*/

const appDir = path.join(__dirname, '..', '..', 'app');
const sectionRules = require(path.join(appDir, 'util', 'settingsSections.js'));
const root = htmlParser.parse(fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8'));
const settings = root.querySelector('#settings');

const SELECTORS = sectionRules.SECTION_SELECTOR.split(', ');
const HEADERS = sectionRules.HEADER_SELECTOR.split(', ');

function isSection(el) {
  return SELECTORS.some((sel) =>
    sel.startsWith('#') ? el.getAttribute('id') === sel.slice(1) : (el.classList && el.classList.contains(sel.slice(1)))
  );
}

function headerOf(el) {
  for (const child of el.childNodes.filter((n) => n.nodeType === 1)) {
    if (HEADERS.some((sel) => child.classList.contains(sel.slice(1)))) return child;
  }
  return null;
}

// The outermost section cards of one tab - the same set sectionsIn() computes in the renderer.
function sectionsOf(section) {
  return section.querySelectorAll(sectionRules.SECTION_SELECTOR).filter((card) => {
    if (!headerOf(card)) return false;
    for (let parent = card.parentNode; parent && parent !== section; parent = parent.parentNode) {
      if (isSection(parent)) return false;
    }
    return true;
  });
}

function allSections() {
  const out = [];
  for (const view of settings.querySelectorAll('.container > section.content')) {
    sectionsOf(view).forEach((card, index) => out.push({ view: view.getAttribute('data-view'), card, index }));
  }
  return out;
}

// Mirrors sectionKey()'s priority order without a jQuery shim.
function keyOf({ card, view, index }) {
  const own = card.getAttribute('id');
  if (own) return own;
  const list = card.querySelector('ul[id]');
  if (list) return list.getAttribute('id');
  const header = headerOf(card);
  const labelled = header && header.querySelector('[id]');
  if (labelled) return labelled.getAttribute('id');
  return `${view}:${index}`;
}

test('every settings tab exposes at least one collapsible section', () => {
  const views = settings.querySelectorAll('.container > section.content').map((s) => s.getAttribute('data-view'));
  assert.ok(views.length >= 7, `expected the full tab set, saw ${views.join(', ')}`);
  for (const view of views) {
    const section = settings.querySelector(`.container > section.content[data-view="${view}"]`);
    assert.ok(sectionsOf(section).length > 0, `tab "${view}" has no collapsible section`);
  }
});

test('every section card starts with one of the three known headers', () => {
  for (const entry of allSections()) {
    const header = headerOf(entry.card);
    assert.ok(header, `a section in "${entry.view}" has no header`);
    assert.ok(
      HEADERS.some((sel) => header.classList.contains(sel.slice(1))),
      `unexpected header shape in "${entry.view}"`
    );
  }
});

test('section keys are unique, so two cards never share one open/closed state', () => {
  const seen = new Map();
  for (const entry of allSections()) {
    const key = keyOf(entry);
    assert.ok(key, `no key derived for a section in "${entry.view}"`);
    assert.ok(!seen.has(key), `duplicate section key "${key}" (${seen.get(key)} and ${entry.view})`);
    seen.set(key, entry.view);
  }
  assert.ok(seen.size >= 20, `expected the whole panel to be covered, only keyed ${seen.size} sections`);
});

test('anything collapsed by default is a section that actually exists', () => {
  // Empty since the preset designer moved to a tab of its own - but a name left here that no longer
  // matches a card would silently collapse nothing, so the list is still checked against the markup.
  const keys = allSections().map(keyOf);
  for (const key of sectionRules.DEFAULT_COLLAPSED) {
    assert.ok(keys.includes(key), `"${key}" is collapsed by default but is not a section key`);
  }
});

test('banners and nested lists are not treated as sections', () => {
  const hero = settings.querySelector('.emulator-hero');
  assert.ok(hero, 'the emulator hero banner should still exist');
  assert.equal(headerOf(hero), null, 'a hero has no header, so it must never become collapsible');

  // `.emulator-list` also carries `.arrow-list`; it must be claimed by its group, not reported twice.
  const nestedList = settings.querySelector('.emulator-group .emulator-list');
  assert.ok(nestedList, 'the emulator groups should still hold their lists');
  assert.ok(
    !allSections().some((entry) => entry.card === nestedList),
    'a list inside a section must not be reported as its own section'
  );
});

test('the collapse never depends on wrapping or reordering the panel', () => {
  const source = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');
  const wiring = source.slice(source.indexOf('function initCollapsibleSections'), source.indexOf('function toggleSection'));
  for (const forbidden of ['.wrap(', '.append(this)', '.detach(', '.remove(']) {
    assert.ok(!wiring.includes(forbidden), `section wiring must not use ${forbidden} - i18n binds labels positionally`);
  }
  assert.ok(wiring.includes("addClass('settings-section')"), 'sections must be marked with a class, not restructured');
});
