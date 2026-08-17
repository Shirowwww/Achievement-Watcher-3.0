'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fitNotificationScale, placeNotification } = require('../../app/util/notificationBounds.js');

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

test('edge anchors sit flush against the display, taskbar included', () => {
  // What the app passes since bottom-anchored presets stopped floating above the taskbar: the full
  // display bounds (not the work area) and no margin, so "bottom" is the bottom of the screen.
  // A 1080p display whose taskbar takes the last 40px — the work area would end at y=1040.
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const at = (position) => placeNotification({ position, width: 600, height: 200, workArea: display, margin: 0 });

  for (const position of ['bottom-left', 'bottom-right', 'center-bottom']) {
    const bounds = at(position);
    assert.equal(bounds.y + bounds.height, 1080, `${position} must reach the bottom of the display`);
  }
  assert.equal(at('bottom-left').x, 0, 'bottom-left must touch the left edge');
  assert.equal(at('bottom-right').x + at('bottom-right').width, 1920, 'bottom-right must touch the right edge');
  assert.equal(at('top-left').y, 0, 'top-left must touch the top edge');
  assert.equal(at('top-right').x + at('top-right').width, 1920, 'top-right must touch the right edge');
  assert.equal(at('middle-left').x, 0, 'middle-left must touch the left edge');
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

test('a custom anchor may hang the window past a screen edge so the popup itself sits flush', () => {
  // A preset window is its <meta> box, which is a little larger than the pixels the preset paints.
  // Clamping that box to the display is what kept a manually placed popup away from the corner.
  const displayBounds = { x: 0, y: 0, width: 2560, height: 1440 };
  const bounds = placeNotification({
    position: 'custom',
    width: 315,
    height: 128,
    workArea: displayBounds,
    custom: { x: 2280, y: 1350 },
    margin: 0,
  });

  assert.deepEqual({ x: bounds.x, y: bounds.y }, { x: 2280, y: 1350 });
  assert.equal(bounds.x + bounds.width, 2595); // 35px of transparent padding past the right edge
  assert.equal(bounds.y + bounds.height, 1478);
});

test('a custom anchor that is mostly off its display is treated as stale and clamped', () => {
  const displayBounds = { x: 0, y: 0, width: 2560, height: 1440 };
  const half = placeNotification({
    position: 'custom',
    width: 400,
    height: 200,
    workArea: displayBounds,
    custom: { x: 2360, y: 1340 }, // exactly half of each side still visible
    margin: 0,
  });
  const tooFar = placeNotification({
    position: 'custom',
    width: 400,
    height: 200,
    workArea: displayBounds,
    custom: { x: 2361, y: 1340 },
    margin: 0,
  });

  assert.deepEqual({ x: half.x, y: half.y }, { x: 2360, y: 1340 });
  assert.deepEqual({ x: tooFar.x, y: tooFar.y }, { x: 2160, y: 1240 });
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

test('a custom 75% popup can sit flush over the taskbar on a 150% scaled 4K display', () => {
  // Electron exposes a 3840x2160 display at 150% as 2560x1440 DIP. The full display bounds,
  // rather than its shorter work area, must be used for an intentionally taskbar-overlapping popup.
  const displayBounds = { x: 0, y: 0, width: 2560, height: 1440 };
  const fitted = fitNotificationScale({
    baseWidth: 420,
    baseHeight: 170,
    scale: 0.75,
    workArea: displayBounds,
    margin: 0,
  });
  const bounds = placeNotification({
    position: 'custom',
    width: fitted.width,
    height: fitted.height,
    workArea: displayBounds,
    custom: { x: 2245, y: 1312 },
    margin: 0,
  });

  assert.deepEqual(fitted, { scale: 0.75, width: 315, height: 128, margin: 0 });
  assert.deepEqual(bounds, { x: 2245, y: 1312, width: 315, height: 128, margin: 0 });
  assert.equal(bounds.y + bounds.height, 1440);
});
