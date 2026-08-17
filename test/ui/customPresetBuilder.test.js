'use strict';

// The Settings > Notification preset designer writes a real preset folder, so a generated preset has
// to satisfy the same contract createNotificationWindow expects from a bundled one — and every
// property the designer offers has to survive the round trip through the generator unchanged.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const appRoot = path.join(__dirname, '..', '..', 'app');
const generator = require(path.join(appRoot, 'util', 'customPreset.js'));
const schema = require(path.join(appRoot, 'util', 'presetSchema.js'));
const { customPresetNumbers, buildCustomPresetCss, buildCustomPresetHtml, buildPresetPreviewHtml, presetBoxSize, CUSTOM_PRESET_WINDOW_MARGIN } = generator;

// A design that moves every property off its default, so a value that silently fails to reach the
// stylesheet cannot pass by looking like the default.
const FULL = {
  layout: 'icon-top',
  align: 'center',
  width: 520,
  padX: 24,
  padY: 20,
  gap: 6,
  fontFamily: 'condensed',
  fontSize: 22,
  detailScale: 80,
  titleWeight: 900,
  titleCase: 'uppercase',
  letterSpacing: 1.5,
  bgMode: 'gradient',
  bg: '#221100',
  bg2: '#00ff88',
  bgAngle: 45,
  artworkDim: 30,
  artworkBlur: 8,
  text: '#eeeeee',
  accent: '#00ff88',
  opacity: 0.6,
  iconSize: 90,
  iconRadius: 50,
  iconBorder: 3,
  radius: 4,
  accentBar: 'outline',
  accentBarSize: 2,
  borderWidth: 2,
  borderColor: '#123456',
  shadow: 20,
  glow: 65,
  animIn: 'left',
  animOut: 'zoom',
  duration: 4000,
  animInMs: 300,
  animOutMs: 240,
  easing: 'back',
  rareAccent: '#ff0000',
  rareGlow: 25,
  platinumAccent: '#0000ff',
  platinumGlow: 40,
  showProgress: false,
  showRarity: true,
  progressHeight: 14,
  rareSilver: '#aaaaaa',
  rareBronze: '#884400',
  showGameName: true,
  descriptionLines: 3,
  textShadow: 45,
  iconGlow: 70,
  titleColorMode: 'custom',
  titleColor: '#ff00ff',
  entryDistance: 60,
  artworkPosition: 'top',
  sound: 'Xbox.wav',
};

test('the reference design covers every property, so nothing new is silently untested', () => {
  // Everything below asserts against FULL. A property added to the schema without a value here would
  // be checked against `undefined` and pass by looking like nothing.
  for (const property of schema.PRESET_PROPERTIES) {
    assert.ok(FULL[property.key] !== undefined, `FULL is missing ${property.key}`);
    assert.notDeepEqual(FULL[property.key], property.def, `FULL must move ${property.key} off its default`);
  }
});

test('every option is clamped to the range the designer offers', () => {
  const tooBig = {};
  const tooSmall = {};
  for (const property of schema.PRESET_PROPERTIES) {
    if (property.type !== 'number') continue;
    tooBig[property.key] = 99999;
    tooSmall[property.key] = -99999;
  }
  const high = customPresetNumbers(tooBig);
  const low = customPresetNumbers(tooSmall);
  for (const property of schema.PRESET_PROPERTIES) {
    if (property.type !== 'number') continue;
    assert.equal(high[property.key], property.max, `${property.key} not clamped to its maximum`);
    assert.equal(low[property.key], property.min, `${property.key} not clamped to its minimum`);
  }

  // No options at all is the same as the built-in defaults, so an empty payload still renders.
  const defaults = customPresetNumbers();
  for (const property of schema.PRESET_PROPERTIES) {
    assert.equal(defaults[property.key], property.def, `${property.key} has no usable default`);
  }
  // A select or a sound that is not one of the values the designer can produce falls back too.
  const nonsense = customPresetNumbers({ layout: 'diagonal', animIn: 'sideways', sound: '../../evil.exe', showProgress: 'maybe' });
  assert.equal(nonsense.layout, 'icon-left');
  assert.equal(nonsense.animIn, 'bottom');
  assert.equal(nonsense.sound, '');
  assert.equal(nonsense.showProgress, true);
});

