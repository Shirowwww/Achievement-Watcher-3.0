'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const epicIdentity = require('../app/util/epicIdentity.js');

function withFetchStub(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}

function jsonResponse(status, body) {
  return { status, json: async () => body };
}

test('resolveEpicArtifactIdentity rejects non-hex ids without a network call', async () => {
  await withFetchStub(
    async () => {
      throw new Error('must not fetch for a non-hex id');
    },
    async () => {
      assert.equal(await epicIdentity.resolveEpicArtifactIdentity('not-hex-id'), null);
      assert.equal(await epicIdentity.resolveEpicArtifactIdentity(''), null);
    }
  );
});

test('resolveEpicArtifactIdentity resolves namespace + catalogItemId + displayName from egdata', async () => {
  epicIdentity.clearEpicIdentityCache();
  const calls = [];
  await withFetchStub(
    async (url) => {
      calls.push(String(url));
      if (String(url).includes('/assets/')) {
        return jsonResponse(200, {
          artifactId: 'deadbeef',
          itemId: 'cid-123',
          namespace: 'ns-abc',
          platform: 'Windows',
        });
      }
      if (String(url).includes('/items/')) {
        return jsonResponse(200, { title: 'Some Great Game' });
      }
      throw new Error(`unexpected url ${url}`);
    },
    async () => {
      const identity = await epicIdentity.resolveEpicArtifactIdentity('deadbeef');
      assert.equal(identity.artifactId, 'deadbeef');
      assert.equal(identity.catalogItemId, 'cid-123');
      assert.equal(identity.namespace, 'ns-abc');
      assert.equal(identity.displayName, 'Some Great Game');
      assert.equal(calls.length, 2);
    }
  );
});

test('resolveEpicArtifactIdentity caches a positive result — second call does not refetch', async () => {
  epicIdentity.clearEpicIdentityCache();
  let calls = 0;
  await withFetchStub(
    async (url) => {
      calls++;
      if (String(url).includes('/assets/')) return jsonResponse(200, { artifactId: 'cafef00d', itemId: '', namespace: 'ns-x' });
      throw new Error('unexpected');
    },
    async () => {
      await epicIdentity.resolveEpicArtifactIdentity('cafef00d');
      await epicIdentity.resolveEpicArtifactIdentity('cafef00d');
      assert.equal(calls, 1, 'the second call should be served from cache');
    }
  );
});

test('resolveEpicArtifactIdentity returns null on a 404 (unknown artifact)', async () => {
  epicIdentity.clearEpicIdentityCache();
  await withFetchStub(
    async () => jsonResponse(404, {}),
    async () => {
      assert.equal(await epicIdentity.resolveEpicArtifactIdentity('abc123'), null);
    }
  );
});

test('resolveEpicArtifactIdentity ignores an asset tagged for a non-Windows platform', async () => {
  epicIdentity.clearEpicIdentityCache();
  await withFetchStub(
    async () => jsonResponse(200, { artifactId: 'abc123', platform: 'Mac' }),
    async () => {
      assert.equal(await epicIdentity.resolveEpicArtifactIdentity('abc123'), null);
    }
  );
});

test('resolveEpicArtifactIdentity guards against a mismatched asset payload', async () => {
  epicIdentity.clearEpicIdentityCache();
  await withFetchStub(
    async () => jsonResponse(200, { artifactId: 'someone-elses-id', platform: 'Windows' }),
    async () => {
      assert.equal(await epicIdentity.resolveEpicArtifactIdentity('abc123'), null);
    }
  );
});

test('resolveEpicArtifactIdentity still returns the identity when the item lookup fails', async () => {
  epicIdentity.clearEpicIdentityCache();
  await withFetchStub(
    async (url) => {
      if (String(url).includes('/assets/')) return jsonResponse(200, { artifactId: 'abc123', itemId: 'cid-1', namespace: 'ns-1' });
      if (String(url).includes('/items/')) return jsonResponse(500, {});
      throw new Error('unexpected');
    },
    async () => {
      const identity = await epicIdentity.resolveEpicArtifactIdentity('abc123');
      assert.equal(identity.namespace, 'ns-1');
      assert.equal(identity.catalogItemId, 'cid-1');
      assert.equal(identity.displayName, '');
    }
  );
});
