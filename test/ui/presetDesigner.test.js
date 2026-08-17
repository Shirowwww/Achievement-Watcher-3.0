'use strict';

/*
  The preset designer's controls, its markup and its labels are three views of one schema. Nothing
  at runtime notices when they disagree — a property with no control is simply uneditable, a control
  with no label ships as a blank line, and a select whose options do not match the schema silently
  writes a value the generator will throw away. So the parity is asserted here instead.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.join(__dirname, '..', '..', 'app');
const { parse } = require(path.join(appRoot, 'node_modules', 'node-html-parser'));
const schema = require(path.join(appRoot, 'util', 'presetSchema.js'));

const document = parse(fs.readFileSync(path.join(appRoot, 'view', 'app.html'), 'utf8'));
const designer = document.querySelector('#options-notify-designer');
const settings = fs.readFileSync(path.join(appRoot, 'ui', 'settings.js'), 'utf8');
const localeDir = path.join(appRoot, 'locale', 'lang');
const english = JSON.parse(fs.readFileSync(path.join(localeDir, 'english.json'), 'utf8'));

const valueAt = (object, dotted) => dotted.split('.').reduce((node, key) => (node == null ? node : node[key]), object);

test('the designer has a tab of its own, listed under Notification', () => {
  assert.ok(designer, 'no preset designer section');

  const tab = document.querySelector("#settings .container > section.content[data-view='presets']");
  assert.ok(tab, 'the designer has no tab of its own');
  assert.ok(tab.querySelector('#options-notify-designer'), 'the designer is not in its tab');
  assert.ok(tab.querySelector('#pd-templates-row'), 'the starting points are not in the tab');
  // …and it is reachable: a view with no nav entry is dead markup.
  const nav = document.querySelectorAll('#settingNav li[data-view]').map((item) => item.getAttribute('data-view'));
  assert.ok(nav.includes('presets'), 'the tab has no entry in the settings navigation');
  assert.equal(nav[nav.indexOf('presets') - 1], 'notification', 'the tab must sit under the Notification group');

  // It is no longer a card inside the Notification tab...
  const notification = document.querySelector("#settings .container > section.content[data-view='notification']");
  assert.equal(notification.querySelector('#options-notify-designer'), null, 'the designer is still duplicated in the Notification tab');
  // ...and the legacy eight-slider builder is gone rather than left beside it.
  assert.equal(document.querySelector('#options-notify-customiser'), null, 'the superseded builder card is still in the page');

  // Simple mode shows it: designing a notification is an everyday choice, not a technical one.
  const interfaceMode = require(path.join(appRoot, 'util', 'interfaceMode.js'));
  assert.ok(interfaceMode.SIMPLE_VIEWS.includes('presets'));
  assert.ok(interfaceMode.isViewVisible('presets', interfaceMode.SIMPLE));

  // Every label in the tab, including both card headers and the nav entry, is bound in one pass.
  const loader = fs.readFileSync(path.join(appRoot, 'locale', 'loader.js'), 'utf8');
  assert.match(loader, /\$\("#settings \.content\[data-view='presets'\] \[data-lang\]"\)\.each/);
  // The side menu gets a label of its own: the card title is twice as long as anything else there.
  assert.match(loader, /\$\("#settingNav li\[data-view='presets'\] span"\)\.text\(clear\(template\.settings\.sideMenu\.presets\)\)/);
  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const label = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')).settings.sideMenu.presets;
    assert.ok(String(label || '').trim(), file + ': the tab has no side-menu label');
    assert.ok(label.length <= 16, file + ': the side-menu label is too long for the nav column');
  }
});

test('the starting points are real designs the schema accepts', () => {
  const templates = require(path.join(appRoot, 'util', 'presetTemplates.js'));
  assert.deepEqual(templates.unknownTemplateKeys(), [], 'a template sets a property the schema does not have');
  assert.ok(templates.PRESET_TEMPLATES.length >= 6, 'too few starting points to be worth a gallery');

  const names = templates.PRESET_TEMPLATES.map((template) => template.name);
  assert.equal(new Set(names).size, names.length, 'two starting points share a name');
  assert.ok(names.includes('Classic'), 'the design the builder always produced must stay one click away');

  for (const name of names) {
    const options = templates.templateOptions(name);
    // A template is applied straight to the controls, so it has to already be a valid design: a
    // value the schema would clamp would leave the controls showing something else.
    assert.deepEqual(schema.normalizeOptions(options), options, `${name} is not a fully valid design`);
  }
  assert.equal(templates.templateOptions('nope'), null);
});

test('the randomiser only ever produces a design the designer can show back', () => {
  const templates = require(path.join(appRoot, 'util', 'presetTemplates.js'));
  // A seeded sequence, so this covers many draws rather than whichever one today's run produced.
  let seed = 1;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let draw = 0; draw < 200; draw += 1) {
    const options = templates.randomPresetOptions(random);
    assert.deepEqual(schema.normalizeOptions(options), options, 'the randomiser produced a value the schema clamps');
    assert.match(options.bg, /^#[0-9a-f]{6}$/i, 'a generated colour is not one a colour input can show');
    assert.match(options.accent, /^#[0-9a-f]{6}$/i);
  }
});

test('every schema property has a control, in its own group, on the right side of Advanced', () => {
  for (const property of schema.PRESET_PROPERTIES) {
    const control = designer.querySelector(`#pd-${property.key}`);
    assert.ok(control, `${property.key} has no control in the designer`);

    const field = control.closest('.pd-field');
    assert.ok(field, `${property.key} is not inside a labelled field`);
    assert.equal(field.getAttribute('data-key'), property.key);

    const group = field.closest('.pd-group');
    assert.ok(group, `${property.key} is not inside a group`);
    assert.equal(group.getAttribute('data-group'), property.group, `${property.key} is in the wrong group`);

    const advanced = Boolean(field.closest('.pd-adv'));
    assert.equal(advanced, Boolean(property.advanced), `${property.key} is on the wrong side of the Advanced disclosure`);
  }

  // Nothing in the markup that the schema does not know about: a stray control would read and write
  // nothing, since the designer only iterates the schema.
  for (const field of designer.querySelectorAll('.pd-field')) {
    const key = field.getAttribute('data-key');
    assert.ok(schema.PROPERTY_BY_KEY.has(key), `the designer shows a control for unknown property "${key}"`);
  }
  assert.equal(designer.querySelectorAll('.pd-field').length, schema.PRESET_PROPERTIES.length);
});

test('each group is a section the user can collapse, and only the everyday two start open', () => {
  const groups = designer.querySelectorAll('.pd-group');
  assert.equal(groups.length, schema.PRESET_GROUPS.length);
  const open = groups.filter((group) => group.classNames.includes('is-open')).map((group) => group.getAttribute('data-group'));
  assert.deepEqual(open, ['layout', 'color'], 'the designer should open on layout and colours only');
  for (const group of groups) {
    assert.ok(group.querySelector('.pd-group-head'), `${group.getAttribute('data-group')} cannot be collapsed`);
    // A group with advanced properties must offer the disclosure that reveals them.
    const hasAdvanced = schema.PRESET_PROPERTIES.some((p) => p.group === group.getAttribute('data-group') && p.advanced);
    assert.equal(Boolean(group.querySelector('.pd-more')), hasAdvanced, `${group.getAttribute('data-group')}: Advanced disclosure does not match its content`);
    const advanced = group.querySelector('.pd-adv');
    if (hasAdvanced) assert.ok(advanced.hasAttribute('hidden'), 'advanced properties must start folded away');
  }
});

test('numeric controls offer exactly the range the schema clamps to', () => {
  for (const property of schema.PRESET_PROPERTIES) {
    if (property.type !== 'number') continue;
    const input = designer.querySelector(`#pd-${property.key}`);
    assert.equal(input.getAttribute('type'), 'range', `${property.key} should be a slider`);
    // Percent sliders show 20-100 for a stored 0.2-1; the designer converts, the schema clamps.
    const factor = property.percent ? 100 : 1;
    assert.equal(Number(input.getAttribute('min')), property.min * factor, `${property.key}: min differs from the schema`);
    assert.equal(Number(input.getAttribute('max')), property.max * factor, `${property.key}: max differs from the schema`);
    assert.ok(designer.querySelector(`#pd-val-${property.key}`), `${property.key} has no live readout`);
  }
});

test('dropdowns offer exactly the values the schema accepts', () => {
  for (const property of schema.PRESET_PROPERTIES) {
    if (property.type !== 'select') continue;
    const options = designer.querySelectorAll(`#pd-${property.key} option`).map((option) => option.getAttribute('value'));
    assert.deepEqual(options, property.values, `${property.key}: the dropdown and the schema disagree`);
  }
  // A toggle is a two-value dropdown, so it round-trips through the same normalizer.
  for (const property of schema.PRESET_PROPERTIES) {
    if (property.type !== 'toggle') continue;
    const options = designer.querySelectorAll(`#pd-${property.key} option`).map((option) => option.getAttribute('value'));
    assert.deepEqual(options, ['true', 'false'], `${property.key}: a toggle must offer true and false`);
  }
});

test('every label in the designer resolves in all 18 locales', () => {
  const keys = designer.querySelectorAll('[data-lang]').map((node) => node.getAttribute('data-lang'));
  assert.ok(keys.length > 90, 'the designer should be fully labelled from the locale');
  // Every property, group and dropdown value is named.
  for (const property of schema.PRESET_PROPERTIES) {
    assert.ok(keys.includes(`field.${property.key}`), `${property.key} has no label`);
  }
  for (const group of schema.PRESET_GROUPS) assert.ok(keys.includes(`group.${group}`), `group ${group} has no title`);

  const files = fs.readdirSync(localeDir).filter((file) => file.endsWith('.json'));
  assert.equal(files.length, 18);
  for (const file of files) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    const block = locale.settings.notification.option.designer;
    assert.ok(block, `${file}: no designer block`);
    for (const key of keys) {
      const value = valueAt(block, key);
      assert.equal(typeof value, 'string', `${file}: designer.${key} is missing`);
      assert.ok(value.trim(), `${file}: designer.${key} must be translated`);
    }
    // The runtime-worded controls the loader parks on data attributes.
    for (const key of ['create', 'update', 'editNew', 'namePlaceholder', 'errName', 'created', 'updated', 'loaded', 'deleted', 'imported', 'importedOnly', 'exported', 'resetDone', 'failed', 'value.appSound']) {
      assert.ok(String(valueAt(block, key) || '').trim(), `${file}: designer.${key} must be translated`);
    }
  }
});

test('the designer reads and writes its controls from the schema rather than by hand', () => {
  // One loop over the schema, not 45 hand-written lookups: that is what keeps a new property from
  // being editable in the UI but ignored on save.
  assert.match(settings, /for \(const property of presetSchema\.PRESET_PROPERTIES\)[\s\S]{0,400}\$\('#pd-' \+ property\.key\)/);
  assert.match(settings, /return presetSchema\.normalizeOptions\(options\);/, 'the designer does not clamp what it reads');
  // Create, Export and both previews all go through that one reader.
  for (const call of ['create-custom-preset', 'preview-custom-preset']) {
    assert.ok(settings.includes(call), `${call} is no longer wired up`);
  }
  assert.match(settings, /invoke\('create-custom-preset', Object\.assign\(\{ name \}, readPresetOptions\(\)\)\)/);
  assert.match(settings, /options: readPresetOptions\(\)/, 'export does not send the design in the controls');
});

test('the live preview swaps only the stylesheet, and never reloads on every keystroke', () => {
  // Rebuilding the document on each input would restart the animation under the user's cursor and
  // make dragging a slider feel broken; the stylesheet is the only thing that has to change.
  assert.match(settings, /styleEl\.textContent = presetGenerator\.buildCustomPresetCss\(values\);/);
  assert.match(settings, /getElementById\('aw-preview-css'\)/);
  assert.match(settings, /previewPending = setTimeout/, 'preview updates are not batched');
  // …and the preview is fed the same payload shape the notification window sends.
  for (const field of ['notificationType', 'rarityPercent', 'isPlatinum', 'progress', 'iconPath', 'imagePath']) {
    assert.ok(settings.includes(field), `the preview payload is missing ${field}`);
  }
});

test('the preview mirrors the notification position instead of inventing a second setting', () => {
  const anchors = designer.querySelectorAll('#pd-anchors button').map((button) => button.getAttribute('data-pos'));
  const positions = document
    .querySelectorAll('#option_overlayPosition option')
    .map((option) => option.getAttribute('value'))
    .filter((value) => value !== 'custom');
  assert.deepEqual(anchors.slice().sort(), positions.slice().sort(), 'the anchor grid and the position setting disagree');
  assert.match(settings, /\$\('#option_overlayPosition'\)\.val\(String\(\$\(this\)\.attr\('data-pos'\)\)\)\.change\(\)/);
});

test('the Advanced disclosure actually hides something', () => {
  /*
    `#settings .pd-fields { display: grid }` outranks the browser's own `[hidden] { display: none }`,
    so an advanced block marked hidden was on screen from the start and its button appeared to do
    nothing at all. The rule that fixes it is the whole feature.
  */
  const css = fs.readFileSync(path.join(appRoot, 'resources', 'css', 'app.css'), 'utf8');
  assert.match(css, /#settings \.pd-fields\[hidden\] \{\s*display: none;/, 'a hidden advanced block would still be shown');

  // Simple mode folds the advanced halves away entirely, through the attribute the panel already uses.
  const interfaceMode = require(path.join(appRoot, 'util', 'interfaceMode.js'));
  for (const block of designer.querySelectorAll('.pd-adv')) {
    assert.equal(block.getAttribute(interfaceMode.ADVANCED_ATTRIBUTE), '1', 'an advanced block is shown in Simple mode');
  }
  for (const button of designer.querySelectorAll('.pd-more')) {
    assert.equal(button.getAttribute(interfaceMode.ADVANCED_ATTRIBUTE), '1', 'the Advanced button is offered in Simple mode');
  }
});