test('the eight options that predate the designer still normalize to the same values', () => {
  // An aw-preset.json or an .awpreset manifest written before the designer existed carries only
  // these, and must keep producing exactly the design it always did.
  const legacy = { bg: '#101010', text: '#f0f0f0', accent: '#ff8800', opacity: 0.8, fontSize: 20, radius: 6, iconSize: 80, width: 500 };
  const values = customPresetNumbers(legacy);
  for (const [key, value] of Object.entries(legacy)) assert.equal(values[key], value, `${key} changed meaning`);
  // …and the properties it never knew about arrive at the look it used to hard-code.
  assert.equal(values.layout, 'icon-left');
  assert.equal(values.accentBar, 'left');
  assert.equal(values.accentBarSize, 4);
  assert.equal(values.padX, 18);
  assert.equal(values.padY, 12);
  assert.equal(values.gap, 12);
  assert.equal(values.animIn, 'bottom');
  assert.equal(values.duration, 6000);
  assert.equal(values.iconRadius, 14);
  assert.equal(values.rareAccent, '#ffd24e');
  assert.equal(values.rareSilver, '#9fb2cc');
  assert.equal(values.rareBronze, '#cd7f32');
});

test('a colour that is not a colour cannot smuggle CSS into the generated stylesheet', () => {
  const hostile = {
    bg: 'red; } body { display: none } .x {',
    accent: 'url(http://evil/x)',
    text: 'expression(alert(1))',
    borderColor: '#fff; background-image: url(http://evil/y)',
    rareAccent: '</style><script>alert(1)</script>',
  };
  const values = customPresetNumbers(hostile);
  assert.equal(values.bg, '#16181d');
  assert.equal(values.accent, '#4aa3ff');
  assert.equal(values.text, '#ffffff');
  assert.equal(values.borderColor, '#ffffff');
  assert.equal(values.rareAccent, '#ffd24e');
  // None of the hostile payloads reach the stylesheet (`display: none` on its own would match the
  // preset's own legitimate `.progress_line[hidden]` rule, so match the injected text itself).
  const css = buildCustomPresetCss(hostile);
  for (const payload of ['body { display: none }', 'evil', 'expression(', '<script']) {
    assert.ok(!css.includes(payload), `generated CSS leaked ${payload}`);
  }
});

