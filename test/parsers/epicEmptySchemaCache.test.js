'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const epicOfficial = require('../../app/parser/epicOfficial.js');

/*
  Fortnite (sandbox "fn") was re-queried on every single scan, forever.

  Epic answers that sandbox with HTTP 200 and a record whose every field is null: no achievements,
  no error. The resolver only ever cached a non-empty schema, so an empty answer wrote nothing and
  the next scan asked again. The distinction that fixes it is already available at the call site -
  whether Epic answered at all - so an answered-but-empty result is now cached like any other, while
  a transport failure still retries.
*/

function sandboxResponse(record) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { Achievement: { productAchievementsRecordBySandbox: record } } }),
  };
}

function withStubbedFetch(handler, run) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      globalThis.fetch = original;
    });
}

function sandboxRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-epic-empty-'));
  epicOfficial.setUserDataPath(dir);
  return dir;
}

test('an answered-but-empty sandbox is cached, so it is asked once and not once per scan', async () => {
  const root = sandboxRoot();
  let calls = 0;
  // Exactly the shape Epic returns for "fn": a record, but nothing in it.
  const empty = { productId: null, sandboxId: null, totalAchievements: null, achievements: null };
  await withStubbedFetch(
    async () => {
      calls++;
      return sandboxResponse(empty);
    },
    async () => {
      assert.equal(await epicOfficial._internal.resolveSchema('fn', 'english'), null);
      assert.equal(calls, 1);
      assert.equal(await epicOfficial._internal.resolveSchema('fn', 'english'), null);
      assert.equal(await epicOfficial._internal.resolveSchema('fn', 'english'), null);
      assert.equal(calls, 1, 'the empty answer must be served from cache');
    }
  );

  const cached = fs.readdirSync(path.join(root, 'steam_cache', 'epicOfficial'));
  assert.equal(cached.length, 1, 'the empty answer must be written to disk');
});

test('an unreachable Epic is not cached, so the next scan retries', async () => {
  sandboxRoot();
  let calls = 0;
  await withStubbedFetch(
    async () => {
      calls++;
      throw new Error('getaddrinfo ENOTFOUND api.epicgames.dev');
    },
    async () => {
      assert.equal(await epicOfficial._internal.resolveSchema('offline-sandbox', 'english'), null);
      assert.equal(await epicOfficial._internal.resolveSchema('offline-sandbox', 'english'), null);
      assert.equal(calls, 2, 'a network failure is not an answer and must be retried');
    }
  );
});

test('an empty answer never erases a schema that resolved earlier', async () => {
  const root = sandboxRoot();
  const populated = {
    productId: 'product-1',
    sandboxId: 'sb',
    achievements: [{ achievement: { name: 'ACH_1', unlockedDisplayName: 'First', hidden: false } }],
  };
  let record = populated;
  await withStubbedFetch(
    async () => sandboxResponse(record),
    async () => {
      const first = await epicOfficial._internal.resolveSchema('sb', 'english');
      assert.equal(first.list.length, 1);

      // Age the cache past its TTL so the next call really refetches, then answer empty - an Epic
      // hiccup must not be able to replace a schema that is known to exist.
      const cacheFile = path.join(root, 'steam_cache', 'epicOfficial', 'sb_en.json');
      assert.ok(fs.existsSync(cacheFile), cacheFile);
      const expired = new Date(Date.now() - 48 * 60 * 60 * 1000);
      fs.utimesSync(cacheFile, expired, expired);

      record = { productId: null, sandboxId: null, achievements: null };
      const second = await epicOfficial._internal.resolveSchema('sb', 'english');
      assert.equal(second.list.length, 1, 'the previously resolved schema must survive');
    }
  );
});
