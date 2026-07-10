'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const appRoot = path.join(__dirname, '..', 'app');
const presets = [
  ['presets/Default Presets/Game Cover', /headerPath/],
  ['presets/Users Presets/Xbox Series', /onNotification/],
  ['presets/Users Presets/Xbox Series - Purple', /onNotification/],
  ['presets/Users Presets/Xbox Series Rare', /onNotification/],
  ['presets/Users Presets/Xbox Series Rare - Purple', /onNotification/],
  ['presets/Users Presets/Xbox Series Platinum', /isPlatinum/],
  ['presets/Users Presets/Xbox Series Platinum - Purple', /isPlatinum/],
];

test('bundled notification presets contain their assets and valid inline scripts', () => {
  for (const [relative, contract] of presets) {
    const root = path.join(appRoot, ...relative.split('/'));
    const htmlPath = path.join(root, 'index.html');
    const cssPath = path.join(root, 'style.css');
    assert.ok(fs.existsSync(htmlPath), `missing ${relative}/index.html`);
    assert.ok(fs.existsSync(cssPath), `missing ${relative}/style.css`);

    const html = fs.readFileSync(htmlPath, 'utf8');
    assert.match(html, contract, `${relative} does not consume its expected payload field`);
    assert.match(html, /<meta\s+name=["']duration["']/i, `${relative} has no duration metadata`);
    assert.match(html, /<meta\s+width=["']\d+["']\s+height=["']\d+["']/i, `${relative} has no window-size metadata`);

    let scriptCount = 0;
    for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      new vm.Script(match[1], { filename: htmlPath });
      scriptCount += 1;
    }
    assert.ok(scriptCount > 0, `${relative} has no inline notification script`);
  }
});
