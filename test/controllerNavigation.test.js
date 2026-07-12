'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chooseDirectionalCandidate } = require('../app/ui/controller.js');

const box = (left, top, width = 40, height = 40) => ({ left, top, width, height });

test('controller spatial navigation chooses the nearest target in each direction', () => {
  const current = box(100, 100);
  const left = box(20, 100);
  const right = box(180, 100);
  const up = box(100, 20);
  const down = box(100, 180);
  const diagonal = box(180, 180);
  const candidates = [current, left, right, up, down, diagonal];

  assert.equal(chooseDirectionalCandidate(current, candidates, -1, 0), left);
  assert.equal(chooseDirectionalCandidate(current, candidates, 1, 0), right);
  assert.equal(chooseDirectionalCandidate(current, candidates, 0, -1), up);
  assert.equal(chooseDirectionalCandidate(current, candidates, 0, 1), down);
});

test('controller spatial navigation returns undefined at an edge', () => {
  const current = box(100, 100);
  assert.equal(chooseDirectionalCandidate(current, [current, box(180, 100)], -1, 0), undefined);
});
