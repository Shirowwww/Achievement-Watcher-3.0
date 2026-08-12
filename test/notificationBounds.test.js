'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fitNotificationScale, placeNotification } = require('../app/util/notificationBounds.js');

const workArea = { x: -1920, y: 40, width: 1920, height: 1040 };

function assertInside(bounds) {
  assert.ok(bounds.x >= workArea.x + bounds.margin, `left edge escaped: ${bounds.x}`);
  assert.ok(bounds.y >= workArea.y + bounds.margin, `top edge escaped: ${bounds.y}`);
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width - bounds.margin, `right edge escaped: ${bounds.x + bounds.width}`);
  assert.ok(bounds.y + bounds.height <= workArea.y + workArea.height - bounds.margin, `bottom edge escaped: ${bounds.y + bounds.height}`);
}

test('every named notification position is anchored to the corresponding work-area edge', () => {
  const expected = {
    'center-top': { x: -1260, y: 42 },
    'top-left': { x: -1918, y: 42 },
    'top-right': { x: -602, y: 42 },
    'middle-left': { x: -1918, y: 460 },
    'middle-right': { x: -602, y: 460 },
    'bottom-left': { x: -1918, y: 878 },
    'bottom-right': { x: -602, y: 878 },
    'center-bottom': { x: -1260, y: 878 },
  };

  for (const [position, anchor] of Object.entries(expected)) {
    const bounds = placeNotification({ position, width: 600, height: 200, workArea });
    assert.deepEqual({ x: bounds.x, y: bounds.y }, anchor, position);
    assertInside(bounds);
  }
});

test('a large preset is reduced to the active work area before it is positioned', () => {
  const fitted = fitNotificationScale({
    baseWidth: 900,
    baseHeight: 600,
    scale: 2,
    workArea: { x: 0, y: 0, width: 1000, height: 700 },
  });
  const bounds = placeNotification({
    position: 'bottom-right',
    width: fitted.width,
    height: fitted.height,
    workArea: { x: 0, y: 0, width: 1000, height: 700 },
  });

  assert.equal(fitted.scale, 1.1066666666666667);
  assert.equal(fitted.width, 996);
  assert.equal(fitted.height, 664);
  assert.deepEqual({ x: bounds.x, y: bounds.y }, { x: 2, y: 34 });
  assert.equal(bounds.x + bounds.width, 998);
  assert.equal(bounds.y + bounds.height, 698);
});

test('custom notification positions are clamped back inside the current monitor', () => {
  const bounds = placeNotification({
    position: 'custom',
    width: 640,
    height: 320,
    workArea,
    custom: { x: 9000, y: -9000 },
  });

  assert.deepEqual({ x: bounds.x, y: bounds.y }, { x: -642, y: 42 });
  assertInside(bounds);
});
