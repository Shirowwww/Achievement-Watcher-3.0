'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const themeLayers = require('../../app/util/themeLayers.js');

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
  assert.match(css, /var\(--aw-grad-panel, none\)/);
  assert.match(css, /var\(--aw-grad-card, none\)/);
  assert.match(css, /var\(--aw-grad-settings, none\)/);
  // title-bar is a shadow-DOM element: its light-DOM rule can never win against :host, so the
  // header's gradient reaches it only through --aw-grad-header + --aw-header-scrim (consumed by
  // titlebar.css's :host rule), never through a `var(--aw-grad-header, none)` usage in this CSS.
  assert.match(css, /--aw-grad-header: linear-gradient\(90deg, #101820 0%, #000000 100%\)/);
  assert.match(css, /--aw-header-scrim: transparent/);

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
  const bodyRule = css.slice(css.indexOf('body {'), css.indexOf('#game-list {'));
  assert.match(bodyRule, /background-color: transparent !important/);
  assert.doesNotMatch(bodyRule, /radial-gradient\(140% 90%/);
  assert.match(bodyRule, /var\(--aw-grad-bg, none\), none, var\(--aw-img-bg/);
  // The base color must be fully cut when a gradient is enabled: no tint veil of it may remain.
  assert.doesNotMatch(css, /--aw-grad-tint/);

  // The settings modal drops its opaque base gradient when a per-layer gradient is enabled.
  const nextBody = css.indexOf('body {', css.indexOf('#settings .box'));
  const settingsRule = css.slice(css.indexOf('#settings .box'), nextBody);
  assert.match(settingsRule, /background-color: transparent/);
  assert.doesNotMatch(settingsRule, /--aw-grad-tint/);
  assert.doesNotMatch(settingsRule, /linear-gradient\(180deg, var\(--set-modal-top\)/);

  // The overlay does the same: no base color behind the gradient.
  const overlay = themeLayers.buildCustomOverlayCss(theme);
  const panelRule = overlay.slice(overlay.indexOf('.overlay-panel {'), overlay.indexOf('.overlay-header {'));
  assert.match(panelRule, /background-color: transparent/);
  assert.doesNotMatch(panelRule, /--aw-grad-tint/);
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
    const imageOverride = css.slice(secondBody, css.indexOf('#game-list {', secondBody));
    // The dark scrim keeps readability, but the enabled gradient is still emitted below the art.
    assert.match(imageOverride, /var\(--aw-grad-bg, none\), var\(--aw-img-bg, none\)/);
    assert.doesNotMatch(imageOverride, /radial-gradient\(140% 90%/);
  } finally {
    require('node:fs').rmSync(tmp, { recursive: true, force: true });
  }
});

/*
  A gradient is listed before the image in `background-image`, which in CSS means it paints ON TOP
  of the art rather than under it: an opaque gradient simply hid the picture, with no control left
  in the editor to say so. An image therefore wins - the stored gradient is kept untouched so that
  removing the image brings it back, but nothing is emitted for it while the image is there.
*/
test('an image on a layer suppresses that layer gradient instead of covering the art', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const nodePath = require('node:path');
  const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grad-wins-'));
  try {
    const file = nodePath.join(tmp, 'panel.png');
    fs.writeFileSync(file, 'x');

    const theme = themeLayers.defaultCustomTheme();
    theme.panel.gradient = { enabled: true, from: '#ff0000', to: '#00ff00', angle: 90 };
    theme.card.gradient = { enabled: true, from: '#ff0000', to: '#00ff00', angle: 90 };
    theme.panel.image = file;

    const css = themeLayers.buildCustomAppCss(theme);
    assert.match(css, /--aw-grad-panel: none;/, 'the layer with the image paints no gradient');
    assert.match(css, /--aw-grad-card: linear-gradient\(90deg, #ff0000 0%, #00ff00 100%\)/, 'other layers are untouched');

    // Dropping the image restores it: only the emitted CSS changes, never the stored theme.
    assert.equal(themeLayers.sanitizeCustomTheme(theme).panel.gradient.enabled, true);
    const withoutImage = themeLayers.defaultCustomTheme();
    withoutImage.panel.gradient = theme.panel.gradient;
    assert.match(themeLayers.buildCustomAppCss(withoutImage), /--aw-grad-panel: linear-gradient\(90deg/);

    // The in-game overlay reads the same theme and has to agree with the window.
    theme.bg.image = file;
    theme.bg.gradient = { enabled: true, from: '#ff0000', to: '#00ff00', angle: 45 };
    assert.match(themeLayers.buildCustomOverlayCss(theme), /--aw-grad-bg: none;/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/*
  The gradient's direction select is styled like the effect-type select, and for a while it also
  carried that class. It renders EARLIER in the row than the effect panel, so every
  `row.find('.theme-layer-effect-type')` in settings.js resolved to the angle instead: picking
  "Blur" still offered a veil colour, and the choice was written back as "veil" because an angle is
  never the string 'blur'. The two controls share a stylesheet rule, never a hook class.
*/
test('the gradient direction select is styled like the effect type without answering for it', () => {
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const settings = fs.readFileSync(nodePath.join(__dirname, '..', '..', 'app', 'ui', 'settings.js'), 'utf8');
  const css = fs.readFileSync(nodePath.join(__dirname, '..', '..', 'app', 'resources', 'css', 'app.css'), 'utf8');

  const angleSelect = /addClass\('theme-layer-gradient-angle[^']*'\)/.exec(settings);
  assert.ok(angleSelect, 'the direction select is still built with its own class');
  assert.doesNotMatch(
    angleSelect[0],
    /theme-layer-effect-type/,
    'it must not answer to the effect-type lookups, which run against the whole row'
  );

  // Exactly one control per row may carry the effect-type hook.
  assert.equal((settings.match(/addClass\('theme-layer-effect-type'\)/g) || []).length, 1);

  // Losing the shared class must not cost the select its styling.
  assert.match(css, /#theme-customizer \.theme-layer-gradient-angle \{/, 'the stylesheet dresses it explicitly');
});
