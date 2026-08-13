'use strict';

// The Settings > Notification custom-preset builder writes a real preset folder, so a generated
// preset has to satisfy the same contract createNotificationWindow expects from a bundled one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appRoot = path.join(__dirname, '..', '..', 'app');
const generator = require(path.join(appRoot, 'util', 'customPreset.js'));
const { customPresetNumbers, buildCustomPresetCss, buildCustomPresetHtml, CUSTOM_PRESET_WINDOW_MARGIN } = generator;

const FULL = { bg: '#221100', text: '#eeeeee', accent: '#00ff88', opacity: 0.6, fontSize: 22, radius: 4, iconSize: 90, width: 520 };

test('every option is clamped to the range the Settings controls offer', () => {
  const tooBig = customPresetNumbers({ opacity: 9, fontSize: 999, radius: 999, iconSize: 999, width: 9999 });
  assert.deepEqual(tooBig, { bg: '#16181d', text: '#ffffff', accent: '#4aa3ff', opacity: 1, fontSize: 28, radius: 40, iconSize: 110, width: 620 });

  const tooSmall = customPresetNumbers({ opacity: -3, fontSize: 0, radius: -10, iconSize: 1, width: 10 });
  assert.deepEqual(tooSmall, { bg: '#16181d', text: '#ffffff', accent: '#4aa3ff', opacity: 0.2, fontSize: 10, radius: 0, iconSize: 24, width: 280 });

  // No options at all is the same as the built-in defaults, so an empty payload still renders.
  assert.deepEqual(customPresetNumbers(), { bg: '#16181d', text: '#ffffff', accent: '#4aa3ff', opacity: 1, fontSize: 16, radius: 12, iconSize: 64, width: 420 });
});

test('a colour that is not a colour cannot smuggle CSS into the generated stylesheet', () => {
  const hostile = { bg: 'red; } body { display: none } .x {', accent: 'url(http://evil/x)', text: 'expression(alert(1))' };
  const values = customPresetNumbers(hostile);
  assert.equal(values.bg, '#16181d');
  assert.equal(values.accent, '#4aa3ff');
  assert.equal(values.text, '#ffffff');
  // None of the hostile payloads reach the stylesheet (`display: none` on its own would match the
  // preset's own legitimate `.progress_line[hidden]` rule, so match the injected text itself).
  const css = buildCustomPresetCss(hostile);
  for (const payload of ['body { display: none }', 'evil', 'expression(']) {
    assert.ok(!css.includes(payload), `generated CSS leaked ${payload}`);
  }
});

