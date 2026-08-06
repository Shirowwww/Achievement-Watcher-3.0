'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const themeLayers = require('../app/util/themeLayers.js');

test('gradient model defaults to off and survives sanitize round-trips', () => {
  const def = themeLayers.defaultCustomTheme();
  assert.equal(def.bg.gradient.enabled, false);
  assert.equal(def.bg.gradient.from, def.bg.color);
  assert.equal(def.bg.gradient.angle, 180);

  const custom = {
    bg: { color: '#123456', gradient: { enabled: true, from: '#111111', to: '#222222', angle: 90 } },
    header: { color: '#654321', gradient: { enabled: true, from: '#333333', to: '#444444', angle: 135 } },
  };
  const clean = themeLayers.sanitizeCustomTheme(custom);
  assert.deepEqual(clean.bg.gradient, { enabled: true, from: '#111111', to: '#222222', angle: 90 });
  assert.equal(clean.header.gradient.angle, 135);
  assert.equal(clean.text.gradient.enabled, false);

  const partial = themeLayers.sanitizeCustomTheme({ bg: { color: '#abcdef' } });
  assert.equal(partial.bg.gradient.enabled, false);
});

test('legacy gradient:true converts into a default dark fade', () => {
  const clean = themeLayers.sanitizeCustomTheme({ bg: { color: '#123456', gradient: true } });
  assert.equal(clean.bg.gradient.enabled, true);
  assert.equal(clean.bg.gradient.from, '#123456');
  assert.equal(clean.bg.gradient.to, '#091b2d'); // 48% darker
  assert.equal(clean.bg.gradient.angle, 180);
});

test('buildCustomAppCss emits gradients for surface layers when enabled', () => {
  const theme = themeLayers.defaultCustomTheme();
  for (const id of ['bg', 'header', 'panel', 'card', 'settings']) {
    theme[id].gradient = { enabled: true, from: '#101820', to: '#000000', angle: 90 };
  }
  const css = themeLayers.buildCustomAppCss(theme);
  assert.match(css, /--aw-grad-bg: linear-gradient\(90deg, #101820 0%, #000000 100%\)/);
  assert.match(css, /var\(--aw-grad-bg, none\)/);
  assert.match(css, /var\(--aw-grad-header, none\)/);
  assert.match(css, /var\(--aw-grad-panel, none\)/);
  assert.match(css, /var\(--aw-grad-card, none\)/);
  assert.match(css, /var\(--aw-grad-settings, none\)/);

  const off = themeLayers.buildCustomAppCss(themeLayers.defaultCustomTheme());
  assert.match(off, /--aw-grad-bg: none/);
  assert.doesNotMatch(off, /var\(--aw-grad-bg, none\), linear-gradient/);
});

test('buildCustomOverlayCss emits gradients for overlay surfaces', () => {
  const theme = themeLayers.defaultCustomTheme();
  theme.bg.gradient = { enabled: true, from: '#101820', to: '#000000', angle: 45 };
  theme.card.gradient = { enabled: true, from: '#202830', to: '#101010', angle: 180 };
  const css = themeLayers.buildCustomOverlayCss(theme);
  assert.match(css, /--aw-grad-bg: linear-gradient\(45deg, #101820 0%, #000000 100%\)/);
  assert.match(css, /var\(--aw-grad-card, none\)/);
});