test('the generated stylesheet carries every option through to CSS', () => {
  const css = buildCustomPresetCss(FULL);

  // Everything with a direct CSS mapping is declared exactly once, with the value the schema says.
  for (const property of schema.PRESET_PROPERTIES) {
    if (!property.css) continue;
    const expected = `${property.css}: ${schema.cssValue(property.key, FULL[property.key])};`;
    assert.ok(css.includes(expected), `stylesheet is missing ${expected}`);
  }

  // …and the properties resolved through a table rather than written out by the user.
  assert.match(css, /--font: 'Bahnschrift'/, 'font stack not applied');
  assert.match(css, /--ease: cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/, 'easing not applied');
  // The offsets are the edge's own distance scaled by the travel distance (60% of -130% = -78%).
  assert.match(css, /--in-dx: -78%; --in-dy: 0%; --in-scale: 1;/, 'entry direction not applied');
  assert.match(css, /--out-dx: 0%; --out-dy: 0%; --out-scale: 0\.82;/, 'exit direction not applied');
  assert.match(css, /color: var\(--title-color\)/, 'a custom title colour is not applied');
  assert.match(buildCustomPresetCss({}), /--in-dy: 170%/, 'the default travel must be the full distance');
  assert.match(buildCustomPresetCss({ entryDistance: 200 }), /--in-dy: 340%/, 'travel distance does not scale the offsets');
  assert.match(buildCustomPresetCss({ titleColorMode: 'text' }), /\.ach \.title \{[^}]*color: var\(--text\)/);
  assert.match(buildCustomPresetCss({}), /\.ach \.title \{[^}]*color: var\(--accent\)/, 'the title must follow the accent by default');
  assert.match(css, /background: linear-gradient\(var\(--bg-angle\)/, 'gradient background not applied');
  assert.match(css, /flex-direction: column; align-items: center;/, 'icon-on-top layout not applied');
  assert.match(css, /text-align: center;/, 'alignment not applied');
  assert.match(css, /border: var\(--bar-size\) solid var\(--accent\);/, 'outline accent bar not applied');
  assert.match(css, /\.progress_line \{ display: none;/, 'progress bar cannot be switched off');

  // The card must read the width variable rather than a baked-in literal.
  assert.match(css, /width: var\(--width\)/);
  assert.doesNotMatch(css, /width: 420px/);
});

test('rare and completion notifications repaint the card from one accent variable', () => {
  const css = buildCustomPresetCss({});
  // Everything accent-coloured reads --accent…
  assert.match(css, /--accent: var\(--accent-base\); --glow-strength: var\(--glow\);/);
  assert.match(css, /\.ach \.title \{[^}]*color: var\(--accent\)/);
  assert.match(css, /\.progress_meter \{[^}]*var\(--accent\)/);
  // …and the states re-point it, so one stylesheet paints all three without a second card.
  assert.match(css, /\.ach\.state-rare \{ --accent: var\(--rare-accent\); --glow-strength: var\(--rare-glow\); \}/);
  assert.match(css, /\.ach\.state-rare\.tier-silver \{ --accent: var\(--rare-silver\); \}/);
  assert.match(css, /\.ach\.state-rare\.tier-bronze \{ --accent: var\(--rare-bronze\); \}/);
  assert.match(css, /\.ach\.state-platinum \{ --accent: var\(--platinum-accent\); --glow-strength: var\(--platinum-glow\); \}/);
});

test('the artwork background is only built when a preset actually paints one', () => {
  const plain = buildCustomPresetCss({ bgMode: 'solid' });
  assert.doesNotMatch(plain, /\.ach::before/, 'a solid preset still pays for the artwork layer');

  const artwork = buildCustomPresetCss({ bgMode: 'artwork' });
  assert.match(artwork, /\.ach::before \{[^}]*background-image: var\(--artwork\)/);
  assert.match(artwork, /filter: blur\(var\(--artwork-blur\)\)/);
  assert.match(artwork, /opacity: calc\(1 - var\(--artwork-dim\)\)/);
  // The engine publishes the payload's image under that variable, for any preset that wants it.
  assert.match(generator.PRESET_ENGINE, /setProperty\('--artwork'/);
});

test('the host window is sized from the design, so a taller or glowing preset is never clipped', () => {
  for (const width of [280, 420, 620]) {
    const options = { width, glow: 0, rareGlow: 0, platinumGlow: 0 };
    const html = buildCustomPresetHtml(options);
    const meta = /<meta width="(\d+)" height="(\d+)"/.exec(html);
    assert.ok(meta, `no window-size metadata for width ${width}`);
    assert.equal(Number(meta[1]), width + CUSTOM_PRESET_WINDOW_MARGIN, `window too narrow for a ${width}px popup`);
    assert.ok(Number(meta[2]) > 0);
  }
  // An out-of-range width is clamped identically in the CSS and in the metadata.
  const clamped = customPresetNumbers({ width: 5000 }).width;
  assert.equal(Number(/<meta width="(\d+)"/.exec(buildCustomPresetHtml({ width: 5000, glow: 0, rareGlow: 0, platinumGlow: 0 }))[1]), clamped + CUSTOM_PRESET_WINDOW_MARGIN);

  // A stacked layout is taller than the row layout it replaced, and the box has to follow or the
  // popup is cropped on screen — the meta box is the whole window the notification gets.
  const row = presetBoxSize({ layout: 'icon-left', iconSize: 96 });
  const stacked = presetBoxSize({ layout: 'icon-top', iconSize: 96 });
  assert.ok(stacked.height > row.height + 60, 'stacking the icon above the text did not grow the window');

  // A glow paints outside the card, so it widens the box — but only past the slack already there.
  const calm = presetBoxSize({ glow: 0, rareGlow: 0, platinumGlow: 0 });
  const glowing = presetBoxSize({ glow: 100, rareGlow: 100, platinumGlow: 100 });
  assert.ok(glowing.width > calm.width, 'a strong glow is not given room');
  assert.equal(presetBoxSize({ glow: 10, rareGlow: 0, platinumGlow: 0 }).width, calm.width, 'a faint glow should not move the popup');
});

test('the generated preset satisfies the notification-window contract', () => {
  const html = buildCustomPresetHtml(FULL);
  assert.match(html, /<meta\s+name="duration"\s+content="4000"/i, 'the chosen display time is not the preset duration');
  assert.match(html, /<link rel="stylesheet" href="style\.css"/, 'does not load its generated stylesheet');
  assert.match(html, /window\.api\.onNotification/, 'does not consume the notification payload');
  assert.match(html, /window\.api\.closeNotificationWindow/, 'never closes its own window');
  assert.match(html, /notificationRenderReady/, 'never signals that it has rendered');

  let scripts = 0;
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi)) {
    new vm.Script(match[1], { filename: 'generated-preset.html' }); // throws on a syntax error
    scripts += 1;
  }
  assert.equal(scripts, 1, 'expected exactly one inline engine script');
});

test('the designer previews the real preset rather than a second renderer', () => {
  const preview = buildPresetPreviewHtml(FULL);
  // Same engine, same markup, same generated stylesheet — the preview only adds the bridge that
  // stands in for the notification window's IPC.
  assert.ok(preview.includes(generator.PRESET_ENGINE), 'the preview does not run the preset engine');
  assert.ok(preview.includes(generator.PRESET_MARKUP), 'the preview does not use the preset markup');
  assert.ok(preview.includes(buildCustomPresetCss(FULL)), 'the preview does not use the generated stylesheet');
  assert.match(preview, /<style id="aw-preview-css">/, 'the designer cannot swap the stylesheet live');
  assert.match(preview, /window\.awPreviewApply/, 'the designer cannot feed it a sample notification');

  // Holding keeps the card on screen while it is being designed; playing it once uses the preset's
  // own display time, so what the user watches is the timing they picked.
  assert.match(buildPresetPreviewHtml(FULL, { hold: false }), /<meta name="duration" content="4000"/);
  const held = /<meta name="duration" content="(\d+)"/.exec(buildPresetPreviewHtml(FULL))[1];
  assert.ok(Number(held) > 60000, 'the held preview closes itself while the user is still working');
});

test('the preview scripts are pinned in the Settings page CSP, or the preview silently dies', () => {
  /*
    The preview frame is a srcdoc document, which inherits the embedder's Content-Security-Policy —
    so its two inline scripts only run because view/app.html lists their hashes. Nothing else fails
    loudly when they drift: the frame just renders an empty card.
  */
  const appHtml = fs.readFileSync(path.join(appRoot, 'view', 'app.html'), 'utf8');
  const csp = /content="(default-src[^"]+)"/.exec(appHtml);
  assert.ok(csp, 'the Settings page has no CSP to pin against');
  for (const hash of generator.PREVIEW_SCRIPT_HASHES) {
    assert.ok(csp[1].includes(`'${hash}'`), `CSP is missing ${hash} — regenerate it from PREVIEW_SCRIPT_HASHES`);
  }
  // The hashes have to be over exactly what is embedded, or they would be decorative. Match the tag
  // case-insensitively and allow attributes: a bare lowercase `<script>` pattern would quietly find
  // nothing the day the generator changes the tag, leaving this loop asserting nothing at all.
  const embedded = [...buildPresetPreviewHtml({}).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(embedded.length, generator.PREVIEW_SCRIPT_HASHES.length, 'every embedded preview script must have a published hash');
  for (const match of embedded) {
    const hash = `sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}`;
    assert.ok(generator.PREVIEW_SCRIPT_HASHES.includes(hash), 'an inline preview script is not covered by a published hash');
  }
});

