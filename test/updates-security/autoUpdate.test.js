'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const yaml = require(path.join(__dirname, '..', '..', 'app', 'node_modules', 'js-yaml'));

test('packaged builds ask before downloading, then silently upgrade and restart', () => {
  const appRoot = path.join(__dirname, '..', '..', 'app');
  const builder = yaml.load(fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8'));
  assert.deepStrictEqual(builder.publish, {
    provider: 'github',
    owner: 'Shirowwww',
    repo: 'Achievement-Watcher-Next',
  });

  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');
  assert.match(init, /autoUpdater\.autoDownload\s*=\s*false/);
  assert.match(init, /if \(app\.isPackaged\)/);
  assert.match(init, /autoUpdater\s*\.\s*checkForUpdates\(\)/);
  assert.match(init, /autoUpdater\.on\('update-available'/);
  assert.match(init, /autoUpdater\.downloadUpdate\(\)/);
  assert.match(init, /autoUpdater\.on\('update-downloaded'/);
  assert.match(init, /autoUpdater\.quitAndInstall\(true, true\)/);

  // The updater stays supervised while the app is resident: a failed check retries after a delay,
  // a successful one re-checks hourly, and errors surface in the tray instead of being silently
  // logged away. A check that fires while a prompt is open reschedules instead of dying.
  assert.match(init, /scheduleUpdateCheck\(8000\)/);
  assert.match(init, /UPDATE_RECHECK_MS/);
  assert.match(init, /UPDATE_RETRY_MS/);
  assert.match(init, /tray\.displayBalloon/);
  assert.match(init, /updatePromptOpen/);
});

test('a sha512 checksum mismatch clears the update cache and retries the full download once, with a manual fallback', () => {
  const appRoot = path.join(__dirname, '..', '..', 'app');
  const init = fs.readFileSync(path.join(appRoot, 'electron', 'init.js'), 'utf8');

  // Differential (patch) downloads read a cached base file that is never revalidated between
  // runs; disabling them removes that whole failure class instead of only reacting to it.
  assert.match(init, /autoUpdater\.disableDifferentialDownload\s*=\s*true/);

  // A checksum-mismatch error is detected (by code or message) through the unit-tested
  // classifier in util/updateChecksum.js, not re-implemented or assumed from context.
  assert.match(init, /require\(path\.join\(__dirname, '\.\.\/util\/updateChecksum\.js'\)\)/);
  assert.match(init, /isChecksumMismatchError\(err\)/);

  // The recovery clears the whole updater cache dir via the officially exposed helper (never a
  // hand-rolled path); the actual clear+rm sequence lives in util/updateCacheClear.js, tested
  // against the real electron-updater cache class.
  assert.match(init, /async function clearUpdaterCacheDir\(/);
  assert.match(init, /autoUpdater\.getOrCreateDownloadHelper\(\)/);
  assert.match(init, /require\(path\.join\(__dirname, '\.\.\/util\/updateCacheClear\.js'\)\)/);
  assert.match(init, /clearCacheDirForHelper\(helper/);

  const cacheClear = fs.readFileSync(path.join(appRoot, 'util', 'updateCacheClear.js'), 'utf8');
  assert.match(cacheClear, /helper\.clear\(\)/);
  assert.match(cacheClear, /fs\.promises\.rm\(cacheDir/);

  // The 'error' listener drives exactly one retry (download, not a fresh check, so no extra
  // dialog reappears) guarded by an in-flight flag, and re-notifies if that retry also fails.
  assert.match(init, /checksumRetryInFlight/);
  assert.match(init, /autoUpdater\.on\('error'/);
  assert.match(init, /async function notifyChecksumRecoveryFailed\(/);
  assert.match(init, /UPDATE_RELEASES_URL/);
  assert.match(init, /shell\.openExternal\(UPDATE_RELEASES_URL\)/);

  // A manual "Clear update cache" action exists for Settings > Advanced and refuses to run
  // while a download is in flight, so it can never race the automatic recovery.
  assert.match(init, /ipcMain\.handle\('clear-update-cache'/);
  assert.match(init, /if \(updateDownloading \|\| checksumRetryInFlight\) return \{ ok: false, error: 'download-in-progress' \}/);

  // getOrCreateDownloadHelper() reads app-update.yml (packaged) or dev-app-update.yml
  // (unpackaged) from the app root; without the dev file every dev-mode call fails.
  assert.ok(fs.existsSync(path.join(appRoot, 'dev-app-update.yml')), 'dev-app-update.yml must exist for dev-mode testing');
  const devConfig = yaml.load(fs.readFileSync(path.join(appRoot, 'dev-app-update.yml'), 'utf8'));
  assert.equal(devConfig.updaterCacheDirName, 'achievement-watcher-updater');
  assert.equal(devConfig.owner, 'Shirowwww');
  assert.equal(devConfig.repo, 'Achievement-Watcher-Next');

  const builder = yaml.load(fs.readFileSync(path.join(appRoot, 'electron-builder.yml'), 'utf8'));
  assert.ok(builder.files.includes('!dev-app-update.yml'), 'the dev-only config must not ship in packaged builds');

  // The dev config exists to mirror the generated app-update.yml. If the two ever name different
  // repositories, dev testing validates an update route that shipped builds do not take.
  assert.equal(devConfig.owner, builder.publish.owner, 'dev-app-update.yml owner must match the publish target');
  assert.equal(devConfig.repo, builder.publish.repo, 'dev-app-update.yml repo must match the publish target');

  // The clear action also sweeps the re-fetchable app caches (Steam/Ubisoft schema, icon and
  // downloaded emulator-tool caches), through the same explicit, unit-tested allowlist —
  // never a blanket folder wipe that could catch an irreplaceable file by accident.
  assert.match(init, /require\(path\.join\(__dirname, '\.\.\/util\/clearableCaches\.js'\)\)/);
  assert.match(init, /clearSafeCaches\(userData\)/);
});
