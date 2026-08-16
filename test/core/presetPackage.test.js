'use strict';

// The .awpreset package is the only path by which files from another machine reach the preset
// storage, so these cover the round trip and every way a package can be wrong or hostile.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.join(__dirname, '..', '..', 'app');
const AdmZip = require(path.join(appRoot, 'node_modules', 'adm-zip'));
const presetPackage = require(path.join(appRoot, 'util', 'presetPackage.js'));
const { PRESET_PACKAGE_FORMAT, PRESET_PACKAGE_FORMAT_VERSION, PRESET_PACKAGE_EXTENSION } = presetPackage;

const APP_VERSION = '3.8.6';
const INDEX_HTML = '<!DOCTYPE html><html><head><meta width="450" height="150" /><link rel="stylesheet" href="style.css" /></head><body></body></html>';

function makeWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preset-pkg-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = {
    root,
    source: path.join(root, 'source'),
    presets: path.join(root, 'presets'),
    sounds: path.join(root, 'sounds'),
    out: path.join(root, 'out'),
  };
  for (const dir of [dirs.source, dirs.presets, dirs.sounds, dirs.out]) fs.mkdirSync(dir, { recursive: true });
  return dirs;
}

// A preset folder with the shapes a real one has: an entry, a stylesheet, a nested asset and a font.
function writeSourcePreset(dir, { options = null } = {}) {
  fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML, 'utf8');
  fs.writeFileSync(path.join(dir, 'style.css'), '.ach { color: #fff; }', 'utf8');
  fs.writeFileSync(path.join(dir, 'icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'fonts', 'face.ttf'), Buffer.from([0, 1, 0, 0, 9]));
  if (options) fs.writeFileSync(path.join(dir, 'aw-preset.json'), JSON.stringify(options), 'utf8');
  return dir;
}

// Build a package by hand so a test can put anything at all inside it.
function writeZip(file, entries) {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  zip.writeZip(file);
  return file;
}

function manifest(overrides = {}) {
  return JSON.stringify({
    format: PRESET_PACKAGE_FORMAT,
    formatVersion: PRESET_PACKAGE_FORMAT_VERSION,
    name: 'Shared Preset',
    ...overrides,
  });
}

// --- round trip -------------------------------------------------------------------------------

test('a preset survives an export/import round trip byte for byte', (t) => {
  const dirs = makeWorkspace(t);
  const options = { name: 'Neon', bg: '#101014', text: '#ffffff', accent: '#ff00aa', opacity: 0.8, fontSize: 20, radius: 6, iconSize: 72, width: 500 };
  writeSourcePreset(dirs.source, { options });
  fs.writeFileSync(path.join(dirs.sounds, 'ping.wav'), Buffer.from('RIFF-audio'));

  const file = path.join(dirs.out, 'Neon' + PRESET_PACKAGE_EXTENSION);
  const exported = presetPackage.exportPreset({
    presetDir: dirs.source,
    name: 'Neon',
    destination: file,
    options,
    meta: { author: 'Someone', description: 'A pink one', tags: ['Neon', 'neon', 'dark'] },
    sound: { name: 'ping.wav', file: path.join(dirs.sounds, 'ping.wav') },
    appVersion: APP_VERSION,
  });
  assert.equal(exported.ok, true, exported.error);
  assert.ok(fs.existsSync(file));

  const installed = presetPackage.installPackage({
    file,
    presetsDir: dirs.presets,
    soundsDir: dirs.sounds,
    appVersion: APP_VERSION,
  });
  assert.equal(installed.ok, true, installed.error);
  assert.equal(installed.name, 'Neon');

  const target = path.join(dirs.presets, 'Neon');
  for (const relative of ['index.html', 'style.css', 'icon.png', path.join('fonts', 'face.ttf')]) {
    assert.deepEqual(
      fs.readFileSync(path.join(target, relative)),
      fs.readFileSync(path.join(dirs.source, relative)),
      `${relative} did not survive the round trip`
    );
  }

  // The builder options come back through the manifest, re-clamped, with the credit preserved.
  const stored = JSON.parse(fs.readFileSync(path.join(target, 'aw-preset.json'), 'utf8'));
  assert.equal(stored.name, 'Neon');
  assert.equal(stored.accent, '#ff00aa');
  assert.equal(stored.width, 500);
  assert.equal(stored.author, 'Someone');

  assert.deepEqual(installed.sounds, ['ping.wav']);
  assert.deepEqual(installed.manifest.tags, ['neon', 'dark']);
  assert.equal(installed.manifest.description, 'A pink one');
  assert.equal(installed.manifest.app.createdWith, APP_VERSION);
});

test('nothing in the package points at the machine that made it', (t) => {
  const dirs = makeWorkspace(t);
  writeSourcePreset(dirs.source);
  const file = path.join(dirs.out, 'p' + PRESET_PACKAGE_EXTENSION);
  assert.equal(presetPackage.exportPreset({ presetDir: dirs.source, name: 'Portable', destination: file, appVersion: APP_VERSION }).ok, true);

  const names = new AdmZip(file).getEntries().map((e) => e.entryName);
  assert.deepEqual(names.sort(), ['manifest.json', 'preset/fonts/face.ttf', 'preset/icon.png', 'preset/index.html', 'preset/style.css']);
  for (const name of names) {
    assert.doesNotMatch(name, /^[a-z]:/i, `${name} is an absolute path`);
    assert.doesNotMatch(name, /^\//, `${name} is an absolute path`);
    assert.doesNotMatch(name, /\.\./, `${name} escapes the package`);
  }
  const parsed = JSON.parse(new AdmZip(file).getEntry('manifest.json').getData().toString('utf8'));
  assert.equal(JSON.stringify(parsed).includes(dirs.root), false, 'the manifest leaked a local path');
  // A hand-authored preset carries no builder options and stays uneditable on the other side.
  assert.equal(parsed.options, null);
});

test('a bundled sound is named in the manifest but not redistributed', (t) => {
  const dirs = makeWorkspace(t);
  writeSourcePreset(dirs.source);
  const file = path.join(dirs.out, 'p' + PRESET_PACKAGE_EXTENSION);
  const exported = presetPackage.exportPreset({
    presetDir: dirs.source,
    name: 'Quiet',
    destination: file,
    sound: { name: 'Xbox.wav', file: '' },
    appVersion: APP_VERSION,
  });
  assert.equal(exported.ok, true, exported.error);

  const read = presetPackage.readPackage(file, { appVersion: APP_VERSION });
  assert.equal(read.ok, true, read.error);
  assert.equal(read.manifest.sound, 'Xbox.wav');
  assert.deepEqual(read.soundFiles, []);

  // A missing payload for a named sound is not an error: the recipient already has that file.
  const installed = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(installed.ok, true, installed.error);
  assert.deepEqual(installed.sounds, []);
});

// --- structure and metadata validation --------------------------------------------------------

test('a package that is not a package is refused before anything is written', (t) => {
  const dirs = makeWorkspace(t);
  const cases = {
    'unreadable-package': path.join(dirs.out, 'missing' + PRESET_PACKAGE_EXTENSION),
    'missing-manifest': writeZip(path.join(dirs.out, 'no-manifest.awpreset'), { 'preset/index.html': INDEX_HTML }),
    'invalid-manifest': writeZip(path.join(dirs.out, 'bad-json.awpreset'), { 'manifest.json': '{ not json', 'preset/index.html': INDEX_HTML }),
    'not-a-preset-package': writeZip(path.join(dirs.out, 'wrong-format.awpreset'), {
      'manifest.json': JSON.stringify({ format: 'something-else', formatVersion: 1, name: 'X' }),
      'preset/index.html': INDEX_HTML,
    }),
    'invalid-name': writeZip(path.join(dirs.out, 'no-name.awpreset'), { 'manifest.json': manifest({ name: '   ' }), 'preset/index.html': INDEX_HTML }),
    'missing-entry': writeZip(path.join(dirs.out, 'no-entry.awpreset'), { 'manifest.json': manifest(), 'preset/style.css': 'a{}' }),
  };
  // A plain file that is not a zip at all.
  const notAZip = path.join(dirs.out, 'text.awpreset');
  fs.writeFileSync(notAZip, 'this is not an archive');
  cases['unreadable-package'] = notAZip;

  for (const [expected, file] of Object.entries(cases)) {
    const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
    assert.equal(res.ok, false, `${expected} was accepted`);
    assert.equal(res.error, expected);
  }
  // A refused import writes nothing at all, not even an empty folder.
  assert.deepEqual(fs.readdirSync(dirs.presets), []);
  assert.deepEqual(fs.readdirSync(dirs.sounds), []);
});

test('a missing package file is reported rather than thrown', (t) => {
  const dirs = makeWorkspace(t);
  const res = presetPackage.installPackage({
    file: path.join(dirs.out, 'nope' + PRESET_PACKAGE_EXTENSION),
    presetsDir: dirs.presets,
    soundsDir: dirs.sounds,
    appVersion: APP_VERSION,
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'unreadable-package');
});

test('files the format does not carry are refused, never silently dropped', (t) => {
  const dirs = makeWorkspace(t);
  const cases = [
    ['unsupported-asset', { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML, 'preset/payload.js': 'require("child_process")' }],
    ['unsupported-asset', { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML, 'preset/setup.exe': 'MZ' }],
    ['unsupported-asset', { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML, 'sounds/tune.dll': 'MZ' }],
    ['unexpected-file', { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML, 'elsewhere/note.txt': 'hi' }],
    ['unexpected-file', { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML, 'loose.html': 'hi' }],
  ];
  cases.forEach(([expected, entries], index) => {
    const file = writeZip(path.join(dirs.out, `case${index}.awpreset`), entries);
    const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
    assert.equal(res.ok, false, `case ${index} was accepted`);
    assert.equal(res.error, expected);
  });
  assert.deepEqual(fs.readdirSync(dirs.presets), []);
});

test('exporting a preset carrying an asset the format cannot express fails loudly', (t) => {
  const dirs = makeWorkspace(t);
  writeSourcePreset(dirs.source);
  fs.writeFileSync(path.join(dirs.source, 'logic.js'), 'window.x = 1;');

  const res = presetPackage.exportPreset({
    presetDir: dirs.source,
    name: 'Scripted',
    destination: path.join(dirs.out, 'x' + PRESET_PACKAGE_EXTENSION),
    appVersion: APP_VERSION,
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /^unsupported-asset/);
  assert.equal(fs.existsSync(path.join(dirs.out, 'x' + PRESET_PACKAGE_EXTENSION)), false);
});

test('a preset folder without an entry point cannot be exported', (t) => {
  const dirs = makeWorkspace(t);
  fs.writeFileSync(path.join(dirs.source, 'style.css'), 'a{}');
  const res = presetPackage.exportPreset({
    presetDir: dirs.source,
    name: 'Empty',
    destination: path.join(dirs.out, 'e' + PRESET_PACKAGE_EXTENSION),
    appVersion: APP_VERSION,
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'preset-not-found');
});

// --- path safety ------------------------------------------------------------------------------

test('safePackagePath rejects every way out of the destination folder', () => {
  const unsafe = [
    '../evil.html',
    'preset/../../evil.html',
    './../evil.html',
    '/etc/passwd',
    '\\\\server\\share\\evil.html',
    'C:/Windows/System32/evil.html',
    'c:evil.html',
    'a//b.html',
    'nested/./b.html',
    'trailing./b.html',
    'trailing /b.html',
    'con',
    'index.html/con.html',
    'NUL.css',
    'lpt1.png',
    'null\u0000byte.html',
    'a'.repeat(400),
    '',
    null,
    undefined,
  ];
  for (const value of unsafe) {
    assert.equal(presetPackage.safePackagePath(value), '', `${JSON.stringify(value)} was accepted`);
  }

  assert.equal(presetPackage.safePackagePath('index.html'), 'index.html');
  assert.equal(presetPackage.safePackagePath('fonts/face.ttf'), 'fonts/face.ttf');
  // A Windows separator normalizes to the package's own separator rather than being refused.
  assert.equal(presetPackage.safePackagePath('fonts\\face.ttf'), 'fonts/face.ttf');
  assert.equal(presetPackage.safePackagePath('My Folder/a b.png'), 'My Folder/a b.png');
});

test('a package cannot write outside the preset storage', (t) => {
  const dirs = makeWorkspace(t);
  const outside = path.join(dirs.root, 'outside.html');

  // adm-zip normalizes a path it is asked to add, so the hostile name is written into the archive
  // afterwards — which is what a package built by hand carries anyway.
  const traversals = [
    'preset/../../../outside.html',
    'preset/../../outside.html',
    'sounds/../../outside.wav',
    'preset/..\\..\\outside.html',
    '/tmp/outside.html',
    'C:/outside.html',
    'preset/sub/../../../outside.html',
  ];
  traversals.forEach((entryName, index) => {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(manifest(), 'utf8'));
    zip.addFile('preset/index.html', Buffer.from(INDEX_HTML, 'utf8'));
    zip.addFile('preset/placeholder.css', Buffer.from('owned', 'utf8'));
    zip.getEntries()[2].entryName = entryName;
    const file = path.join(dirs.out, `slip${index}.awpreset`);
    zip.writeZip(file);

    const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
    assert.equal(res.ok, false, `${entryName} was accepted`);
    assert.ok(['unsafe-path', 'unexpected-file'].includes(res.error), `${entryName} failed as ${res.error}`);
  });

  assert.equal(fs.existsSync(outside), false, 'a package escaped the preset storage');
  assert.equal(fs.existsSync(path.join(dirs.root, 'outside.wav')), false);
  assert.deepEqual(fs.readdirSync(dirs.presets), []);
});

test('a manifest name cannot steer the install out of the preset storage', (t) => {
  const dirs = makeWorkspace(t);
  const hostile = ['../escaped', '..\\escaped', 'C:\\Windows\\escaped', '../../escaped', '  ', '.'];
  hostile.forEach((name, index) => {
    const file = writeZip(path.join(dirs.out, `name${index}.awpreset`), { 'manifest.json': manifest({ name }), 'preset/index.html': INDEX_HTML });
    const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
    if (res.ok) {
      // A name that survives sanitizing must still land directly under the preset storage.
      assert.equal(path.dirname(path.join(dirs.presets, res.name)), path.resolve(dirs.presets));
      assert.doesNotMatch(res.name, /[\\/:]/);
      fs.rmSync(path.join(dirs.presets, res.name), { recursive: true, force: true });
    } else {
      assert.equal(res.error, 'invalid-name');
    }
  });
  assert.equal(fs.existsSync(path.join(dirs.root, 'escaped')), false);
});

test('the reserved preview preset name cannot be claimed by an import', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'preview.awpreset'), {
    'manifest.json': manifest({ name: '__aw-preview__' }),
    'preset/index.html': INDEX_HTML,
  });
  const res = presetPackage.installPackage({
    file,
    presetsDir: dirs.presets,
    soundsDir: dirs.sounds,
    appVersion: APP_VERSION,
    reservedNames: ['__aw-preview__'],
  });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'reserved-name');
});

