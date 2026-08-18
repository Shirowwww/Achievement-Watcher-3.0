'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const appRoot = path.join(__dirname, '..', '..', 'app');
const defaultPresetsRoot = path.join(appRoot, 'presets', 'Default Presets');

// Hand-written community presets. They carry their own renderer and are deliberately left alone,
// so only the contract that keeps them loadable is checked.
const userPresets = [
  ['presets/Users Presets/Xbox Series', /onNotification/],
  ['presets/Users Presets/Hexagon', /onNotification/],
  ['presets/Users Presets/Pantheon', /onNotification/],
  ['presets/Users Presets/Batman', /onNotification/],
];

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script(?:\s[^>]*)?>/gi)].map((match) => match[1]);
}

test('bundled notification presets contain their assets and valid inline scripts', () => {
  for (const [relative, contract] of userPresets) {
    const root = path.join(appRoot, ...relative.split('/'));
    const htmlPath = path.join(root, 'index.html');
    const cssPath = path.join(root, 'style.css');
    assert.ok(fs.existsSync(htmlPath), `missing ${relative}/index.html`);
    assert.ok(fs.existsSync(cssPath), `missing ${relative}/style.css`);

    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, contract, `${relative} does not consume its expected payload field`);
    assert.match(html, /<meta\s+name=["']duration["']/i, `${relative} has no duration metadata`);
    assert.match(html, /<meta\s+width=["']\d+["']\s+height=["']\d+["']/i, `${relative} has no window-size metadata`);

    const scripts = inlineScripts(html);
    for (const source of scripts) new vm.Script(source, { filename: htmlPath });
    assert.ok(scripts.length > 0, `${relative} has no inline notification script`);
  }
});

/*
  The default library renders through ONE engine.

  Every preset under "Default Presets" carries util/customPreset.js's PRESET_ENGINE verbatim and the
  markup that goes with it, so a preset differs from its neighbours only in its stylesheet. That is
  what makes a fix to rare tiers, the 100% state, the progress line or the marquee land in all of
  them at once - the previous library had seventeen near-copies of the same script, and the drift
  between them is why none of them ever rendered a completion notification.

  If this fails after an intentional engine change, regenerate the bundled index.html files rather
  than letting one of them keep an older copy.
*/
test('every bundled default preset renders through the shared preset engine', () => {
  const { PRESET_ENGINE, PRESET_MARKUP } = require('../../app/util/customPreset.js');
  const names = fs.readdirSync(defaultPresetsRoot).filter((name) => fs.statSync(path.join(defaultPresetsRoot, name)).isDirectory());
  assert.ok(names.length >= 6, `expected a curated default library, found ${names.length} presets`);

  for (const name of names) {
    const htmlPath = path.join(defaultPresetsRoot, name, 'index.html');
    assert.ok(fs.existsSync(htmlPath), `missing ${name}/index.html`);
    assert.ok(fs.existsSync(path.join(defaultPresetsRoot, name, 'style.css')), `missing ${name}/style.css`);

    const html = fs.readFileSync(htmlPath, 'utf8');
    const scripts = inlineScripts(html);
    assert.equal(scripts.length, 1, `${name} must carry exactly one inline script (the shared engine)`);
    assert.equal(scripts[0].trim(), PRESET_ENGINE.trim(), `${name} does not carry the shared preset engine verbatim`);
    assert.ok(html.includes(PRESET_MARKUP), `${name} does not carry the shared preset markup`);
    new vm.Script(scripts[0], { filename: htmlPath });
  }
});

/*
  What the window is given. createNotificationWindow() sizes the popup from <meta width height> and
  times it from <meta name="duration">, and anything a preset paints outside that box is cut off on
  screen. The engine also needs to be able to work out a hold: a duration shorter than the entry and
  exit it declares leaves no time on screen at all.
*/
test('every bundled default preset declares a usable window box and duration', () => {
  const names = fs.readdirSync(defaultPresetsRoot).filter((name) => fs.statSync(path.join(defaultPresetsRoot, name)).isDirectory());

  for (const name of names) {
    const html = fs.readFileSync(path.join(defaultPresetsRoot, name, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(defaultPresetsRoot, name, 'style.css'), 'utf8');

    const box = html.match(/<meta\s+width=["'](\d+)["']\s+height=["'](\d+)["']/i);
    assert.ok(box, `${name} has no window-size metadata`);
    const [width, height] = [Number(box[1]), Number(box[2])];
    assert.ok(width >= 200 && width <= 900, `${name} window width ${width} is outside a sane range`);
    assert.ok(height >= 80 && height <= 460, `${name} window height ${height} is outside a sane range`);

    const duration = html.match(/<meta\s+name=["']duration["']\s+content=["'](\d+)["']/i);
    assert.ok(duration, `${name} has no duration metadata`);
    const total = Number(duration[1]);

    const ms = (property) => {
      const found = css.match(new RegExp(`${property}\\s*:\\s*([\\d.]+)(ms|s)`));
      assert.ok(found, `${name} does not declare ${property}, which the engine reads to size the hold`);
      return found[2] === 's' ? Number(found[1]) * 1000 : Number(found[1]);
    };
    const entry = ms('--ach-in');
    const exit = ms('--ach-out');
    assert.ok(total > entry + exit, `${name} duration ${total}ms leaves no hold after ${entry}ms in and ${exit}ms out`);
    /*
      A custom duration freezes every animation about three seconds in and resumes it later, so a
      preset whose entry is still playing at that point is frozen mid-flight for the whole hold.
    */
    assert.ok(entry <= 2500, `${name} entry ${entry}ms is too slow: a custom duration freezes it mid-animation`);
  }
});

/*
  Cost. A notification is drawn over a running game, so the default library stays on properties the
  compositor can handle on its own.

  backdrop-filter is called out by name because it was in five of the presets this library replaced
  and did nothing in any of them: the notification window is transparent and has no page content
  behind the card to sample, so it only ever bought a blur pass per frame.
*/
test('no bundled default preset uses effects that cost frames over a game', () => {
  const names = fs.readdirSync(defaultPresetsRoot).filter((name) => fs.statSync(path.join(defaultPresetsRoot, name)).isDirectory());

  for (const name of names) {
    const css = fs.readFileSync(path.join(defaultPresetsRoot, name, 'style.css'), 'utf8');
    assert.doesNotMatch(css, /backdrop-filter/i, `${name} uses backdrop-filter, which costs frames and blurs nothing here`);
    assert.doesNotMatch(css, /animation:[^;]*\b(width|height|top|left|right|bottom|margin|padding|box-shadow|filter)\b/i,
      `${name} animates a property that forces layout or repaint`);
  }
});

/*
  The PlayStation-styled presets keep one card size whatever the achievement is called. PS5 Steam
  used `width: fit-content`, so the same notification arrived a different width every time and a
  short name produced a stub next to a long one - the card has a fixed slot for the ring on the
  right, which only reads as deliberate when the card itself does not move.
*/
test('the PlayStation-styled presets have one card width, not one per achievement name', () => {
  for (const relative of ['presets/Default Presets/PlayStation', 'presets/Users Presets/PS5 Steam']) {
    const css = fs.readFileSync(path.join(appRoot, ...relative.split('/'), 'style.css'), 'utf8');
    const card = css.slice(css.indexOf('.ach {'), css.indexOf('}', css.indexOf('.ach {')));
    assert.ok(card, `${relative} has no .ach rule`);
    assert.match(card, /width:\s*\d+px;/, `${relative} must state a fixed card width`);
    assert.doesNotMatch(card, /width:\s*(fit-content|max-content|auto)/, `${relative} must not size itself to its text`);
  }
});
