'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const goldberg = require(path.join(__dirname, '..', '..', 'app', 'parser', 'goldberg.js'));

/*
  "Repair the achievement data" reported every icon as FAILED on emulator installs.

  A game with no Steam data takes its schema from the emulator's own achievements.json, and
  steam.getLocalAchievementSchema rebuilds each icon url out of that file's basename. When the
  emulator named its images after the achievement instead of after the Steam content hash - repacks
  and hand-made schemas do - the rebuilt url points at an asset that does not exist, so the repair
  fired one doomed request per icon and reported failure over an images/ folder that was already
  complete.
*/

function installWith(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-repair-icons-'));
  const steamSettings = path.join(root, 'steam_settings');
  fs.mkdirSync(path.join(steamSettings, 'images'), { recursive: true });
  for (const name of files) fs.writeFileSync(path.join(steamSettings, 'images', name), 'binary');
  return steamSettings;
}

const schemaWith = (list) => ({ achievement: { list } });

const rebuilt = (appid, base) => `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${base}`;

test('an icon already on disk is never re-downloaded', async () => {
  const steamSettings = installWith(['ACH_WIN.jpg', 'ACH_WIN_gray.jpg']);
  const attempted = [];

  const summary = await goldberg.repair({
    steamSettings,
    appid: '3751950',
    schema: schemaWith([
      {
        name: 'ACH_WIN',
        displayName: 'Winner',
        description: 'Win',
        icon: rebuilt('3751950', 'ACH_WIN.jpg'),
        icongray: rebuilt('3751950', 'ACH_WIN_gray.jpg'),
      },
    ]),
    downloadIcon: async (url, dir) => {
      attempted.push(url);
      throw new Error('Not Found'); // what the rebuilt url really answers
    },
  });

  assert.deepEqual(attempted, [], 'no request may be made for an icon that is already present');
  assert.equal(summary.icons.failed, 0, 'a complete images/ folder is not a failed repair');
  assert.equal(summary.icons.downloaded, 0);
  assert.equal(summary.icons.skipped, 2);
});

test('a genuinely missing icon is still downloaded, under the name the schema references', async () => {
  const steamSettings = installWith(['ACH_WIN.jpg']); // the gray variant is absent
  const attempted = [];

  const summary = await goldberg.repair({
    steamSettings,
    appid: '3751950',
    schema: schemaWith([
      {
        name: 'ACH_WIN',
        displayName: 'Winner',
        description: 'Win',
        icon: rebuilt('3751950', 'ACH_WIN.jpg'),
        icongray: rebuilt('3751950', 'ACH_WIN_gray.jpg'),
      },
    ]),
    downloadIcon: async (url, dir) => {
      attempted.push(url);
      return path.join(dir, path.basename(url));
    },
  });

  assert.deepEqual(attempted, [rebuilt('3751950', 'ACH_WIN_gray.jpg')], 'only the absent icon is fetched');
  assert.equal(summary.icons.downloaded, 1);
  assert.equal(summary.icons.failed, 0);
  assert.equal(summary.icons.skipped, 1);

  // The written schema must reference exactly the files the loop reasoned about.
  const written = JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'));
  assert.equal(written[0].icon, 'images/ACH_WIN.jpg');
  assert.equal(written[0].icongray, 'images/ACH_WIN_gray.jpg');
});

test('a download that really fails is still reported as a failure', async () => {
  const steamSettings = installWith([]);

  const summary = await goldberg.repair({
    steamSettings,
    appid: '3751950',
    schema: schemaWith([{ name: 'A', displayName: 'A', description: '', icon: rebuilt('3751950', 'a.jpg'), icongray: '' }]),
    downloadIcon: async () => {
      throw new Error('Not Found');
    },
  });

  assert.equal(summary.icons.failed, 1);
  assert.equal(summary.icons.skipped, 1, 'the empty icongray is skipped, not counted as a failure');
});

