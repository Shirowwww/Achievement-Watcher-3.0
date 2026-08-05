'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-ubi-title-'));
process.env.APPDATA = tmp;
fs.mkdirSync(path.join(tmp, 'Achievement Watcher 3.0', 'logs'), { recursive: true });
process.on('exit', () => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

const ubi = require('../app/parser/ubisoftOfficial.js');

function writeConfigurations(content, name = 'configurations') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, content);
  return file;
}

// Shaped after a real %LOCALAPPDATA%\Ubisoft Game Launcher\cache\configuration\configurations:
// the game's own name lives in `installer: game_identifier:`, while `root: name:` is usually a
// localization key ("l1", "NAME") — or, for a storefront variant block, the storefront itself.
const GAME_BLOCK = [
  'version: 2.0',
  'root:',
  '  name: l1',
  "  sort_string: Far Cry 04",
  '  installer:',
  '    game_identifier: Far Cry 4',
  '    publisher: Ubisoft',
  '  uplay:',
  '    game_code: FC4',
  "    achievements: '971_spec'",
  '',
].join('\n');

// The block a title sold on Steam also gets. Its ONLY name is the storefront's, and it can appear
// before the real block in the file — which is how Far Cry 4 landed in the library titled "Steam"
// with no cover art (issue #7).
const STOREFRONT_BLOCK = [
  'version: 2.0',
  'root:',
  '  name: Steam',
  '  uplay:',
  "    achievements: '971_spec'",
  '',
].join('\n');

test('a storefront name is never used as a game title', () => {
  for (const launcher of ['Steam', 'steam', 'Ubisoft Connect', 'Rockstar Games Launcher', 'EA app', 'Epic Games', '']) {
    assert.equal(ubi._internal.isLauncherTitle(launcher), true, `"${launcher}" must be treated as a storefront`);
  }
  assert.equal(ubi._internal.isLauncherTitle('Far Cry 4'), false);
  assert.equal(ubi._internal.cleanTitle('Steam'), '');
  assert.equal(ubi._internal.cleanTitle('Far Cry 4'), 'Far Cry 4');

  const blocks = ubi._internal.readConfigurationsIndex(writeConfigurations(STOREFRONT_BLOCK, 'storefront-only'));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].title, '', 'a storefront-only block has no title at all');
});

test('blocks sharing one achievements spec are merged, storefront last', () => {
  // The storefront block is written FIRST on purpose: picking the first match was a coin flip that
  // decided whether the library showed "Far Cry 4" or "Steam" (issue #7).
  const file = writeConfigurations(`${STOREFRONT_BLOCK}${GAME_BLOCK}`, 'duplicate-spec');
  const blocks = ubi._internal.readConfigurationsIndex(file);
  assert.equal(blocks.length, 2, 'both blocks are indexed');

  const merged = ubi._internal.mergeConfigBlocks(blocks);
  assert.equal(merged.title, 'Far Cry 4', 'the real game name wins regardless of block order');
  assert.deepEqual(merged.storefronts, ['steam'], 'the storefront is remembered, not used as a title');

  // Reversed order must give the same answer.
  const reversed = ubi._internal.mergeConfigBlocks(ubi._internal.readConfigurationsIndex(writeConfigurations(`${GAME_BLOCK}${STOREFRONT_BLOCK}`, 'duplicate-spec-2')));
  assert.equal(reversed.title, 'Far Cry 4');

  assert.equal(ubi._internal.mergeConfigBlocks([]), null);
});

test('name candidates come from the game fields, never the storefront', () => {
  const block = ubi._internal.mergeConfigBlocks(ubi._internal.readConfigurationsIndex(writeConfigurations(`${STOREFRONT_BLOCK}${GAME_BLOCK}`, 'candidates')));
  // Only the game's own name. "l1" is a localization key, "Steam" a storefront, and sort_string
  // ("Far Cry 04") is a franchise-level shelf key that would confidently match the WRONG game.
  assert.deepEqual(ubi._internal.buildNameCandidates(block), ['Far Cry 4']);

  // Unresolved localization keys are not names: searching Steam for "l1" or "RELATED_GAMENAME_116"
  // would return a wrong match, which is worse than returning none.
  for (const key of ['l1', 'NAME', 'RELATED_GAMENAME_116', 'THUMBIMAGE_1', '']) {
    assert.equal(ubi._internal.isPlaceholderTitle(key), true, `"${key}" must be treated as a placeholder`);
  }
  assert.equal(ubi._internal.isPlaceholderTitle('UNO'), false, 'a genuinely all-caps title is kept');
  assert.equal(ubi._internal.isPlaceholderTitle('Far Cry 4'), false);
  assert.equal(ubi._internal.cleanTitle('l1'), '');
  assert.deepEqual(ubi._internal.specToWords('FarCry4'), ['far', 'cry', '4']);
  assert.deepEqual(ubi._internal.specToWords('971_spec'), [], 'a pure id is too ambiguous to search by');
  // Most specs are a content hash; splitting one into "words" gives digit soup that a fuzzy lookup
  // can still match to the wrong game.
  assert.deepEqual(ubi._internal.specToWords('e58f2672942d2a930e591c55f54f75c6'), []);
  assert.deepEqual(ubi._internal.specToWords('236f0da63e40e7ab42c813cc1f0926f0.zip'), []);
});