// --- version compatibility --------------------------------------------------------------------

test('an incompatible package is refused with a reason, not a broken install', (t) => {
  const dirs = makeWorkspace(t);

  const newerFormat = writeZip(path.join(dirs.out, 'future.awpreset'), {
    'manifest.json': manifest({ formatVersion: PRESET_PACKAGE_FORMAT_VERSION + 1 }),
    'preset/index.html': INDEX_HTML,
  });
  const format = presetPackage.installPackage({ file: newerFormat, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(format.ok, false);
  assert.equal(format.error, 'format-too-new');
  assert.equal(format.supported, PRESET_PACKAGE_FORMAT_VERSION);

  const newerApp = writeZip(path.join(dirs.out, 'needs-newer.awpreset'), {
    'manifest.json': manifest({ app: { minVersion: '4.0.0' } }),
    'preset/index.html': INDEX_HTML,
  });
  const tooOld = presetPackage.installPackage({ file: newerApp, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(tooOld.ok, false);
  assert.equal(tooOld.error, 'app-too-old');
  assert.equal(tooOld.requires, '4.0.0');

  // The same package installs on a build that satisfies the floor.
  const ok = presetPackage.installPackage({ file: newerApp, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: '4.1.0' });
  assert.equal(ok.ok, true, ok.error);

  assert.deepEqual(fs.readdirSync(dirs.presets), ['Shared Preset']);
});

test('a package with no version floor installs on any build that knows the format', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'floorless.awpreset'), { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML });
  for (const version of ['3.0.0', APP_VERSION, '99.0.0', '']) {
    const res = presetPackage.installPackage({
      file,
      presetsDir: dirs.presets,
      soundsDir: dirs.sounds,
      appVersion: version,
      duplicate: 'replace',
    });
    assert.equal(res.ok, true, `${version}: ${res.error}`);
  }
});

test('a malformed version floor is a malformed manifest', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'bad-floor.awpreset'), {
    'manifest.json': manifest({ app: { minVersion: 'tomorrow' } }),
    'preset/index.html': INDEX_HTML,
  });
  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'invalid-manifest');
});

