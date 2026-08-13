'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindowArgs } = require('../../app/util/windowArgs.js');

test('normalizes case-folded notification arguments from a second instance', () => {
  const args = normalizeWindowArgs({
    displayname: 'Unlocked title',
    gamedisplayname: 'Game title',
    notificationtype: 'platinum',
    progresscurrent: '4',
    progressmax: '10',
    raritypercent: '2.5',
  });

  assert.equal(args.displayName, 'Unlocked title');
  assert.equal(args.gameDisplayName, 'Game title');
  assert.equal(args.notificationType, 'platinum');
  assert.equal(args.progressCurrent, '4');
  assert.equal(args.progressMax, '10');
  assert.equal(args.rarityPercent, '2.5');
});

test('keeps an explicitly camel-cased argument over a case-folded duplicate', () => {
  const args = normalizeWindowArgs({ displayName: 'Preferred title', displayname: 'Fallback title' });
  assert.equal(args.displayName, 'Preferred title');
});
