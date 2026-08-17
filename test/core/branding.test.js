'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const htmlParser = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'node-html-parser'));

/*
  The product name changed everywhere a user reads it — including the executable's FileDescription,
  which is the label Task Manager shows. What did not change is every string Windows keys an
  existing install on: the AppUserModelID, the executable filename, the install directory, the
  uninstaller filename and the update artifact. `executableName` is what keeps those pinned while
  `productName` carries the branding, and the split matters: the "Start with Windows" entry stores
  the full path of the executable, so a renamed binary silently kills autostart and leaves a dead
  registry value pointing at a file that no longer exists.

  Both directions are pinned here: the new name where it must appear, the old identifiers where
  they must not move.
*/

const repoRoot = path.join(__dirname, '..', '..');
const read = (...parts) => fs.readFileSync(path.join(repoRoot, ...parts), 'utf8');

const appHtml = read('app', 'view', 'app.html');
const initJs = read('app', 'electron', 'init.js');
const builderYml = read('app', 'electron-builder.yml');

test('the window and tray carry the product name', () => {
  assert.match(appHtml, /<title>AW Next<\/title>/, 'the window title must be the product name');
  // A tooltip has room for the full name; the window title bar does not.
  assert.match(initJs, /tray\.setToolTip\('Achievement Watcher Next'\)/, 'the tray tooltip carries the full product name');
  assert.match(appHtml, /<h1 id="onboarding-title">Achievement Watcher Next<\/h1>/, 'first run introduces the full product name');
});

test('the installer presents the product name without a version', () => {
  assert.match(builderYml, /shortcutName: 'Achievement Watcher Next'/, 'shortcuts have room for the full product name');
  assert.match(builderYml, /uninstallDisplayName: 'Achievement Watcher Next'/, 'the Control Panel entry must carry the full product name');
  // electron-builder would otherwise default this to "${productName} ${version}".
  assert.doesNotMatch(builderYml, /uninstallDisplayName:.*\$\{version\}/, 'the product name must not carry a version number');
});

test('the executable reports the product name to Windows', () => {
  // electron-builder writes productName into the exe's FileDescription and ProductName, which is
  // what Task Manager and the file properties dialog display.
  assert.match(builderYml, /^productName: 'Achievement Watcher Next'$/m, 'productName is the label Windows shows for the process');
});

