'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const themeLayers = require('../app/util/themeLayers.js');

test('custom themes sanitize colors, images and fit values', () => {
  const clean = themeLayers.sanitizeCustomTheme({
    bg: {
      color: '#123456',
      image: 'C:/x/bg.png',
      fit: 'repeat',
      effect: { enabled: true, type: 'veil', color: '#ff0000', opacity: 35 },
    },
    text: { color: 'not-a-color' },
    accent: { color: 'rgb(10, 20, 30)' },
  });

  assert.equal(clean.bg.color, '#123456');
  assert.equal(clean.bg.image, 'C:/x/bg.png');
  assert.equal(clean.bg.fit, 'repeat');
  assert.deepEqual(clean.bg.effect, {
    enabled: true,
    type: 'veil',
    color: '#ff0000',
    opacity: 35,
    blur: 8,
    blurImage: '',
  });
  // Invalid colors fall back to the layer default.
  assert.equal(clean.text.color, themeLayers.BUILTIN_COLORS.default.text);
  assert.equal(clean.accent.color, 'rgb(10, 20, 30)');
  // Non-image layers never get image/fit keys.
  assert.equal('image' in clean.text, false);
});

test('custom theme CSS covers app and overlay layers', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-theme-css-'));
  const theme = themeLayers.defaultCustomTheme();
  theme.bg.color = '#101820';
  theme.accent.color = '#ff8800';
  const bgFile = path.join(tmp, 'bg.png');
  const cardBlur = path.join(tmp, 'card-blur.png');
  fs.writeFileSync(bgFile, 'x');
  fs.writeFileSync(cardBlur, 'x');
  theme.bg.image = bgFile;
  theme.card.image = path.join(tmp, 'card.png');
  theme.bg.effect = { enabled: true, type: 'veil', color: '#102030', opacity: 50, blur: 8, blurImage: '' };
  theme.card.effect = { enabled: true, type: 'blur', color: '#000000', opacity: 40, blur: 12, blurImage: cardBlur };

  const appCss = themeLayers.buildCustomAppCss(theme);
  assert.match(appCss, /--bg-base: #101820/);
  assert.match(appCss, /--accent: #ff8800/);
  assert.match(appCss, /--accent-soft: rgba\(255, 136, 0, 0\.16\)/);
  assert.match(appCss, /#game-list \{/);
  assert.match(appCss, /#settings \.box/);
  // The color must not hide the image: images get a dark scrim instead of the opaque surface.
  assert.match(appCss, /linear-gradient\(180deg, rgba\(0, 0, 0, 0\.28\), rgba\(0, 0, 0, 0\.55\)\), var\(--aw-img-bg/);
  assert.match(appCss, /background-color: rgba\(0, 0, 0, 0\.30\);/);
  assert.match(appCss, /--aw-veil-bg: rgba\(16, 32, 48, 0\.500\)/);
  assert.match(appCss, /--aw-img-card: url\('file:\/\/\/.*card-blur\.png'\)/);

  const overlayCss = themeLayers.buildCustomOverlayCss(theme);
  assert.match(overlayCss, /--aw-theme-bg: #101820/);
  assert.match(overlayCss, /--aw-theme-accent: #ff8800/);
  assert.match(overlayCss, /\.overlay-panel \{/);
  assert.match(overlayCss, /\.overlay-row \{/);
  assert.match(overlayCss, /\.overlay-panel \{\s*background-color: rgba\(0, 0, 0, 0\.25\)/);
  assert.match(overlayCss, /--aw-veil-bg: rgba\(16, 32, 48, 0\.500\)/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('built-in overlay CSS mirrors each theme', () => {
  for (const name of ['default', 'oled', 'dracula', 'graphite', 'nord', 'gruvbox', 'tokyonight']) {
    const css = themeLayers.buildBuiltinOverlayCss(name);
    assert.match(css, new RegExp(`--aw-theme-bg: ${themeLayers.BUILTIN_COLORS[name].bg}`));
  }
});

test('custom themes persist to userData and round-trip', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-theme-layers-'));
  try {
    const theme = themeLayers.defaultCustomTheme();
    theme.header.color = '#abcdef';
    theme.panel.image = 'C:/pics/panel.png';
    theme.panel.fit = 'contain';

    const saved = themeLayers.saveCustomTheme(root, theme);
    assert.equal(saved.header.color, '#abcdef');
    assert.equal(fs.existsSync(themeLayers.customThemeFile(root)), true);

    const loaded = themeLayers.loadCustomTheme(root);
    assert.equal(loaded.header.color, '#abcdef');
    assert.equal(loaded.panel.image, 'C:/pics/panel.png');
    assert.equal(loaded.panel.fit, 'contain');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('theme payload exposes CSS for custom and built-in themes', () => {
  const custom = themeLayers.themePayload('C:/userData', 'custom', themeLayers.defaultCustomTheme(), '');
  assert.equal(custom.custom, true);
  assert.ok(custom.appCss.includes(':root'));
  assert.ok(custom.overlayCss.includes('--aw-theme-bg'));

  const dracula = themeLayers.themePayload('C:/userData', 'dracula', null, '');
  assert.equal(dracula.custom, false);
  assert.equal(dracula.appCss, '');
  assert.match(dracula.overlayCss, /--aw-theme-bg: #282a36/);

  const user = themeLayers.themePayload('C:/userData', 'user:neon', null, 'body{}');
  assert.equal(user.userCss, 'body{}');
});