test('a preset can carry its own sound, and anything that is not a sound file is ignored', () => {
  assert.equal(customPresetNumbers({ sound: 'Xbox Rare.wav' }).sound, 'Xbox Rare.wav');
  assert.equal(customPresetNumbers({ sound: 'beep.mp3' }).sound, 'beep.mp3');
  // '' means "use the sound the Notifications tab is set to", which is what every preset says until
  // the designer gives it one.
  assert.equal(customPresetNumbers({}).sound, '');
  for (const hostile of ['..\\..\\windows\\system32\\evil.wav', 'sounds/deep.wav', 'evil.exe', 'C:\\x.wav', 'x.wav\0']) {
    assert.equal(customPresetNumbers({ sound: hostile }).sound, '', `${hostile} was accepted as a sound`);
  }
});

test('presetSound reads what a preset asks for, and never becomes a reason for silence', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'aw-preset-sound-'));
  try {
    assert.equal(generator.presetSound(dir), '', 'a preset with no options file must defer to the app setting');
    assert.equal(generator.presetSound(''), '');
    fs.writeFileSync(path.join(dir, generator.PRESET_OPTIONS_FILE), '{ not json', 'utf8');
    assert.equal(generator.presetSound(dir), '', 'an unreadable options file must defer to the app setting');
    fs.writeFileSync(path.join(dir, generator.PRESET_OPTIONS_FILE), JSON.stringify({ name: 'x', sound: 'Steam.wav' }), 'utf8');
    assert.equal(generator.presetSound(dir), 'Steam.wav');
    fs.writeFileSync(path.join(dir, generator.PRESET_OPTIONS_FILE), JSON.stringify({ name: 'x', sound: '../evil.wav' }), 'utf8');
    assert.equal(generator.presetSound(dir), '', 'a sound path from a hand-edited file must not be trusted');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the notification path prefers the preset sound and keeps random sound on top', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  assert.match(init, /const presetOwnSound = customPreset\.presetSound\(presetFolder\);/, 'the preset folder is never asked for its sound');
  assert.match(init, /resolveNotificationSound\(presetOwnSound \|\| ov\.notificationSound\)/, 'the preset sound does not win over the app setting');
  // "Random sound" is an explicit choice for every popup and still overrides both.
  assert.match(init, /randomSound\s*\n?\s*\?\s*notificationSounds\.pickRandomSound/);
});

