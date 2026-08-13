'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const htmlParser = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'node-html-parser'));
const { chooseDirectionalCandidate } = require('../../app/ui/controller.js');

const box = (left, top, width = 40, height = 40) => ({ left, top, width, height });

test('controller spatial navigation chooses the nearest target in each direction', () => {
  const current = box(100, 100);
  const left = box(20, 100);
  const right = box(180, 100);
  const up = box(100, 20);
  const down = box(100, 180);
  const diagonal = box(180, 180);
  const candidates = [current, left, right, up, down, diagonal];

  assert.equal(chooseDirectionalCandidate(current, candidates, -1, 0), left);
  assert.equal(chooseDirectionalCandidate(current, candidates, 1, 0), right);
  assert.equal(chooseDirectionalCandidate(current, candidates, 0, -1), up);
  assert.equal(chooseDirectionalCandidate(current, candidates, 0, 1), down);
});

test('controller spatial navigation returns undefined at an edge', () => {
  const current = box(100, 100);
  assert.equal(chooseDirectionalCandidate(current, [current, box(180, 100)], -1, 0), undefined);
});

test('the main-window controller navigation covers the new Controller settings tab and its dropdowns', () => {
  const appDir = path.join(__dirname, '..', '..', 'app');
  const root = htmlParser.parse(fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8'));
  const appHtmlSource = fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8');
  const controllerSource = fs.readFileSync(path.join(appDir, 'ui', 'controller.js'), 'utf8');

  const navTab = root.querySelector('#settingNav li[data-view="controller"]');
  assert.ok(navTab, 'the Controller tab must exist in the settings navigation');
  const section = root.querySelector('#settings .content[data-view="controller"]');
  assert.ok(section, 'the Controller settings section must exist');
  for (const id of [
    'option_controllerAppNavigation',
    'option_controllerLayout',
    'option_controllerToggle1',
    'option_controllerToggle2',
    'option_controllerToggle3',
    'option_controllerUi1',
    'option_controllerUi2',
    'option_controllerUi3',
    'option_controllerMove1',
    'option_controllerMove2',
    'option_controllerMove3',
    'option_controllerSendEscape',
  ]) {
    assert.ok(section.querySelector(`#${id}`), `missing controller setting #${id}`);
    assert.ok(section.querySelector(`#${id}[disabled]`) === null, `#${id} must stay focusable`);
  }
  assert.match(controllerSource, /select:not\(\[disabled\]\)/, 'controller.js must treat selects as focusable');
  assert.match(controllerSource, /#settingNav li/, 'controller.js must navigate the settings tabs');
  assert.match(controllerSource, /#settings \.previous/, 'controller.js must navigate arrow controls');
  assert.match(appHtmlSource, /util\/controllerLabels\.js/, 'the Controller labels module must be loaded by the app window');
});

test('the overlay controller navigation focuses achievement rows and no longer resizes the window', () => {
  const overlay = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'view', 'overlay.html'), 'utf8');
  assert.match(overlay, /'\.overlay-row'/, 'achievement rows must be focusable with the controller');
  assert.match(overlay, /overlay-row\.controller-focus/, 'focused rows must get a hover-style background');
  assert.match(overlay, /createTextNode\(' \+ '\)/, 'multi-button bindings must render a visible + separator');
  assert.doesNotMatch(overlay, /controllerModes\.window/, 'window mode must be removed from the overlay');
  assert.doesNotMatch(overlay, /resizeWindow/, 'window resizing must be removed from the overlay');
});