/*
  A brand-new appid whose achievement art is not on the community CDN yet answers 404 for every
  icon its Steam schema lists. Sovereign Tower (4113940, 75 achievements) did exactly that and
  blocked a scan for 174 seconds - one dead request at a time - before reporting "0 dl, 150 fail".
*/

const doomedSchema = (count) =>
  schemaWith(
    Array.from({ length: count }, (unused, i) => ({
      name: `ACH_${i}`,
      displayName: `A${i}`,
      description: '',
      icon: rebuilt('4113940', `${i}.jpg`),
      icongray: rebuilt('4113940', `${i}_gray.jpg`),
    }))
  );

test('a set of icons that all 404 is abandoned instead of walked to the end', async () => {
  const steamSettings = installWith([]);
  let attempts = 0;

  const summary = await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(75),
    downloadIcon: async () => {
      attempts++;
      throw new Error('Not Found');
    },
  });

  assert.ok(attempts < 40, `the dead set must be given up on, made ${attempts} of 150 requests`);
  assert.equal(summary.icons.failed, 150, 'every icon is still reported as a miss');
  assert.equal(summary.icons.downloaded, 0);
  assert.equal(summary.icons.abandoned, true);
});

test('one icon landing keeps the whole set in play', async () => {
  const steamSettings = installWith([]);
  let attempts = 0;

  // The first request succeeds, so the misses that follow are a flaky network rather than a game
  // with no art on the CDN - abandoning there would silently skip icons that are really there.
  const summary = await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(30),
    downloadIcon: async (url, dir) => {
      attempts++;
      if (attempts === 1) return path.join(dir, path.basename(url));
      throw new Error('Not Found');
    },
  });

  assert.equal(attempts, 60, 'every icon is attempted once');
  assert.equal(summary.icons.downloaded, 1);
  assert.equal(summary.icons.failed, 59);
  assert.equal(summary.icons.abandoned, undefined);
});

test('the icon fetches run in parallel', async () => {
  const steamSettings = installWith([]);
  let inFlight = 0;
  let peak = 0;

  await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(20),
    downloadIcon: async (url, dir) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return path.join(dir, path.basename(url));
    },
  });

  assert.ok(peak > 1, 'a sequential loop is what made a 75-achievement repair take three minutes');
});

/*
  The panel kept showing "150 icons not downloaded" as a warning with a "Rewrite the achievement
  data" button behind it. Rewriting can never fetch art Steam does not host, so the repair leaves a
  marker and diagnose() reports the fact at info level instead of as a repairable fault.
*/

test('an abandoned set leaves a marker that turns the warning into a statement of fact', async () => {
  const steamSettings = installWith([]);

  await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(75),
    downloadIcon: async () => {
      throw new Error('Not Found');
    },
  });

  assert.ok(fs.existsSync(path.join(steamSettings, 'images', '.aw-artwork-unavailable')), 'the marker must be written');

  const report = goldberg.diagnose({ gameDir: path.dirname(steamSettings), appid: '4113940' });
  assert.equal(report.achievements.iconsUnavailable, true);
  assert.ok(report.achievements.missingIcons.length > 0, 'the icons are still genuinely absent');
  assert.equal(report.issues.filter((i) => i.code === 'MISSING_ICONS').length, 0, 'no repairable warning');
  const info = report.issues.find((i) => i.code === 'ICONS_UNAVAILABLE');
  assert.ok(info, 'the fact is still reported');
  assert.equal(info.level, 'info', 'info keeps it out of the review count and off the repair button');
});

