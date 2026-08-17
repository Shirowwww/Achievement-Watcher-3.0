'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

test('the final onboarding step exposes exactly eight useful choices', () => {
  const html = fs.readFileSync(path.join(root, 'app', 'view', 'app.html'), 'utf8');
  // Found by its own content, not by a step index: inserting a step ahead of it (the Simple /
  // Advanced choice did exactly that) must not silently point this at a different section.
  const step = html.split(/<section class="onboarding-step[^"]*" id="onboarding-step-\d+"/).find((part) => part.includes('id="onboard-theme"')) || '';
  const body = step.slice(0, step.indexOf('</section>'));
  assert.equal((body.match(/<select\b/g) || []).length, 8);
  for (const id of ['onboard-theme', 'onboard-notification-mode', 'onboard-notification-preset', 'onboard-playtime']) {
    assert.match(body, new RegExp(`id="${id}"`));
  }
});

test('fresh profiles enable playtime and a notification preview uses one transport', () => {
  const settings = fs.readFileSync(path.join(root, 'app', 'settings.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'app', 'ui', 'settings.js'), 'utf8');
  assert.match(settings, /playtime:\s*true/);
  assert.match(ui, /if \(mode === 'toast'\) await runNotificationTest/);
  assert.doesNotMatch(ui, /mode === 'toast' \|\| mode === 'both'\) runNotificationTest/);
  assert.match(ui, /setNotificationTestBusy\(btn, true\)/);
});

test('automatic scanning is reviewable and never injects Desktop or whole-drive roots', () => {
  const achievements = fs.readFileSync(path.join(root, 'app', 'parser', 'achievements.js'), 'utf8');
  const userDirs = fs.readFileSync(path.join(root, 'app', 'parser', 'userDir.js'), 'utf8');
  const rootBlock = achievements.match(/async function goldbergScanRoots[\s\S]*?return roots;\n}/)?.[0] || '';
  assert.doesNotMatch(rootBlock, /libraryDirs\.find/);
  assert.doesNotMatch(rootBlock, /Desktop/);
  assert.doesNotMatch(userDirs, /listDrive\s*\(/);
  assert.match(userDirs, /discoverLibraryRoots\(\)/);
});

test('artwork fallbacks fill missing assets without replacing existing ones', () => {
  const parser = fs.readFileSync(path.join(root, 'app', 'parser', 'achievements.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'app', 'electron', 'init.js'), 'utf8');
  assert.match(parser, /game\.img\.header = game\.img\.header \|\| fallback\.landscape/);
  assert.match(parser, /game\.img\.logo = game\.img\.logo \|\| fallback\.logo/);
  assert.match(main, /steamgriddb_assets/);
  assert.match(main, /pickSteamGridDbGame\(searchData\?\.data, gameName\)/);
  assert.doesNotMatch(main, /if \(list\.length === 1\) return list\[0\]/);
});

test('the alternate-cover picker resolves and shows the actual current cover', () => {
  const app = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.match(app, /const currentUrl = coverOverrideFor\(appid\) \|\|/);
  assert.match(app, /const currentTilePromise = currentUrl/);
  assert.match(app, /ipcRenderer\.invoke\('fetch-icon', preview, coverCacheAppid\)/);
  assert.match(app, /game\.steamappid \|\| game\.appid/);
  assert.match(app, /addTile\(currentUrl, t\('currentCover'/);
});

test('streaming scans retain a skeleton tail until the list actually completes', () => {
  const app = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.match(app, /const MIN_STREAMING_SKELETON_TILES = 6/);
  assert.match(app, /if \(!skeletonStreamActive\) return;\s*const budget = skeletonBudget\(MIN_STREAMING_SKELETON_TILES\)/);
  // The tail is capped by the games still to arrive, so it runs down to nothing instead of
  // shimmering past the last one (behaviour covered by browser/skeletonTiles.browser.test.js).
  assert.match(app, /function skeletonBudget\(cap\)[\s\S]*?skeletonExpected - skeletonRendered/);
  assert.match(app, /function clearSkeletonTiles\(\) \{\s*skeletonStreamActive = false/);
});

test('manual game creation is a compact search-adjacent action with explicit optional fields', () => {
  const html = fs.readFileSync(path.join(root, 'app', 'view', 'app.html'), 'utf8');
  const search = html.match(/<div id="search-bar">[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(search, /id="add-game-manually"[\s\S]*?<div class="wrapper">/);
  assert.match(search, /<i class="fas fa-plus"/);
  assert.match(search, /<span class="sr-only">Add game manually<\/span>/);
  assert.match(html, /id="manual-game-name-label">Game name/);
  assert.match(html, /id="manual-game-appid-label">Steam AppID \(optional\)/);
});

test('folder provenance never reuses an add-folder action as the manual-source badge', () => {
  const settingsUi = fs.readFileSync(path.join(root, 'app', 'ui', 'settings.js'), 'utf8');
  const onboarding = fs.readFileSync(path.join(root, 'app', 'ui', 'onboarding.js'), 'utf8');
  const metadata = settingsUi.match(/function applyFolderRowMetadata[\s\S]*?function folderEntryFromRow/)?.[0] || '';
  assert.match(metadata, /manual-source/);
  assert.doesNotMatch(metadata, /addLibraryDir|addCustomDir/);
  assert.doesNotMatch(metadata, /origin\.append/);
  assert.doesNotMatch(metadata, /options\.detector \|\| detectedLabel/);
  assert.match(onboarding, /folder-origin \$\{automatic \? 'auto' : 'manual'\}/);
  assert.doesNotMatch(onboarding, /origin\.append/);
  assert.doesNotMatch(onboarding, /entry\.detector \|\| t\.smartFind/);
});

test('initial config generation is gated to games without an existing fix', () => {
  const parser = fs.readFileSync(path.join(root, 'app', 'parser', 'achievements.js'), 'utf8');
  const settingsUi = fs.readFileSync(path.join(root, 'app', 'ui', 'settings.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.match(parser, /onlyIfUnconfigured:\s*true/);
  assert.match(settingsUi, /emulatorFixEligibility\.inspect/);
  assert.match(app, /initialGbeEligibility\.eligible/);
});

test('manual games keep guarded per-game tools and the common uninstall flow', () => {
  const app = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.match(app, /const isManualGame = !!ctxGame\?\.manual \|\| gameSource === 'Manual'/);
  assert.match(app, /allowManual: isManualGame/);
  assert.match(app, /if \(!isConsoleSystem\)/);
  assert.match(app, /if \(!isManualGame\) emulatorMenu\.append/);
  assert.match(app, /if \(!isManualGame\) appendCrackFixItem\(\)/);
  assert.match(app, /if \(app\.config\?\.general\?\.uninstallContextMenu !== false\)/);
  assert.match(app, /if \(isManualGame && isConsoleSystem\)[\s\S]*?PCGamingWiki/);
  assert.match(app, /if \(isManualGame \|\| isUbisoftSource\)[\s\S]*?PlaytimeTracking\.reset/);
});

test('zero-achievement games render a localized unavailable state instead of zero percent', () => {
  const app = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.match(app, /const hasAchievements = Number\(game\.achievement\.total\) > 0/);
  assert.match(app, /const progressLabel = !hasAchievements/);
  assert.match(app, /progressBar\$\{!hasAchievements \? ' unavailable' : ''\}/);
  assert.doesNotMatch(app, /game\.manual && game\.achievement\.total === 0/);
});

test('achievement-less games open the normal detail view and only the play button launches them', () => {
  const app = fs.readFileSync(path.join(root, 'app', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /if \(selected && !gameHasAchievements\(selected\)\)/);
  assert.match(app, /on\('click\.awLibrary', '\.game-box',[\s\S]*?self\.onGameBoxClick\(\$\(this\), gameList\)/);
  assert.match(app, /on\('click\.awLibrary', '\.game-box \.play-button',[\s\S]*?self\.onPlayButtonClick/);
  assert.match(app, /const title = game\.manual[\s\S]*?achievements-not-available/);
  assert.match(app, /path\.isAbsolute\(localPath\) \? pathToFileURL\(localPath\)\.href/);
  assert.match(app, /quarantineBrokenBypass/);
  assert.match(app, /ipcRenderer\.invoke\('launch-game-via-shell'/);
});
