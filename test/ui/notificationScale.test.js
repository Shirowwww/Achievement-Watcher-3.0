'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.join(__dirname, '..', '..');
const init = fs.readFileSync(path.join(root, 'app', 'electron', 'init.js'), 'utf8');
const presetRoots = [path.join(root, 'app', 'presets', 'Default Presets'), path.join(root, 'app', 'presets', 'Users Presets')];

function readPresets() {
  return presetRoots.flatMap((presetRoot) =>
    fs
      .readdirSync(presetRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(presetRoot, entry.name, 'index.html')))
      .map((entry) => ({
        name: entry.name,
        dir: path.join(presetRoot, entry.name),
        html: fs.readFileSync(path.join(presetRoot, entry.name, 'index.html'), 'utf8'),
      }))
  );
}

test('notification scaling is applied as page zoom, not as a second transform inside the preset', () => {
  // The window is the preset's <meta> box multiplied by the scale, so the page must be zoomed by
  // that same factor: the preset then lays out at its design size and paints exactly filling the
  // window. Handing the preset the scale as well shrank an already-shrunken layout a second time.
  assert.match(init, /zoomFactor: scale,/);
  assert.match(init, /notif\.webContents\.setZoomFactor\(scale\);[\s\S]*?send\('show-notification'/);
  assert.match(init, /position: data\.position,[\s\S]*?\n\s*scale: 1,/);
});

test('presets anchored to a screen edge keep that edge while their width animates', () => {
  // The Xbox Series family expands a collapsed badge into a full pill. Its script picks the anchor
  // (--translate-x / --origin-x: left, right or centered) from the notification position, but the
  // stylesheet used to hard-code translate(-50%): a right-anchored popup therefore drifted half its
  // grown width to the left, ending clipped by its own window on the opposite side.
  for (const preset of readPresets()) {
    const cssPath = path.join(preset.dir, 'style.css');
    if (!fs.existsSync(cssPath)) continue;
    const css = fs.readFileSync(cssPath, 'utf8');
    if (!/setProperty\(\s*["']--translate-x/.test(preset.html)) continue;
    assert.match(css, /transform:\s*translate\(\s*var\(--translate-x/, `${preset.name} ignores --translate-x`);
    assert.match(css, /transform-origin:\s*var\(--origin-x/, `${preset.name} ignores --origin-x`);
  }
});

test('a preset never sets a CSS variable nothing reads', () => {
  // This is the static signature of the Xbox Series bug above: the script published an anchor the
  // stylesheet never consumed, so the popup silently used a different one. A variable set at
  // runtime and read by no rule is either dead weight or a wire that came loose.
  const { PRESET_ENGINE } = require('../../app/util/customPreset.js');
  /*
    Except where the script is not the preset's own. The shared engine publishes the notification's
    artwork to every preset that runs it, because any design MAY paint it - a design that does not
    (most of them) is declining a capability, not leaving a wire loose. Everything else the engine
    publishes still has to be consumed: --scale and --ach-hold are what scale and time the card.
  */
  const SHARED_ENGINE_OPTIONAL = new Set(['--artwork']);

  for (const preset of readPresets()) {
    const cssPath = path.join(preset.dir, 'style.css');
    const styles = preset.html + (fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '');
    const sharedEngine = preset.html.includes(PRESET_ENGINE.trim());
    for (const [, name] of preset.html.matchAll(/setProperty\(\s*["'](--[a-z0-9-]+)/gi)) {
      if (sharedEngine && SHARED_ENGINE_OPTIONAL.has(name)) continue;
      assert.match(styles, new RegExp(`var\\(\\s*${name}\\b`), `${preset.name} sets ${name} but never reads it`);
    }
  }
});

test('every bundled preset declares the meta box the host sizes its window from', () => {
  // Without it getPresetDimensions() falls back to 400x200 and the window no longer matches what
  // the preset paints — the same mismatch, from the other end, that the zoom fix removes.
  for (const preset of readPresets()) {
    assert.match(preset.html, /<meta\s+width\s*=\s*"\d+"\s+height\s*=\s*"\d+"\s*\/?>/i, `${preset.name} has no <meta width height>`);
  }
});
