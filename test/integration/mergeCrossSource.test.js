'use strict';

const assert = require('node:assert/strict');
const Module = require('module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcRenderer: {
        sendSync: () => false,
        invoke: async () => null,
      },
    };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../../app/parser/achievements.js');

test('mergeDuplicate merges a Ubisoft product into its mapped Steam release', () => {
  const steam = {
    appid: '3751950',
    source: 'Steam (Miza)',
    data: { type: 'steamAPI', userID: '76561199129454711' },
  };
  const uplay = {
    appid: 'uplay-66088',
    source: 'Ubisoft Connect',
    data: { type: 'ubisoftOfficial', uplayId: '66088', spoolFilePath: 'C:\\spool\\66088.spool' },
  };
  const merged = achievements._internal.mergeCrossSourceDuplicates([uplay, steam]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].appid, '3751950');
  const sources = merged[0]._sources || [merged[0]];
  assert.ok(
    sources.some((s) => String(s.appid) === '3751950' && s.data.type === 'steamAPI'),
    'the Steam source survives'
  );
  assert.ok(
    sources.some((s) => String(s.appid) === 'uplay-66088' && s.data.type === 'ubisoftOfficial'),
    'the Ubisoft spool source is merged in so its unlocks feed the same tile'
  );
});

test('mergeDuplicate keeps an unmapped Ubisoft product separate', () => {
  const unknown = {
    appid: 'uplay-999999',
    source: 'Ubisoft Connect',
    data: { type: 'ubisoftOfficial', uplayId: '999999' },
  };
  const merged = achievements._internal.mergeCrossSourceDuplicates([unknown]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appid, 'uplay-999999');
});

test('a GOG game dedupes a same-name Steam save phantom (Cyberpunk case)', () => {
  const gog = {
    appid: '1423049311',
    source: 'GOG Galaxy',
    data: { type: 'gogOfficial', title: 'Cyberpunk 2077', gameplayDbPath: 'C:\\gog\\gameplay.db' },
  };
  const steamPhantom = {
    appid: '1091500',
    name: 'Cyberpunk 2077',
    source: 'CODEX',
    data: { type: 'file', path: 'C:\\Users\\Public\\Documents\\Steam\\CODEX\\1091500' },
  };
  const merged = achievements._internal.mergeCrossSourceDuplicates([gog, steamPhantom]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].appid, '1423049311');
});

test('the dedupe does not depend on the order discovery happens to emit records in', () => {
  // The phantom is dropped while walking the list, so when it came BEFORE the GOG record it had
  // already been kept and both tiles survived. Discovery order is not stable: the same library
  // deduped correctly one day and showed two Cyberpunk 2077 tiles the next.
  const gog = {
    appid: '1423049311',
    source: 'GOG Galaxy',
    data: { type: 'gogOfficial', title: 'Cyberpunk 2077', gameplayDbPath: 'C:\\gog\\gameplay.db' },
  };
  const steamPhantom = {
    appid: '1091500',
    name: 'Cyberpunk 2077',
    source: 'CODEX',
    data: { type: 'file', path: 'C:\\Users\\Public\\Documents\\Steam\\CODEX\\1091500' },
  };
  const clone = (record) => JSON.parse(JSON.stringify(record));

  for (const [label, list] of [
    ['phantom first', [steamPhantom, gog]],
    ['GOG first', [gog, steamPhantom]],
  ]) {
    const merged = achievements._internal.mergeCrossSourceDuplicates(list.map(clone));
    assert.equal(merged.length, 1, `${label}: exactly one tile`);
    assert.equal(String(merged[0].appid), '1423049311', `${label}: the GOG install is the survivor`);
  }

  // Unrelated records must not be disturbed, whatever their position around the dropped one.
  const other = { appid: '367520', source: 'Goldberg', data: { type: 'file', path: 'C:\\x' } };
  const withNeighbours = achievements._internal.mergeCrossSourceDuplicates([other, steamPhantom, gog].map(clone));
  assert.deepEqual(withNeighbours.map((g) => String(g.appid)), ['367520', '1423049311']);
});

test('a GOG game keeps a genuinely installed Steam copy', () => {
  const gog = {
    appid: '1423049311',
    source: 'GOG Galaxy',
    data: { type: 'gogOfficial', title: 'Cyberpunk 2077', gameplayDbPath: 'C:\\gog\\gameplay.db' },
  };
  const steamInstalled = {
    appid: '1091500',
    name: 'Cyberpunk 2077',
    source: 'Steam',
    data: { type: 'steamAPI', gameDir: 'C:\\Jeux\\Cyberpunk 2077', userID: 'x' },
  };
  const merged = achievements._internal.mergeCrossSourceDuplicates([gog, steamInstalled]);
  assert.equal(merged.length, 2);
});

test('official launcher and library-name helpers are exposed for the scanner', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-merge-official-'));
  try {
    const dir = path.join(tmp, 'Legit Epic Game');
    fs.mkdirSync(path.join(dir, '.egstore'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'Game.exe'), Buffer.alloc(16, 1));
    assert.equal(achievements._internal.isOfficialLauncherInstall(dir), true);
    assert.equal(achievements._internal.isLibraryLikeFolderName('Jeux'), true);
    assert.equal(achievements._internal.isLibraryLikeFolderName('Desktop'), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    Module._load = originalLoad;
  }
});
