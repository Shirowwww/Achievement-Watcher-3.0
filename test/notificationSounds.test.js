'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sounds = require('../app/util/notificationSounds.js');

function makeDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sounds-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

test('lists supported formats including flac/m4a/aac', () => {
  const dir = makeDir(['a.wav', 'b.mp3', 'c.ogg', 'd.flac', 'e.m4a', 'f.aac', 'notes.txt', 'g.WAV']);
  const list = sounds.listSoundFiles([dir]);
  const names = list.map((x) => x.name).sort();
  assert.deepEqual(names, ['a.wav', 'b.mp3', 'c.ogg', 'd.flac', 'e.m4a', 'f.aac', 'g.WAV']);
});

test('user dir shadows bundled dir of the same name', () => {
  const bundled = makeDir(['x.wav', 'y.ogg']);
  const user = makeDir(['x.wav']);
  const list = sounds.listSoundFiles([bundled, user]);
  const x = list.find((s) => s.name === 'x.wav');
  assert.equal(x.file, path.join(user, 'x.wav'));
  assert.equal(list.length, 2);
});

test('pickRandomSound returns an existing file and handles empty dirs', () => {
  const dir = makeDir(['only.flac', 'only.m4a']);
  for (let i = 0; i < 20; i++) {
    const picked = sounds.pickRandomSound([dir]);
    assert.ok(picked.startsWith(dir));
    assert.ok(fs.existsSync(picked));
  }
  assert.equal(sounds.pickRandomSound([makeDir([])]), '');
});
