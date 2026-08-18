'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'ui', 'controller.js'), 'utf8');
const docs = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'controller.md'), 'utf8');

/*
  Making the library tile the unit of pad navigation fixed directional movement, but it also put the
  play and Game Health buttons out of reach: A on a tile opens the game, and every documented
  shortcut was already taken. The triggers were the one pair of inputs the app never read, so both
  actions could be added without any existing binding changing meaning.
*/

test('the triggers are bound to the two tile controls the grid no longer selects', () => {
  assert.match(source, /LT: 6, RT: 7/, 'the triggers must be in the button map');
  assert.match(source, /repeat\('rt', pressed\(gamepad, BUTTON\.RT\), \(\) => tileAction\('\.play-button'\)\)/);
  assert.match(source, /repeat\('lt', pressed\(gamepad, BUTTON\.LT\), \(\) => tileAction\('\.config-button'\)\)/);
});

test('no previously bound button changed meaning', () => {
  // The regression this guards against is silently repurposing a documented shortcut to make room
  // for the new ones - the whole reason the triggers were chosen instead.
  assert.match(source, /repeat\('a', pressed\(gamepad, BUTTON\.A\), activate\)/);
  assert.match(source, /repeat\('b', pressed\(gamepad, BUTTON\.B\), back\)/);
  assert.match(source, /repeat\('x', pressed\(gamepad, BUTTON\.X\), focusSearch\)/);
  assert.match(source, /repeat\('y', pressed\(gamepad, BUTTON\.Y\), openSettings\)/);
  assert.match(source, /repeat\('start', pressed\(gamepad, BUTTON\.START\), openSettings\)/);
});

test('a trigger does nothing unless a library tile is selected', () => {
  const body = source.slice(source.indexOf('function tileAction'), source.indexOf('function focusSearch'));
  assert.match(body, /closest\?\.\('#game-list \.game-box'\)/, 'it must resolve the tile from the selection');
  assert.match(body, /if \(!tile\) return;/, 'outside the library the triggers must be inert');
});

test('a trigger press wakes controller mode like any other button', () => {
  // Without this the first trigger press would act while the app still believed no pad was in use,
  // so nothing would be outlined and the action would appear to come from nowhere.
  const anyInput = source.slice(source.indexOf('const anyInput ='), source.indexOf('repeat(\'up\''));
  assert.match(anyInput, /BUTTON\.LT/);
  assert.match(anyInput, /BUTTON\.RT/);
});

test('the two shortcuts are documented', () => {
  assert.match(docs, /\|\s*Launch the selected game\s*\|\s*\*\*RT\*\*/);
  assert.match(docs, /\|\s*Open Game Health for the selected game\s*\|\s*\*\*LT\*\*/);
});