test('init.js reserves the preview preset name and hides it from the preset list', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  const reserved = /const PREVIEW_PRESET_NAME = '([^']+)';/.exec(init);
  assert.ok(reserved, 'no reserved preview preset name');
  // The scratch preset the Preview button writes must never be offered as a real preset...
  assert.match(init, /if \(name === PREVIEW_PRESET_NAME\) continue;/, 'list-presets does not skip the preview preset');
  assert.match(init, /name !== PREVIEW_PRESET_NAME/, 'list-custom-presets does not skip the preview preset');
  // ...nor be creatable by hand under that name.
  assert.match(init, /if \(name === PREVIEW_PRESET_NAME\) return \{ ok: false, error: 'reserved-name' \};/);
});

test('a generated preset stores the builder options that produced it, so it can be re-opened', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  // The name lives in customPreset.js so the designer and the package importer share one spelling.
  assert.equal(generator.PRESET_OPTIONS_FILE, 'aw-preset.json');
  assert.match(init, /const \{ PRESET_OPTIONS_FILE \} = customPreset;/);
  assert.match(init, /fs\.writeFileSync\(path\.join\(dir, PRESET_OPTIONS_FILE\)/, 'writeCustomPreset does not persist its options');
  // read-custom-preset re-clamps what it read, so a hand-edited options file cannot widen the ranges.
  assert.match(init, /return \{ name: safe, editable: true, \.\.\.customPresetNumbers\(parsed\) \};/);
});

test('generated presets are written under userData, never inside the packaged app', () => {
  const { generatedPresetsDir, GENERATED_PRESETS_SUBPATH } = generator;

  const userData = path.join('C:', 'Users', 'someone', 'AppData', 'Roaming', 'Achievement Watcher Next');
  const dir = generatedPresetsDir(userData);

  assert.ok(dir.startsWith(userData + path.sep), `${dir} is not under userData`);
  assert.equal(dir, path.join(userData, ...GENERATED_PRESETS_SUBPATH));
  // Packaging puts app/presets inside app.asar, which is a file: mkdir below it fails with ENOTDIR,
  // so Preview and Save silently died on every installed build. Nothing may point back at the app.
  assert.doesNotMatch(dir, /app\.asar/i);
  assert.throws(() => generatedPresetsDir(''), /userData path is required/);
});

test('init.js resolves generated presets from userData and reads the bundled libraries separately', () => {
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');

  // The single writable root, taken from the tested helper rather than rebuilt by hand.
  assert.match(init, /const usersPresetsDir = \(\) => customPreset\.generatedPresetsDir\(userData\);/);
  // Every write goes through it...
  const write = /function writeCustomPreset[\s\S]*?\n}/.exec(init);
  assert.ok(write, 'writeCustomPreset not found');
  assert.match(write[0], /path\.join\(usersPresetsDir\(\), name\)/);
  assert.doesNotMatch(write[0], /__dirname/, 'writeCustomPreset still targets the app folder');
  // ...and the notification lookup still finds both the generated and the bundled presets.
  assert.match(init, /const roots = \[usersPresetsDir\(\), \.\.\.bundledPresetRoots\(\)/);
  assert.match(init, /const roots = \[\.\.\.bundledPresetRoots\(\), usersPresetsDir\(\)\]/);
});
