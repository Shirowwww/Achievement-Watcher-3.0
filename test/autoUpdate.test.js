'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const yaml = require(path.join(__dirname, '..', 'app', 'node_modules', 'js-yaml'));

test('packaged builds check the GitHub release feed and can install a downloaded update', () => {
  const appRoot = path.join(__dirname, '..', 'app');
  const builder = yaml.load(fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8'));
  assert.deepStrictEqual(builder.publish, {
    provider: 'github',
    owner: 'Shirowwww',
    repo: 'Achievement-Watcher-3.0',
  });

  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  assert.match(init, /autoUpdater\.autoDownload\s*=\s*true/);
  assert.match(init, /if \(app\.isPackaged\)/);
  assert.match(init, /autoUpdater\.checkForUpdates\(\)/);
  assert.match(init, /autoUpdater\.on\('update-downloaded'/);
  assert.match(init, /autoUpdater\.quitAndInstall\(\)/);
});
