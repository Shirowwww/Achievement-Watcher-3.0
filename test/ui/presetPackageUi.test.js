'use strict';

// Import/Export are two buttons in the preset designer. Nothing here renders, so these guard the
// wiring the buttons depend on: the markup, the locale bindings and what the main process does with
// the request.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.join(__dirname, '..', '..', 'app');
const htmlParser = require(path.join(appRoot, 'node_modules', 'node-html-parser'));

const read = (...parts) => fs.readFileSync(path.join(appRoot, ...parts), 'utf8');

test('the Import and Export buttons sit in the preset designer actions', () => {
  const document = htmlParser.parse(read('view', 'app.html'));
  // The card also holds the starting points and their own actions, so target the designer's row.
  const actions = document.querySelector('#options-notify-designer #pd-actions');
  assert.ok(actions, 'the preset designer action row is gone');

  for (const id of ['btn-import-preset', 'btn-export-preset']) {
    const button = actions.querySelector(`#${id}`);
    assert.ok(button, `${id} is not in the preset designer actions`);
    assert.equal(button.tagName, 'BUTTON');
  }
  // Both labels are localized through their own span, like every other button in this card.
  const labels = actions.querySelectorAll('[data-lang]').map((node) => node.getAttribute('data-lang'));
  assert.ok(labels.includes('importLabel'));
  assert.ok(labels.includes('exportLabel'));
});

test('every string the two buttons show is bound from the locale', () => {
  const loader = read('locale', 'loader.js');
  // The designer's labels are bound in one pass over `data-lang`, so the Import and Export spans are
  // covered by that loop rather than by a selector each.
  assert.match(loader, /\$\("#settings \.content\[data-view='presets'\] \[data-lang\]"\)\.each/, 'the designer labels are not bound');
  assert.match(loader, /attr\('data-imported', clear\(c\.imported\)\)/, 'the import status is not bound');
  assert.match(loader, /attr\('data-exported', clear\(c\.exported\)\)/, 'the export status is not bound');

  // The keys have to exist in English before the parity suite can require them everywhere else.
  const english = JSON.parse(read('locale', 'lang', 'english.json'));
  const designer = english.settings.notification.option.designer;
  for (const key of ['importLabel', 'exportLabel', 'imported', 'exported']) {
    assert.ok(String(designer[key] || '').trim(), `designer.${key} is missing`);
  }
});

test('Export writes the design on screen, never some other preset', () => {
  const settings = read('ui', 'settings.js');
  const handler = /\$\('#btn-export-preset'\)\.click\([\s\S]*?\n    \}\);/.exec(settings);
  assert.ok(handler, 'the export handler is gone');

  /*
    Falling back to the ACTIVE notification preset when the picker sat on "New preset…" exported a
    package named for the design in the builder whose contents were the user's current preset - a
    "goat.awpreset" whose manifest said "Shirow", which then clashed with the bundled Shirow on
    import and rendered as Shirow everywhere. Export now takes the controls, except for an imported
    preset, whose look the controls cannot describe.
  */
  assert.doesNotMatch(handler[0], /#option_overlayPreset/, 'Export can still reach for the active preset');
  assert.match(handler[0], /loaded && !isEditablePreset\(loaded\)\s*\?\s*\{ name: loaded \}/, 'an imported preset is not exported from disk');
  assert.match(handler[0], /options: readPresetOptions\(\)/, 'a builder design is not exported from the controls');
  // An unnamed design is refused rather than exported under a borrowed name.
  assert.match(handler[0], /if \(!request\.name\) \{/);
});

test('the main process can export an unsaved builder design', () => {
  const init = read('electron', 'init.js');
  const handler = /ipcMain\.handle\('export-preset'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(handler, 'the export handler is gone');
  // A draft is generated into the scratch folder and exported through the same path as a saved one.
  assert.match(handler[0], /const draft = asked\.options && typeof asked\.options === 'object' \? customPresetNumbers\(asked\.options\) : null;/);
  assert.match(handler[0], /draft \? writeCustomPreset\(PREVIEW_PRESET_NAME, draft\) : findPresetFolder\(safe\)/);
  // The package is named by the request, never by the reserved scratch preset.
  assert.match(handler[0], /if \(!safe \|\| safe === PREVIEW_PRESET_NAME\) return \{ ok: false, error: 'invalid-name' \};/);
  assert.match(handler[0], /let options = draft;/, 'a draft export must carry the drafted options');
});

test('importing loads the preset into the builder controls', () => {
  const settings = read('ui', 'settings.js');
  // Selecting the preset in code fires no change event, so the controls kept the previous draft and
  // the builder looked like the import had not happened.
  assert.match(settings, /async function loadPresetIntoBuilder\(name\)/, 'the shared loader is gone');
  const handler = /\$\('#btn-import-preset'\)\.click\([\s\S]*?\n    \}\);/.exec(settings);
  assert.ok(handler, 'the import handler is gone');
  assert.match(handler[0], /await loadPresetIntoBuilder\(res\.name\);/, 'an import does not load the preset into the controls');
  // The picker keeps using the same loader, so the two paths cannot drift apart.
  const picker = /\$\('#pd-load'\)\.on\('change'[\s\S]*?\n    \}\);/.exec(settings);
  assert.ok(picker && /await loadPresetIntoBuilder\(name\)/.test(picker[0]), 'the picker no longer shares the loader');
});

