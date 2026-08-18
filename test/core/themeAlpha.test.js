'use strict';

/*
  Custom-theme layer colors may be translucent (or fully transparent). `<input type="color">` has no
  alpha channel, so the editor stores the alpha in the color itself as #rrggbbaa and splits it back
  apart to fill the picker - these helpers are that split/rejoin, and everything downstream
  (color-mix, the veils, the overlay palette) has to keep working on the 8-digit form.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const themeLayers = require('../../app/util/themeLayers.js');

test('alpha survives the round trip through a picker that has no alpha channel', () => {
  const { colorAlpha, colorWithAlpha, colorWithoutAlpha } = themeLayers;

  assert.equal(colorAlpha('#142236'), 100, 'a plain hex is fully opaque');
  assert.equal(colorAlpha('#14223600'), 0);
  assert.equal(colorAlpha('#142236ff'), 100);
  assert.equal(colorAlpha('rgba(1, 2, 3, 0.5)'), 50);
  assert.equal(colorAlpha('#abcd'), colorAlpha('#aabbccdd'), 'the short form means the same thing');
  assert.equal(colorAlpha(''), 100);

  assert.equal(colorWithoutAlpha('#142236aa'), '#142236');
  assert.equal(colorWithoutAlpha('#abc'), '#aabbcc');
  assert.equal(colorWithoutAlpha('rgb(255, 0, 128)'), '#ff0080');

  // 100% keeps writing a 6-digit hex, so a theme that never touches opacity is stored unchanged.
  assert.equal(colorWithAlpha('#142236', 100), '#142236');
  assert.equal(colorWithAlpha('#142236', 0), '#14223600');
  assert.equal(colorWithAlpha('#142236', 50), '#14223680');
  assert.equal(colorAlpha(colorWithAlpha('#142236', 37)), 37);
});

test('an alpha color keeps its own hue everywhere a triplet is needed', () => {
  // hexToRgbTriplet used to reject an 8-digit hex and fall back to the default accent, which turned
  // every translucent layer into stock blue in --accent-soft and in the veil layers.
  assert.equal(themeLayers.hexToRgbTriplet('#142236aa'), '20, 34, 54');
  assert.equal(themeLayers.hexToRgbTriplet('#142236'), '20, 34, 54');
  assert.equal(themeLayers.hexToRgbTriplet('#abcd'), themeLayers.hexToRgbTriplet('#aabbcc'));
});

test('a translucent layer color is stored and rendered as chosen', () => {
  const clean = themeLayers.sanitizeCustomTheme({
    bg: { color: '#11223344' },
    header: { color: '#00000000' },
    accent: { color: '#ff0080cc' },
  });
  assert.equal(clean.bg.color, '#11223344', 'sanitize must not strip the alpha channel');
  assert.equal(clean.header.color, '#00000000');

  const css = themeLayers.buildCustomAppCss(clean);
  assert.match(css, /--bg-base: #11223344;/);
  assert.match(css, /--accent: #ff0080cc;/);
  assert.match(css, /--accent-soft: rgba\(255, 0, 128, 0\.16\);/, 'the accent tint follows the chosen hue, not the default');
});

/*
  The opacity slider has to be the only thing deciding how much of a layer you see.

  app.css frosts the library panel, the game cards and the Settings modal with a backdrop blur, and
  a blur outlives its own colour going transparent: taken to 0% the panel was still a blurred pane
  of exactly its own shape, and the library behind the Settings modal stayed dimmed and washed out
  no matter where the slider went. Which reads, correctly, as "the opacity does nothing".
*/
test('a translucent layer drops the frosted blur that would survive its own transparency', () => {
  const theme = themeLayers.defaultCustomTheme();
  const opaque = themeLayers.buildCustomAppCss(theme);
  assert.doesNotMatch(opaque, /backdrop-filter: none/, 'a fully opaque theme changes nothing');

  theme.panel.color = themeLayers.colorWithAlpha(theme.panel.color, 60);
  const css = themeLayers.buildCustomAppCss(theme);
  const panelRule = css.split('\n\n').find((block) => block.startsWith('#game-list {') && /backdrop-filter/.test(block));
  assert.ok(panelRule, 'the library panel clears its blur');
  assert.match(panelRule, /-webkit-backdrop-filter: none;/, 'both spellings, since app.css sets both');
  // At 60% the panel is still a surface: it keeps its outline and its shadow.
  assert.doesNotMatch(panelRule, /box-shadow/);

  // Only the layers actually taken down are touched.
  assert.ok(!css.split('\n\n').some((b) => b.startsWith('#game-list .game-box {') && /backdrop-filter/.test(b)));
});

