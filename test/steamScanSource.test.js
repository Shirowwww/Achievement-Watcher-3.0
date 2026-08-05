'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const steam = require('../app/parser/steam.js');

function withEnv(values, fn) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    process.env[key] = values[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

// Regression (issue #12): a manually added custom folder whose name doesn't match any known
// emulator/scene layout (SmartSteamEmu, CODEX, RUNE, Goldberg, ...) still holds a real numeric-AppID
// save folder. It must be discovered with a readable source label, not `undefined` — an unset source
// downstream left the game with no consistent attribution.
test('steam.scan() attributes a readable source to an unrecognized custom folder', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-custom-scan-src-'));
  await withEnv(
    {
      APPDATA: path.join(tmp, 'AppData'),
      LOCALAPPDATA: path.join(tmp, 'LocalAppData'),
      PUBLIC: path.join(tmp, 'Public'),
      PROGRAMDATA: path.join(tmp, 'ProgramData'),
    },
    async () => {
      const customRoot = path.join(tmp, 'DOGE');
      fs.mkdirSync(path.join(customRoot, '2067050'), { recursive: true });
      fs.writeFileSync(path.join(customRoot, 'steam_id.txt'), '123', 'utf8');

      const found = await steam.scan([customRoot]);
      const entry = found.find((g) => g.appid === '2067050');
      assert.ok(entry, 'the numeric AppID subfolder must be discovered');
      assert.equal(entry.source, 'Steam-emulator');
      assert.notEqual(entry.source, undefined);
    }
  );

  fs.rmSync(tmp, { recursive: true, force: true });
});
