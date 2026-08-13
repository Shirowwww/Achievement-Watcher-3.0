'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildAchievementSchemaIndex,
  findAchievementInSchema,
  savedApiName,
} = require('../../app/parser/achievementSchemaIndex.js');

test('schema index keeps the first case-insensitive duplicate, like the previous Array.find', () => {
  const first = { name: 'ACH_WIN' };
  const later = { name: 'ach_win' };
  const index = buildAchievementSchemaIndex([first, later]);

  assert.strictEqual(findAchievementInSchema(index, { apiname: 'ach_win' }, 'fallback'), first);
});

test('schema index keeps the existing save-key priority and fallback', () => {
  const byId = { name: 'BY_ID' };
  const fallback = { name: 'FALLBACK' };
  const index = buildAchievementSchemaIndex([byId, fallback]);

  assert.equal(savedApiName({ id: 'BY_ID', apiname: 'ignored' }, 'fallback'), 'BY_ID');
  assert.strictEqual(findAchievementInSchema(index, { id: 'BY_ID', apiname: 'ignored' }, 'fallback'), byId);
  assert.strictEqual(findAchievementInSchema(index, {}, 'FALLBACK'), fallback);
});

test('CRC save records retain first schema match order', () => {
  const first = { name: 'Alpha' };
  const later = { name: 'Beta' };
  const index = buildAchievementSchemaIndex([first, later], { includeCrc: true });
  const crc = index.crcEntries.map(({ checksum }) => checksum).join(':');

  assert.strictEqual(findAchievementInSchema(index, { crc }, 'fallback'), first);
});

test('normal saves do not allocate a CRC lookup table', () => {
  const index = buildAchievementSchemaIndex([{ name: 'Alpha' }]);

  assert.equal(index.crcEntries.length, 0);
});