test('a name clash asks the user instead of overwriting or failing silently', () => {
  const settings = read('ui', 'settings.js');
  assert.match(settings, /res\.error === 'duplicate'/, 'the duplicate answer is not handled');
  // The second call reuses the file the user already picked rather than reopening the dialog.
  assert.match(settings, /invoke\('import-preset', \{ file: res\.file, duplicate: choice === 1 \? 'replace' : 'rename' \}\)/);
});

test('the main process installs only into the userData preset storage', () => {
  const init = read('electron', 'init.js');
  const handler = /ipcMain\.handle\('import-preset'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(handler, 'the import handler is gone');

  assert.match(handler[0], /presetsDir: usersPresetsDir\(\)/, 'imports must land in the generated-preset folder');
  assert.match(handler[0], /soundsDir: userSoundsDir\(\)/);
  assert.doesNotMatch(handler[0], /__dirname/, 'the import handler must never target the packaged app folder');
  // The scratch preview preset keeps its reserved name against an imported package too.
  assert.match(handler[0], /reservedNames: \[PREVIEW_PRESET_NAME\]/);
  // Anything but an explicit choice reports the clash rather than replacing a preset.
  assert.match(handler[0], /\['rename', 'replace'\]\.includes\(opts\.duplicate\) \? opts\.duplicate : 'fail'/);
});

test('an imported preset is listed and deletable, not an orphan in the preset folder', () => {
  const init = read('electron', 'init.js');
  // Only the builder's options file used to count, so a hand-authored preset installed from a
  // package was invisible in the picker and refused by delete.
  assert.match(init, /const PRESET_MARKERS = \[PRESET_OPTIONS_FILE, presetPackage\.PRESET_PACKAGE_FILE\];/);

  const list = /ipcMain\.handle\('list-custom-presets'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(list && /managedPresetMarker\(name\)/.test(list[0]), 'the picker does not list imported presets');

  const remove = /ipcMain\.handle\('delete-custom-preset'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(remove, 'the delete handler is gone');
  assert.match(remove[0], /if \(!managedPresetMarker\(safe\)\) return \{ ok: false, error: 'not-generated-here' \};/);
  // A preset a user dropped in the folder by hand carries no marker and stays untouchable.
  assert.match(remove[0], /path\.dirname\(path\.resolve\(dir\)\) !== path\.resolve\(usersPresetsDir\(\)\)/);
});

test('an imported preset does not load meaningless slider values or arm an overwrite', () => {
  const init = read('electron', 'init.js');
  const reader = /ipcMain\.handle\('read-custom-preset'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(reader, 'the read handler is gone');
  assert.match(reader[0], /return \{ name: safe, editable: true, \.\.\.customPresetNumbers\(parsed\) \};/);
  assert.match(reader[0], /return \{ name: safe, editable: false \};/);
  assert.match(reader[0], /if \(!safe \|\| !managedPresetMarker\(safe\)\) return null;/);

  const settings = read('ui', 'settings.js');
  assert.match(settings, /if \(opts\.editable === false\) \{/, 'the builder still loads defaults over an imported preset');
  // The name field is cleared, so Create makes a new preset instead of replacing the artwork.
  assert.match(settings, /if \(opts\.editable === false\) \{\s*\$\('#pd-name'\)\.val\(''\);/);
  assert.match(settings, /attr\('data-imported-only'\)/, 'nothing explains why the controls did not move');

  const english = JSON.parse(read('locale', 'lang', 'english.json'));
  assert.ok(String(english.settings.notification.option.designer.importedOnly || '').trim());
  assert.match(read('locale', 'loader.js'), /attr\('data-imported-only', clear\(c\.importedOnly\)\)/);
});

test('deleting a preset never moves the user onto an unrelated one', () => {
  const settings = read('ui', 'settings.js');
  const helper = /async function refreshOverlayPresetMenu[\s\S]*?\n    \}/.exec(settings);
  assert.ok(helper, 'the preset menu helper is gone');

  // Deleting the active preset used to fall through to presets[0], i.e. whatever sorts first
  // ("ArmsofGod"), which looked like the setting had failed to save.
  assert.match(helper[0], /\[preferred, previous, DEFAULT_PRESET_NAME\]\.find\(\(n\) => n && names\.includes\(n\)\)/);
  assert.match(settings, /const DEFAULT_PRESET_NAME = 'AW Next';/);

  // Every rebuild of the menu goes through the helper, so the fallback cannot differ between them.
  for (const handler of ['btn-delete-preset', 'btn-create-preset', 'btn-import-preset']) {
    const block = new RegExp(`\\$\\('#${handler}'\\)\\.click\\([\\s\\S]*?\\n    \\}\\);`).exec(settings);
    assert.ok(block, `${handler} handler not found`);
    assert.doesNotMatch(block[0], /\$\('#option_overlayPreset'\)\.empty\(\)|sel\.empty\(\)/, `${handler} still rebuilds the menu by hand`);
  }
  assert.equal((settings.match(/refreshOverlayPresetMenu\(/g) || []).length, 4, 'expected the definition plus three call sites');
});

test('a refresh rebuilds the per-type preset menus, not just the main one', () => {
  const settings = read('ui', 'settings.js');
  const helper = /async function refreshOverlayPresetMenu[\s\S]*?\n    \}/.exec(settings);
  assert.ok(helper, 'the preset menu helper is gone');

  /*
    Rebuilding only the main menu left an imported preset unpickable for rare/platinum/emulator
    notifications, so those kept rendering whatever they already pointed at - which is what "the
    tests still show Shirow" looked like from the outside.
  */
  assert.match(helper[0], /for \(const id of OVERLAY_PRESET_TYPE_IDS\)/, 'the per-type menus are not rebuilt');
  assert.match(helper[0], /typeSel\.attr\('data-lang-same'\)/, 'the "same as main" entry is lost on refresh');
  assert.match(helper[0], /if \(next !== kept\) typeSel\.change\(\);/, 'a stale override is not persisted after a reset');

  // The list must cover exactly the overrides the settings form and options.ini carry.
  const ids = /const OVERLAY_PRESET_TYPE_IDS = \[([\s\S]*?)\];/.exec(settings);
  assert.ok(ids, 'the per-type id list is gone');
  const document = htmlParser.parse(read('view', 'app.html'));
  const inForm = document
    .querySelectorAll('select[id^="option_overlayPreset"]')
    .map((node) => node.getAttribute('id'))
    .filter((id) => id !== 'option_overlayPreset');
  for (const id of inForm) {
    assert.match(ids[1], new RegExp(`'#${id}'`), `${id} is missing from the refresh`);
  }
  assert.equal(ids[1].match(/'#option_/g).length, inForm.length, 'the refresh covers a different set than the form');
});

test('Preview shows the imported preset, not the unrelated slider draft', () => {
  const settings = read('ui', 'settings.js');
  const handler = /\$\('#btn-preview-preset'\)\.click\([\s\S]*?\n    \}\);/.exec(settings);
  assert.ok(handler, 'the preview handler is gone');

  // An imported preset has no builder options, so the scratch preset built from the controls
  // previewed a default dark card instead of the preset the user had just picked.
  assert.match(handler[0], /const loaded = String\(\$\('#pd-load'\)\.val\(\) \|\| ''\);/);
  assert.match(handler[0], /if \(loaded && !isEditablePreset\(loaded\)\) \{/);
  assert.match(handler[0], /overlayTestData\(kind, loaded, loaded\)/, 'the preview does not render the selected preset');
  // The popup on screen shows the state the designer is previewing, so a rare or completion design
  // can be judged at full size and not only as a normal unlock.
  assert.match(handler[0], /const kind = previewState === 'completion' \? 'platinum' :/);
  // The designer's own drafts still go through the scratch preset, so an unsaved one stays previewable.
  assert.match(handler[0], /const options = readPresetOptions\(\);/);
  assert.match(handler[0], /invoke\('preview-custom-preset', options\)/);
  // A preset that carries its own sound previews with it - the one thing the inline preview cannot show.
  assert.match(handler[0], /if \(options\.sound\) data\.soundPath = resolveSoundFile\(options\.sound\);/);
});

test('the builder never offers to "Update" a preset it cannot rebuild', () => {
  const init = read('electron', 'init.js');
  const list = /ipcMain\.handle\('list-custom-presets'[\s\S]*?\n\}\);/.exec(init);
  // Both markers make a preset manageable, but only the builder's options file makes it editable.
  assert.match(list[0], /editable: managedPresetMarker\(name\) === PRESET_OPTIONS_FILE/);

  const settings = read('ui', 'settings.js');
  assert.match(settings, /const known = Boolean\(name\) && isEditablePreset\(name\);/, 'Update is still offered for an imported preset');
  assert.match(settings, /preset\.editable && preset\.name\.toLowerCase\(\)/);
  // Listing and deleting still cover every managed preset, editable or not.
  assert.match(settings, /managedPresetNames\(\)\.includes\(loaded\)/);
});

test('an import cannot silently shadow a bundled preset', () => {
  const init = read('electron', 'init.js');
  const handler = /ipcMain\.handle\('import-preset'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(handler, 'the import handler is gone');
  assert.match(handler[0], /takenNames: bundledPresetRoots\(\)/, 'bundled names are not offered to the duplicate check');
});

test('export resolves the named preset exactly, never the Default fallback', () => {
  const init = read('electron', 'init.js');
  const handler = /ipcMain\.handle\('export-preset'[\s\S]*?\n\}\);/.exec(init);
  assert.ok(handler, 'the export handler is gone');
  assert.match(handler[0], /findPresetFolder\(safe\)/);
  assert.doesNotMatch(handler[0], /resolvePresetFolder/, 'resolvePresetFolder falls back to Default and would export the wrong preset');
  assert.match(handler[0], /if \(!presetDir\) return \{ ok: false, error: 'preset-not-found' \};/);
  // Nothing about the machine or the Windows account is written into a shareable file.
  assert.doesNotMatch(handler[0], /os\.userInfo|username/i);
});
