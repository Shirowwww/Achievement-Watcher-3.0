'use strict';

// The app is a resident tray daemon, so almost all of its lifetime is spent with no one looking at
// it. These guard the three things that used to make that idle state expensive: a renderer kept
// alive for a window nobody can see, a discovery poll that re-scanned the whole library forever,
// and per-achievement log spam. Source-level assertions, in the house style for init.js/app.js -
// neither can be required outside Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.join(__dirname, '..', '..', 'app');
const read = (...parts) => fs.readFileSync(path.join(appRoot, ...parts), 'utf8');

const initJs = read('electron', 'init.js');
const appJs = read('app.js');
const afterPackJs = read('build', 'afterPack.js');
const builderYml = read('electron-builder.yml');
const achievementsJs = read('parser', 'achievements.js');

test('the main window is released after it has stayed hidden, not kept resident forever', () => {
  // Hiding to the tray left the renderer (~180 MB) and the GPU process it holds up (~140 MB)
  // resident for the whole session.
  assert.match(initJs, /function scheduleMainWindowRelease\(\)/);
  assert.match(initJs, /function cancelMainWindowRelease\(\)/);
  assert.match(initJs, /MAIN_WINDOW_IDLE_RELEASE_MS\s*=/);

  // destroy(), not close(): close() is intercepted by the close-to-tray handler and only re-hides.
  const timerBody = initJs.slice(initJs.indexOf('function scheduleMainWindowRelease()'), initJs.indexOf('let overlayWindow'));
  assert.match(timerBody, /MainWin\.destroy\(\)/);
  // It must re-check visibility when it fires: the user may have reopened the window meanwhile.
  assert.match(timerBody, /MainWin\.isVisible\(\)/);
  assert.match(timerBody, /app\.isQuiting/);
});

test('hiding schedules the release and showing cancels it', () => {
  const hideHandler = initJs.slice(initJs.indexOf("MainWin.on('hide'"), initJs.indexOf("MainWin.on('hide'") + 260);
  assert.match(hideHandler, /scheduleMainWindowRelease\(\)/);

  const showHandler = initJs.slice(initJs.indexOf("MainWin.on('show'"), initJs.indexOf("MainWin.on('show'") + 260);
  assert.match(showHandler, /cancelMainWindowRelease\(\)/);
});

test('minimizing never releases the window', () => {
  // A minimized window keeps its taskbar button, so the user expects an instant restore.
  const minimizeHandler = initJs.slice(initJs.indexOf("MainWin.on('minimize'"), initJs.indexOf("MainWin.on('minimize'") + 200);
  assert.doesNotMatch(minimizeHandler, /scheduleMainWindowRelease/);
});

test('releasing the window is safe because the headless fallback engages when MainWin is null', () => {
  // runBackgroundAutoFix is what keeps new-install detection working with no window open.
  assert.match(initJs, /if \(MainWin\) return;[^\n]*renderer/);
});

