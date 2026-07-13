'use strict';

const assert = require('node:assert/strict');
const { sanitizeAppIdForPlatform, officialAppId, rawAppId, normalizeType } = require('../app/util/platformId.js');

(() => {
  // ---- sanitizeAppIdForPlatform: per-platform id shape validation
  assert.equal(sanitizeAppIdForPlatform('440', 'steam'), '440');
  assert.equal(sanitizeAppIdForPlatform('1423049311', 'gogOfficial'), '1423049311');
  assert.equal(sanitizeAppIdForPlatform('1843', 'ubisoftOfficial'), '1843');
  assert.equal(sanitizeAppIdForPlatform('9773aa1aa54f4f7b80e44bef04986cea', 'epicOfficial'), '9773aa1aa54f4f7b80e44bef04986cea');
  assert.equal(sanitizeAppIdForPlatform('CUSA03173', 'shadps4'), 'CUSA03173');
  assert.equal(sanitizeAppIdForPlatform('NPWR12345_00', 'rpcs3'), 'NPWR12345_00');
  assert.equal(sanitizeAppIdForPlatform('0x4D5307E6', 'xenia'), '4D5307E6'); // 0x stripped
  // rejects malformed ids
  assert.equal(sanitizeAppIdForPlatform('not!valid', 'steam'), '');
  assert.equal(sanitizeAppIdForPlatform('CUSA03173', 'rpcs3'), ''); // wrong platform shape
  assert.equal(sanitizeAppIdForPlatform('', 'steam'), '');

  // ---- officialAppId: namespaces the collision-prone native-id sources
  // Ubisoft small ints overlap Steam appids → must be namespaced
  assert.equal(officialAppId('ubisoftOfficial', '1843'), 'uplay-1843');
  assert.equal(officialAppId('ubisoftOfficial', '6100'), 'uplay-6100');
  // GOG productIds namespaced too (future-proof)
  assert.equal(officialAppId('gogOfficial', '1423049311'), 'gog-1423049311');
  // Steam / emulator sources keep their bare appid (back-compat with existing caches)
  assert.equal(officialAppId('steam', '440'), '440');
  assert.equal(officialAppId('steamOfficial', '440'), '440');
  assert.equal(officialAppId('file', '480'), '480');
  // idempotent — an already-namespaced id isn't double-prefixed
  assert.equal(officialAppId('ubisoftOfficial', 'uplay-1843'), 'uplay-1843');

  // ---- the collision that motivated this: Ubisoft 1843 and Steam 1843 now get DIFFERENT keys
  assert.notEqual(officialAppId('ubisoftOfficial', '1843'), officialAppId('steam', '1843'));

  // ---- rawAppId: recover the native id from a namespaced key
  assert.equal(rawAppId('uplay-1843'), '1843');
  assert.equal(rawAppId('gog-1423049311'), '1423049311');
  assert.equal(rawAppId('440'), '440'); // bare id passes through

  // ---- normalizeType maps parser data.type → platform tag
  assert.equal(normalizeType('ubisoftOfficial'), 'ubisoft-official');
  assert.equal(normalizeType('gogOfficial'), 'gog-official');

  console.log('PASS: platformId validation + collision-safe cache ids');
})();
