'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let steamDataCalls = 0;
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcRenderer: {
        sendSync: () => false,
        invoke: async () => {
          steamDataCalls++;
          return 'A Game';
        },
      },
    };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const steam = require('../../app/parser/steam.js');
// node_modules live in app/, so resolve the HTTP client the parser itself uses.
const request = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'request-zero'));

/*
  Steam retired ISteamApps/GetAppList - it answers 404 ("Method 'GetAppList' not found in interface
  'ISteamApps'") and no longer appears in GetSupportedAPIList. With no cached copy on disk the map
  therefore stays empty, which used to send every single appid back to the same dead endpoint: one
  wasted round trip per game on every scan, and the reason the first scan after clearing the cache
  dragged.
*/
test('a retired app-list endpoint is called once per session, not once per appid', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-applist-'));
  fs.mkdirSync(path.join(userData, 'logs'), { recursive: true });
  steam.initDebug({ isDev: false, userDataPath: userData });

  const originalGetJson = request.getJson;
  let attempts = 0;
  request.getJson = async (url) => {
    if (String(url).includes('GetAppList')) {
      attempts++;
      const err = new Error('Not Found');
      err.code = 404;
      throw err;
    }
    return originalGetJson(url);
  };

  try {
    const names = [];
    for (const appid of [4000, 391540, 1426210]) names.push(await steam.getAppNameByAppid(appid));

    assert.equal(attempts, 1, 'the dead endpoint must be tried once, not once per appid');
    assert.equal(steamDataCalls, 3, 'every appid still resolves through the store-data fallback');
    assert.deepEqual(names, ['A Game', 'A Game', 'A Game']);
  } finally {
    // The log stream stays open for the rest of the run, so the temp folder is left to the OS
    // rather than deleted out from under a pending write.
    request.getJson = originalGetJson;
  }
});
