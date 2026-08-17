'use strict';

/*
  Where Game Health lives and how it is wired. The value of these is structural: Game Health has to
  stay inside the per-game tools panel rather than becoming a separate destination, its labels have
  to be bound by id (the panel's i18n has no positional selectors and must not grow any), and the
  two repairs that change files have to stay behind a confirmation.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '..', 'app');
const htmlParser = require(path.join(appDir, 'node_modules', 'node-html-parser'));
const document = htmlParser.parse(fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8'));
const appSource = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');

test('Game Health lives inside the per-game tools panel, not in a new destination', () => {
  const panel = document.querySelector('#game-config');
  assert.ok(panel, '#game-config must exist');
  assert.ok(panel.querySelector('#game-health'), 'the health view belongs to the per-game panel');
  assert.ok(panel.querySelector('.content[data-view="health"]'), 'health is a view of the existing panel');
  assert.ok(panel.querySelector('.content[data-view="exe-config"]'), 'the executable view is kept');
  // Nothing else in the app may host a second copy of the report.
  assert.equal(document.querySelectorAll('#game-health').length, 1);
});

test('the panel tabs are labelled by id, so the panel keeps no positional i18n', () => {
  const tabs = document.querySelectorAll('#game-config-tabs button');
  assert.equal(tabs.length, 2);
  assert.deepEqual(
    tabs.map((tab) => tab.getAttribute('data-gc-view')),
    ['health', 'exe-config'],
    'health is the first tab'
  );
  for (const id of ['game-config-tab-health', 'game-config-tab-exe']) {
    assert.ok(document.querySelector(`#${id}`), `${id} must be addressable by id`);
    assert.match(appSource, new RegExp(`\\$\\('#${id}'\\)\\.text\\(t\\(`), `${id} must be translated through t()`);
  }
});

test('the report shows a state, an explanation, checks and repair actions', () => {
  const health = document.querySelector('#game-health');
  for (const selector of ['.gh-state', '.gh-state-label', '.gh-explanation', '.gh-checks', '.gh-actions']) {
    assert.ok(health.querySelector(selector), `${selector} must exist in the report`);
  }
});

test('every low-level value stays behind the Technical details disclosure', () => {
  const technical = document.querySelector('#game-health .gh-technical');
  assert.ok(technical, 'the technical block must exist');
  assert.equal(technical.tagName, 'DETAILS', 'it must be collapsed by default, not always shown');
  assert.ok(!technical.hasAttribute('open'), 'the simple layer is what opens first');
  assert.ok(technical.querySelector('summary'), 'it must be expandable');
  assert.ok(technical.querySelector('.gh-technical-dump'), 'the raw values need somewhere to render');
  assert.ok(technical.querySelector('.gh-copy'), 'the raw values must be copyable for a bug report');
});

test('opening the per-game panel shows Health first and runs the report', () => {
  const opener = appSource.slice(appSource.indexOf('onConfigButtonClick: async function'));
  const body = opener.slice(0, opener.indexOf('\n  onGameConfigCancelClick'));
  assert.match(body, /setGameConfigView\('health'\)/, 'the panel opens on the health view');
  assert.match(body, /renderGameHealth\(appid\)/, 'the report is built for the game that was clicked');
  assert.match(body, /exeList\.get\(appid\)/, 'the executable view still loads its configuration');
});

test('the state chip stops spinning once the report is painted', () => {
  // The chip ships as a spinner in the markup; a paint that only set the label would leave it
  // spinning forever next to a finished result.
  assert.match(
    document.querySelector('#game-health .gh-state i').getAttribute('class'),
    /fa-spin/,
    'the chip starts as a spinner'
  );
  const paint = appSource.slice(appSource.indexOf('function paintGameHealth'));
  assert.match(paint.slice(0, paint.indexOf('\n}')), /chip\.find\('i'\)\.attr\('class'/, 'painting must replace the spinner icon');

  const render = appSource.slice(appSource.indexOf('async function renderGameHealth'));
  const body = render.slice(0, render.indexOf('\n}\n'));
  assert.match(body, /fa-circle-notch fa-spin/, 'reopening on another game restores the spinner');
  // The failure path has to leave a readable state too, not a spinner over an error message.
  const failure = body.slice(body.indexOf('} catch'));
  assert.match(failure, /chip\.find\('i'\)\.attr\('class'/, 'a failed report must also stop the spinner');
});

test('Save is hidden on the health view, where it would outrank the actual repair', () => {
  const setter = appSource.slice(appSource.indexOf('function setGameConfigView'));
  const body = setter.slice(0, setter.indexOf('\n}'));
  assert.match(body, /const editing = view === 'exe-config'/, 'the executable view is what enables editing');
  assert.match(body, /#btn-game-config-save'\)\.toggle\(editing\)/, 'the executable form Save must only show on the executable view');
  // Alone on the health view the remaining button dismisses a report, so it must not say "Cancel".
  assert.match(body, /#btn-game-config-cancel'\)\.text\(editing \? t\('cancel'/, 'the dismiss label follows the view');
  assert.match(body, /: t\('close'/, 'the health view closes rather than cancels');
});

test('the report is rebuilt for the game actually being shown', () => {
  const render = appSource.slice(appSource.indexOf('async function renderGameHealth'));
  assert.match(
    render.slice(0, render.indexOf('\n}')),
    /root\.attr\('data-appid'\)\) !== String\(appid\)/,
    'a slow folder walk must not paint its result over a different game'
  );
});

test('both file-changing repairs confirm before writing, and say where the backup goes', () => {
  const runner = appSource.slice(appSource.indexOf('async function runGameHealthAction'));

  for (const [action, planCall, confirmKey] of [
    ['REPAIR_DATA', 'planAchievementDataRepair', 'gh-confirm-repair-detail'],
    ['INSTALL_RUNTIME', 'planRuntimeInstall', 'gh-confirm-runtime-detail'],
  ]) {
    const start = runner.indexOf(`gameHealth.ACTION.${action}`);
    assert.ok(start > 0, `${action} must be handled`);
    const block = runner.slice(start, runner.indexOf('\n  if (action ===', start + 1) + 1 || undefined);

    const planAt = block.indexOf(planCall);
    const confirmAt = block.indexOf('showMessageBoxSync');
    const writeAt = block.search(/gameHealthRepair\.(repairAchievementData|installEmulatorRuntime)/);
    assert.ok(planAt >= 0, `${action} must build a plan`);
    assert.ok(confirmAt > planAt, `${action} must describe the change before asking`);
    assert.ok(writeAt > confirmAt, `${action} must not write before the user confirms`);
    assert.ok(block.includes(confirmKey), `${action} must show where the previous files are kept`);
    assert.match(block.slice(confirmAt), /confirmed !== 1\) return false/, `${action} must abort on cancel`);
  }
});

test('the repairs delegate to the parsers that own the backup behaviour', () => {
  // A repair that started writing files itself would bypass .aw-backups / .bak entirely.
  const repairSource = fs.readFileSync(path.join(appDir, 'util', 'gameHealthRepair.js'), 'utf8');
  assert.doesNotMatch(repairSource, /\bfs\.(writeFileSync|copyFileSync|rmSync|unlinkSync)\b/, 'the repair module must not write files directly');
  assert.match(repairSource, /goldberg\.repair\(/, 'the schema repair goes through goldberg.repair');
  assert.match(repairSource, /gbeInstaller\.installDlls\(/, 'the runtime install goes through installDlls');
});

test('a repair that changed something refreshes the report', () => {
  assert.match(
    appSource,
    /if \(await runGameHealthAction\(appid, action, button\)\) await renderGameHealth\(appid\)/,
    'the user must not be left looking at the state that justified the button they pressed'
  );
});

test('the notification test reuses the shared transport-aware path', () => {
  const runner = appSource.slice(appSource.indexOf('async function runGameHealthAction'));
  assert.match(runner, /window\.testAchievementWatcherNotification\(/, 'no second notification-test implementation');
  assert.match(runner, /app\.config\?\.notification_transport\?\.mode/, 'it must exercise the configured transport');
});

test('no internal identifier is ever shown to the user as-is', () => {
  const renderer = appSource.slice(appSource.indexOf('function gameHealthEmulatorLabel'));
  const values = renderer.slice(0, renderer.indexOf('\nfunction gameHealthActionLabel'));

  // "gbe" / "goldberg" / "none" are storage ids; only the two brand names and a translated
  // sentence may reach the panel.
  assert.match(values, /gameHealthEmulatorLabel/, 'the emulator id must go through a label function');
  assert.doesNotMatch(values, /return p\.emulator \|\| ''/, 'a raw emulator id must not be rendered');
  assert.match(values, /t\('diagnosis-emulator-none'/, '"no emulator" is a sentence and must be translated');

  // toast / overlay / both are config values; the Notifications tab already translates them.
  assert.doesNotMatch(values, /return p\.transport \|\| ''/, 'a raw transport id must not be rendered');
  assert.match(values, /settings\?\.notification\?\.option\?\.mode\?\.value/, 'reuse the existing translation');
});

test('the transport labels the panel borrows exist in every bundled locale', () => {
  const localeDir = path.join(appDir, 'locale', 'lang');
  const files = fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'));
  assert.equal(files.length, 18);
  for (const file of files) {
    const value = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')).settings.notification.option.mode.value;
    for (const key of ['toast', 'overlay', 'both']) {
      assert.ok(String(value[key] || '').trim(), `${file}: settings.notification.option.mode.value.${key} must be translated`);
    }
  }
});

test('the panel tab labels survive a language change', () => {
  // locale/loader.js does not know about this panel, so a one-shot startup binding would freeze
  // the tabs in the language the app was launched in.
  assert.match(appSource, /function applyGameConfigTabLabels\(\)/);
  const opener = appSource.slice(appSource.indexOf('onConfigButtonClick: async function'));
  assert.match(opener.slice(0, opener.indexOf('\n  onGameConfigCancelClick')), /applyGameConfigTabLabels\(\)/, 're-applied on every open');
});

test('every visible string in the health panel comes from the locale layer', () => {
  const start = appSource.indexOf('// ---- Game Health');
  const block = appSource.slice(start, appSource.indexOf("(function ($, window, document) {", start));
  const offenders = [];
  for (const line of block.split('\n')) {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue; // comments
    if (!/^\s*return\s+['"]/.test(line)) continue; // only literal returns can leak text
    if (/\bt\(/.test(line)) continue; // translated
    const literal = /^\s*return\s+'([^']*)'/.exec(line) || /^\s*return\s+"([^"]*)"/.exec(line);
    if (!literal) continue;
    const text = literal[1];
    // Brand names and empty strings are not translatable content.
    if (!text || ['GBE Fork', 'Goldberg'].includes(text)) continue;
    offenders.push(text);
  }
  assert.deepEqual(offenders, [], `hard-coded user-visible text: ${offenders.join(' | ')}`);
});

test('the derivation module stays free of renderer and filesystem dependencies', () => {
  const source = fs.readFileSync(path.join(appDir, 'util', 'gameHealth.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](fs|node:fs|electron|@electron\/remote)['"]\)/, 'derivation must stay pure and testable');
  // The call form the locale layer scans for; a match would mean wording had leaked into the logic.
  assert.doesNotMatch(source, /\bt\(\s*['"]/, 'user-visible wording is resolved by the renderer, not baked into the logic');
});