test('identity resolves from the install folder, with no name involved at all', async () => {
  // The strongest signal: Ubisoft Connect records where it installed the product, and that folder
  // is inside the Steam library for a Steam purchase. This works for a block that carries no
  // game name whatsoever, which is exactly the storefront-only case.
  ubi._internal.resetIdentityCache();
  const installs = [{ appid: '298110', name: 'Far Cry 4', dir: 'D:\\SteamLibrary\\steamapps\\common\\Far Cry 4' }];
  const identity = await ubi._internal.resolveIdentity(
    { appid: 'uplay-971', data: { uplayId: '971', title: '', configBlock: null } },
    {
      ubisoftInstallDir: () => 'D:/SteamLibrary/steamapps/common/Far Cry 4/',
      localSteamInstalls: installs,
      localSteamLibrary: [],
      findAppidByName: async () => null,
    }
  );
  assert.equal(identity.method, 'installdir');
  assert.equal(identity.steamAppId, '298110');
  assert.equal(identity.title, 'Far Cry 4');

  // Path matching is separator- and case-insensitive, and a nested library beats its parent.
  assert.equal(ubi._internal.matchSteamInstall('D:/SteamLibrary/steamapps/common/Far Cry 4', installs), '298110');
  assert.equal(ubi._internal.matchSteamInstall('D:\\SteamLibrary\\steamapps\\common\\Far Cry 4\\bin', installs), '298110');
  assert.equal(ubi._internal.matchSteamInstall('D:\\Elsewhere\\Far Cry 4', installs), '');
  assert.equal(ubi._internal.matchSteamInstall('', installs), '');
});

test('identity falls back to the local Steam library, then to the catalog, by name', async () => {
  const block = ubi._internal.mergeConfigBlocks(ubi._internal.readConfigurationsIndex(writeConfigurations(`${STOREFRONT_BLOCK}${GAME_BLOCK}`, 'fallbacks')));

  ubi._internal.resetIdentityCache();
  const fromLibrary = await ubi._internal.resolveIdentity(
    { appid: 'uplay-971', data: { uplayId: '971', title: '', configBlock: block } },
    { ubisoftInstallDir: () => '', localSteamInstalls: [], localSteamLibrary: [{ appid: 298110, name: 'Far Cry 4' }], findAppidByName: async () => null }
  );
  assert.equal(fromLibrary.method, 'library');
  assert.equal(fromLibrary.steamAppId, '298110');
  assert.equal(fromLibrary.title, 'Far Cry 4');

  ubi._internal.resetIdentityCache();
  const fromCatalog = await ubi._internal.resolveIdentity(
    { appid: 'uplay-971', data: { uplayId: '971', title: '', configBlock: block } },
    {
      ubisoftInstallDir: () => '',
      localSteamInstalls: [],
      localSteamLibrary: [],
      findAppidByName: async (name) => (String(name).toLowerCase().includes('far cry') ? '298110' : null),
    }
  );
  assert.equal(fromCatalog.method, 'name');
  assert.equal(fromCatalog.steamAppId, '298110');
  assert.equal(fromCatalog.title, 'Far Cry 4');
});

test('the local Steam library reader understands the real VDF/ACF layout', async () => {
  assert.deepEqual(
    ubi._internal.parseSteamVdfLibraryFolders('"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"D:\\\\Games\\\\SteamLibrary"\n\t}\n}'),
    ['D:\\Games\\SteamLibrary']
  );
  assert.deepEqual(
    ubi._internal.parseSteamAppManifest('"AppState"\n{\n\t"appid"\t\t"298110"\n\t"name"\t\t"Far Cry 4"\n\t"installdir"\t\t"Far Cry 4"\n}'),
    { appid: '298110', name: 'Far Cry 4', installDir: 'Far Cry 4' }
  );

  // End-to-end off a fake Steam install on disk: names AND install folders are indexed.
  const fakeSteam = path.join(tmp, 'Steam');
  fs.mkdirSync(path.join(fakeSteam, 'steamapps'), { recursive: true });
  fs.writeFileSync(path.join(fakeSteam, 'steam.exe'), '');
  fs.writeFileSync(
    path.join(fakeSteam, 'steamapps', 'libraryfolders.vdf'),
    '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"' + fakeSteam.replace(/\\/g, '\\\\') + '"\n\t}\n}'
  );
  fs.writeFileSync(
    path.join(fakeSteam, 'steamapps', 'appmanifest_298110.acf'),
    '"AppState"\n{\n\t"appid"\t\t"298110"\n\t"name"\t\t"Far Cry 4"\n\t"installdir"\t\t"Far Cry 4"\n}'
  );

  const installs = await ubi._internal.loadLocalSteamInstalls({ steamPath: fakeSteam });
  assert.equal(installs.length, 1);
  assert.equal(installs[0].appid, '298110');
  assert.equal(installs[0].dir, path.join(fakeSteam, 'steamapps', 'common', 'Far Cry 4'));

  ubi._internal.resetIdentityCache();
  const fromDisk = await ubi._internal.resolveIdentity(
    { appid: 'uplay-971', data: { uplayId: '971', title: '', configBlock: null } },
    { steamPath: fakeSteam, ubisoftInstallDir: () => path.join(fakeSteam, 'steamapps', 'common', 'Far Cry 4'), findAppidByName: async () => null }
  );
  assert.equal(fromDisk.method, 'installdir');
  assert.equal(fromDisk.steamAppId, '298110');
});

test('an unresolvable product stays anonymous instead of becoming "Steam"', async () => {
  ubi._internal.resetIdentityCache();
  const anonymous = await ubi._internal.resolveIdentity(
    { appid: 'uplay-999999', data: { uplayId: '999999', title: '', configBlock: null } },
    { ubisoftInstallDir: () => '', localSteamInstalls: [], localSteamLibrary: [], findAppidByName: async () => null }
  );
  assert.equal(anonymous.title, '');
  assert.equal(anonymous.steamAppId, '');
  assert.equal(anonymous.method, '');
});
