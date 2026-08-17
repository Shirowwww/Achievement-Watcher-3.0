'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const htmlParser = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'node-html-parser'));

/*
  The theme picker opens on a short primary set and keeps the rest behind "More themes…". The real
  risk is silent loss: a built-in listed in neither array disappears from the UI while its palette
  and its app.css block stay in the tree, so nothing else fails. These tests pin both arrays against
  the theme engine itself, and pin the light theme's contrast because it is the one palette the
  stylesheet's dark-base overlays were not written for.
*/

const appDir = path.join(__dirname, '..', '..', 'app');
const themeLayers = require(path.join(appDir, 'util', 'themeLayers.js'));
const source = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');

function listValues(name) {
  const block = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`));
  assert.ok(block, `${name} must stay a top-level array literal in settings.js`);
  return [...block[1].matchAll(/\[\s*'([^']+)'/g)].map((m) => m[1]);
}

const primary = listValues('PRIMARY_THEMES');
const more = listValues('MORE_THEMES');
const sentinel = (source.match(/const MORE_THEMES_VALUE = '([^']+)'/) || [])[1];

// WCAG relative luminance, used to prove "light" really is light and readable.
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('the picker opens on a set small enough to choose from', () => {
  assert.ok(primary.length >= 6 && primary.length <= 7, `expected 6-7 primary themes, got ${primary.length}`);
});

test('every built-in theme is still reachable from the picker', () => {
  const offered = [...primary, ...more];
  assert.equal(new Set(offered).size, offered.length, 'a theme must not appear in both lists');
  assert.deepEqual(offered.slice().sort(), Object.keys(themeLayers.BUILTIN_COLORS).sort(), 'the two lists together must cover every built-in palette');
});

test('the primary set keeps the default and spans both extremes', () => {
  assert.ok(primary.includes('default'), 'the default theme must not be hidden behind More themes…');
  assert.ok(primary.includes('light'), 'the only light theme belongs in the primary set');
  assert.ok(primary.includes('oled'), 'the pure-black theme belongs in the primary set');
});

test('primary themes are visually distinct from one another', () => {
  // Two primaries that render near-identically waste one of the seven slots.
  for (let i = 0; i < primary.length; i++) {
    for (let j = i + 1; j < primary.length; j++) {
      const a = themeLayers.BUILTIN_COLORS[primary[i]];
      const b = themeLayers.BUILTIN_COLORS[primary[j]];
      assert.notEqual(a.bg + a.accent, b.bg + b.accent, `${primary[i]} and ${primary[j]} share a background and accent`);
    }
  }
});

test('the More themes… sentinel cannot collide with a real selection', () => {
  assert.ok(sentinel, 'MORE_THEMES_VALUE must stay a literal in settings.js');
  assert.equal(themeLayers.BUILTIN_COLORS[sentinel], undefined, 'the sentinel must not name a built-in theme');
  assert.notEqual(sentinel, 'custom', 'the sentinel must not collide with the Custom theme');
  // It is a command, so it must be intercepted before anything treats it as a theme value.
  const handler = source.slice(source.indexOf("$('#option_theme').on('change'"));
  const guard = handler.indexOf('MORE_THEMES_VALUE');
  const apply = handler.indexOf('applyThemeValue(value)');
  assert.ok(guard !== -1 && guard < apply, 'the change handler must return on the sentinel before applying it as a theme');
});

test('the long list folds both ways and never hides the active theme', () => {
  // One sentinel, flipped rather than latched, is what makes the row collapsible as well.
  assert.match(source, /themeListExpanded = !themeListExpanded/, 'the toggle must invert the state, not only expand it');
  assert.match(source, /themeFewer/, 'the toggle needs a collapse label');
  assert.match(source, /themeMore/, 'the toggle needs an expand label');
  // Collapsing while an extra theme is selected must keep that row present.
  const populate = source.slice(source.indexOf('function populateThemeSelect'));
  assert.match(populate.slice(0, populate.indexOf('ipcRenderer')), /MORE_THEMES\.find\(/, 'a selected extra theme must survive collapsing');
});

test('theme rows stay plain so the selected one is obvious', () => {
  // Tinting the options was tried at full palette and at a faint accent wash; a native <select>
  // offers no control over how that swatch renders, and either way the list looked like a patchwork
  // and the tint fought Chromium's highlight for the current row.
  const optionFn = source.slice(source.indexOf('function themeOption'), source.indexOf('function populateThemeSelect'));
  assert.doesNotMatch(optionFn, /background-color/, 'theme rows must not be tinted');
  assert.doesNotMatch(optionFn, /\.css\(/, 'theme rows must not carry inline styling at all');
});

test('the light accent is muted enough for a pale background', () => {
  const light = themeLayers.BUILTIN_COLORS.light;
  const n = parseInt(light.accent.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  assert.ok(saturation < 0.75, `light accent is too saturated for a white surface (${saturation.toFixed(2)})`);
  assert.ok(contrast(light.accent, light.bg) >= 4.5, 'the light accent must still be readable as text on the light background');
});

test('the markup fallback mirrors the primary set', () => {
  const root = htmlParser.parse(fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8'));
  const options = root.querySelectorAll('#option_theme option').map((o) => o.getAttribute('value'));
  assert.deepEqual(options, primary, 'the static <option> list must match PRIMARY_THEMES so the control never flashes a stale list');
});

test('light is the only light-based built-in and stays readable', () => {
  const light = themeLayers.BUILTIN_COLORS.light;
  assert.ok(light, 'the light theme must exist in the theme engine');
  assert.ok(luminance(light.bg) > 0.5, 'the light theme must have a light background');
  for (const [name, colors] of Object.entries(themeLayers.BUILTIN_COLORS)) {
    if (name === 'light') continue;
    assert.ok(luminance(colors.bg) < 0.2, `${name} is expected to stay a dark theme`);
  }
  assert.ok(contrast(light.text, light.bg) >= 4.5, 'light theme body text must meet WCAG AA against its background');
  assert.ok(contrast(light.muted, light.bg) >= 4.5, 'light theme muted text must meet WCAG AA against its background');
});

test('a theme the picker offers survives being saved', () => {
  /*
    settings.js validates general.theme and rewrites anything it does not recognise back to
    "default". It used to carry its own copy of the built-in names, and that copy never learned
    about "light": the picker offered it, the stylesheet implemented it, and the next load quietly
    reset it. Reading the theme engine here is what keeps the two from drifting again.
  */
  const validator = fs.readFileSync(path.join(appDir, 'settings.js'), 'utf8');
  assert.doesNotMatch(
    validator,
    /\[\s*'default',\s*'(?:oled|light)'[^\]]*\]\.includes\(options\.general\.theme\)/,
    'the theme validator must not hard-code a second list of built-ins'
  );
  assert.match(
    validator,
    /Object\.keys\(themeLayers\.BUILTIN_COLORS\)\.includes\(options\.general\.theme\)/,
    'the theme validator must accept every palette the theme engine defines'
  );

  // Custom and user themes are not palettes in BUILTIN_COLORS, so they need their own branches.
  assert.match(validator, /options\.general\.theme !== 'custom'/, 'the Custom theme must stay valid');
  assert.match(validator, /\^user:/, 'user themes from <userData>\\themes must stay valid');
});
