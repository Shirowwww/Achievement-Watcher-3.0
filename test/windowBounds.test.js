'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clampWindowBoundsToWorkArea } = require('../app/util/windowBounds.js');

test('keeps fully visible window bounds unchanged', () => {
  const bounds = { x: 120, y: 64, width: 1200, height: 800 };
  assert.deepEqual(clampWindowBoundsToWorkArea(bounds, { x: 0, y: 0, width: 1536, height: 864 }), bounds);
});

test('brings a high-DPI window whose title-bar controls are off-screen back into the work area', () => {
  assert.deepEqual(
    clampWindowBoundsToWorkArea(
      { x: 366, y: 151, width: 1316, height: 809 },
      { x: 0, y: 0, width: 1536, height: 864 }
    ),
    { x: 220, y: 55, width: 1316, height: 809 }
  );
});

test('supports displays with negative coordinates and windows larger than the work area', () => {
  assert.deepEqual(
    clampWindowBoundsToWorkArea(
      { x: -1800, y: 700, width: 2200, height: 1100 },
      { x: -1920, y: 0, width: 1920, height: 1040 }
    ),
    { x: -1920, y: 0, width: 2200, height: 1100 }
  );
});

test('leaves malformed geometry untouched rather than guessing a position', () => {
  const bounds = { x: 10, y: 20, width: 1200, height: 800 };
  assert.equal(clampWindowBoundsToWorkArea(bounds, { x: 0, y: 0, width: 'wide', height: 900 }), bounds);
});