// --- duplicates and failure recovery ----------------------------------------------------------

test('an installed preset is marked, so the app can list and delete it again', (t) => {
  const dirs = makeWorkspace(t);
  // A hand-authored preset has no builder options; without a marker of its own it used to install
  // as an orphan the UI could neither show nor remove.
  const file = writeZip(path.join(dirs.out, 'handmade.awpreset'), {
    'manifest.json': manifest({ name: 'Handmade', author: 'Someone', description: 'By hand' }),
    'preset/index.html': INDEX_HTML,
    'preset/style.css': '.ach {}',
  });
  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);

  const installed = path.join(dirs.presets, 'Handmade');
  assert.equal(fs.existsSync(path.join(installed, 'aw-preset.json')), false, 'a hand-authored preset must not look editable');
  const marker = JSON.parse(fs.readFileSync(path.join(installed, presetPackage.PRESET_PACKAGE_FILE), 'utf8'));
  assert.equal(marker.name, 'Handmade');
  assert.equal(marker.author, 'Someone');
  assert.equal(marker.description, 'By hand');

  // The marker is bookkeeping, not content: it never travels inside the next package.
  const again = path.join(dirs.out, 'again.awpreset');
  assert.equal(presetPackage.exportPreset({ presetDir: installed, name: 'Handmade', destination: again, appVersion: APP_VERSION }).ok, true);
  const names = new AdmZip(again).getEntries().map((e) => e.entryName);
  assert.equal(names.includes(`preset/${presetPackage.PRESET_PACKAGE_FILE}`), false);
  assert.deepEqual(names.sort(), ['manifest.json', 'preset/index.html', 'preset/style.css']);
});

