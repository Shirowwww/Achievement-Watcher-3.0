'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const help = require('../../app/ui/help.js');

const xbox = {
  hotkey: 'Ctrl+Shift+K',
  toggle: 'Back + Start + LB',
  ui: 'LB + X',
  move: 'LB + RB',
  a: 'A',
  b: 'B',
  x: 'X',
  y: 'Y',
};

test('the Game health help panel is part of the render contract', () => {
  assert.equal(help.HELP_LISTS['help-gamehealth-list'], 'gameHealth');
  // Folded into the Steam emulator topic rather than kept as a card of its own.
  assert.equal(help.HELP_LISTS['help-config-list'], undefined);
});

test('help search is case, whitespace and accent insensitive', () => {
  assert.deepEqual(help.parseSearchTerms('  Steam   ÉMULATEUR  '), ['steam', 'emulateur']);
  assert.equal(help.matchesHelpQuery('Réparer un émulateur Steam', 'emulateur steam'), true);
  assert.equal(help.matchesHelpQuery('Notifications et overlay', 'notification manette'), false);
  assert.equal(help.matchesHelpQuery('Any topic', ''), true);
});

test('the dynamic help module is wired into the real Settings page', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'ui', 'help.js'), 'utf8');
  assert.match(source, /\$\('#' \+ id\)/, 'lists must be addressed by their real DOM id');
  assert.match(source, /window\.AchievementHelp = helpApi/, 'the renderer entry point must be exposed');

  const settingsUi = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'ui', 'settings.js'), 'utf8');
  assert.match(settingsUi, /window\.AchievementHelp\.render\(\$\)/, 'settings must re-render the help preview');
});

test('controller help follows the selected button layout', () => {
  const playstation = {
    ...xbox,
    toggle: 'Share + Options + L1',
    ui: 'L1 + Square',
    move: 'L1 + R1',
    a: 'Cross',
    b: 'Circle',
    x: 'Square',
    y: 'Triangle',
  };

  assert.equal(
    help.formatHelpText('Enable Settings > Controller first, then Back + Start opens the in-game overlay.', playstation, 'controller'),
    'Enable Settings > Controller first, then Share + Options + L1 opens the in-game overlay.'
  );
  assert.equal(
    help.formatHelpText('LB + X toggles in-overlay navigation.', playstation, 'controller'),
    'L1 + Square toggles in-overlay navigation.'
  );
  assert.equal(
    help.formatHelpText('Hold LB + RB to move the overlay with the left stick and scroll with the right stick.', playstation, 'controller'),
    'Hold L1 + R1 to move the overlay with the left stick and scroll with the right stick.'
  );
  assert.equal(
    help.formatHelpText('Navigation mode: D-pad/left stick move the focus, A confirms, B cancels, X searches, Y opens the options.', playstation, 'controller'),
    'Navigation mode: D-pad/left stick move the focus, Cross confirms, Circle cancels, Square searches, Triangle opens the options.'
  );
});

test('the French controller wording is adapted too', () => {
  assert.equal(
    help.formatHelpText(
      'Active d’abord Paramètres > Manette, puis Select + Start ouvre l’overlay en jeu.',
      { ...xbox, toggle: 'Options + Partage + L1' },
      'controller'
    ),
    'Active d’abord Paramètres > Manette, puis Options + Partage + L1 ouvre l’overlay en jeu.'
  );
  assert.equal(
    help.formatHelpText(
      'Mode navigation : croix/stick gauche déplacent le focus, A valide, B annule, X recherche, Y ouvre les options.',
      { ...xbox, a: 'Croix', b: 'Rond', x: 'Carré', y: 'Triangle' },
      'controller'
    ),
    'Mode navigation : croix/stick gauche déplacent le focus, Croix valide, Rond annule, Carré recherche, Triangle ouvre les options.'
  );
});

test('the overlay and shortcut text show the real hotkey instead of the default', () => {
  const values = { ...xbox, hotkey: 'Ctrl+Alt+O', toggle: 'Guide' };
  assert.equal(
    help.formatHelpText('Open it with the overlay hotkey (Ctrl+Shift+K by default) or Back + Start on a controller.', values, 'overlay'),
    'Open it with the overlay hotkey (Ctrl+Alt+O) or Guide on a controller.'
  );
  assert.equal(
    help.formatHelpText('Ctrl+Shift+K (default): toggle the in-game overlay — configurable in Settings > General.', values, 'shortcuts'),
    'Ctrl+Alt+O: toggle the in-game overlay — configurable in Settings > General.'
  );
  assert.equal(
    help.formatHelpText('Öffne es mit dem Overlay-Hotkey (standardmäßig Ctrl+Shift+K) oder Guide.', values, 'overlay'),
    'Öffne es mit dem Overlay-Hotkey (Ctrl+Alt+O) oder Guide.'
  );
});
