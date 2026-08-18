'use strict';

/*
  A notification test fired from a game's Health panel must preview THAT game.

  The trap this guards: the overlay has two entry points with different payload shapes.
  enqueueNotificationFromArgs() (the Watchdog CLI path, used by real unlocks) accepts
  `gameDisplayName` and normalises it; enqueueNotification() (the object path the renderer's test
  uses) does not - createNotificationWindow() forwards a fixed field list. Setting a field the
  window never reads produces a preview that silently ignores it, which is exactly what happened.
*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appDir = path.join(__dirname, '..', '..', 'app');
const settingsUi = fs.readFileSync(path.join(appDir, 'ui', 'settings.js'), 'utf8');
const init = fs.readFileSync(path.join(appDir, 'electron', 'init.js'), 'utf8');
const appSource = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');

// The exact fields createNotificationWindow() forwards to the notification page.
function windowFields() {
  const send = init.slice(init.indexOf("notif.webContents.send('show-notification', {"));
  const body = send.slice(0, send.indexOf('\n    });'));
  return new Set([...body.matchAll(/^\s{6}([A-Za-z][\w]*):/gm)].map((m) => m[1]));
}

// The payload the renderer builds for a preview.
function overlayTestDataBody() {
  const fn = settingsUi.slice(settingsUi.indexOf('function overlayTestData('));
  return fn.slice(0, fn.indexOf('\n    }\n'));
}

test('every field the preview payload sets is one the notification window actually reads', () => {
  const fields = windowFields();
  const body = overlayTestDataBody();
  const returned = body.slice(body.indexOf('return Object.assign('));

  const handledElsewhere = new Set([
    // Consumed under an alias by createNotificationWindow (`data.icon`, `data.image`, …) or handled
    // by enqueueNotification/processNotificationQueue before the window exists.
    'test',
    'preset',
    'image',
    'icon',
    'gameIcon',
    'soundPath',
    'notifyId',
    'volume', // read for the sound gain, outside the send() payload
    // Pre-existing dead field: both enqueueNotificationFromArgs() and this preview set it, nothing
    // reads it. Left in place rather than removed from one path only; listed so this test keeps
    // catching NEW unread fields instead of failing on an old one.
    'achievementIconPath',
  ]);
  const unread = [...returned.matchAll(/^\s{10}([A-Za-z][\w]*):/gm)]
    .map((m) => m[1])
    .filter((name) => !fields.has(name) && !handledElsewhere.has(name));

  assert.deepEqual(unread, [], `these preview fields are never read by the notification window: ${unread.join(', ')}`);
});

test('the preview names the game somewhere the overlay actually renders', () => {
  const body = overlayTestDataBody();
  // `displayName` carries the achievement title on this path, so a real unlock never prints the
  // game name: the description is the only slot a preview can use to say which game it is.
  assert.match(body, /texts\[kindName\]\.description = game\.name/, 'the game must be named in a rendered slot');
  assert.match(body, /texts\.playtime\.displayName = game\.name/, 'playtime keeps the game in its title');
  // The dead field must not come back.
  assert.doesNotMatch(body, /gameDisplayName:/, 'gameDisplayName is not read on the renderer path');
});

test('the preview shows the game artwork rather than the placeholder badge', () => {
  const body = overlayTestDataBody();
  assert.match(body, /const gameIcon = \(game && game\.icon\) \|\|/, 'the game icon wins when one is supplied');
  assert.match(body, /iconPath: kind === 'playtime' \|\| game \? gameIcon : achievementIcon/, 'a game preview must not keep the generic badge');
  assert.match(body, /image: \(game && game\.image\) \|\| ''/, 'the header art feeds imagePath/headerPath');
});

test('both transports receive the game, and the Health panel supplies it', () => {
  // Windows toast: through the websocket protocol.
  assert.match(settingsUi, /function runNotificationTest\(cmd, btn, game\)/);
  assert.match(settingsUi, /ws\.send\(JSON\.stringify\(game \? \{ cmd, game \} : \{ cmd \}\)\)/, 'the toast test carries the game');
  // Overlay: through the payload builder.
  assert.match(settingsUi, /overlayTestData\(kind, presetOverride, null, game\)/, 'the overlay test carries the game');
  // And the shared entry point threads it from the Health panel.
  assert.match(settingsUi, /window\.testAchievementWatcherNotification = function \(mode, button, preset, game\)/);
  const runner = appSource.slice(appSource.indexOf('async function runGameHealthAction'));
  assert.match(runner, /testAchievementWatcherNotification\([\s\S]{0,220}name: game\.name/, 'the panel passes the selected game');
});

test('the artwork is resolved before it is sent, never passed as a raw token', () => {
  /*
    game.img holds fetch-icon TOKENS, not URLs: `icon` is a bare Steam content hash
    ("3714884d0e78…") and `header` a fragment ("header.jpg", "<hash>/header.jpg"). Handing those to
    a notification produces no artwork at all - the failure is silent, the popup simply shows the
    placeholder. Every other view in the app resolves them through the fetch-icon IPC first.
  */
  const runner = appSource.slice(appSource.indexOf('async function runGameHealthAction'));
  const branch = runner.slice(runner.indexOf('gameHealth.ACTION.TEST_NOTIFICATION'));
  const body = branch.slice(0, branch.indexOf('\n  if (action ==='));

  assert.match(body, /invoke\('fetch-icon', token, artAppid\)/, 'tokens must go through fetch-icon');
  assert.match(body, /fileURLToPath\(resolved\)/, 'the overlay needs a filesystem path, not a file:// URL');

  // The payload must carry the RESOLVED values, not the raw img fields.
  const payload = body.slice(body.indexOf('testAchievementWatcherNotification('));
  assert.match(payload, /icon,/, 'the resolved icon is sent');
  assert.match(payload, /image,/, 'the resolved header is sent');
  assert.doesNotMatch(payload, /art\.icon|art\.header|art\.background|art\.logo/, 'no raw token may reach the payload');

  // A failed resolution must degrade to the built-in sample rather than sending a broken path.
  assert.match(body, /return ''/, 'an unresolved token becomes empty, letting the sample stand in');
});

test('the watchdog side keeps the sample when no game is supplied', () => {
  const watchdog = fs.readFileSync(path.join(__dirname, '..', '..', 'watchdog', 'notification-test.js'), 'utf8');
  assert.match(watchdog, /function testMessageAndOptions\(kind, options, game = null\)/);
  // Every sample constant must remain reachable as a fallback.
  for (const fallback of ['TEST_APPID', 'TEST_GAME', 'TEST_GAME_ICON', 'TEST_HEADER', 'TEST_ACHIEVEMENT_ICON']) {
    assert.ok(new RegExp(`\\|\\| ${fallback}`).test(watchdog), `${fallback} must stay the fallback`);
  }
  assert.match(watchdog, /module\.exports\.toast = \(game\) => runTest\('toast', \{ game \}\)/, 'the exported tests accept a game');

  const websocket = fs.readFileSync(path.join(__dirname, '..', '..', 'watchdog', 'websocket.js'), 'utf8');
  assert.match(websocket, /run\(req\.game && typeof req\.game === 'object' \? req\.game : null\)/, 'the protocol forwards it, and only an object');
});
