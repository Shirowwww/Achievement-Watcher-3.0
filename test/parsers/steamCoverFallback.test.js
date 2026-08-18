'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const steam = require(path.join(__dirname, '..', '..', 'app', 'parser', 'steam.js'));

/*
  Library covers.

  Three users reported tiles that stayed blank for games SteamGridDB clearly has artwork for. The
  cause was not the lookup but WHERE it lived: the SteamDB -> SteamGridDB chain ran only inside
  getSteamDataFromSRV, which is the cache-MISS path. Once a schema was cached - with `portrait:
  null`, because product info happened to have no capsule that one time - every later scan went
  through GetMissingData, which re-asked product info and stopped there. The tile could never
  recover, on any number of rescans.

  These tests pin the chain itself and the fact that the repair path is wired to it.
*/

// Record the channels a resolution actually used, so ordering is asserted rather than assumed.
function recorder(answers) {
  const calls = [];
  return {
    calls,
    invoke: async (channel, ...args) => {
      calls.push(channel);
      const answer = answers[channel];
      return typeof answer === 'function' ? answer(...args) : answer;
    },
  };
}

test('a game with no product-info cover falls through SteamDB to SteamGridDB', async () => {
  const { calls, invoke } = recorder({
    'get-steamdb-cover': null, // the stealth-browser scrape came back empty (or could not launch)
    'get-steamgriddb-cover': 'https://cdn2.steamgriddb.com/grid/abc.png',
  });

  const portrait = await steam.resolvePortrait({ appid: 893180, name: 'Catherine Classic', portrait: null, invoke });

  assert.equal(portrait, 'https://cdn2.steamgriddb.com/grid/abc.png');
  assert.deepEqual(calls, ['get-steamdb-cover', 'get-steamgriddb-cover']);
});

test('SteamGridDB is not consulted when SteamDB already resolved the capsule', async () => {
  const { calls, invoke } = recorder({ 'get-steamdb-cover': 'https://cdn.st/library_600x900.jpg' });

  const portrait = await steam.resolvePortrait({ appid: 787480, name: 'Phoenix Wright', portrait: null, invoke });

  assert.equal(portrait, 'https://cdn.st/library_600x900.jpg');
  assert.deepEqual(calls, ['get-steamdb-cover']);
});

test('a product-info url that does not actually download is replaced, not trusted', async () => {
  // fetch-icon handing back the url it was given means nothing was cached: the guessable CDN path
  // is dead, which is exactly the case that used to leave a blank tile behind a truthy value.
  const dead = 'https://cdn.st/apps/1/library_600x900.jpg';
  const { calls, invoke } = recorder({
    'fetch-icon': dead,
    'get-steamdb-cover': null,
    'get-steamgriddb-cover': 'https://cdn2.steamgriddb.com/grid/real.png',
  });

  const portrait = await steam.resolvePortrait({ appid: 1, name: 'Some Game', portrait: dead, invoke });

  assert.equal(portrait, 'https://cdn2.steamgriddb.com/grid/real.png');
  assert.deepEqual(calls, ['fetch-icon', 'get-steamdb-cover', 'get-steamgriddb-cover']);
});

test('a product-info url that does download is kept, and costs no extra lookup', async () => {
  const live = 'https://cdn.st/apps/1/library_600x900.jpg';
  const { calls, invoke } = recorder({ 'fetch-icon': 'file:///cache/1/library_600x900.jpg' });

  const portrait = await steam.resolvePortrait({ appid: 1, name: 'Some Game', portrait: live, invoke });

  assert.equal(portrait, live);
  assert.deepEqual(calls, ['fetch-icon']);
});

test('a non-http value is a fetch-icon token and is returned untouched', async () => {
  const { calls, invoke } = recorder({});

  const portrait = await steam.resolvePortrait({ appid: 1, name: 'Some Game', portrait: 'library_600x900.jpg', invoke });

  assert.equal(portrait, 'library_600x900.jpg');
  assert.deepEqual(calls, [], 'a token must not trigger a network lookup');
});

test('the Steam appid is forwarded to SteamGridDB, which resolves by identity', async () => {
  /*
    SteamGridDB can be asked for a game by Steam appid outright, and that is not a guess: it is why
    "Staffer Retro : A Supernatural Mystery Quest" can reach artwork SteamGridDB files under the
    shorter name "Staffer Retro". The alternative - loosening the title matcher to a prefix rule -
    would equally have matched "LEGO Batman" to "LEGO Batman: Legacy of the Dark Knight", so the
    appid has to reach the handler for the strict matcher to stay strict.
  */
  const seen = [];
  const invoke = async (channel, ...args) => {
    seen.push([channel, args]);
    return channel === 'get-steamgriddb-cover' ? 'https://cdn2.steamgriddb.com/grid/by-id.png' : null;
  };

  const portrait = await steam.resolvePortrait({ appid: 3837350, name: 'Staffer Retro : A Supernatural Mystery Quest', portrait: null, invoke });

  assert.equal(portrait, 'https://cdn2.steamgriddb.com/grid/by-id.png');
  const sgdb = seen.find(([channel]) => channel === 'get-steamgriddb-cover');
  assert.deepEqual(sgdb[1], ['Staffer Retro : A Supernatural Mystery Quest', 3837350], 'the appid must be passed alongside the name');
});

test('a record with neither a name nor an appid asks nothing', async () => {
  const { calls, invoke } = recorder({ 'get-steamdb-cover': 'x' });

  assert.equal(await steam.resolvePortrait({ appid: '', name: '', portrait: null, invoke }), null);
  assert.deepEqual(calls, [], 'with no handle at all there is nothing to look up');
});

test('a nameless record can still be resolved from its appid alone', async () => {
  // Both remaining sources are keyed on the appid, so a missing title is no longer a dead end.
  const { calls, invoke } = recorder({ 'get-steamdb-cover': 'https://cdn.st/library_600x900.jpg' });

  assert.equal(await steam.resolvePortrait({ appid: 1, name: '', portrait: null, invoke }), 'https://cdn.st/library_600x900.jpg');
  assert.deepEqual(calls, ['get-steamdb-cover']);
});

test('the cached-schema repair path is wired to the same chain, on a retry stamp', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'parser', 'steam.js'), 'utf8');
  const body = source.slice(source.indexOf('async function GetMissingData'));

  assert.match(body, /resolvePortrait\(\{ appid: data\.appid, name: data\.name, portrait: null \}\)/, 'GetMissingData must run the full portrait chain, not just product info');
  // Without a stamp a genuinely cover-less game would re-run both lookups on every single scan.
  assert.match(body, /portraitCheckedAt/, 'the attempt must be remembered so a miss is not retried every scan');
});
