'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const s = require('../app/parser/steamdbLaunch.js');

// Compact fixture mirroring SteamDB's real "Launch Options" markup (one .panel.launch-option per
// option, a table of <td>key</td><td><code>value</code></td> rows). Covers Windows/macOS/Linux,
// a DLC option, and duplicate exe names.
const FIXTURE = `
<h2>Launch Options</h2>
<div class="panel launch-option">
  <div class="panel-heading">0. Unnamed launch option</div>
  <table><tbody>
    <tr><td>Executable</td><td><code>game_win64.exe</code></td><td>tip</td></tr>
    <tr><td>Arguments</td><td><code>-steam</code></td><td>tip</td></tr>
    <tr><td>Operating System</td><td><code>Windows</code></td><td>tip</td></tr>
    <tr><td>Launch Type</td><td><code>Default (Launch)</code></td><td>tip</td></tr>
  </tbody></table>
</div>
<div class="panel launch-option">
  <div class="panel-heading">1.</div>
  <table><tbody>
    <tr><td>Executable</td><td><code>game.sh</code></td></tr>
    <tr><td>Operating System</td><td><code>Linux</code></td></tr>
  </tbody></table>
</div>
<div class="panel launch-option">
  <div class="panel-heading">2.</div>
  <table><tbody>
    <tr><td>Executable</td><td><code>bin/game.exe</code></td></tr>
    <tr><td>Operating System</td><td><code>Windows</code></td></tr>
    <tr><td>Launch Type</td><td><code>Option</code></td></tr>
  </tbody></table>
</div>
<div class="panel launch-option">
  <div class="panel-heading">3. DLC</div>
  <table><tbody>
    <tr><td>Executable</td><td><code>dlc_editor.exe</code></td></tr>
    <tr><td>Operating System</td><td><code>Windows</code></td></tr>
    <tr><td>Launch Type</td><td><code>DLC</code></td></tr>
  </tbody></table>
</div>`;

(() => {
  // ---- parsing
  const opts = s.parseLaunchOptionsFromHtml(FIXTURE);
  assert.equal(opts.length, 4);
  assert.equal(opts[0].Executable, 'game_win64.exe');
  assert.equal(opts[0]['Operating System'], 'Windows');

  // ---- scoring: a Windows Default (Launch) exe beats a Linux/option/DLC one
  const best = s.pickBestLaunchOption(opts);
  assert.equal(best.executable, 'game_win64.exe');
  assert.ok(s.scoreLaunchOption(s.normalizeLaunchOption(opts[0])) > s.scoreLaunchOption(s.normalizeLaunchOption(opts[1])));

  // ---- candidates: Windows-preferred, DLC dropped
  const cands = s.getCandidateLaunchOptions(opts).map((o) => o.executable);
  assert.ok(cands.includes('game_win64.exe'));
  assert.ok(cands.some((e) => e.includes('game.exe')));
  assert.ok(!cands.some((e) => e.toLowerCase().includes('dlc')), 'DLC option excluded');
  assert.ok(!cands.some((e) => e.endsWith('.sh')), 'Linux option excluded when Windows present');

  // ---- process names: basenames only, deduped, ';'-joined
  const meta = s.launchMetadataFromHtml('42', FIXTURE);
  assert.equal(meta.appid, '42');
  assert.equal(meta.best_process_name, 'game_win64.exe');
  assert.equal(meta.process_name, 'game_win64.exe;game.exe'); // bin/game.exe → game.exe basename
  assert.equal(meta.arguments, '-steam');

  // ---- empty / no-exe input never throws
  assert.equal(s.launchMetadataFromHtml('1', ''), null);
  assert.deepEqual(s.parseLaunchOptionsFromHtml('<div>nope</div>'), []);
  assert.equal(s.pickBestLaunchOption([]), null);

  // ---- real captured SteamDB markup (Team Fortress 2, appid 440)
  const real = fs.readFileSync(path.join(__dirname, 'fixtures', 'steamdb-tf2.launch.html'), 'utf8');
  const realMeta = s.launchMetadataFromHtml('440', real);
  assert.ok(realMeta, 'real TF2 markup parsed');
  assert.ok(realMeta.best_process_name.toLowerCase().includes('tf'), `expected a tf*.exe, got ${realMeta.best_process_name}`);
  assert.ok(realMeta.process_name.toLowerCase().includes('.exe'), 'real process names are windows exes');
  assert.ok(!realMeta.process_name.includes('.sh') && !realMeta.process_name.includes('_osx'), 'non-windows options filtered out of real data');

  console.log('PASS: steamdbLaunch parses + ranks launch options (synthetic + real TF2 markup)');
})();
