'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// The main window loads ui/*.js and app.js as classic <script>s sharing one global lexical
// scope. A top-level `const`/`let` declared in two of those scripts is a SyntaxError that
// aborts the second script entirely (3.3.0 regressed with `userThemes`). This test keeps the
// top-level declarations disjoint, in the same order the page loads them.
const appDir = path.join(__dirname, '..', 'app');
const viewHtml = fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8');
const scriptOrder = [...viewHtml.matchAll(/<script src="\.\.\/(ui\/[^"]+\.js|app\.js)"/g)].map((m) => m[1]);

function topLevelDeclarations(file) {
  const source = fs.readFileSync(path.join(appDir, file), 'utf8');
  const names = new Set();
  for (const match of source.matchAll(/^(const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)) {
    names.add(match[2]);
  }
  // Destructured top-level bindings share the same global lexical scope and can collide
  // just like plain `const x` (this regressed with `pathToFileURL` in settings.js).
  for (const match of source.matchAll(/^(?:const|let|var)\s*\{\s*([^}]+?)\s*\}\s*=/gm)) {
    for (const part of match[1].split(',')) {
      const id = /^([A-Za-z_$][\w$]*)/.exec(part.trim());
      if (id) names.add(id[1]);
    }
  }
  return names;
}

test('classic page scripts keep top-level declarations disjoint', () => {
  assert.ok(scriptOrder.includes('app.js'), 'app.js must be loaded by the main window');
  const seen = new Map();
  for (const file of scriptOrder) {
    for (const name of topLevelDeclarations(file)) {
      if (seen.has(name)) {
        assert.fail(`${file} redeclares top-level "${name}" already declared in ${seen.get(name)}`);
      }
      seen.set(name, file);
    }
  }
});
