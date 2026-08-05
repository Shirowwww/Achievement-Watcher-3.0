'use strict';

const assert = require('node:assert/strict');
const { after, test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Keep the sidecar cache inside a sandbox; CACHE_DIR is captured at require time.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rarity-'));
process.env.APPDATA = tmp;

const rarity = require('../app/util/rarity.js');
const { clearEpicIdentityCache } = require('../app/util/epicIdentity.js');

after(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function withFetchStub(impl, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = real;
  });
}

test('normalizeSteamBridgeName strips Ach_ and trailing numeric ids', () => {
  assert.equal(rarity.normalizeSteamBridgeName('Ach_12'), '12');
  assert.equal(rarity.normalizeSteamBridgeName('ACS_ACH_7'), '7');
  assert.equal(rarity.normalizeSteamBridgeName('ACH_WIN_ONE'), 'WIN_ONE');
  assert.equal(rarity.normalizeSteamBridgeName('PlainName'), 'PlainName');
  assert.equal(rarity.normalizeSteamBridgeName(''), '');
});

test('fetchSteamBridgeEntries maps Steam apinames onto native numeric ids', async () => {
  await withFetchStub(async () => {
    return {
      ok: true,
      json: async () => ({
        achievementpercentages: {
          achievements: [
            { name: 'Ach_12', percent: 3.2 },
            { name: 'ACS_ACH_7', percent: 9.9 },
            { name: 'no_digits', percent: 50 },
          ],
        },
      }),
    };
  }, async () => {
    const entries = await rarity.fetchSteamBridgeEntries('3159330', ['12', '7', 'missing']);
    assert.deepEqual(entries, [
      { name: '12', percent: 3.2 },
      { name: '7', percent: 9.9 },
    ]);
  });
});

test('getSteamBridgeRarity reuses a fresh sidecar without fetching', async () => {
  rarity.writeRarityCache('uplay-8006', [{ name: '1', percent: 4.4 }], 'steam');
  let fetched = 0;
  await withFetchStub(async () => {
    fetched += 1;
    throw new Error('must not fetch when the bridge cache is fresh');
  }, async () => {
    const entries = await rarity.getSteamBridgeRarity('uplay-8006', '3159330', ['1', '2']);
    assert.deepEqual(entries, [{ name: '1', percent: 4.4 }]);
    assert.equal(fetched, 0);
  });
});

test('getSteamBridgeRarity seeds the bridge cache when missing', async () => {
  await withFetchStub(async () => {
    return {
      ok: true,
      json: async () => ({
        achievementpercentages: {
          achievements: [{ name: 'ACH_1', percent: 12.5 }],
        },
      }),
    };
  }, async () => {
    const entries = await rarity.getSteamBridgeRarity('uplay-1234', '999999', ['1', '2']);
    assert.deepEqual(entries, [{ name: '1', percent: 12.5 }]);
    const cached = rarity.readRarityCache('uplay-1234');
    assert.equal(cached.source, 'steam-global-achievement-percentages');
    assert.deepEqual(cached.entries, [{ name: '1', percent: 12.5 }]);
  });
});

test('fetchEpicRarityByArtifactId resolves the real productId via egdata before fetching percentages', async () => {
  clearEpicIdentityCache();
  const calls = [];
  await withFetchStub(async (url) => {
    calls.push(String(url));
    if (String(url).includes('api.egdata.app/assets/')) {
      return { status: 200, json: async () => ({ artifactId: 'deadbeef', itemId: 'cid-real-product', namespace: 'ns-x' }) };
    }
    if (String(url).includes('api.egdata.app/items/')) {
      return { status: 200, json: async () => ({ title: 'X' }) };
    }
    assert.ok(url.includes('/product/cid-real-product/'), `expected the resolved catalogItemId in the percentages URL, got ${url}`);
    return { ok: true, json: async () => ({ achievements: [{ achievement: { name: 'A1', rarity: { percent: 42 } } }] }) };
  }, async () => {
    const entries = await rarity.fetchEpicRarityByArtifactId('deadbeef');
    assert.deepEqual(entries, [{ name: 'A1', percent: 42 }]);
  });
  assert.ok(calls.some((u) => u.includes('/product/cid-real-product/')), 'percentages must be fetched with the resolved productId');
});