test('the three states can be compared side by side', () => {
  // Switching states one at a time shows what a rare unlock looks like; only seeing them together
  // shows whether it looks DIFFERENT, which is the question a rare colour is actually asking.
  const views = designer.querySelectorAll('#pd-view button').map((button) => button.getAttribute('data-view'));
  assert.deepEqual(views, ['card', 'compare', 'screen']);

  const rows = designer.querySelectorAll('#pd-compare .pd-compare-row');
  assert.deepEqual(rows.map((row) => row.getAttribute('data-state')), ['normal', 'rare', 'completion']);
  for (const row of rows) {
    assert.ok(row.querySelector('iframe'), 'a compare row has nothing to render into');
    assert.ok(row.querySelector('.pd-compare-label[data-lang]'), 'a compare row is unlabelled');
  }
  assert.match(settings, /function renderComparePreviews\(values\)/, 'the compare view is not rendered');
  // Editing has to reach the compare frames, and cheaply: the stylesheet is swapped, not reloaded.
  assert.match(settings, /if \(previewView === 'compare'\) renderComparePreviews\(values\);/);
  assert.match(settings, /style\.textContent = presetGenerator\.buildCustomPresetCss\(values\)/);
});

test('scale and position are mirrored from the app settings, never duplicated', () => {
  const scales = designer.querySelectorAll('#pd-scale option').map((option) => option.getAttribute('value'));
  const appScales = document.querySelectorAll('#option_overlayScale option').map((option) => option.getAttribute('value'));
  assert.deepEqual(scales, appScales, 'the designer offers a different set of scales than the setting it writes');
  // Writing goes to the one setting, and the mirror follows it back when it changes elsewhere.
  assert.match(settings, /\$\('#option_overlayScale'\)\.val\(String\(\$\(this\)\.val\(\)\)\)\.change\(\)/);
  assert.match(settings, /if \(\$\('#pd-scale'\)\.val\(\) !== scale\) \$\('#pd-scale'\)\.val\(scale\)/);
});

