'use strict';

// Standalone test (run from app/ via: node --test "../test/parsers/blacklist.test.js").
// Characterizes blacklist.get()'s merge/dedup of the built-in AppIDs + the server bogus-list +
// the user exclusion file, and its graceful fallback when the server fetch fails. request-zero
// is stubbed (the same cached instance the parser holds) so the test stays offline/deterministic.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const blacklist = require(path.join(__dirname, '..', '..', 'app', 'parser', 'blacklist.js'));
// Resolve request-zero from app/node_modules so it is the *same* cached module object the parser
// uses (Node keys the module cache by absolute path) - patching .getJson then affects the parser.
const request = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'request-zero'));
const realGetJson = request.getJson;
// Same crc32 the app uses to mint `local-<hash>` ids for unconfigured installs.
const { crc32 } = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'crc'));

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

    await test('backfills a missing name from a cached per-game schema (no appList dump needed)', async () => {
      await blacklist.reset();
      fs.writeFileSync(exclusionFile, JSON.stringify([534680]));
      // The dump the previous test seeded must not be what answers here.
      fs.rmSync(path.join(temp, 'steam_cache', 'schema', 'appList.json'), { force: true });
      const frenchDir = path.join(temp, 'steam_cache', 'schema', 'french');
      fs.mkdirSync(frenchDir, { recursive: true });
      fs.writeFileSync(path.join(frenchDir, '534680.db'), JSON.stringify({ name: 'Ghostrunner', appid: '534680' }));

      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 534680, name: 'Ghostrunner' }]);
      assert.strictEqual(
        JSON.parse(fs.readFileSync(path.join(temp, 'cfg', 'exclusion-names.json'), 'utf8'))['534680'],
        'Ghostrunner'
      );
    });

    await test('backfills a NON-Steam id from gameIndex (the only local source that covers it)', async () => {
      await blacklist.reset();
      fs.writeFileSync(exclusionFile, JSON.stringify(['local-a5f2c7b5']));
      fs.writeFileSync(
        path.join(temp, 'cfg', 'gameIndex.json'),
        JSON.stringify([{ appid: 'local-a5f2c7b5', name: 'A Local Game', source: 'Goldberg' }])
      );

      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 'local-a5f2c7b5', name: 'A Local Game' }]);
    });

    await test('add() captures a non-Steam name from gameIndex before the entry is dropped from it', async () => {
      await blacklist.reset();
      fs.writeFileSync(exclusionFile, JSON.stringify([]));
      fs.writeFileSync(
        path.join(temp, 'cfg', 'gameIndex.json'),
        JSON.stringify([{ appid: 'local-deadbeef', name: 'Some Cracked Game', source: 'Goldberg' }])
      );

      await blacklist.add('local-deadbeef', ''); // caller had no title to hand
      // gameIndex.remove() has since emptied the only source that knew the name...
      fs.writeFileSync(path.join(temp, 'cfg', 'gameIndex.json'), JSON.stringify([]));
      // ...but it was captured into the sidecar first.
      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 'local-deadbeef', name: 'Some Cracked Game' }]);
    });

    await test('names a local- install by recomputing its folder hash over the library roots', async () => {
      await blacklist.reset();
      fs.rmSync(path.join(temp, 'cfg', 'gameIndex.json'), { force: true });
      // `local-<crc32(dir.toLowerCase())>` is exactly how achievements.js mints the id.
      const library = path.join(temp, 'Library');
      const gameDir = path.join(library, 'Publisher', 'Some Cracked Game');
      fs.mkdirSync(gameDir, { recursive: true });
      fs.writeFileSync(path.join(temp, 'cfg', 'librarydirs.db'), JSON.stringify([library]));
      blacklist.forgetLocalInstallIndex(); // the scan roots just changed
      const id = 'local-' + (crc32(gameDir.toLowerCase()) >>> 0).toString(16);
      fs.writeFileSync(exclusionFile, JSON.stringify([id]));

      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: id, name: 'Some Cracked Game' }]);
      // Resolved once, then remembered - the walk must not run again on the next render.
      assert.strictEqual(JSON.parse(fs.readFileSync(path.join(temp, 'cfg', 'exclusion-names.json'), 'utf8'))[id], 'Some Cracked Game');
    });

    await test('a local- id whose folder is gone stays unresolved instead of hanging or throwing', async () => {
      await blacklist.reset();
      fs.writeFileSync(exclusionFile, JSON.stringify(['local-deadbeef']));
      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 'local-deadbeef', name: '' }]);
    });

    await test('the folder map is walked once, not on every unresolvable render', async () => {
      await blacklist.reset();
      const library = path.join(temp, 'Library');
      fs.writeFileSync(path.join(temp, 'cfg', 'librarydirs.db'), JSON.stringify([library]));
      blacklist.forgetLocalInstallIndex();
      fs.writeFileSync(exclusionFile, JSON.stringify(['local-deadbeef'])); // never resolvable

      // Count only the install-folder walk: the schema-cache lookup reads its own directory on every
      // render by design, and that is not what this cache exists to avoid.
      const realReaddir = fs.readdirSync;
      let walks = 0;
      fs.readdirSync = function (target, ...rest) {
        if (String(target).startsWith(library)) walks += 1;
        return realReaddir.call(fs, target, ...rest);
      };
      try {
        await blacklist.getUserDetailed();
        const first = walks;
        assert.ok(first > 0, 'the first lookup must actually walk the roots');
        await blacklist.getUserDetailed();
        await blacklist.getUserDetailed();
        assert.strictEqual(walks, first, 'later lookups must reuse the cached map');

        blacklist.forgetLocalInstallIndex();
        await blacklist.getUserDetailed();
        assert.ok(walks > first, 'invalidating the cache must let the next lookup walk again');
      } finally {
        fs.readdirSync = realReaddir;
      }
    });

    await test('leaves a non-Steam id (e.g. UPLAY) unresolved without throwing', async () => {
      await blacklist.reset();
      fs.rmSync(path.join(temp, 'cfg', 'gameIndex.json'), { force: true });
      fs.rmSync(path.join(temp, 'cfg', 'librarydirs.db'), { force: true });
      fs.writeFileSync(exclusionFile, JSON.stringify(['UPLAY273']));
      const detailed = await blacklist.getUserDetailed();
      assert.deepStrictEqual(detailed, [{ appid: 'UPLAY273', name: '' }]);
    });

    await test('setName records an externally resolved title and getUserDetailed reuses it', async () => {
      await blacklist.reset();
      fs.writeFileSync(exclusionFile, JSON.stringify([220]));
      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 220, name: '' }]);

      assert.strictEqual(await blacklist.setName(220, 'Half-Life 2'), true);
      assert.strictEqual(await blacklist.setName(220, 'Half-Life 2'), false, 'an unchanged name is not rewritten');
      assert.strictEqual(await blacklist.setName(220, '   '), false, 'a blank name is ignored');
      assert.strictEqual(await blacklist.setName('', 'Nothing'), false, 'a blank id is ignored');

      assert.deepStrictEqual(await blacklist.getUserDetailed(), [{ appid: 220, name: 'Half-Life 2' }]);
      // remove() drops the sidecar entry with the id.
      await blacklist.remove(220);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(temp, 'cfg', 'exclusion-names.json'), 'utf8')), {});
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