test('an appid that discovery keeps finding but never renders stops re-triggering full scans', () => {
  // One phantom appid triggered 89 full library refreshes in a single log, each a 2-13s rescan.
  assert.match(appJs, /UNRENDERABLE_MISS_LIMIT/);
  assert.match(appJs, /function isPersistentlyUnrenderable\(/);
  assert.match(appJs, /!previous\.has\(id\) && !isPersistentlyUnrenderable\(id\)/);

  // The baseline needs the rendered list to tell "discovered" from "actually shown".
  assert.match(appJs, /seedNewGameScanBaseline\(list\)/);
  assert.match(appJs, /function seedNewGameScanBaseline\(renderedList\)/);

  // A manual refresh means "look again properly", so the suppression must be cleared there.
  const forget = appJs.slice(appJs.indexOf('function forgetScanCaches()'), appJs.indexOf('function forgetScanCaches()') + 400);
  assert.match(forget, /unrenderableAppids\.clear\(\)/);
});

test('the main-process background scan applies the same suppression', () => {
  // Releasing the window hands polling back to this fallback for most of a session, so the loop
  // would simply move here otherwise.
  assert.match(initJs, /BG_UNRENDERABLE_MISS_LIMIT/);
  assert.match(initJs, /function recordBackgroundScanMisses\(/);
  assert.match(initJs, /recordBackgroundScanMisses\(all, scanned\)/);
});

test('a save that no longer matches its schema logs one aggregate line, not one per achievement', () => {
  // Hundreds of identical lines per game per scan churned the 2 MB parser.log rotation on its own.
  assert.match(achievementsJs, /let schemaMissCount = 0;/);
  assert.match(achievementsJs, /schemaMissCount\+\+;/);
  assert.match(achievementsJs, /if \(schemaMissCount > 0\)/);
  assert.doesNotMatch(achievementsJs, /debug\.warn\(`\[\$\{appid\.appid\}\] Achievement not found in game schema data/);
});

test('afterPack prunes payloads that cannot load on Windows x64 and guards what must survive', () => {
  for (const rule of ['regodit', 'koffi', 'moment', '7zip-bin']) {
    assert.ok(afterPackJs.includes(rule), `afterPack must still prune ${rule}`);
  }
  // Both non-x64 Windows 7-Zip builds, not just the mac/linux trees.
  assert.match(afterPackJs, /'ia32', 'arm64'/);
  // A silent miss must fail the build rather than ship a watchdog that cannot read the registry.
  assert.match(afterPackJs, /pruning removed or missed required runtime file/);
  assert.match(afterPackJs, /regodit\.\$\{targetArch\}\.dll/);
});

test('afterPack never prunes koffi/src, the package entry point behind index.cjs', () => {
  // koffi/index.cjs is a one-line require("./src/koffi/index.cjs"). Pruning src/ left the module
  // unloadable and every koffi consumer dead, while the monitor still started - the only symptom
  // was "[controller] XInput backend missing" in the log.
  assert.doesNotMatch(afterPackJs, /'src', 'vendor', 'doc'/);
  assert.match(afterPackJs, /'vendor', 'doc'/);
  assert.match(afterPackJs, /koffi', 'src', 'koffi', 'index\.cjs'/);
});

test('the build fails loudly if pruning removes a file the runtime needs', () => {
  assert.match(afterPackJs, /const mustKeep = \[/);
  assert.match(afterPackJs, /pruning removed or missed required runtime file/);
  for (const needed of ['regodit', 'koffi.node', '7za.exe']) {
    assert.ok(afterPackJs.includes(needed), `mustKeep must cover ${needed}`);
  }
});

test('a pruning rule that stops matching is reported instead of silently succeeding', () => {
  // The old koffi rule pointed at a path koffi 3.x no longer creates and "succeeded" for years.
  assert.match(afterPackJs, /already absent/);
});

test('the packaged app drops the Bare-runtime shims but keeps bare-events', () => {
  for (const dead of ['bare-fs', 'bare-url', 'bare-path', 'bare-stream']) {
    assert.ok(builderYml.includes(`!node_modules/${dead}/**`), `${dead} must not ship`);
  }
  // streamx -> events-universal requires bare-events unconditionally, so it has to stay.
  assert.ok(!builderYml.includes('!node_modules/bare-events/**'), 'bare-events must keep shipping');
});

test('the duplicated Media/ payload is gone from the repo and the package', () => {
  // 11 .wav files byte-identical to app/sounds/, shipped inside app.asar AND beside it, then copied
  // into every user profile by checkResources().
  assert.equal(fs.existsSync(path.join(appRoot, 'media')), false, 'app/media must not come back');
  assert.doesNotMatch(builderYml, /from:\s*\.\/media/);
  assert.doesNotMatch(initJs, /copyFolderRecursive\(media,/);
  // The folder playback actually resolves against must still ship unpacked.
  assert.match(builderYml, /- sounds\/\*\*/);
  assert.ok(fs.existsSync(path.join(appRoot, 'sounds')), 'app/sounds is the real sound store');
});
