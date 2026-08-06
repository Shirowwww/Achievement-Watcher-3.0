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

const achievements = require('../app/parser/achievements.js');

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
