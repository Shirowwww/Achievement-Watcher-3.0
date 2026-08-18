'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'electron', 'init.js'), 'utf8');

/*
  SteamGridDB lookups.

  "Staffer Retro : A Supernatural Mystery Quest" had a permanently blank tile because SteamGridDB
  files it under the shorter name "Staffer Retro", and the title matcher is deliberately strict -
  loosening it to a prefix rule would equally match "LEGO Batman" to "LEGO Batman: Legacy of the
  Dark Knight", and the in-code policy is that a wrong cover is worse than none.

  The way out is to stop matching titles when there is no need to: /games/steam/<appid> is an
  identity mapping. These tests pin that the identity path is preferred AND that the title matcher
  kept every bit of its strictness for the sources that have no Steam appid (Ubisoft, GOG, Epic).
*/

test('a Steam appid is resolved by identity, before any title is matched', () => {
  assert.match(source, /BASE_URL\}\/games\/steam\/\$\{encodeURIComponent\(id\)\}/, 'the by-appid endpoint must be used');
  const grids = source.slice(source.indexOf('async function fetchSteamGridDbGrids'), source.indexOf('async function fetchSteamGridDbCovers'));
  const identityAt = grids.indexOf('fetchSteamGridDbGameIdBySteamAppid');
  const searchAt = grids.indexOf('search/autocomplete');
  assert.ok(identityAt !== -1 && searchAt !== -1);
  assert.ok(identityAt < searchAt, 'the appid lookup must come before the title search');
  assert.match(grids, /if \(!gameId\) \{/, 'the title search must be the fallback, not the default');
});

test('the strict title matcher is unchanged - no prefix or subset rule crept in', () => {
  const picker = source.slice(source.indexOf('function pickSteamGridDbGame'), source.indexOf('function rankSteamGridDbGrids'));
  // An exact match, then "all query words present with at most one extra word". Nothing else.
  assert.match(picker, /tokens\.length - queryTokens\.length <= 1/);
  assert.doesNotMatch(picker, /startsWith|includes\(name\)|indexOf\(name\)/, 'a prefix rule would mismatch sequels and subtitled releases');
});

test('a network failure never poisons the appid cache', () => {
  const lookup = source.slice(source.indexOf('async function fetchSteamGridDbGameIdBySteamAppid'), source.indexOf('// Prefer an exact title match'));
  // The catch must bail out before the cache write below it, so an unreachable host leaves no
  // record behind and the next scan asks again. A cached "no such game" would be permanent.
  const catchStart = lookup.indexOf('} catch (err) {');
  const writeStart = lookup.indexOf('fs.mkdirSync(path.dirname(cacheFile)');
  assert.ok(catchStart !== -1 && writeStart !== -1 && catchStart < writeStart);
  const catchBody = lookup.slice(catchStart, writeStart);
  assert.match(catchBody, /return null;/, 'an unreachable host must leave the cache alone');
});

test('the covers cache is keyed on the appid as well as the title', () => {
  // The same title resolved by identity and by search can legitimately be different games.
  const expected = 'update(`${appid}' + String.fromCharCode(92) + '0${name.toLowerCase()}' + String.fromCharCode(92) + '0${orient}`)';
  assert.ok(source.includes(expected), 'the appid must be part of the covers cache key');
});

/*
  Every game asks SteamHunters for its achievement groups independently. When that host is
  unreachable the whole library used to pay the full 10s timeout each: a user's log shows 52
  consecutive "aborted due to timeout" lines spanning 70 seconds of one scan.
*/
test('a dead SteamHunters groups endpoint is not re-proven once per game', () => {
  assert.match(source, /function steamGroupsUnavailable\(\)/);
  assert.match(source, /if \(steamGroupsUnavailable\(\)\) return \{ ok: false, groups: \[\] \};/);
  assert.match(source, /STEAM_GROUPS_FAILURE_LIMIT = 3/);
  // An HTTP status is a real answer from a live host and must clear the breaker.
  const handler = source.slice(source.indexOf("if (type === 'steamgroups')"));
  const successAt = handler.indexOf('recordSteamGroupsSuccess()');
  const okCheckAt = handler.indexOf('if (!res.ok)');
  assert.ok(successAt !== -1 && successAt < okCheckAt, 'a reachable host clears the breaker even on an error status');
});