test('importing over a bundled preset asks instead of hiding it', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'shirow.awpreset'), { 'manifest.json': manifest({ name: 'Shirow' }), 'preset/index.html': INDEX_HTML });
  const bundled = ['Shirow', 'Default', 'PS5 enhanced'];

  // A preset installed here shadows the bundled one of the same name, so it counts as a duplicate
  // even though the folder is still empty.
  const asked = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, takenNames: bundled });
  assert.equal(asked.ok, false);
  assert.equal(asked.error, 'duplicate');
  assert.equal(asked.name, 'Shirow');
  assert.equal(asked.bundled, true, 'the caller cannot tell it is a bundled preset being shadowed');
  assert.deepEqual(fs.readdirSync(dirs.presets), []);

  // Keeping both must skip the bundled name too, not just the folders on disk.
  const kept = presetPackage.installPackage({
    file,
    presetsDir: dirs.presets,
    soundsDir: dirs.sounds,
    appVersion: APP_VERSION,
    duplicate: 'rename',
    takenNames: bundled,
  });
  assert.equal(kept.ok, true, kept.error);
  assert.equal(kept.name, 'Shirow (2)');
  assert.deepEqual(fs.readdirSync(dirs.presets), ['Shirow (2)']);
});

test('a duplicate name changes nothing until the caller decides', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'dup.awpreset'), { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML });

  const first = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(first.ok, true, first.error);
  fs.writeFileSync(path.join(dirs.presets, 'Shared Preset', 'index.html'), 'MINE', 'utf8');

  // Default: report the clash and leave the installed preset exactly as it was.
  const reported = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(reported.ok, false);
  assert.equal(reported.error, 'duplicate');
  assert.equal(reported.name, 'Shared Preset');
  assert.equal(fs.readFileSync(path.join(dirs.presets, 'Shared Preset', 'index.html'), 'utf8'), 'MINE');

  // Keep both.
  const renamed = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, duplicate: 'rename' });
  assert.equal(renamed.ok, true, renamed.error);
  assert.equal(renamed.name, 'Shared Preset (2)');
  assert.equal(fs.readFileSync(path.join(dirs.presets, 'Shared Preset', 'index.html'), 'utf8'), 'MINE');

  const again = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, duplicate: 'rename' });
  assert.equal(again.name, 'Shared Preset (3)');

  // Replace.
  const replaced = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, duplicate: 'replace' });
  assert.equal(replaced.ok, true, replaced.error);
  assert.equal(replaced.name, 'Shared Preset');
  assert.equal(replaced.replaced, true);
  assert.equal(fs.readFileSync(path.join(dirs.presets, 'Shared Preset', 'index.html'), 'utf8'), INDEX_HTML);
});

