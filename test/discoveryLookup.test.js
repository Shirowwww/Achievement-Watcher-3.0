'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcRenderer: {
        sendSync: () => false,
        invoke: async () => null,
      },
    };
  }
  if (request === '@electron/remote' || request.startsWith('@electron/remote/')) return {};
  return originalLoad.call(this, request, parent, isMain);
};

const achievements = require('../app/parser/achievements.js');

const { buildDiscoveryLookup, getDiscoverySources } = achievements._internal;

function legacySources(record, cachedList) {
  const clone = (value) => {
    if (!value || value.appid == null) return null;
    const copy = { ...value };
    if (value.data && typeof value.data === 'object') copy.data = { ...value.data };
    delete copy._sources;
    return copy;
  };
  if (record && Array.isArray(record._sources) && record._sources.length > 0) return record._sources.map(clone).filter(Boolean);
  if (record && !record.data && cachedList) {
    const matches = cachedList.filter((candidate) => String(candidate.appid) === String(record.appid));
    if (matches.length > 0) {
      return matches.flatMap((match) => (Array.isArray(match._sources) ? match._sources : [match])).map(clone).filter(Boolean);
    }
  }
  return [clone(record)].filter(Boolean);
}

test('discovery lookup keeps the legacy first match and every source in array order', () => {
  const list = [
    { appid: 42, source: 'first', data: { type: 'file', path: 'A' } },
    { appid: '42', source: 'second', data: { type: 'uplay', path: 'B' } },
    { appid: '99', source: 'other', data: { type: 'file', path: 'C' } },
  ];
  const lookup = buildDiscoveryLookup(list);

  assert.strictEqual(lookup.firstByAppid.get('42'), list[0], 'String()-based find must keep the first numeric/string match');
  assert.deepEqual(lookup.recordsByAppid.get('42'), [list[0], list[1]]);

  const placeholder = { appid: '42', source: 'placeholder' };
  const indexed = getDiscoverySources(placeholder, list, lookup);
  assert.deepEqual(indexed, legacySources(placeholder, list));
  assert.deepEqual(indexed.map((record) => record.source), ['first', 'second']);
  indexed[0].data.path = 'mutated';
  assert.equal(list[0].data.path, 'A', 'returned source records remain clones');
});

test('discovery lookup preserves merged sources and direct-record fallbacks', () => {
  const list = [
    {
      appid: '1',
      source: 'merged',
      _sources: [
        { appid: '1', source: 'steam', data: { type: 'file' } },
        { appid: '1', source: 'uplay', data: { type: 'uplay' } },
      ],
    },
  ];
  const lookup = buildDiscoveryLookup(list);

  const merged = getDiscoverySources(list[0], list, lookup);
  assert.deepEqual(merged, legacySources(list[0], list));
  assert.deepEqual(merged.map((record) => record.source), ['steam', 'uplay']);

  const direct = { appid: '1', source: 'direct', data: { type: 'epic' } };
  assert.deepEqual(getDiscoverySources(direct, list, lookup), legacySources(direct, list));
  const missing = { appid: '404', source: 'missing' };
  assert.deepEqual(getDiscoverySources(missing, list, lookup), legacySources(missing, list));
  Module._load = originalLoad;
});