test('the tab disappears when notifications are Windows toasts', () => {
  /*
    A preset only ever describes the in-game overlay. On the toast transport nothing it describes is
    drawn, so the tab goes away rather than offering an authoring surface with no effect.
  */
  assert.match(settings, /function updatePresetTabVisibility\(\)/);
  assert.match(settings, /const unused = \(\$\('#option_notifMode'\)\.val\(\) \|\| 'auto'\) === 'toast';/);
  assert.match(settings, /\$\("#settingNav li\[data-view='presets'\]"\)\.toggleClass\(interfaceMode\.HIDDEN_CLASS, unused\)/);
  assert.match(settings, /\$\("#settings \.box section\.content\[data-view='presets'\]"\)\.toggleClass\(interfaceMode\.HIDDEN_CLASS, unused\)/);
  // Hiding the tab the user is standing on would leave the panel blank.
  assert.match(settings, /if \(unused && \$\("#settingNav li\[data-view='presets'\]"\)\.hasClass\('active'\)\)/);
  // …and it is re-evaluated whenever the transport changes, not only at startup.
  assert.match(settings, /\$\('#option_notifMode'\)\.on\('change', function \(\) \{[\s\S]{0,200}updatePresetTabVisibility\(\);/);
});

test('the preview borrows real game artwork instead of shipping a picture', () => {
  // A notification is seen over a game, so that is what the preview is judged against — taken from
  // the covers the app already downloaded, which also keeps copyrighted art out of the repository.
  assert.match(settings, /path\.join\(userData, 'covers'\)/, 'the preview does not use the library artwork');
  assert.match(settings, /function imageDimensions\(file\)/, 'landscape art is not preferred');
  assert.match(settings, /const artwork = backdrop === 'artwork' \? previewArtwork\(\) : '';/);
  // An empty library must still get something to judge contrast against.
  const css = fs.readFileSync(path.join(appRoot, 'resources', 'css', 'app.css'), 'utf8');
  assert.match(css, /pd-stage\[data-backdrop='artwork'\] \{[^}]*radial-gradient/, 'no painted fallback scene');
});

test('choosing a preset stays with the notification settings, with a way through to the designer', () => {
  /*
    Which preset is used is what a notification will look like tonight, so it belongs with the other
    notification settings. The designer is a workshop rather than a setting, so the row that picks a
    preset carries a button into it instead of the two being merged.
  */
  const overlay = document.querySelector("#settings .container > section.content[data-view='notification'] #options-notify-overlay");
  const chosen = overlay.querySelectorAll('select[id^="option_overlayPreset"]').map((node) => node.getAttribute('id'));
  assert.deepEqual(chosen, [
    'option_overlayPreset',
    'option_overlayPresetXenia',
    'option_overlayPresetRpcs3',
    'option_overlayPresetShadps4',
  ]);
  // …so they keep saving through the binding that has always covered that tab.
  assert.match(settings, /section\.content\[data-view='notification'\]"\)\.on\('change', 'select, #option_overlayVolume', autosaveNotifications\)/);

  // The button sits on the main preset row, next to its label, like the other inline row actions.
  const button = overlay.querySelector('#btn-open-presets');
  assert.ok(button, 'no way through to the designer');
  assert.ok(button.closest('li').querySelector('#lbl-overlayPreset'), 'the button is not on the preset row');
  assert.ok(button.classNames.includes('inline-action-btn'), 'the button does not follow the inline row-action style');
  assert.match(settings, /\$\('#btn-open-presets'\)\.on\('click', function \(\) \{\s*\$\("#settingNav li\[data-view='presets'\]"\)\.trigger\('click'\);/);
  // Its tooltip is localized like everything else.
  assert.match(fs.readFileSync(path.join(appRoot, 'locale', 'loader.js'), 'utf8'), /\$\('#btn-open-presets'\)\.attr\('title', clear\(c\.open\)\)/);
  for (const file of fs.readdirSync(localeDir).filter((name) => name.endsWith('.json'))) {
    const block = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')).settings.notification.option.designer;
    assert.ok(String(block.open || '').trim(), `${file}: the designer button has no tooltip`);
  }
});

test('the starting points are a row of the designer card, not a card of their own', () => {
  // One card, read top to bottom: start from something, then shape it.
  const tab = document.querySelector("#settings .container > section.content[data-view='presets']");
  assert.equal(tab.querySelectorAll('.arrow-list').length, 1, 'the Presets tab should be one card');
  const rows = tab.querySelectorAll('#options-notify-designer > li');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].getAttribute('id'), 'pd-templates-row', 'the starting points must come first');
  assert.ok(rows[0].querySelector('#pd-templates'), 'the template gallery is gone');
  assert.ok(rows[1].querySelector('#pd-frame'), 'the designer is gone');
  // The gallery is wired through the card that now holds it.
  assert.match(settings, /\$\('#options-notify-designer'\)\.on\('click', '\.pd-template'/);
});

/*
  The designer reports what it just did through one element, #pd-status, and reads each message off
  a data attribute the locale loader is supposed to have put there. Nothing connects the two ends:
  a message the loader never binds resolves to '' and the status still renders, so picking the
  "Slate" template printed a bare green "Slate" with no indication of what had happened, and
  "Surprise me" reported nothing at all. Assert every attribute the code reads is one the loader
  writes, and that the strings behind them exist in every locale.
*/
test('every #pd-status message the designer reads is bound by the locale loader', () => {
  const settingsJs = fs.readFileSync(path.join(appRoot, 'ui', 'settings.js'), 'utf8');
  const loaderJs = fs.readFileSync(path.join(appRoot, 'locale', 'loader.js'), 'utf8');

  const read = new Set([...settingsJs.matchAll(/\$\('#pd-status'\)\s*\.attr\('(data-[\w-]+)'/g)].map((m) => m[1]));
  const statusBinding = loaderJs.slice(loaderJs.indexOf("$('#pd-status')"));
  const bound = new Set([...statusBinding.slice(0, statusBinding.indexOf(';')).matchAll(/\.attr\('(data-[\w-]+)'/g)].map((m) => m[1]));

  assert.ok(read.size >= 10, `expected the designer to read several status messages, saw ${read.size}`);
  const unbound = [...read].filter((name) => !bound.has(name));
  assert.deepEqual(unbound, [], `these #pd-status messages are read but never localized: ${unbound.join(', ')}`);
});

test('the template status strings exist and are translated in every locale', () => {
  const langDir = path.join(appRoot, 'locale', 'lang');
  const files = fs.readdirSync(langDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 18, 'all bundled locales must be checked');

  for (const file of files) {
    const designerStrings = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8')).settings.notification.option.designer;
    for (const key of ['applied', 'randomized', 'duplicated']) {
      const value = String((designerStrings.templates || {})[key] || '').trim();
      assert.ok(value, `${file}: designer.templates.${key} must be translated — there is no English fallback at runtime`);
    }
  }
});