test('an import that fails leaves no trace and no half-installed preset', (t) => {
  const dirs = makeWorkspace(t);
  const good = writeZip(path.join(dirs.out, 'good.awpreset'), { 'manifest.json': manifest({ name: 'Keeper' }), 'preset/index.html': INDEX_HTML });
  assert.equal(presetPackage.installPackage({ file: good, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION }).ok, true);
  const before = fs.readFileSync(path.join(dirs.presets, 'Keeper', 'index.html'), 'utf8');

  // A package that only reveals its bad entry after several valid ones.
  const bad = writeZip(path.join(dirs.out, 'bad.awpreset'), {
    'manifest.json': manifest({ name: 'Keeper' }),
    'preset/index.html': INDEX_HTML,
    'preset/style.css': 'a{}',
    'preset/icon.png': 'png',
    'sounds/tune.wav': 'RIFF',
    'preset/../../escape.html': 'owned',
  });
  const res = presetPackage.installPackage({ file: bad, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, duplicate: 'replace' });
  assert.equal(res.ok, false);

  assert.equal(fs.readFileSync(path.join(dirs.presets, 'Keeper', 'index.html'), 'utf8'), before, 'the existing preset was damaged');
  assert.deepEqual(fs.readdirSync(dirs.presets), ['Keeper'], 'a staging folder or partial preset was left behind');
  assert.deepEqual(fs.readdirSync(dirs.sounds), [], 'a sound from a failed import was left behind');
  assert.equal(fs.existsSync(path.join(dirs.root, 'escape.html')), false);
});

