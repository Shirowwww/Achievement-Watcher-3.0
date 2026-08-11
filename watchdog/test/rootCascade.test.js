'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  scanRootOnce,
  getStrictRootProfile,
  isAppIdName,
  shouldIgnoreDiscoveredId,
} = require('../util/rootCascade.js');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rootcascade-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('numeric appid folder is discovered as a generic Steam-emu root', async () => {
  const dir = fixture();
  try {
    fs.mkdirSync(path.join(dir, '12345'), { recursive: true });
    const result = await scanRootOnce(dir);
    assert.equal(result.platform, 'steam-emu');
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].options.appid, '12345');
  } finally {
    cleanup(dir);
  }
});

test('goggame .info is detected with appid and launch metadata', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(
      path.join(dir, 'goggame-1421404671.info'),
      JSON.stringify({
        gameId: 1421404671,
        rootGameId: 1421404671,
        name: 'My GOG Game',
        playTasks: [{ path: 'bin/game.exe', isPrimary: true, category: 'game', type: 'filetask' }],
      }),
    );
    const result = await scanRootOnce(dir);
    assert.equal(result.platform, 'gog');
    assert.equal(result.entries[0].options.appid, '1421404671');
    assert.equal(
      result.entries[0].options.launchMetadata.executable,
      path.join(dir, 'bin', 'game.exe'),
    );
  } finally {
    cleanup(dir);
  }
});

test('tenoke.ini is detected when there is no numeric appid folder', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'tenoke.ini'), '[TENOKE]\nid = 98765\n');
    const result = await scanRootOnce(dir);
    assert.equal(result.platform, 'tenoke');
    assert.equal(result.entries[0].options.appid, '98765');
  } finally {
    cleanup(dir);
  }
});

test('UniverseLAN.ini is detected with the appid from GameSettings', async () => {
  const dir = fixture();
  try {
    fs.writeFileSync(path.join(dir, 'UniverseLAN.ini'), '[GameSettings]\nAppID = 4242\n');
    const result = await scanRootOnce(dir);
    assert.equal(result.platform, 'universe-lan');
    assert.equal(result.entries[0].options.appid, '4242');
  } finally {
    cleanup(dir);
  }
});

test('Steam appcache stats root is detected with schema bins', async () => {
  const dir = fixture();
  try {
    const stats = path.join(dir, 'Steam', 'appcache', 'stats');
    fs.mkdirSync(stats, { recursive: true });
    fs.writeFileSync(path.join(stats, 'UserGameStatsSchema_480.bin'), 'x');
    const result = await scanRootOnce(stats);
    assert.equal(result.platform, 'steam-official');
    assert.equal(result.entries[0].options.appid, '480');
  } finally {
    cleanup(dir);
  }
});

test('strict root profile matches RLD! and CODEX save roots', () => {
  assert.equal(getStrictRootProfile('C:\\Public\\Documents\\Steam\\RLD!').key, 'steam-rld');
  assert.equal(getStrictRootProfile('C:\\Public\\Documents\\Steam\\CODEX').key, 'steam-codex');
});

test('appid validation rejects padding and user ids', () => {
  assert.equal(isAppIdName('0000123'), false); // 4+ leading zeros
  assert.equal(isAppIdName('1'), false); // single character
  assert.equal(isAppIdName('12345'), true);
  assert.equal(shouldIgnoreDiscoveredId('76561198000000000'), true); // SteamID64
});
