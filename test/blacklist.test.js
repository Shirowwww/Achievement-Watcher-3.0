'use strict';

// Standalone test (run via: node --test "../test/*.test.js").
// Characterizes blacklist.get()'s merge/dedup of the built-in AppIDs + the server bogus-list +
// the user exclusion file, and its graceful fallback when the server fetch fails. request-zero
// is stubbed (the same cached instance the parser holds) so the test stays offline/deterministic.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const blacklist = require(path.join(__dirname, '..', 'app', 'parser', 'blacklist.js'));
// Resolve request-zero from app/node_modules so it is the *same* cached module object the parser
// uses (Node keys the module cache by absolute path) — patching .getJson then affects the parser.
const request = require(path.join(__dirname, '..', 'app', 'node_modules', 'request-zero'));
const realGetJson = request.getJson;

const BUILTIN = [480, 753, 250820, 228980];

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL - ${name}\n         ${e.message}`);
    process.exitCode = 1;
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-blacklist-'));

(async () => {
  fs.mkdirSync(path.join(temp, 'cfg'), { recursive: true });
  fs.mkdirSync(path.join(temp, 'logs'), { recursive: true });
  blacklist.initDebug({ isDev: false, userDataPath: temp });

  const exclusionFile = path.join(temp, 'cfg', 'exclusion.db');

  try {
    await test('merges built-in + server + user lists, deduped', async () => {
      request.getJson = async () => ({ data: [100, 200, 480] }); // 480 overlaps a built-in
      fs.writeFileSync(exclusionFile, JSON.stringify([200, 300])); // 200 overlaps the server list
      const res = await blacklist.get();
      for (const id of [...BUILTIN, 100, 200, 300]) assert.ok(res.includes(id), `missing ${id}`);
      assert.strictEqual(new Set(res).size, res.length, 'result must not contain duplicates');
    });

    await test('server fetch failure → still returns built-in + user list', async () => {
      request.getJson = async () => {
        throw new Error('offline');
      };
      const res = await blacklist.get();
      for (const id of [...BUILTIN, 200, 300]) assert.ok(res.includes(id), `missing ${id}`);
    });

    await test('no user exclusion file → built-in + server only', async () => {
      fs.rmSync(exclusionFile, { force: true });
      request.getJson = async () => ({ data: [777] });
      const res = await blacklist.get();
      for (const id of [...BUILTIN, 777]) assert.ok(res.includes(id), `missing ${id}`);
      assert.ok(!res.includes(300), 'a removed user id should no longer appear');
    });

    await test('stores display names and restores one game without clearing the others', async () => {
      await blacklist.add(9001, 'First hidden game');
      await blacklist.add('9001', 'Updated hidden game');
      await blacklist.add(9002, 'Second hidden game');

      const detailed = await blacklist.getUserDetailed();
      assert.deepStrictEqual(detailed, [
        { appid: 9001, name: 'Updated hidden game' },
        { appid: 9002, name: 'Second hidden game' },
      ]);

      await blacklist.remove('9001');
      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 9002, name: 'Second hidden game' }]);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(exclusionFile, 'utf8')), [9002]);
    });

    await test('backfills a missing name from the offline appList dump and persists it', async () => {
      await blacklist.reset();
      // A game blacklisted with no stored name (older entry / unknown title at add-time).
      fs.writeFileSync(exclusionFile, JSON.stringify([242050]));
      fs.writeFileSync(path.join(temp, 'cfg', 'exclusion-names.json'), JSON.stringify({}));
      // Seed the local appList dump the offline resolver reads.
      const schemaDir = path.join(temp, 'steam_cache', 'schema');
      fs.mkdirSync(schemaDir, { recursive: true });
      fs.writeFileSync(
        path.join(schemaDir, 'appList.json'),
        JSON.stringify([{ appid: 242050, name: "Assassin's Creed IV Black Flag" }])
      );

      const detailed = await blacklist.getUserDetailed();
      assert.deepStrictEqual(detailed, [{ appid: 242050, name: "Assassin's Creed IV Black Flag" }]);
      // Resolved name is written back to the sidecar so the next render is instant.
      assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(temp, 'cfg', 'exclusion-names.json'), 'utf8'))['242050'],
        "Assassin's Creed IV Black Flag"
      );
    });

    await test('leaves a non-Steam id (e.g. UPLAY) unresolved without throwing', async () => {
      await blacklist.reset();
      fs.writeFileSync(exclusionFile, JSON.stringify(['UPLAY273']));
      const detailed = await blacklist.getUserDetailed();
      assert.deepStrictEqual(detailed, [{ appid: 'UPLAY273', name: '' }]);
    });

    await test('reset clears both ids and their display-name sidecar', async () => {
      await blacklist.reset();
      assert.deepStrictEqual(await blacklist.getUserDetailed(), []);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(temp, 'cfg', 'exclusion-names.json'), 'utf8')), {});
    });

    console.log(`PASS: blacklist.get (${passed} checks)`);
  } finally {
    request.getJson = realGetJson;
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