test('a replace that cannot complete restores the preset it was replacing', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'r.awpreset'), { 'manifest.json': manifest({ name: 'Keeper' }), 'preset/index.html': INDEX_HTML });
  assert.equal(presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION }).ok, true);
  fs.writeFileSync(path.join(dirs.presets, 'Keeper', 'index.html'), 'ORIGINAL', 'utf8');

  // Break the final move: the swap is the only rename of a directory onto the destination.
  const realRename = fs.renameSync;
  let renames = 0;
  t.mock.method(fs, 'renameSync', (from, to) => {
    renames += 1;
    if (renames === 2) throw new Error('simulated-failure');
    return realRename(from, to);
  });

  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, duplicate: 'replace' });
  t.mock.restoreAll();

  assert.equal(res.ok, false);
  assert.equal(res.error, 'simulated-failure');
  assert.equal(fs.readFileSync(path.join(dirs.presets, 'Keeper', 'index.html'), 'utf8'), 'ORIGINAL', 'the replaced preset was lost');
  assert.deepEqual(fs.readdirSync(dirs.presets), ['Keeper']);
});

test('an imported sound never overwrites one the user already has', (t) => {
  const dirs = makeWorkspace(t);
  fs.writeFileSync(path.join(dirs.sounds, 'tune.wav'), 'MINE');
  const file = writeZip(path.join(dirs.out, 'sound.awpreset'), {
    'manifest.json': manifest({ sound: 'tune.wav' }),
    'preset/index.html': INDEX_HTML,
    'sounds/tune.wav': 'THEIRS',
  });

  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);
  assert.equal(fs.readFileSync(path.join(dirs.sounds, 'tune.wav'), 'utf8'), 'MINE');
  assert.deepEqual(res.sounds, ['tune (2).wav']);
  assert.equal(fs.readFileSync(path.join(dirs.sounds, 'tune (2).wav'), 'utf8'), 'THEIRS');

  // Importing the same package twice does not keep stacking copies of an identical file.
  const again = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION, duplicate: 'replace' });
  assert.equal(again.ok, true, again.error);
  assert.deepEqual(again.sounds, ['tune (2).wav']);
  assert.deepEqual(fs.readdirSync(dirs.sounds).sort(), ['tune (2).wav', 'tune.wav']);
});

test('a manifest cannot smuggle values past the builder clamps', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'clamp.awpreset'), {
    'manifest.json': manifest({ options: { bg: 'red; } body { display: none } .x {', width: 99999, opacity: 12, fontSize: -5 } }),
    'preset/index.html': INDEX_HTML,
  });
  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);

  const stored = JSON.parse(fs.readFileSync(path.join(dirs.presets, 'Shared Preset', 'aw-preset.json'), 'utf8'));
  assert.equal(stored.bg, '#16181d');
  assert.equal(stored.width, 620);
  assert.equal(stored.opacity, 1);
  assert.equal(stored.fontSize, 10);
});