test('the generated stylesheet carries every option through as a :root variable', () => {
  const css = buildCustomPresetCss(FULL);
  assert.match(css, /--bg: #221100;/);
  assert.match(css, /--text: #eeeeee;/);
  assert.match(css, /--accent: #00ff88;/);
  assert.match(css, /--opacity: 0\.6;/);
  assert.match(css, /--font-size: 22px;/);
  assert.match(css, /--radius: 4px;/);
  assert.match(css, /--icon-size: 90px;/);
  assert.match(css, /--width: 520px;/);
  // The card must read the width variable rather than a baked-in literal.
  assert.match(css, /width: var\(--width\)/);
  assert.doesNotMatch(css, /width: 420px/);
});

test('the host window is sized from the popup width, so a wide preset is never clipped', () => {
  for (const width of [280, 420, 620]) {
    const html = buildCustomPresetHtml({ width });
    const meta = /<meta width="(\d+)" height="(\d+)"/.exec(html);
    assert.ok(meta, `no window-size metadata for width ${width}`);
    assert.equal(Number(meta[1]), width + CUSTOM_PRESET_WINDOW_MARGIN, `window too narrow for a ${width}px popup`);
    assert.ok(Number(meta[2]) > 0);
  }
  // An out-of-range width is clamped identically in the CSS and in the metadata.
  const clamped = customPresetNumbers({ width: 5000 }).width;
  assert.equal(Number(/<meta width="(\d+)"/.exec(buildCustomPresetHtml({ width: 5000 }))[1]), clamped + CUSTOM_PRESET_WINDOW_MARGIN);
});

test('the generated preset satisfies the notification-window contract', () => {
  const html = buildCustomPresetHtml(FULL);
  assert.match(html, /<meta\s+name="duration"\s+content="\d+"/i, 'no duration metadata');
  assert.match(html, /<link rel="stylesheet" href="style\.css"/, 'does not load its generated stylesheet');
  assert.match(html, /window\.api\.onNotification/, 'does not consume the notification payload');
  assert.match(html, /window\.api\.closeNotificationWindow/, 'never closes its own window');
  assert.match(html, /notificationRenderReady/, 'never signals that it has rendered');

  let scripts = 0;
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi)) {
    new vm.Script(match[1], { filename: 'generated-preset.html' }); // throws on a syntax error
    scripts += 1;
  }
  assert.equal(scripts, 1, 'expected exactly one inline engine script');
});

test('init.js reserves the preview preset name and hides it from the preset list', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  const reserved = /const PREVIEW_PRESET_NAME = '([^']+)';/.exec(init);
  assert.ok(reserved, 'no reserved preview preset name');
  // The scratch preset the Preview button writes must never be offered as a real preset...
  assert.match(init, /if \(name === PREVIEW_PRESET_NAME\) continue;/, 'list-presets does not skip the preview preset');
  assert.match(init, /name !== PREVIEW_PRESET_NAME/, 'list-custom-presets does not skip the preview preset');
  // ...nor be creatable by hand under that name.
  assert.match(init, /if \(name === PREVIEW_PRESET_NAME\) return \{ ok: false, error: 'reserved-name' \};/);
});

test('a generated preset stores the builder options that produced it, so it can be re-opened', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  assert.match(init, /const PRESET_OPTIONS_FILE = 'aw-preset\.json';/);
  assert.match(init, /fs\.writeFileSync\(path\.join\(dir, PRESET_OPTIONS_FILE\)/, 'writeCustomPreset does not persist its options');
  // read-custom-preset re-clamps what it read, so a hand-edited options file cannot widen the ranges.
  assert.match(init, /return \{ name: safe, \.\.\.customPresetNumbers\(parsed\) \};/);
});

test('generated presets are written under userData, never inside the packaged app', () => {
  const { generatedPresetsDir, GENERATED_PRESETS_SUBPATH } = require(path.join(appRoot, 'util', 'customPreset.js'));

  const userData = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'Achievement Watcher 3.0');
  const dir = generatedPresetsDir(userData);

  assert.ok(dir.startsWith(userData + path.sep), `${dir} is not under userData`);
  assert.equal(dir, path.join(userData, ...GENERATED_PRESETS_SUBPATH));
  // Packaging puts app/presets inside app.asar, which is a file: mkdir below it fails with ENOTDIR,
  // so Preview and Save silently died on every installed build. Nothing may point back at the app.
  assert.doesNotMatch(dir, /app\.asar/i);
  assert.throws(() => generatedPresetsDir(''), /userData path is required/);
});

test('init.js resolves generated presets from userData and reads the bundled libraries separately', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');

  // The single writable root, taken from the tested helper rather than rebuilt by hand.
  assert.match(init, /const usersPresetsDir = \(\) => customPreset\.generatedPresetsDir\(userData\);/);
  // Every write goes through it...
  const write = /function writeCustomPreset[\s\S]*?\n}/.exec(init);
  assert.ok(write, 'writeCustomPreset not found');
  assert.match(write[0], /path\.join\(usersPresetsDir\(\), name\)/);
  assert.doesNotMatch(write[0], /__dirname/, 'writeCustomPreset still targets the app folder');
  // ...and the notification lookup still finds both the generated and the bundled presets.
  assert.match(init, /const roots = \[usersPresetsDir\(\), \.\.\.bundledPresetRoots\(\)/);
  assert.match(init, /const roots = \[\.\.\.bundledPresetRoots\(\), usersPresetsDir\(\)\]/);
});
