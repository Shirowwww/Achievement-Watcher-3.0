'use strict';

/*
  Which right-click entries every game gets, regardless of where it came from.

  "Launch game" and "Configure executable…" were built inside the `if (isUbisoftSource)` branch, so
  right-clicking a Steam, GOG, Epic or emulated game offered no way to start it — even with the
  executable already configured, and even though the tile's own play button works for every source.
  Balanced braces hide that kind of mistake, so this walks the brace depth to find the conditions
  actually enclosing each entry.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
const lines = source.split(/\r?\n/);

// The chain of still-open `{` blocks above a line, nearest first.
function enclosingBlocks(marker) {
  const target = lines.findIndex((line) => line.includes(marker));
  assert.ok(target >= 0, `marker not found: ${marker}`);
  const chain = [];
  let depth = 0;
  for (let i = target; i >= 0; i--) {
    const code = lines[i].replace(/\/\/.*$/, '');
    for (const ch of [...code].reverse()) {
      if (ch === '}') depth += 1;
      else if (ch === '{') {
        depth -= 1;
        if (depth < 0) {
          chain.push(lines[i].trim());
          depth = 0;
        }
      }
    }
  }
  return chain;
}

test('launching a game is offered for every source, not only Ubisoft', () => {
  for (const marker of ["t('launch-game'", "t('configure-executable'"]) {
    const chain = enclosingBlocks(marker);
    assert.ok(
      !chain.some((line) => line.includes('isUbisoftSource')),
      `${marker} is gated by isUbisoftSource: ${chain.slice(0, 3).join(' <- ')}`
    );
    assert.ok(
      chain.some((line) => line.includes("contextmenu(function")),
      `${marker} should be built inside the tile context-menu handler`
    );
  }
});

test('reset playtime stays Ubisoft-only, since other sources add their own', () => {
  // Both branches append it; duplicating it for Ubisoft would show the entry twice.
  const chain = enclosingBlocks("data-ctx-resetplaytime");
  assert.ok(chain.some((line) => line.includes('isUbisoftSource')), 'the first reset-playtime entry is the Ubisoft one');
  assert.equal((source.match(/data-ctx-resetplaytime/g) || []).length, 2, 'exactly one entry per branch');
});

test('the launch entry drives the same handler as the tile play button', () => {
  const start = source.indexOf("t('launch-game'");
  const body = source.slice(start, start + 400);
  assert.match(body, /app\.onPlayButtonClick\(self\.find\('\.play-button'\)\)/);
});