test('a duplicated entry name in the archive is refused', (t) => {
  const dirs = makeWorkspace(t);
  // adm-zip keeps both records, so the reader has to notice rather than let the last one win.
  const zip = new AdmZip();
  zip.addFile('manifest.json', Buffer.from(manifest(), 'utf8'));
  zip.addFile('preset/index.html', Buffer.from(INDEX_HTML, 'utf8'));
  zip.addFile('preset/style.css', Buffer.from('a{}', 'utf8'));
  zip.getEntries()[2].entryName = 'preset/index.html';
  const file = path.join(dirs.out, 'dupe-entry.awpreset');
  zip.writeZip(file);

  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'duplicate-entry');
});

test('an oversized member is refused on its declared size, before it is decompressed', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'huge.awpreset'), { 'manifest.json': manifest(), 'preset/index.html': INDEX_HTML });

  // A zip bomb declares a small compressed size and an enormous uncompressed one.
  const zip = new AdmZip(file);
  zip.getEntry('preset/index.html').header.size = presetPackage.LIMITS.fileBytes + 1;
  const bomb = path.join(dirs.out, 'bomb.awpreset');
  zip.writeZip(bomb);

  const res = presetPackage.installPackage({ file: bomb, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'asset-too-large');
  assert.deepEqual(fs.readdirSync(dirs.presets), []);
});

test('every designed property survives the round trip, not just the eight the builder started with', (t) => {
  const dirs = makeWorkspace(t);
  const schema = require(path.join(appRoot, 'util', 'presetSchema.js'));

  // A design that moves every property off its default, built from the schema so a property added
  // later is covered here the day it exists.
  const design = {};
  for (const property of schema.PRESET_PROPERTIES) {
    if (property.type === 'number') design[property.key] = property.key === 'opacity' ? 0.4 : property.min + Math.round((property.max - property.min) / 3 / (property.step || 1)) * (property.step || 1);
    else if (property.type === 'select') design[property.key] = property.values[property.values.length - 1];
    else if (property.type === 'toggle') design[property.key] = !property.def;
    else if (property.type === 'color') design[property.key] = '#123456';
    else if (property.type === 'sound') design[property.key] = 'fanfare.wav';
  }
  const expected = schema.normalizeOptions(design);

  writeSourcePreset(dirs.source, { options: { name: 'Everything', ...expected } });
  const out = presetPackage.exportPreset({
    presetDir: dirs.source,
    name: 'Everything',
    destination: path.join(dirs.out, 'everything.awpreset'),
    options: expected,
    appVersion: APP_VERSION,
  });
  assert.equal(out.ok, true, out.error);

  const installed = presetPackage.installPackage({
    file: out.file,
    presetsDir: dirs.presets,
    soundsDir: dirs.sounds,
    appVersion: APP_VERSION,
  });
  assert.equal(installed.ok, true, installed.error);

  const stored = JSON.parse(fs.readFileSync(path.join(dirs.presets, 'Everything', 'aw-preset.json'), 'utf8'));
  for (const property of schema.PRESET_PROPERTIES) {
    assert.equal(stored[property.key], expected[property.key], `${property.key} did not survive the package round trip`);
  }
});

test('a preset that brings its own sound keeps pointing at the file that arrived with it', (t) => {
  const dirs = makeWorkspace(t);
  // The user already has a different sound under that name, so the import lands beside it — and the
  // preset has to follow, or it silently plays the sound it was never designed with.
  fs.writeFileSync(path.join(dirs.sounds, 'fanfare.wav'), 'MINE');
  const file = writeZip(path.join(dirs.out, 'sound-preset.awpreset'), {
    'manifest.json': manifest({ sound: 'fanfare.wav', options: { accent: '#00ff88', sound: 'fanfare.wav' } }),
    'preset/index.html': INDEX_HTML,
    'sounds/fanfare.wav': 'THEIRS',
  });

  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(res.sounds, ['fanfare (2).wav']);

  const stored = JSON.parse(fs.readFileSync(path.join(dirs.presets, 'Shared Preset', 'aw-preset.json'), 'utf8'));
  assert.equal(stored.sound, 'fanfare (2).wav', 'the preset still names the sound it did not get');
  // …and that is the sound the notification path will resolve for this preset.
  const customPreset = require(path.join(appRoot, 'util', 'customPreset.js'));
  assert.equal(customPreset.presetSound(path.join(dirs.presets, 'Shared Preset')), 'fanfare (2).wav');
});