test('fetchEpicRarityByArtifactId falls back to the raw id when identity resolution fails', async () => {
  clearEpicIdentityCache();
  await withFetchStub(async (url) => {
    if (String(url).includes('api.egdata.app/')) return { status: 500, json: async () => ({}) };
    assert.ok(url.includes('/product/deadc0de/'), `expected the raw id in the percentages URL, got ${url}`);
    return { ok: true, json: async () => ({ achievements: [] }) };
  }, async () => {
    const entries = await rarity.fetchEpicRarityByArtifactId('deadc0de');
    assert.deepEqual(entries, []);
  });
});

test('non-Steam sources never hit the Steam endpoint through getRarityEntries', async () => {
  await withFetchStub(async () => {
    throw new Error('must not fetch for cache-only sources');
  }, async () => {
    const entries = await rarity.getRarityEntries('ea-1', 'ea', {
      gameName: 'x',
      achievements: [],
    });
    assert.deepEqual(entries, []);
  });
});

test('resolveGameRarityContext reconciles every source to the right rarity path', () => {
  const emulatorSources = new Set(['RPCS3 Emulator', 'ShadPS4 Emulator', 'Xenia Emulator']);
  const base = (extra) => ({ appid: '0', source: 'Steam', achievement: { list: [{ name: 'a' }] }, ...extra });

  // Native Steam game → direct Steam percentages.
  assert.deepEqual(rarity.resolveGameRarityContext(base({ appid: '440' })), { kind: 'steam', appid: '440' });

  // Goldberg Uplay R2 keeps the Steam AppID and Steam API names → direct Steam percentages.
  assert.deepEqual(
    rarity.resolveGameRarityContext(base({ appid: '3159330', source: 'Uplay R2', system: 'uplay' })),
    { kind: 'steam', appid: '3159330' }
  );

  // Goldberg SocialClub uses a namespaced appid but the Steam schema of its resolved release.
  assert.deepEqual(
    rarity.resolveGameRarityContext(base({ appid: 'socialclub-gta-v', steamappid: '271590', source: 'Goldberg SocialClub' })),
    { kind: 'steam', appid: '271590' }
  );

  // Official Ubisoft Connect: namespaced appid + numeric ids → Steam↔id bridge.
  const ubi = rarity.resolveGameRarityContext(
    base({
      appid: 'uplay-8006',
      steamappid: '3159330',
      source: 'Ubisoft Connect',
      system: 'uplay',
      achievement: { list: [{ name: '1' }, { name: '2' }] },
    })
  );
  assert.equal(ubi.kind, 'steam-bridge');
  assert.equal(ubi.cacheId, 'uplay-8006');
  assert.equal(ubi.steamAppId, '3159330');
  assert.deepEqual(ubi.names, ['1', '2']);

  // Lumaplay with a resolved Steam counterpart → same bridge.
  assert.equal(
    rarity.resolveGameRarityContext(base({ appid: 'UPLAY8006', steamappid: '3159330', source: 'Lumaplay', system: 'uplay' })).kind,
    'steam-bridge'
  );

  // Epic with a Steam release borrows Steam percentages; Epic without keeps its own.
  assert.deepEqual(
    rarity.resolveGameRarityContext(base({ appid: 'epic-product', steamappid: '1097150', source: 'epic' })),
    { kind: 'steam', appid: '1097150' }
  );
  assert.equal(rarity.resolveGameRarityContext(base({ appid: 'epic-product', source: 'epic' })).kind, 'native');

  // GOG's numeric product id must NOT be mistaken for a Steam AppID.
  assert.equal(rarity.resolveGameRarityContext(base({ appid: '1423049311', source: 'GOG Galaxy' })).kind, 'native');
  assert.equal(rarity.resolveGameRarityContext(base({ appid: '1423049311', source: 'gog' })).kind, 'native');

  // Console emulators and Xbox keep their own paths.
  assert.equal(rarity.resolveGameRarityContext(base({ appid: 'NPUA12345', source: 'RPCS3 Emulator', system: 'playstation' }), { emulatorSources }).kind, 'emulator');
  assert.equal(rarity.resolveGameRarityContext(base({ source: 'Xbox PC' })).kind, 'xbox');

  // EA has no percentage source → hidden.
  assert.equal(rarity.resolveGameRarityContext(base({ appid: 'ea-game', source: 'ea', system: 'ea' })), null);

  // Malformed / achievement-less records never resolve.
  assert.equal(rarity.resolveGameRarityContext(null), null);
  assert.equal(rarity.resolveGameRarityContext({ appid: '440', source: 'Steam' }), null);
});