test('the marker is cleared as soon as Steam publishes the artwork', async () => {
  const steamSettings = installWith([]);
  const marker = path.join(steamSettings, 'images', '.aw-artwork-unavailable');

  await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(75),
    downloadIcon: async () => {
      throw new Error('Not Found');
    },
  });
  assert.ok(fs.existsSync(marker));

  // Same game, later: the art is up now, so the game must go back to an ordinary repairable state.
  await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(75),
    downloadIcon: async (url, dir) => {
      const file = path.join(dir, path.basename(url));
      fs.writeFileSync(file, 'x');
      return file;
    },
  });

  assert.ok(!fs.existsSync(marker), 'a successful download must clear the marker');
  const report = goldberg.diagnose({ gameDir: path.dirname(steamSettings), appid: '4113940' });
  assert.equal(report.achievements.iconsUnavailable, false);
});

/*
  The marker must not close the case. Steam sends no notification when a developer finally uploads
  the art, so the only way to find out is to look again - on the same three-day cadence steam.js
  already uses for descriptions and covers.
*/

const ageMarker = (steamSettings, days) => {
  const file = path.join(steamSettings, 'images', '.aw-artwork-unavailable');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.checkedAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(file, JSON.stringify(data));
};

test('a marker inside the three-day window suppresses the warning, an aged one reopens it', async () => {
  const steamSettings = installWith([]);
  await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(75),
    downloadIcon: async () => {
      throw new Error('Not Found');
    },
  });

  assert.equal(goldberg.needsArtworkRecheck(steamSettings), false, 'a fresh marker is not due for a retry');
  assert.equal(goldberg.diagnose({ gameDir: path.dirname(steamSettings), appid: '4113940' }).achievements.iconsUnavailable, true);

  ageMarker(steamSettings, 4);

  assert.equal(goldberg.needsArtworkRecheck(steamSettings), true, 'past the window the icons must be retried');
  const report = goldberg.diagnose({ gameDir: path.dirname(steamSettings), appid: '4113940' });
  assert.equal(report.achievements.iconsUnavailable, false, 'an aged marker must not keep suppressing the warning');
  assert.ok(report.issues.some((i) => i.code === 'MISSING_ICONS'), 'the repairable warning comes back');
});

test('a retry that fails again restamps the marker instead of retrying on every scan', async () => {
  const steamSettings = installWith([]);
  const stamp = () => JSON.parse(fs.readFileSync(path.join(steamSettings, 'images', '.aw-artwork-unavailable'), 'utf8')).checkedAt;
  const doomed = { steamSettings, appid: '4113940', schema: doomedSchema(75), downloadIcon: async () => { throw new Error('Not Found'); } };

  await goldberg.repair(doomed);
  ageMarker(steamSettings, 4);
  const before = stamp();

  await goldberg.repair(doomed);
  assert.notEqual(stamp(), before, 'the failed retry must restamp');
  assert.equal(goldberg.needsArtworkRecheck(steamSettings), false, 'and go quiet for another three days');
});

test('a small set that never trips the abandon threshold is still marked unavailable', async () => {
  const steamSettings = installWith([]);
  // 3 achievements = 6 icons, well under the abandon threshold, so nothing is "abandoned" here.
  const summary = await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(3),
    downloadIcon: async () => {
      throw new Error('Not Found');
    },
  });

  assert.equal(summary.icons.abandoned, undefined, 'too small to give up early');
  assert.equal(summary.icons.unavailable, true, 'but the whole set is still unobtainable');
  assert.ok(fs.existsSync(path.join(steamSettings, 'images', '.aw-artwork-unavailable')), 'so it must still be marked');
});

test('a partial miss beside icons already on disk stays an ordinary repairable gap', async () => {
  const steamSettings = installWith(['0.jpg']); // artwork plainly exists for this game
  const summary = await goldberg.repair({
    steamSettings,
    appid: '4113940',
    schema: doomedSchema(3),
    downloadIcon: async () => {
      throw new Error('Not Found');
    },
  });

  assert.equal(summary.icons.skipped, 1);
  assert.equal(summary.icons.unavailable, false, 'one icon on disk proves Steam does host art for this appid');
  assert.ok(!fs.existsSync(path.join(steamSettings, 'images', '.aw-artwork-unavailable')));
});