test('a sound named in a manifest cannot become a path out of the sounds folder', (t) => {
  const dirs = makeWorkspace(t);
  const file = writeZip(path.join(dirs.out, 'evil-sound.awpreset'), {
    'manifest.json': manifest({ options: { sound: '../../../Windows/System32/evil.wav' } }),
    'preset/index.html': INDEX_HTML,
  });
  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);
  const stored = JSON.parse(fs.readFileSync(path.join(dirs.presets, 'Shared Preset', 'aw-preset.json'), 'utf8'));
  assert.equal(stored.sound, '', 'a traversal survived the clamp into the stored options');
});

test('a package from a build before presets carried a sound keeps the one it names', (t) => {
  const dirs = makeWorkspace(t);
  const customPreset = require(path.join(appRoot, 'util', 'customPreset.js'));

  /*
    Older builds recorded the sound a preset was designed with in `manifest.sound`, because options
    had no sound field yet. Reading only the options dropped it, so a preset shared from such a build
    silently fell back to whatever the recipient's Notifications tab was set to.
  */
  const file = writeZip(path.join(dirs.out, 'legacy-sound.awpreset'), {
    'manifest.json': manifest({ sound: 'Steam.wav', options: { bg: '#101010', accent: '#ff8800', width: 500 } }),
    'preset/index.html': INDEX_HTML,
  });

  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);

  const installed = path.join(dirs.presets, 'Shared Preset');
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed, 'aw-preset.json'), 'utf8')).sound, 'Steam.wav');
  assert.equal(customPreset.presetSound(installed), 'Steam.wav', 'the notification path cannot find the sound the package named');
});

test('a preset with no builder options still tells the app which sound it wants', (t) => {
  const dirs = makeWorkspace(t);
  const customPreset = require(path.join(appRoot, 'util', 'customPreset.js'));

  // A hand-authored preset has no options file at all, so its manifest is the only place its sound
  // can be recorded — and the only place the notification path can read it back from.
  const file = writeZip(path.join(dirs.out, 'handmade.awpreset'), {
    'manifest.json': manifest({ sound: 'Xbox.wav' }),
    'preset/index.html': INDEX_HTML,
  });
  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);

  const installed = path.join(dirs.presets, 'Shared Preset');
  assert.equal(fs.existsSync(path.join(installed, 'aw-preset.json')), false, 'a preset with no options must not become editable');
  assert.equal(customPreset.presetSound(installed), 'Xbox.wav');
});

test('the two bookkeeping filenames are spelled once', () => {
  // presetSound() reads both, so a second spelling in either module would make a preset's sound
  // readable by one of them and invisible to the other.
  const customPreset = require(path.join(appRoot, 'util', 'customPreset.js'));
  assert.equal(presetPackage.PRESET_PACKAGE_FILE, customPreset.PRESET_PACKAGE_FILE);
  assert.equal(customPreset.PRESET_PACKAGE_FILE, 'aw-package.json');
  const source = fs.readFileSync(path.join(appRoot, 'util', 'presetPackage.js'), 'utf8');
  assert.doesNotMatch(source, /const PRESET_PACKAGE_FILE = /, 'the manifest filename is declared twice');
});

test('a preset with no sound of its own is not given the exporter\u2019s', (t) => {
  const dirs = makeWorkspace(t);
  const customPreset = require(path.join(appRoot, 'util', 'customPreset.js'));

  /*
    The manifest also records the sound the preset was DESIGNED with, which is not the same as the
    sound it asks for. Options carrying an empty sound mean "use whatever the Notifications tab is
    set to" — inheriting the exporter's selection over that would pin a sound onto a preset that
    deliberately had no opinion, and an export/import round trip would make it permanent.
  */
  const file = writeZip(path.join(dirs.out, 'no-opinion.awpreset'), {
    'manifest.json': manifest({ sound: 'Steam Deck.wav', options: { accent: '#00ff88', sound: '' } }),
    'preset/index.html': INDEX_HTML,
  });
  const res = presetPackage.installPackage({ file, presetsDir: dirs.presets, soundsDir: dirs.sounds, appVersion: APP_VERSION });
  assert.equal(res.ok, true, res.error);

  const installed = path.join(dirs.presets, 'Shared Preset');
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed, 'aw-preset.json'), 'utf8')).sound, '');
  assert.equal(customPreset.presetSound(installed), '', 'an opinionless preset was pinned to a sound');
});