test('a layer at 0% leaves nothing behind, silhouette included', () => {
  const theme = themeLayers.defaultCustomTheme();
  theme.card.color = themeLayers.colorWithAlpha(theme.card.color, 0);
  const cardRule = themeLayers
    .buildCustomAppCss(theme)
    .split('\n\n')
    .find((block) => block.startsWith('#game-list .game-box {'));
  assert.match(cardRule, /backdrop-filter: none;/);
  assert.match(cardRule, /border-color: transparent;/, 'an invisible card may not still draw its outline');
  assert.match(cardRule, /box-shadow: none;/, 'nor its drop shadow');
});

test('the scrim behind the Settings modal fades with the Settings layer', () => {
  const theme = themeLayers.defaultCustomTheme();
  const scrimOf = (percent) => {
    theme.settings.color = themeLayers.colorWithAlpha('#263b55', percent);
    return themeLayers
      .buildCustomAppCss(theme)
      .split('\n\n')
      .find((block) => block.startsWith('#settings .overlay,'));
  };

  assert.equal(scrimOf(100), undefined, 'an opaque Settings layer keeps the stock scrim');

  const half = scrimOf(50);
  assert.match(half, /background-color: color-mix\(in srgb, var\(--set-scrim\) 50%, transparent\);/);
  assert.match(half, /backdrop-filter: none;/, 'the library behind must stop being blurred');

  // At 0% the modal is gone, so nothing may still dim or texture what is behind it.
  const clear = scrimOf(0);
  assert.match(clear, /var\(--set-scrim\) 0%, transparent/);
  assert.match(clear, /background-image: none;/, 'the scrim noise texture goes with it');
});

/*
  The other half of the rule. Removing the automatic frost from a translucent layer must not make a
  blur unreachable: Effect -> Blur is how a see-through layer becomes real frosted glass, and it has
  to keep working at 0%, where the blur is the only thing left to see.
*/
test('Effect Blur puts a real backdrop blur on the layer, transparent or not', () => {
  const blurEffect = (px) => ({ enabled: true, type: 'blur', color: '#000000', opacity: 40, blur: px, blurImage: '' });
  const ruleFor = (theme, selector) =>
    themeLayers
      .buildCustomAppCss(theme)
      .split('\n\n')
      .find((block) => block.startsWith(selector) && /backdrop-filter/.test(block));

  const theme = themeLayers.defaultCustomTheme();
  theme.panel.color = themeLayers.colorWithAlpha(theme.panel.color, 0);
  theme.panel.effect = blurEffect(16);

  const panel = ruleFor(theme, '#game-list {');
  assert.match(panel, /backdrop-filter: blur\(16px\);/, 'a fully transparent layer still blurs when asked to');
  assert.match(panel, /-webkit-backdrop-filter: blur\(16px\);/);
  // The blur is the layer now, so nothing may strip its outline as if it were not there.
  assert.doesNotMatch(panel, /box-shadow: none/);

  // The slider drives the radius, and it applies to every surface with something behind it.
  theme.header.effect = blurEffect(4);
  theme.card.effect = blurEffect(30);
  theme.settings.effect = blurEffect(8);
  const css = themeLayers.buildCustomAppCss(theme);
  assert.match(css, /title-bar \{\n {2}backdrop-filter: blur\(4px\);/);
  assert.match(css, /#game-list \.game-box \{\n {2}backdrop-filter: blur\(30px\);/);
  assert.match(css, /#settings \.box,\n#game-config \.box \{\n {2}backdrop-filter: blur\(8px\);/);

  // A veil is not a blur, and a disabled effect is not one either: both leave the layer crisp.
  const veiled = themeLayers.defaultCustomTheme();
  veiled.panel.color = themeLayers.colorWithAlpha(veiled.panel.color, 0);
  veiled.panel.effect = { enabled: true, type: 'veil', color: '#000000', opacity: 40, blur: 20, blurImage: '' };
  assert.match(ruleFor(veiled, '#game-list {'), /backdrop-filter: none;/);

  const off = themeLayers.defaultCustomTheme();
  off.panel.color = themeLayers.colorWithAlpha(off.panel.color, 0);
  off.panel.effect = { ...blurEffect(20), enabled: false };
  assert.match(ruleFor(off, '#game-list {'), /backdrop-filter: none;/);
});
