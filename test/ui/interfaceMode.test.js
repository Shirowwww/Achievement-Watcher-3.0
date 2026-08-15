'use strict';

/*
  How Simple / Advanced is wired into the real UI: the onboarding choice, the Settings switch, what
  each mode hides, and the two properties that must never break —

    * nothing is REMOVED from the DOM, only classed, because the settings panel is translated
      positionally (locale/loader.js binds `li:nth-child(n)`);
    * no capability is deleted, disabled or reset by the display mode.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');
const appDir = path.join(root, 'app');
const htmlParser = require(path.join(appDir, 'node_modules', 'node-html-parser'));
const html = fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8');
const document = htmlParser.parse(html);
const interfaceMode = require(path.join(appDir, 'util', 'interfaceMode.js'));
const settingsSearch = require(path.join(appDir, 'util', 'settingsSearch.js'));
const settingsUi = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');
const onboardingUi = fs.readFileSync(path.join(appDir, 'ui', 'onboarding.js'), 'utf8');
const appSource = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
const settingsSource = fs.readFileSync(path.join(appDir, 'settings.js'), 'utf8');
const english = JSON.parse(fs.readFileSync(path.join(appDir, 'locale', 'lang', 'english.json'), 'utf8'));

/* ---- Onboarding: an explicit, unprompted choice ------------------------------------------- */

test('onboarding asks for the mode with two cards and no preselected answer', () => {
  const choice = document.querySelector('.onboarding-mode-choice');
  assert.ok(choice, 'the guide must ask');
  const cards = choice.querySelectorAll('.onboarding-mode-card');
  assert.deepEqual(cards.map((card) => card.getAttribute('data-mode')), ['simple', 'advanced']);
  for (const card of cards) {
    assert.equal(card.getAttribute('aria-checked'), 'false', 'neither card starts selected');
    assert.ok(!/\bis-selected\b/.test(card.getAttribute('class') || ''), 'neither card starts highlighted');
  }
  assert.doesNotMatch(html.slice(html.indexOf('onboarding-mode-choice')), /^[\s\S]{0,1600}?recommended/i, 'neither mode is labelled recommended');
});

test('a first run cannot leave the mode step unanswered, and reopening does not re-ask blindly', () => {
  assert.match(onboardingUi, /chosenInterfaceMode = isFirstRunSession \? '' :/, 'a first run starts with no answer');
  assert.match(onboardingUi, /step === modeStep && nextStep > modeStep && !chosenInterfaceMode/, 'moving on needs an answer');
  assert.match(onboardingUi, /setStatus\(text\(\)\.modeRequired, 'error'\)/, 'and says so');
  // Going backwards must stay possible, otherwise the guide traps the user on this step.
  assert.match(onboardingUi, /nextStep > modeStep/, 'only forward is gated');
  assert.match(onboardingUi, /app\.config\.general\.interfaceMode = chosenInterfaceMode/, 'the answer is persisted');
});