test('identifiers an existing install depends on are unchanged', () => {
  assert.match(builderYml, /^appId: io\.github\.shirowwww\.achievement\.watcher$/m, 'the AppUserModelID is what Windows matches toasts and pins against');
  assert.match(builderYml, /^executableName: 'Achievement Watcher'$/m, 'the executable, install directory and uninstaller filename all derive from executableName');
  assert.match(builderYml, /artifactName: 'Achievement\.Watcher\.Setup\.\$\{version\}\.\$\{ext\}'/, 'the update artifact name is referenced by latest.yml');
  assert.match(initJs, /app\.setName\('Achievement Watcher'\)/, 'app.getName() names the autostart registry value and the main log file');

  const userDataPath = read('app', 'util', 'userDataPath.js');
  // The data folder does move, but only forward, and both predecessors stay addressable so the
  // one-way import in migrateUserData.js can still find them.
  assert.match(userDataPath, /APP_DATA_DIR_NAME = 'Achievement Watcher Next'/, 'AW Next owns its own data folder');
  assert.match(userDataPath, /AW3_DATA_DIR_NAME = 'Achievement Watcher 3\.0'/, 'the 3.x import must still find its source');
  assert.match(userDataPath, /LEGACY_DATA_DIR_NAME = 'Achievement Watcher'/, 'the one-time legacy import must still find the 1.6.8 folder');

  // The app and the Watchdog resolve the same folder independently; a mismatch means the monitor
  // writes unlock state the UI never reads.
  assert.match(read('watchdog', 'util', 'userData.js'), /APP_DATA_DIR_NAME = 'Achievement Watcher Next'/, 'the Watchdog must agree on the data folder');
  // Playtime is written by the Watchdog and read by the app: both must name one registry key.
  assert.match(read('watchdog', 'playtime', 'track.js'), /Software\/Achievement Watcher Next\/Playtime\/Steam\//, 'playtime writer namespace');
  assert.match(read('app', 'parser', 'playtime.js'), /Software\/Achievement Watcher Next\/Playtime\/Steam\//, 'playtime reader namespace');

  const watchdog = read('watchdog', 'watchdog.js');
  assert.match(watchdog, /'Achievement Watcher\.exe'/, 'the Watchdog spawns the app by its real executable name');

  const toastIdentity = read('watchdog', 'util', 'toastIdentity.js');
  assert.match(toastIdentity, /ACHIEVEMENT_WATCHER_AUMID = 'io\.github\.shirowwww\.achievement\.watcher'/, 'toasts are delivered under the registered AppUserModelID');
});

test('the uninstaller speaks the new name in every language but keeps the data path', () => {
  const nsh = read('app', 'build', 'installer.nsh');
  // Only the LangString definitions carry text; the dialog also references $(AW_UNINSTALL_INTRO).
  const intro = nsh.split('\n').filter((l) => l.includes('LangString AW_UNINSTALL_INTRO'));
  const deleteData = nsh.split('\n').filter((l) => l.includes('LangString AW_UNINSTALL_DELETE_DATA'));
  assert.equal(intro.length, 17, 'the uninstaller intro must stay translated into all 17 installer languages');
  for (const line of intro) {
    assert.doesNotMatch(line, /Achievement Watcher/, `uninstaller intro still shows the old name: ${line.trim().slice(0, 80)}`);
    assert.match(line, /AW Next/, `uninstaller intro must name the product: ${line.trim().slice(0, 80)}`);
  }
  for (const line of deleteData) {
    assert.match(line, /Achievement Watcher Next/, 'the delete-data checkbox must quote the real %APPDATA% folder');
  }
  // Opting into "delete my data" has to clear the folder the previous name owned as well, or the
  // import source is left behind holding hundreds of megabytes of caches and backups.
  assert.match(nsh, /RMDir \/r "\$APPDATA\\Achievement Watcher Next"/, 'uninstall removes the current data folder');
  assert.match(nsh, /RMDir \/r "\$APPDATA\\Achievement Watcher 3\.0"/, 'uninstall also removes the folder it migrated from');
  assert.doesNotMatch(nsh, /RMDir \/r "\$APPDATA\\Achievement Watcher"/, 'the 1.6.8 folder belongs to another application and must survive');
});

test('the Settings About block is compact and matches what the locale loader binds', () => {
  // app/locale/loader.js still addresses the first row purely by position. Reordering it without
  // updating those selectors shifts every label silently — the labels are not defaulted in markup,
  // so a mismatch ships as blank text rather than as an error.
  const root = htmlParser.parse(appHtml);
  const notice = root.querySelector('#settings .footer .notice');
  assert.ok(notice, 'the Settings About block must exist');

  const rows = notice.querySelectorAll('p');
  assert.equal(rows.length, 1, 'the About block is one row about this app; the lineage moved to Advanced');

  const brand = rows[0].querySelector('.notice-brand');
  assert.ok(brand, 'the row names the product');
  assert.equal(brand.text.trim(), 'Achievement Watcher Next');
  // The brand must not be a <span>: the loader indexes spans in this row by position.
  assert.equal(brand.rawTagName, 'strong', 'the product name must not shift the span indices the loader uses');
  assert.equal(rows[0].querySelectorAll('span').length, 3, 'the row keeps: version label, version number, update status');

  // The repository link text is user-facing, so it must not spell out the old project slug.
  assert.doesNotMatch(notice.text, /achievement-watcher-3\.0/i, 'the About block must not show the old repository slug');

  // The upstream credits live at the foot of the Advanced tab now, bound by id rather than by
  // position — so this block can grow or shrink again without touching them.
  const lineageRow = root.querySelector('#advanced-lineage');
  assert.ok(lineageRow, 'the lineage must still be credited somewhere');
  const lineage = lineageRow.querySelectorAll('a');
  assert.equal(lineage.length, 4, 'it stays: Fork label, fork repo, Original label, original repo');
  assert.ok(!lineage[0].getAttribute('href'), 'the localized "Fork" label slot');
  assert.ok(lineage[1].getAttribute('href'), 'the fork link');
  assert.ok(!lineage[2].getAttribute('href'), 'the localized "Original" label slot');
  assert.ok(lineage[3].getAttribute('href'), 'the original project link');

  const loader = read('app', 'locale', 'loader.js');
  assert.match(loader, /#lineage-fork-label'\)\.text\(clear\(template\.settings\.common\.fork\)\)/, 'Fork is bound by id');
  assert.match(loader, /#lineage-original-label'\)\.text\(clear\(template\.settings\.common\.original\)\)/, 'Original is bound by id');
  assert.doesNotMatch(loader, /notice p:nth-child\(2\)/, 'nothing may still bind the removed second About row');
  assert.doesNotMatch(loader, /notice p:nth-child\(3\)/, 'the third About row is gone; nothing may still bind it');
});

test('no stale product branding is left in the localized UI', () => {
  const langDir = path.join(repoRoot, 'app', 'locale', 'lang');
  const offenders = [];
  for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
    (function walk(node, keyPath) {
      if (typeof node === 'string') {
        // A remaining hit is only legitimate as a path segment the app really writes to, which is
        // always preceded by a separator (Pictures\, %APPDATA%\, and their translated folder words).
        for (const match of node.matchAll(/Achievement Watcher/g)) {
          if (node[match.index - 1] !== '\\') offenders.push(`${file}: ${keyPath}`);
        }
        return;
      }
      if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${keyPath}[${i}]`));
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, keyPath ? `${keyPath}.${k}` : k);
    })(locale, '');
  }
  assert.deepEqual(offenders, [], 'these localized strings still show the old product name');
});

test('every locale ships the More themes… label', () => {
  const langDir = path.join(repoRoot, 'app', 'locale', 'lang');
  for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const locale = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
    assert.ok(String(locale.dialogs.themeMore || '').trim(), `${file}: dialogs.themeMore must be translated`);
  }
});

test('help links point at this project, not the upstream wiki', () => {
  // The "no achievement unlocked" notice used to send people to xan105's wiki, which documents a
  // different application. Only the credit links in Settings may still name the upstream projects.
  const appJs = read('app', 'app.js');
  assert.doesNotMatch(appJs, /xan105\/Achievement-Watcher\/wiki/, 'the help link must not point at the upstream wiki');
  assert.match(appJs, /Shirowwww\/Achievement-Watcher-Next\/blob\/main\/docs\/troubleshooting\.md/, 'it must point at this project’s troubleshooting guide');

  // Its label is localized rather than the old hard-coded "Wiki".
  assert.match(appJs, /data\('lang-troubleshoot'\)/, 'the link label must come from the locale');
  assert.match(read('app', 'locale', 'loader.js'), /'lang-troubleshoot', clear\(template\.settings\.help\.troubleshootTitle\)/, 'the loader must supply that label');

  // The sentence in front of the link has to stand on its own now: it used to run into the label
  // ("...section of the" + "Wiki"), which only read correctly because the label was a noun.
  const langDir = path.join(repoRoot, 'app', 'locale', 'lang');
  for (const file of fs.readdirSync(langDir).filter((f) => f.endsWith('.json'))) {
    const hint = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8')).noneUnlockedHint || '';
    assert.ok(hint.trim(), `${file}: noneUnlockedHint must be translated`);
    assert.match(hint.trim(), /[?？]$/, `${file}: the hint must end at its question, not run into the link label`);
  }
});

test('the main window resolves its icon absolutely and prefers the multi-size .ico', () => {
  // BrowserWindow and fs resolve a relative icon path against the working directory, which is the
  // install folder rather than the app — the icon was silently dropped and the window fell back to
  // the runtime's own logo. Windows also picks small frames out of an .ico far better than it
  // downscales a lone 256px PNG.
  assert.match(initJs, /path\.isAbsolute\(configured\) \? configured : path\.join\(__dirname, '\.\.', configured\)/, 'the icon path must be resolved against the app root');
  assert.match(initJs, /process\.platform === 'win32' \? base\.replace\(\/\\\.png\$\/i, '\.ico'\) : base/, 'Windows must prefer the .ico');

  for (const rel of [
    ['app', 'resources', 'icon', 'icon.ico'],
    ['app', 'resources', 'icon', 'icon.png'],
    ['app', 'build', 'icon.ico'],
  ]) {
    assert.ok(fs.existsSync(path.join(repoRoot, ...rel)), `${rel.join('/')} must exist`);
  }

  // The installer header paints the mark white over a dark gradient, so it must be fed the bare
  // logo — handing it the outlined app icon floods the whole silhouette into one white blob.
  const ps1 = read('app', 'build', 'generate-installer-images.ps1');
  assert.match(ps1, /LogoPath = \(Join-Path \$PSScriptRoot 'brandMark\.png'\)/, 'the header must use the un-outlined mark');
  assert.ok(fs.existsSync(path.join(repoRoot, 'app', 'build', 'brandMark.png')), 'brandMark.png must ship with the build resources');
});
