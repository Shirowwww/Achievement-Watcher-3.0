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

test('angle 0 is preserved (not coerced to 180) through sanitize and CSS', () => {
  const clean = themeLayers.sanitizeCustomTheme({ bg: { color: '#123456', gradient: { enabled: true, from: '#111111', to: '#222222', angle: 0 } } });
  assert.equal(clean.bg.gradient.angle, 0);
  const theme = themeLayers.defaultCustomTheme();
  theme.bg.gradient = clean.bg.gradient;
  assert.match(themeLayers.buildCustomAppCss(theme), /--aw-grad-bg: linear-gradient\(0deg, #111111 0%, #222222 100%\)/);
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

test('enabled gradients replace the layer base color in generated CSS', () => {
  const theme = themeLayers.defaultCustomTheme();
  theme.bg.gradient = { enabled: true, from: '#ff0000', to: '#00ff00', angle: 135 };
  theme.settings.gradient = { enabled: true, from: '#111111', to: '#222222', angle: 90 };

  const css = themeLayers.buildCustomAppCss(theme);

  // The main window must drop both the opaque base color and the base radial backdrop
  // so the custom gradient is the layer background, with the image (if any) on top.
  const bodyRule = css.slice(css.indexOf('body {'), css.indexOf('title-bar {'));
  assert.match(bodyRule, /background-color: transparent !important/);
  assert.doesNotMatch(bodyRule, /radial-gradient\(140% 90%/);
  assert.match(bodyRule, /var\(--aw-grad-bg, none\), none, var\(--aw-img-bg/);

  // The settings modal drops its opaque base gradient when a per-layer gradient is enabled.
  const nextBody = css.indexOf('body {', css.indexOf('#settings .box'));
  const settingsRule = css.slice(css.indexOf('#settings .box'), nextBody);
  assert.match(settingsRule, /background-color: transparent/);
  assert.doesNotMatch(settingsRule, /linear-gradient\(180deg, var\(--set-modal-top\)/);

  // The overlay does the same: no base color behind the gradient.
  const overlay = themeLayers.buildCustomOverlayCss(theme);
  const panelRule = overlay.slice(overlay.indexOf('.overlay-panel {'), overlay.indexOf('.overlay-header {'));
  assert.match(panelRule, /background-color: transparent/);
});

test('enabled gradients stay layered under images', () => {
  const tmp = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'aw-grad-img-'));
  try {
    const bgFile = require('node:path').join(tmp, 'bg.png');
    require('node:fs').writeFileSync(bgFile, 'x');
    const theme = themeLayers.defaultCustomTheme();
    theme.bg.image = bgFile;
    theme.bg.gradient = { enabled: true, from: '#ff0000', to: '#00ff00', angle: 90 };

    const css = themeLayers.buildCustomAppCss(theme);
    const firstBody = css.indexOf('body {');
    const secondBody = css.indexOf('body {', firstBody + 1);
    const imageOverride = css.slice(secondBody, css.indexOf('title-bar {', secondBody));
    // The dark scrim keeps readability, but the enabled gradient is still emitted below the art.
    assert.match(imageOverride, /var\(--aw-grad-bg, none\), var\(--aw-img-bg, none\)/);
    assert.doesNotMatch(imageOverride, /radial-gradient\(140% 90%/);
  } finally {
    require('node:fs').rmSync(tmp, { recursive: true, force: true });
  }
});