test('the mode step is located by its markup, not by a hard-coded index', () => {
  assert.match(onboardingUi, /function interfaceModeStep\(\)/);
  assert.match(onboardingUi, /\.onboarding-mode-choice'\)\.closest\('\.onboarding-step'\)/);
});

test('the guide still counts its steps correctly after gaining one', () => {
  const steps = document.querySelectorAll('#onboarding .onboarding-step');
  const buttons = document.querySelectorAll('#onboarding .onboarding-steps button');
  assert.equal(steps.length, buttons.length, 'one nav button per step');
  assert.match(onboardingUi, new RegExp(`const STEP_COUNT = ${steps.length};`), 'STEP_COUNT must match the markup');
  assert.deepEqual(
    steps.map((step) => step.getAttribute('data-step')),
    steps.map((_, index) => String(index)),
    'steps stay contiguous from 0'
  );
  assert.equal(english.onboarding.steps.length, steps.length, 'every step needs a localized label');
});

/* ---- Settings: switching later, without losing anything ------------------------------------ */

test('the mode switch sits in the settings header, beside the title and outside every tab', () => {
  const header = document.querySelector('#settings .box .header');
  const control = header.querySelector('#settings-mode');
  assert.ok(control, 'the switch belongs to the header — it decides which tabs exist');
  assert.equal(document.querySelectorAll('#settings-mode').length, 1, 'exactly one switch');
  // Right of the title, left of the search: the header's own order is what puts it there.
  const headerHtml = header.outerHTML;
  assert.ok(headerHtml.indexOf('<span></span>') < headerHtml.indexOf('id="settings-mode"'), 'the switch follows the title');
  assert.ok(headerHtml.indexOf('id="settings-mode"') < headerHtml.indexOf('id="settings-search"'), 'the search stays last');
  const buttons = control.querySelectorAll('.settings-mode-switch button');
  assert.deepEqual(buttons.map((b) => b.getAttribute('data-mode')), ['simple', 'advanced']);
  assert.equal(control.getAttribute('role'), 'radiogroup');
});

test('nothing the switch adds to the header can break the positional title binding', () => {
  // locale/loader.js binds the panel title with `#settings .box .header span`, so the header must
  // contain exactly one <span> — the title itself. The switch labels itself with <b> for this.
  const header = document.querySelector('#settings .box .header');
  const spans = header.querySelectorAll('span');
  assert.equal(spans.length, 1, 'the header must keep exactly one <span>: the title');
  assert.equal(spans[0].text.trim(), '', 'and it must be the empty one the loader fills');
  assert.ok(document.querySelector('#settings-mode b#settings-mode-simple'), 'the switch labels use <b>');
});

test('each side of the switch explains itself, since the header has no room for a caption', () => {
  const applier = settingsUi.slice(settingsUi.indexOf('function applyInterfaceMode()'));
  const body = applier.slice(0, applier.indexOf('\n}\n'));
  assert.match(body, /interface-mode-hint-simple/);
  assert.match(body, /interface-mode-hint-advanced/);
  assert.match(body, /\.attr\('title', hints\[own\] \|\| ''\)/, 'the hint is a tooltip on the button');
});

test('switching applies immediately and is written to disk, not left for the Save button', () => {
  assert.match(settingsUi, /function setInterfaceMode\(mode\)/);
  const setter = settingsUi.slice(settingsUi.indexOf('function setInterfaceMode(mode)'));
  const body = setter.slice(0, setter.indexOf('\n}'));
  assert.match(body, /app\.config\.general\.interfaceMode = normalized/);
  assert.match(body, /applyInterfaceMode\(\)/);
  assert.match(body, /settings\.save\(app\.config\)/, 'the choice must survive a restart');
  assert.match(settingsUi, /\$\('#settings-mode \.settings-mode-switch button'\)\.on\('click'/, 'the switch is wired');
  assert.match(settingsUi, /applyInterfaceMode\(\);\n\s*\$\('#game-config'\)\.hide\(\)/, 'the mode is applied when Settings opens');
});

test('finishing the guide pushes the chosen mode onto the already-built Settings panel', () => {
  assert.match(onboardingUi, /window\.applyInterfaceMode === 'function'\) window\.applyInterfaceMode\(\)/);
  assert.match(settingsUi, /window\.applyInterfaceMode = applyInterfaceMode;/);
});

test('Simple hides tabs and rows with a class and never detaches them', () => {
  const applier = settingsUi.slice(settingsUi.indexOf('function applyInterfaceMode()'));
  const body = applier.slice(0, applier.indexOf('\n}\n'));
  assert.match(body, /toggleClass\(hidden, simple\)/, 'hiding is a class toggle');
  for (const forbidden of [/\.remove\(\)/, /\.detach\(\)/, /\.empty\(\)/, /\.appendTo\(/]) {
    assert.doesNotMatch(body, forbidden, 'positional i18n breaks if the DOM order changes');
  }
  // No setting may be written, cleared or defaulted as a side effect of changing what is displayed.
  assert.doesNotMatch(body, /app\.config\.\w+\.\w+ =/, 'switching the display must not rewrite settings');
});

test('switching away from a tab that just disappeared lands somewhere visible', () => {
  const applier = settingsUi.slice(settingsUi.indexOf('function applyInterfaceMode()'));
  assert.match(applier.slice(0, applier.indexOf('\n}\n')), /active\.hasClass\(hidden\)[\s\S]*?\.first\(\)\.trigger\('click'\)/);
});

test('every tab the policy names actually exists in the panel', () => {
  for (const view of [...interfaceMode.SIMPLE_VIEWS, ...interfaceMode.ADVANCED_VIEWS]) {
    assert.ok(document.querySelector(`#settingNav li[data-view="${view}"]`), `${view} needs a nav entry`);
    assert.ok(document.querySelector(`#settings .box section.content[data-view="${view}"]`), `${view} needs a panel`);
  }
  // Nothing may be left un-classified: a new tab has to be put in one list or the other.
  const declared = new Set([...interfaceMode.SIMPLE_VIEWS, ...interfaceMode.ADVANCED_VIEWS]);
  for (const li of document.querySelectorAll('#settingNav li[data-view]')) {
    assert.ok(declared.has(li.getAttribute('data-view')), `${li.getAttribute('data-view')} is not assigned to a mode`);
  }
});

test('the technical features named for Advanced all live behind an Advanced-only tab', () => {
  // GBE runtime, Steamless, API-check bypass, diagnostics and the bulk repairs.
  for (const id of ['option_steamlessAutoUnpack', 'option_steamlessExperimental', 'option_apiCheckBypass', 'option_autoApplyCrackFix']) {
    const view = document.querySelector(`#${id}`).closest('section.content').getAttribute('data-view');
    assert.ok(interfaceMode.ADVANCED_VIEWS.includes(view), `${id} sits in ${view}, which Simple still shows`);
  }
  for (const id of ['scan-gbe', 'diag-versions', 'open-logs', 'fix-all-games', 'blacklist-manager']) {
    const view = document.querySelector(`#${id}`).closest('section.content').getAttribute('data-view');
    assert.ok(interfaceMode.ADVANCED_VIEWS.includes(view), `${id} sits in ${view}, which Simple still shows`);
  }
});

test('the everyday actions Simple must keep are reachable from a Simple tab', () => {
  for (const id of ['btn-onboarding-open', 'addCustomDir', 'addLibraryDir', 'smartFind', 'option_theme', 'option_notifMode']) {
    const el = document.querySelector(`#${id}`);
    assert.ok(el, `#${id} must exist`);
    const view = el.closest('section.content').getAttribute('data-view');
    assert.ok(interfaceMode.SIMPLE_VIEWS.includes(view), `#${id} is stranded in the ${view} tab`);
    assert.ok(!el.closest('[data-advanced]'), `#${id} must not be marked advanced-only`);
  }
  // Checking for updates lives in the always-visible settings footer, not in a gated tab.
  assert.ok(document.querySelector('#settings .box .footer #footer-check-updates'), 'the footer update check is mode-independent');
});

test('the settings footer keeps only this app, and the upstream lineage moved to Advanced', () => {
  const notice = document.querySelector('#settings .box .footer .notice');
  assert.equal(notice.querySelectorAll('p').length, 1, 'the footer is one line about this app');
  assert.ok(notice.querySelector('.notice-brand'), 'the product name stays');
  // The divider after the brand is drawn, not typed: a character element here would shift the span
  // indices the loader uses for the version label and the version number.
  const css = fs.readFileSync(path.join(appDir, 'resources', 'css', 'app.css'), 'utf8');
  const brandRule = css.slice(css.indexOf('#settings .box .notice .notice-brand {'));
  assert.match(brandRule.slice(0, brandRule.indexOf('}')), /border-right:/, 'the brand is separated by a rule, not a glyph');
  for (const upstream of ['darktakayanagi', 'xan105']) {
    assert.ok(!notice.outerHTML.includes(upstream), `${upstream} must no longer be in the footer`);
  }
  const lineage = document.querySelector('#advanced-lineage');
  assert.ok(lineage, 'the credits must not simply disappear');
  assert.equal(lineage.closest('section.content').getAttribute('data-view'), 'advanced', 'they belong with the technical credits');
  for (const upstream of ['darktakayanagi/Achievement-Watcher', 'xan105/Achievement-Watcher']) {
    assert.ok(lineage.outerHTML.includes(upstream), `${upstream} must still be credited`);
  }
  // Both labels are now bound by id, so no positional selector survives their move.
  const loader = fs.readFileSync(path.join(appDir, 'locale', 'loader.js'), 'utf8');
  assert.match(loader, /#lineage-fork-label'\)\.text\(clear\(template\.settings\.common\.fork/);
  assert.match(loader, /#lineage-original-label'\)\.text\(clear\(template\.settings\.common\.original/);
  assert.doesNotMatch(loader, /footer \.notice p:nth-child\(2\)/, 'the old positional binding must be gone');
});

test('Help is not gated: reading about a feature must not require turning the feature on', () => {
  const panels = document.querySelectorAll('#settings .content[data-view="help"] .help-panel');
  assert.ok(panels.length >= 9, 'the Help tab must carry its full set of topics');
  for (const panel of panels) {
    assert.ok(
      !panel.hasAttribute(interfaceMode.ADVANCED_ATTRIBUTE),
      `${panel.querySelector('summary').text.trim()} must stay readable in Simple`
    );
  }
  // The search still has to cope with a gated topic, in case one is ever added.
  const helpSource = fs.readFileSync(path.join(appDir, 'ui', 'help.js'), 'utf8');
  assert.match(helpSource, /\.find\('\.help-panel'\)\.not\('\.mode-hidden'\)/, 'the help search must skip hidden topics');
});

test('Simple keeps the controller tab and hides only its implementation rows', () => {
  assert.ok(interfaceMode.SIMPLE_VIEWS.includes('controller'), 'enabling a gamepad is an everyday choice');
  const gated = (id) => !!document.querySelector(`#${id}`).closest(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`);
  for (const id of ['option_controllerEnabled', 'option_controllerAppNavigation', 'option_controllerLayout', 'option_controllerToggle1']) {
    assert.equal(gated(id), false, `#${id} is what a controller user actually sets`);
  }
  for (const id of ['option_controllerBackend', 'option_controllerFocusOverlay', 'option_controllerSendEscape']) {
    assert.equal(gated(id), true, `#${id} is about how the integration works, not what it does`);
  }
});

test('a settings card whose every row is Advanced is gated as a card, header included', () => {
  // Marking only the row left the card title standing over an empty list in Simple.
  for (const [listId, label] of [['options-notify-transport', 'Transport']]) {
    const card = document.querySelector(`#${listId}`).closest('.arrow-list');
    assert.ok(card.hasAttribute(interfaceMode.ADVANCED_ATTRIBUTE), `the ${label} card must be gated, not just its rows`);
  }
  // Conversely, no gated card may still contain a row a Simple user needs.
  for (const card of document.querySelectorAll(`#settings [${interfaceMode.ADVANCED_ATTRIBUTE}]`)) {
    assert.ok(!card.querySelector(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`), 'nested gating is redundant and hides intent');
  }
});

test('settings labels name the outcome, not the API behind it', () => {
  const option = english.settings.notification.option;
  assert.doesNotMatch(option.rumble.name, /XInput/i, 'a player does not know what XInput is');
  assert.equal(option.notifyOnProgress.name, 'Progress notifications', 'it is a notification, not a report');
});

test('the sources a player recognises are never folded away, in either mode', () => {
  const optional = new Set(Object.keys(interfaceMode.OPTIONAL_SOURCES).map((key) => `option_${key}`));
  for (const id of ['option_legitSteam', 'option_steamEmu', 'option_ubisoftOfficial', 'option_gogOfficial', 'option_epicOfficial', 'option_ea', 'option_xboxPc', 'option_rpcs3', 'option_shadps4', 'option_xenia']) {
    assert.ok(document.querySelector(`#${id}`), `#${id} must exist`);
    assert.ok(!optional.has(id), `#${id} is a launcher or console someone knows by name`);
    assert.ok(!document.querySelector(`#${id}`).closest(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`), `#${id} must not be statically gated`);
  }
});

test('a niche source is decided per row, not by a static marker in the markup', () => {
  // Their visibility depends on live state, so the blanket `data-advanced` rule must not own them.
  for (const key of Object.keys(interfaceMode.OPTIONAL_SOURCES)) {
    const row = document.querySelector(`#option_${key}`);
    assert.ok(row, `#option_${key} must exist`);
    assert.ok(!row.closest(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`), `#option_${key} must be decided at runtime, not marked`);
    assert.equal(row.closest('section.content').getAttribute('data-view'), 'source', 'it belongs to the Sources tab');
  }
  const applier = settingsUi.slice(settingsUi.indexOf('function applySourceVisibility(mode)'));
  const body = applier.slice(0, applier.indexOf('\n}\n'));
  assert.match(body, /interfaceMode\.hiddenOptionalSources\(\{ mode, enabled, librarySources \}\)/);
  // The saved config, not the <select>: this runs before the form is populated when Settings opens.
  assert.match(body, /app\.config\.achievement_source/);
  assert.match(body, /gameList\.map\(\(game\) => game && game\.source\)/);
  assert.match(settingsUi, /applySourceVisibility\(mode\);/, 'the rule must actually run');
});

test('Simple never hides a source that is switched off or that the library uses', () => {
  const every = Object.keys(interfaceMode.OPTIONAL_SOURCES);
  // Advanced hides nothing at all.
  assert.deepEqual(interfaceMode.hiddenOptionalSources({ mode: 'advanced' }), []);
  // Untouched defaults with nothing to show for them: Simple folds all of them away.
  assert.deepEqual(interfaceMode.hiddenOptionalSources({ mode: 'simple' }).sort(), [...every].sort());

  // Switched off: the row is the ONLY control that could bring those games back, so it stays.
  for (const key of every) {
    const hidden = interfaceMode.hiddenOptionalSources({ mode: 'simple', enabled: { [key]: false } });
    assert.ok(!hidden.includes(key), `${key} is off — hiding its switch would strand the user`);
  }

  // Already contributing games: if you use it, you get its switch.
  for (const [key, names] of Object.entries(interfaceMode.OPTIONAL_SOURCES)) {
    for (const name of names) {
      const hidden = interfaceMode.hiddenOptionalSources({ mode: 'simple', librarySources: ['GBE Fork', name] });
      assert.ok(!hidden.includes(key), `${key} produced a game (${name}) and must keep its switch`);
      // Matching is on the value the parser stamps, whatever case it arrives in.
      const upper = interfaceMode.hiddenOptionalSources({ mode: 'simple', librarySources: [name.toUpperCase()] });
      assert.ok(!upper.includes(key), `${key} must match its source value case-insensitively`);
    }
  }

  // An unrelated library never resurrects a row, and junk never throws.
  assert.deepEqual(interfaceMode.hiddenOptionalSources({ mode: 'simple', librarySources: ['Steam (Shirow)', null, 42] }).sort(), [...every].sort());
  assert.deepEqual(interfaceMode.hiddenOptionalSources({ mode: 'simple', librarySources: 'not an array' }).sort(), [...every].sort());
  assert.deepEqual(interfaceMode.hiddenOptionalSources(), []);
});

test('every niche source names the value its parser actually stamps on a game', () => {
  // The rule is only as good as this mapping: a stale source string silently stops resurrecting the
  // row for someone who uses that emulator.
  const parserDir = path.join(appDir, 'parser');
  const stamped = new Set();
  for (const file of fs.readdirSync(parserDir).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(parserDir, file), 'utf8');
    for (const match of source.matchAll(/\bsource:\s*'([^']+)'/g)) stamped.add(match[1]);
    // greenluma.js stamps the per-variant display name from its own table.
    for (const match of source.matchAll(/\bname:\s*'(GreenLuma[^']*)'/g)) stamped.add(match[1]);
  }
  for (const [key, names] of Object.entries(interfaceMode.OPTIONAL_SOURCES)) {
    for (const name of names) {
      assert.ok(stamped.has(name), `${key}: no parser stamps source '${name}' any more`);
    }
  }
});

test('Simple keeps folder management but not the raw built-in scan paths', () => {
  const folder = document.querySelector('#settings .content[data-view="folder"]');
  assert.ok(folder.querySelector('#defaultdir').closest(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`), 'the %APPDATA% list is Advanced');
  for (const id of ['addCustomDir', 'addLibraryDir', 'smartFind', 'wrap-dirlist', 'libdirlist']) {
    assert.ok(!document.querySelector(`#${id}`).closest(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`), `#${id} is how a user adds their own games`);
  }
  // The "select the folder holding ALI213.ini / valve.ini / …" detail is its own paragraph now.
  assert.ok(!document.querySelector('#folder-add-info').closest(`[${interfaceMode.ADVANCED_ATTRIBUTE}]`), 'the plain sentence stays');
  assert.ok(document.querySelector('#folder-add-info-detail').hasAttribute(interfaceMode.ADVANCED_ATTRIBUTE), 'the .ini list does not');
  const loader = fs.readFileSync(path.join(appDir, 'locale', 'loader.js'), 'utf8');
  assert.match(loader, /#folder-add-info'\)\.text\(clear\(addInfo\[0\]\)\)/, 'line one goes to the plain paragraph');
  assert.match(loader, /#folder-add-info-detail'\)\.html\(clear\(addInfo\.slice\(1\)/, 'the rest goes to the gated one');
});

test('advanced-only rows inside kept tabs are marked, and only ever inside kept tabs', () => {
  const marked = document.querySelectorAll(`#settings [${interfaceMode.ADVANCED_ATTRIBUTE}]`);
  assert.ok(marked.length > 0, 'the row-level gate must actually be used');
  for (const row of marked) {
    const view = row.closest('section.content').getAttribute('data-view');
    assert.ok(
      interfaceMode.SIMPLE_VIEWS.includes(view),
      `marking a row in ${view} is redundant — Simple already hides the whole tab`
    );
  }
});

/* ---- Search must not fight the mode -------------------------------------------------------- */

test('the search treats mode-hidden rows as absent and never clears their class', () => {
  assert.equal(settingsSearch.MODE_HIDDEN_CLASS, interfaceMode.HIDDEN_CLASS, 'one class, two modules');
  const filter = settingsSearch.filterSections.toString();
  assert.match(filter, /MODE_HIDDEN_CLASS/, 'hidden rows must not be counted');
  assert.match(filter, /removeClass\('search-hidden'\)/);
  assert.doesNotMatch(filter, /removeClass\(`?\$?\{?MODE_HIDDEN_CLASS/, 'the search owns search-hidden and nothing else');
});

/* ---- Config: persistence and a deliberate migration ---------------------------------------- */

test('an existing profile keeps everything on upgrade instead of being dropped into Simple', () => {
  const block = settingsSource.slice(settingsSource.indexOf("options.general.interfaceMode !== 'simple'"));
  const decision = block.slice(0, block.indexOf('\n    }'));
  assert.match(decision, /onboardingCompleted === true \? 'advanced' : ''/);
  // A brand-new profile has no answer yet, so onboarding is the one that asks.
  assert.match(settingsSource, /interfaceMode: '',/, 'a fresh config starts unanswered');
});

/* ---- Game Health: same report, plainer words -------------------------------------------- */

test('Simple rewords the Game Health checks instead of computing a different report', () => {
  const health = fs.readFileSync(path.join(appDir, 'util', 'gameHealth.js'), 'utf8');
  assert.doesNotMatch(health, /interfaceMode|simple/i, 'the derivation must not know about display modes');
  const paint = appSource.slice(appSource.indexOf('function paintGameHealth'));
  const body = paint.slice(0, paint.indexOf('\n}\n'));
  assert.match(body, /gameHealthInterfaceMode\.isCheckVisible\(entry\.id, mode\)/, 'Simple filters the display only');
  assert.match(body, /gameHealthCheckValue\(entry, simple\)/);
  assert.match(body, /gameHealthCheckLabel\(entry\.id, simple\)/);
  // The state, the explanation and the repair buttons are identical in both modes.
  assert.doesNotMatch(body, /simple[\s\S]{0,120}gh-actions/, 'Simple must not withhold a repair');
  assert.match(appSource, /root\.find\('\.gh-explanation'\)\.text\(gameHealthExplanation\(report\)\)/);
});

test('Simple states outcomes, and every exact value stays in Technical details', () => {
  const values = appSource.slice(appSource.indexOf('function gameHealthSimpleCheckValue'));
  const body = values.slice(0, values.indexOf('\n}\n'));
  for (const phrase of ['Achievement data found', 'Achievement progress found', 'Tracking active', 'Game saves detected', 'Notifications working']) {
    assert.ok(body.includes(phrase), `Simple should say "${phrase}"`);
  }
  // None of the low-level vocabulary may be interpolated into a Simple row.
  for (const leak of ['p.path', 'p.binary', 'p.transport', 'p.appid', 'p.emulator', 'p.source']) {
    assert.ok(!body.includes(leak), `${leak} is a technical value and must not surface in Simple`);
  }
  // Technical details is not gated: it is the disclosure that keeps the exact values reachable.
  const technical = document.querySelector('#game-health .gh-technical');
  assert.ok(technical && !technical.hasAttribute(interfaceMode.ADVANCED_ATTRIBUTE), 'Technical details shows in both modes');
  assert.match(appSource, /root\.find\('\.gh-technical-dump'\)\.text\(JSON\.stringify\(report\.technical/);
});

test('Simple hides the emulator context submenu without weakening the safe repairs', () => {
  assert.match(appSource, /if \(emulatorMenu\.items\.length && !interfaceIsSimple\(\)\)/, 'the GBE/Steamless menu is Advanced');
  // The per-game repairs Game Health offers are unconditional, in both modes.
  const runner = appSource.slice(appSource.indexOf('async function runGameHealthAction'));
  for (const action of ['REPAIR_DATA', 'INSTALL_RUNTIME', 'START_TRACKING', 'CHOOSE_EXE']) {
    assert.ok(runner.includes(`gameHealth.ACTION.${action}`), `${action} must stay available`);
  }
  assert.doesNotMatch(runner, /interfaceIsSimple\(\)/, 'no repair is withheld by the display mode');
});

/* ---- Localization -------------------------------------------------------------------------- */

test('the mode is fully translated in every bundled locale', () => {
  const localeDir = path.join(appDir, 'locale', 'lang');
  const onboardingKeys = ['modeTitle', 'modeCopy', 'modeSimple', 'modeSimpleCopy', 'modeAdvanced', 'modeAdvancedCopy', 'modeHint', 'modeRequired'];
  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    for (const key of onboardingKeys) {
      assert.ok(String(locale.onboarding[key] || '').trim(), `${file}: onboarding.${key} must be translated`);
    }
    for (const key of ['title', 'simple', 'advanced']) {
      assert.ok(String(locale.settings.interfaceMode[key] || '').trim(), `${file}: settings.interfaceMode.${key} must be translated`);
    }
    assert.equal(locale.onboarding.steps.length, english.onboarding.steps.length, `${file}: the step labels must cover every step`);
  }
});

test('the nav switch is labelled through the locale layer, by id', () => {
  const loader = fs.readFileSync(path.join(appDir, 'locale', 'loader.js'), 'utf8');
  for (const id of ['settings-mode-label', 'settings-mode-simple', 'settings-mode-advanced']) {
    assert.ok(document.querySelector(`#${id}`), `#${id} must exist`);
    assert.match(loader, new RegExp(`#${id}'\\)\\.text\\(clear\\(template\\.settings\\.interfaceMode`), `#${id} must be bound`);
  }
});
