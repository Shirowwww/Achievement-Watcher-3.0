'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const themeLayers = require('../../app/util/themeLayers.js');

test('main-window chrome and progress surfaces use theme tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app/resources/css/app.css'), 'utf8');
  const titlebarCss = fs.readFileSync(path.join(__dirname, '../../app/resources/css/titlebar.css'), 'utf8');

  assert.match(css, /--success: #5fd49a/);
  assert.match(titlebarCss, /--sf-indicator-green: var\(--success/);
  assert.match(titlebarCss, /background-color: color-mix\(in srgb, var\(--surface-sunken/);
  assert.doesNotMatch(titlebarCss, /var\(--(?:success|warning|danger|text|text-muted|border|bg-glow|surface-sunken),/);
  assert.doesNotMatch(titlebarCss, /rgba\((?:47, 229, 95|197, 27, 27|219, 135, 25)/);
  assert.match(css, /#game-list \.game-box \.info \.progressBar\s*\{[\s\S]*?var\(--surface-sunken\)/);
  assert.match(css, /#game-list \.game-box \.info \.progressBar > \.meter\s*\{[\s\S]*?var\(--accent\)/);
  assert.doesNotMatch(css, /#0c1828|#08121f|#4f8bf7|#5f75df|#7f8cff/);
});

test('the default palette has one source in CSS and matches the theme engine', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app/resources/css/app.css'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app/package.json'), 'utf8'));
  const root = css.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(root, 'app.css must define default theme tokens');

  const tokenFor = {
    bg: 'bg-base',
    header: 'bg-glow',
    panel: 'bg-panel',
    card: 'surface',
    text: 'text',
    muted: 'text-muted',
    border: 'border',
    accent: 'accent',
  };
  for (const [layer, token] of Object.entries(tokenFor)) {
    const escaped = themeLayers.BUILTIN_COLORS.default[layer].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(root[1], new RegExp(`--${token}:\\s*${escaped}\\s*;`), `${layer} must match BUILTIN_COLORS.default`);
    assert.equal((css.match(new RegExp(`--${token}:`, 'g')) || []).length >= 1, true);
  }

  assert.equal(packageJson.config.window.backgroundColor, themeLayers.BUILTIN_COLORS.default.bg);
  assert.equal((css.match(/:root\s*\{/g) || []).length, 1, 'do not shadow the default palette with a later :root block');
});

test('semantic UI states follow theme tokens', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app/resources/css/app.css'), 'utf8');
  assert.match(css, /\.dll-badge\.present\s*\{[^}]*var\(--success\)/);
  assert.match(css, /\.dll-badge\.missing\s*\{[^}]*var\(--danger\)/);
  assert.match(css, /\.onboarding-warning\s*\{[^}]*var\(--warning\)/);
  assert.match(css, /#emulator-login-test-status\.success\s*\{[^}]*var\(--success\)/);
  assert.match(css, /#emulator-login-test-status\.error\s*\{[^}]*var\(--danger\)/);
  assert.match(css, /\.achievement\.manual \.box\s*\{[^}]*var\(--warning\)/);
});

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
  const bgVeilBlur = path.join(tmp, 'bg-veilblur.png');
  const cardBlur = path.join(tmp, 'card-blur.png');
  fs.writeFileSync(bgFile, 'x');
  fs.writeFileSync(bgVeilBlur, 'x');
  fs.writeFileSync(cardBlur, 'x');
  theme.bg.image = bgFile;
  theme.card.image = path.join(tmp, 'card.png');
  theme.bg.effect = { enabled: true, type: 'veil', color: '#102030', opacity: 50, blur: 8, blurImage: bgVeilBlur };
  theme.card.effect = { enabled: true, type: 'blur', color: '#000000', opacity: 40, blur: 12, blurImage: cardBlur };

  const appCss = themeLayers.buildCustomAppCss(theme);
  assert.match(appCss, /--bg-base: #101820/);
  assert.match(appCss, /--accent: #ff8800/);
  assert.match(appCss, /--accent-soft: rgba\(255, 136, 0, 0\.16\)/);
  assert.match(appCss, /#game-list \{/);
  assert.match(appCss, /#settings \.box/);
  // The color must not hide the image: images get a dark scrim instead of the opaque surface.
  assert.match(appCss, /linear-gradient\(180deg, rgba\(0, 0, 0, 0\.28\), rgba\(0, 0, 0, 0\.55\)\), var\(--aw-grad-bg, none\), var\(--aw-img-bg/);
  assert.match(appCss, /background-color: rgba\(0, 0, 0, 0\.30\);/);
  assert.match(appCss, /--aw-veil-bg: rgba\(16, 32, 48, 0\.500\)/);
  // The colored veil also renders the pre-blurred copy (light frosted blur), not the sharp source.
  assert.match(appCss, /--aw-img-bg: url\('file:\/\/\/.*bg-veilblur\.png'\)/);
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

test('custom theme defaults to the Steam Blue palette', () => {
  const fresh = themeLayers.defaultCustomTheme();
  assert.equal(fresh.bg.color, themeLayers.BUILTIN_COLORS.default.bg);
  assert.equal(fresh.header.color, themeLayers.BUILTIN_COLORS.default.header);
  assert.equal(fresh.panel.color, themeLayers.BUILTIN_COLORS.default.panel);
  assert.equal(fresh.card.color, themeLayers.BUILTIN_COLORS.default.card);
  assert.equal(fresh.settings.color, themeLayers.BUILTIN_COLORS.default.settings);
  assert.equal(fresh.text.color, themeLayers.BUILTIN_COLORS.default.text);
  assert.equal(fresh.muted.color, themeLayers.BUILTIN_COLORS.default.muted);
  assert.equal(fresh.border.color, themeLayers.BUILTIN_COLORS.default.border);
  assert.equal(fresh.accent.color, themeLayers.BUILTIN_COLORS.default.accent);

  // A fresh theme generates the exact Steam Blue palette.
  const freshCss = themeLayers.buildCustomAppCss(fresh);
  assert.match(freshCss, /--bg-base: #142236/);
  assert.match(freshCss, /--bg-glow: #26384c/);
  assert.match(freshCss, /--bg-panel: #192a40/);
  assert.match(freshCss, /--surface: #263b55/);
  assert.match(freshCss, /--text: #e7edf6/);
  assert.match(freshCss, /--text-muted: #94a5ba/);
  assert.match(freshCss, /--border: #3e5065/);
  assert.match(freshCss, /--accent: #6c91ff/);
});

test('built-in overlay CSS mirrors each theme', () => {
  for (const name of Object.keys(themeLayers.BUILTIN_COLORS)) {
    const css = themeLayers.buildBuiltinOverlayCss(name);
    assert.match(css, new RegExp(`--aw-theme-bg: ${themeLayers.BUILTIN_COLORS[name].bg}`));
  }
});

test('every built-in theme has an app.css token block', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../app/resources/css/app.css'), 'utf8');
  const tokenFor = {
    bg: 'bg-base',
    header: 'bg-glow',
    panel: 'bg-panel',
    card: 'surface',
    settings: 'set-surface',
    text: 'text',
    muted: 'text-muted',
    border: 'border',
    accent: 'accent',
  };
  for (const [name, colors] of Object.entries(themeLayers.BUILTIN_COLORS)) {
    if (name === 'default') continue;
    const block = css.match(new RegExp(`:root\\[data-theme='${name}'\\]\\s*\\{([\\s\\S]*?)\\}`));
    assert.ok(block, `${name}: missing CSS token block`);
    for (const [layer, token] of Object.entries(tokenFor)) {
      const escaped = colors[layer].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(block[1], new RegExp(`--${token}:\\s*${escaped}\\s*;`), `${name}: ${layer} does not match the theme engine`);
    }
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
