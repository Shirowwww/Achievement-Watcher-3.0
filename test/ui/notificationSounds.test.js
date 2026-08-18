'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sounds = require('../../app/util/notificationSounds.js');

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

/*
  "Random" is an entry in the sound list, not a switch beside it.

  Two controls describing one outcome is how the sound dropdown could read "Steam Deck" while every
  notification played something else, so the row is gone and the list carries the choice. That makes
  four things load-bearing, and none of them is visible from the other three:

    * the sentinel cannot look like a filename, or it could collide with a real sound;
    * the list has to offer it, labelled from the locale;
    * saving has to turn it back into the boolean the notification path actually reads;
    * nothing may try to PLAY the sentinel as if it were a file.
*/
test('the random sound is chosen from the sound list, not from a row of its own', () => {
  const root = path.join(__dirname, '..', '..', 'app');
  const settings = fs.readFileSync(path.join(root, 'ui', 'settings.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'view', 'app.html'), 'utf8');
  const loader = fs.readFileSync(path.join(root, 'locale', 'loader.js'), 'utf8');
  const schema = require('../../app/util/presetSchema.js');

  // The row is gone, everywhere.
  assert.doesNotMatch(html, /option_overlayRandomSound/, 'the standalone random-sound row is still in app.html');
  assert.doesNotMatch(settings, /option_overlayRandomSound/, 'ui/settings.js still reads the standalone random-sound row');
  assert.doesNotMatch(loader, /lbl-overlayRandomSound/, 'the locale loader still labels the removed row');

  // The sentinel can never be mistaken for a sound file.
  const sentinel = /const RANDOM_SOUND_VALUE = '([^']+)';/.exec(settings);
  assert.ok(sentinel, 'the random sentinel is gone');
  assert.doesNotMatch(sentinel[1], schema.SOUND_RE, `"${sentinel[1]}" would also validate as a sound filename`);

  // It is offered in the list, and labelled from the locale rather than hard-coded.
  assert.match(settings, /sel\.append\(\$\('<option>'\)\.attr\('value', RANDOM_SOUND_VALUE\)/, 'the sound list does not offer Random');
  assert.match(loader, /data-lang-random/, 'the Random label is never published to the sound select');
  assert.match(settings, /data-lang-random/, 'the sound list does not read the Random label');

  // Saving writes the flag the notification path reads, and never stores the sentinel as a filename.
  assert.match(settings, /app\.config\.overlay\.randomSound = chosenSound === RANDOM_SOUND_VALUE;/, 'picking Random no longer sets the flag');
  assert.match(
    settings,
    /app\.config\.overlay\.notificationSound = chosenSound === RANDOM_SOUND_VALUE \? '' : chosenSound;/,
    'the sentinel can still be saved as if it were a filename'
  );

  // Loading puts the selection back on Random.
  assert.match(settings, /cfgOverlay\.randomSound === true \? RANDOM_SOUND_VALUE :/, 'a saved Random choice does not come back selected');

  /*
    And the sentinel is never played as if it were a file - it is resolved to a real one first.

    Silencing it instead would have been the easy answer and the wrong one: Random is an entry in
    the list like any other, so previewing it, dragging the volume under it and firing a test with
    it all have to make a noise.
  */
  assert.match(settings, /function soundForPreview\(name\) \{[\s\S]*?if \(name !== RANDOM_SOUND_VALUE\) return name;/, 'the sentinel is not resolved to a real sound');
  assert.match(settings, /const file = resolveSoundFile\(soundForPreview\(name\)\);/, 'the sound preview does not resolve the sentinel');
  assert.match(settings, /const sound = soundForPreview\(\$\('#option_overlaySound'\)\.val\(\) \|\| ''\);/, 'a test notification does not resolve the sentinel');
  assert.match(settings, /previewSoundAtVolume\(\$\('#option_overlaySound'\)\.val\(\)\);/, 'the volume slider no longer previews the selected sound');
});

/*
  Bundled sounds are a curated list, not an archive: each one is offered to every user in the same
  dropdown, so one that does not belong is noise in the only place the choice is made.
*/
test('the bundled sound list carries only sounds that ship on purpose', () => {
  const dir = path.join(__dirname, '..', '..', 'app', 'sounds');
  const files = fs.readdirSync(dir).filter((name) => /\.(?:wav|mp3|ogg|flac|m4a|aac)$/i.test(name));
  assert.ok(files.length > 0, 'the bundled sound folder is empty');
  assert.ok(!files.includes('Indiana.wav'), 'Indiana.wav was removed from the bundled sounds');
});
