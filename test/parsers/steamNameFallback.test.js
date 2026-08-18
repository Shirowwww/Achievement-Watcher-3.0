'use strict';

/*
  Where the numeric titles came from (issue #34).

  getGameData resolves a game through two INDEPENDENT lookups: findInAppList(), which answers with
  the canonical store name, and getSteamDataFromSRV(), which fetches product info, artwork and the
  achievement schema. The first one's answer was used as a boolean ("is this appid real?") and then
  thrown away, so when the second came back without a name the entry kept no title at all - and the
  layer above rendered the appid. Artwork still appeared, because Steam's CDN paths are built from
  the appid alone, which is exactly the "artwork resolved, name did not" the report describes.
*/

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Answers for the main-process IPC, swapped per test.
let steamData = {};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcRenderer: {
        sendSync: () => false,
        invoke: async (channel, payload) => {
          if (channel !== 'get-steam-data') return null;
          const type = (payload && payload.type) || '';
          const answer = steamData[type];
          return typeof answer === 'function' ? answer(payload) : answer;
        },
      },
    };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const steam = require('../../app/parser/steam.js');

// One user-data root for the file: the app-list map is built once per process, so every appid this
// suite needs has to be in the dump written here.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-name-'));
fs.mkdirSync(path.join(userData, 'steam_cache', 'schema'), { recursive: true });
fs.writeFileSync(
  path.join(userData, 'steam_cache', 'schema', 'appList.json'),
  JSON.stringify([
    { appid: 3768760, name: '007 First Light' },
    { appid: 2012840, name: 'Portal with RTX' },
  ])
);
steam.initDebug({ isDev: false, userDataPath: userData });

const schemaFile = (appid) => path.join(userData, 'steam_cache', 'schema', 'english', `${appid}.db`);

function load(appid) {
  return steam.getGameData({ appID: appid, lang: 'english', showHidden: false, fastStart: true });
}

test('a nameless product-info response no longer costs the game its title', async () => {
  // Exactly the field case: product info answers, but with no name in it.
  steamData = { common: {}, steamhunters: { achievements: [] } };

  const game = await load(2012840);
  assert.ok(game, 'the game must still resolve');
  assert.equal(game.name, 'Portal with RTX', 'the name the app-list lookup already had must be used');
  assert.notEqual(String(game.name), '2012840', 'the appid is not a title');
});

test('the recovered title is written to the schema cache like any other', async () => {
  steamData = { common: {}, steamhunters: { achievements: [] } };

  await load(3768760);
  const cached = JSON.parse(fs.readFileSync(schemaFile(3768760), 'utf8'));
  assert.equal(cached.name, '007 First Light');
});

test('product info still wins when it does answer with a name', async () => {
  // The app-list dump is a fallback, never an override: it is stale by construction.
  steamData = {
    common: { name: 'Portal with RTX (2024)', isGame: true, header: 'header', icon: 'icon' },
    steamhunters: { achievements: [] },
    steamgroups: { ok: false, groups: [] },
  };
  fs.rmSync(schemaFile(2012840), { force: true });

  const game = await load(2012840);
  assert.equal(game.name, 'Portal with RTX (2024)');
});

test('an appid nothing can name is still reported as unresolved, not invented', async () => {
  // Absent from the dump and the per-appid name lookup answers nothing: this really is a miss, and
  // it must keep failing loudly rather than being papered over with a title.
  steamData = { common: {}, steamhunters: { achievements: [] }, name: '' };

  const game = await load(111222333);
  assert.equal(game, undefined, 'an unresolvable appid returns nothing, as before');
  assert.equal(fs.existsSync(schemaFile(111222333)), false, 'and nothing nameless is left in the cache');
});
