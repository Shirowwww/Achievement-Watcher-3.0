'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const uninstall = require(path.join(__dirname, '..', 'app', 'util', 'uninstall.js'));

function tempDir(prefix = 'aw-uninstall-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(dir, name) {
  fs.writeFileSync(path.join(dir, name), '');
  return path.join(dir, name);
}

test('detects an Inno Setup uninstaller with its .dat sibling', () => {
  const dir = tempDir();
  try {
    write(dir, 'unins000.exe');
    write(dir, 'unins000.dat');
    const found = uninstall.findUninstallers(dir);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].kind, 'inno');
    assert.strictEqual(found[0].name, 'unins000.exe');
    assert.strictEqual(found[0].file, path.join(dir, 'unins000.exe'));
    assert.ok(found[0].silent);
    assert.deepStrictEqual(found[0].args, ['/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES', `_?=${dir}`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an Inno-named exe without its .dat is treated as a generic uninstaller', () => {
  const dir = tempDir();
  try {
    write(dir, 'unins000.exe');
    const found = uninstall.findUninstallers(dir);
    assert.strictEqual(found.length, 1);
    assert.strictEqual(found[0].kind, 'generic');
    assert.deepStrictEqual(found[0].args, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detects NSIS and generic uninstaller names', () => {
  const dir = tempDir();
  try {
    write(dir, 'Uninstall.exe');
    write(dir, 'uninstaller_x64.exe');
    write(dir, 'Uninstaller.exe');
    const found = uninstall.findUninstallers(dir);
    const kinds = found.map((f) => `${f.kind}:${f.name.toLowerCase()}`);
    assert.ok(kinds.includes('nsis:uninstall.exe'));
    assert.ok(kinds.includes('nsis:uninstaller.exe'));
    assert.ok(kinds.includes('generic:uninstaller_x64.exe'));
    assert.deepStrictEqual(found[0].args, ['/S', `_?=${dir}`]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Inno uninstallers win over NSIS/generic ones', () => {
  const dir = tempDir();
  try {
    write(dir, 'unins000.exe');
    write(dir, 'unins000.dat');
    write(dir, 'Uninstall.exe');
    const best = uninstall.findLocalUninstaller(dir);
    assert.strictEqual(best.kind, 'inno');
    assert.strictEqual(best.name, 'unins000.exe');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('ignores non-uninstaller executables and missing folders', () => {
  const dir = tempDir();
  try {
    write(dir, 'game.exe');
    write(dir, 'setup.exe');
    write(dir, 'launcher.exe');
    assert.strictEqual(uninstall.findUninstallers(dir).length, 0);
    assert.strictEqual(uninstall.findUninstallers(path.join(dir, 'missing')).length, 0);
    assert.strictEqual(uninstall.findUninstallers(null).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('builds the Steam uninstall URI only for numeric appids', () => {
  assert.strictEqual(uninstall.steamUninstallUrl(480), 'steam://uninstall/480');
  assert.strictEqual(uninstall.steamUninstallUrl('123456'), 'steam://uninstall/123456');
  assert.strictEqual(uninstall.steamUninstallUrl('480 '), null);
  assert.strictEqual(uninstall.steamUninstallUrl('abc'), null);
  assert.strictEqual(uninstall.steamUninstallUrl(''), null);
  assert.strictEqual(uninstall.steamUninstallUrl(null), null);
  assert.strictEqual(uninstall.steamUninstallUrl(undefined), null);
});

test('trash-target safety gate rejects roots, files, save folders and missing paths', () => {
  const dir = tempDir();
  try {
    assert.ok(uninstall.isSafeTrashTarget(dir));

    const file = write(dir, 'dummy.exe');
    assert.strictEqual(uninstall.isSafeTrashTarget(file), false);
    assert.strictEqual(uninstall.isSafeTrashTarget(path.join(dir, 'nope')), false);
    assert.strictEqual(uninstall.isSafeTrashTarget(''), false);
    assert.strictEqual(uninstall.isSafeTrashTarget(null), false);

    const root = path.parse(dir).root;
    assert.strictEqual(uninstall.isSafeTrashTarget(root), false);

    const saveDir = path.join(dir, 'GSE Saves');
    fs.mkdirSync(saveDir);
    assert.strictEqual(uninstall.isSafeTrashTarget(saveDir), false);

    const nestedSave = path.join(dir, 'some game', 'Goldberg SteamEmu Saves');
    fs.mkdirSync(nestedSave, { recursive: true });
    assert.strictEqual(uninstall.isSafeTrashTarget(nestedSave), false);

    const desktop = path.join(dir, 'Desktop');
    fs.mkdirSync(desktop);
    assert.strictEqual(uninstall.isSafeTrashTarget(desktop), false);

    const downloads = path.join(dir, 'Downloads');
    fs.mkdirSync(downloads);
    assert.strictEqual(uninstall.isSafeTrashTarget(downloads), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registry helpers degrade gracefully without throwing', () => {
  const info = uninstall.getSteamUninstallInfo('480');
  assert.strictEqual(info.url, 'steam://uninstall/480');
  assert.ok(info.steamPath === null || typeof info.steamPath === 'string');
  assert.ok(info.installed === null || typeof info.installed === 'boolean');
  assert.strictEqual(uninstall.steamUninstallUrl('not-a-number'), null);
});
