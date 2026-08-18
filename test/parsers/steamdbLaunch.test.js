'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const s = require('../../app/parser/steamdbLaunch.js');

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
  const real = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'steamdb-tf2.launch.html'), 'utf8');
  const realMeta = s.launchMetadataFromHtml('440', real);
  assert.ok(realMeta, 'real TF2 markup parsed');
  assert.ok(realMeta.best_process_name.toLowerCase().includes('tf'), `expected a tf*.exe, got ${realMeta.best_process_name}`);
  assert.ok(realMeta.process_name.toLowerCase().includes('.exe'), 'real process names are windows exes');
  assert.ok(!realMeta.process_name.includes('.sh') && !realMeta.process_name.includes('_osx'), 'non-windows options filtered out of real data');

  console.log('PASS: steamdbLaunch parses + ranks launch options (synthetic + real TF2 markup)');
})();

// Steam's own product info is the preferred, browser-free source for the same launch options.
// The fixture mirrors a real appinfo.config.launch section, checked live against appids 1913120
// (Tears of Metal -> ToM.exe) and 4113940 (Sovereign Tower, whose Windows entry is a nested path).
(() => {
  const APPINFO_LAUNCH = {
    0: { executable: 'sovereign_tower_windows_build\\sovereign_tower.exe', type: 'default', config: { oslist: 'windows' } },
    1: { executable: 'sovereign_tower.x86_64', config: { oslist: 'linux' } },
    2: { executable: 'Sovereign Tower.app', config: { oslist: 'macos' } },
  };

  // ---- mapping onto the shape the shared ranker already understands
  const opts = s.parseLaunchOptionsFromAppInfo(APPINFO_LAUNCH);
  assert.equal(opts.length, 3);
  assert.equal(opts[0].executable, 'sovereign_tower_windows_build\\sovereign_tower.exe');
  assert.equal(opts[0].operatingSystem, 'windows');
  assert.equal(opts[0].launchType, 'default');

  // ---- the watchdog matches one filename: nested path collapses, non-Windows entries lose
  const meta = s.launchMetadataFromAppInfo('4113940', APPINFO_LAUNCH);
  assert.equal(meta.appid, '4113940');
  assert.equal(meta.best_process_name, 'sovereign_tower.exe');
  assert.ok(!meta.process_name.includes('\\'), 'no path separator survives into a process name');
  assert.ok(!/x86_64|[.]app/.test(meta.process_name), 'non-Windows entries are not offered');

  // ---- no launch section: must fall through to the SteamDB scrape, not invent a name
  // (verified live against appid 5, which has no config.launch)
  assert.equal(s.launchMetadataFromAppInfo('5', null), null);
  assert.equal(s.launchMetadataFromAppInfo('5', undefined), null);
  assert.equal(s.launchMetadataFromAppInfo('5', {}), null);
  assert.deepEqual(s.parseLaunchOptionsFromAppInfo(null), []);

  // ---- malformed entries are skipped rather than thrown on
  const mixed = s.launchMetadataFromAppInfo('1', {
    0: null,
    1: 'garbage',
    2: { config: { oslist: 'windows' } },
    3: { executable: 'ToM.exe' },
  });
  assert.equal(mixed.best_process_name, 'ToM.exe', 'the one usable entry still wins');

  console.log('PASS: steamdbLaunch maps Steam appinfo launch options (browser-free source)');
})();
