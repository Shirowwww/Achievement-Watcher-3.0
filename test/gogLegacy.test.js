'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const gog = require('../app/parser/gog.js');
const request = require('../app/node_modules/request-zero');

test('legacy GOG discovery tolerates a missing or corrupt cache and a non-Steam release', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gog-legacy-'));
  const previousAppData = process.env.APPDATA;
  const realGetJson = request.getJson;

  try {
    process.env.APPDATA = temp;
    gog.setUserDataPath(temp);

    // The first-run cache is optional; callers must simply get no cached schema back.
    assert.equal(await gog.getCachedData({ appID: 'missing', lang: 'english' }), undefined);

    const cacheDir = path.join(temp, 'steam_cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'gog.db'), '{not valid json');
    assert.equal(await gog.getCachedData({ appID: 'broken', lang: 'english' }), undefined);

    const root = path.join(temp, 'NemirtingasGalaxyEmu', 'account');
    fs.mkdirSync(path.join(root, 'only-gog'), { recursive: true });
    fs.mkdirSync(path.join(root, 'with-steam'), { recursive: true });
    request.getJson = async (url) => {
      if (String(url).endsWith('/only-gog')) return { game: { releases: [{ platform_id: 'gog', external_id: 'only-gog' }] } };
      if (String(url).endsWith('/with-steam')) return { game: { releases: [{ platform_id: 'steam', external_id: '4242' }] } };
      throw new Error(`unexpected URL: ${url}`);
    };

    const games = await gog.scan();
    assert.deepEqual(games.map((game) => game.appid), ['4242']);
    assert.equal(path.normalize(games[0].data.path), path.normalize(path.join(root, 'with-steam')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cacheDir, 'gog.db'), 'utf8')), [{ gogid: 'with-steam', steamid: '4242' }]);
  } finally {
    request.getJson = realGetJson;
    process.env.APPDATA = previousAppData;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
