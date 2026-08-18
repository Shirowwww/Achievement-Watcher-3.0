'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const goldberg = require(path.join(__dirname, '..', '..', 'app', 'parser', 'goldberg.js'));

/*
  Game Health's "Repair the achievement data" is dominated by icon downloads - two per achievement -
  so on a large game the panel sat still for a minute with nothing to show it was working. The
  repair now reports progress; these tests pin the contract the progress bar reads.
*/

function newInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-repair-progress-'));
  const steamSettings = path.join(root, 'steam_settings');
  fs.mkdirSync(steamSettings, { recursive: true });
  return steamSettings;
}

function schemaWith(count) {
  return {
    achievement: {
      list: Array.from({ length: count }, (unused, index) => ({
        name: `ACH_${index}`,
        displayName: `Achievement ${index}`,
        icon: `https://example.invalid/icon_${index}.jpg`,
        icongray: `https://example.invalid/gray_${index}.jpg`,
      })),
    },
  };
}

test('every icon advances the count exactly once, downloaded or not', async () => {
  const steamSettings = newInstall();
  const events = [];
  // One url of each pair fails: a repair on a flaky network must still reach done === total,
  // otherwise the bar would stop short of the end and read as a hang.
  await goldberg.repair({
    steamSettings,
    appid: 1,
    schema: schemaWith(4),
    writeDlc: false,
    writeMain: false,
    downloadIcon: async (url, dir) => {
      if (url.includes('gray_')) throw new Error('network');
      const file = path.join(dir, path.basename(url));
      fs.writeFileSync(file, 'x');
      return file;
    },
    onProgress: (progress) => events.push(progress),
  });

  const icons = events.filter((event) => event.phase === 'icons');
  assert.ok(icons.length > 0, 'the icon phase must report progress');
  const total = icons[0].total;
  assert.equal(total, 8, 'two images per achievement');
  assert.equal(icons[icons.length - 1].done, total, 'the count must reach the total');
  // Strictly increasing by one, starting from the initial 0 - the bar must never jump or go back.
  assert.deepEqual(
    icons.map((event) => event.done),
    Array.from({ length: total + 1 }, (unused, index) => index)
  );
});

test('an icon already on disk still advances the bar', async () => {
  const steamSettings = newInstall();
  const imgDir = path.join(steamSettings, 'images');
  fs.mkdirSync(imgDir, { recursive: true });
  // Pre-seed every icon so the repair skips all of them: skipped work is still work done, and a bar
  // that ignored it would stall at 0% on exactly the installs that repair fastest.
  const schema = schemaWith(3);
  for (const entry of schema.achievement.list) {
    for (const url of [entry.icon, entry.icongray]) fs.writeFileSync(path.join(imgDir, path.basename(url)), 'x');
  }

  const events = [];
  const summary = await goldberg.repair({
    steamSettings,
    appid: 1,
    schema,
    writeDlc: false,
    writeMain: false,
    downloadIcon: async () => {
      throw new Error('must not download an icon that is already present');
    },
    onProgress: (progress) => events.push(progress),
  });

  assert.equal(summary.icons.skipped, 6);
  assert.equal(summary.icons.downloaded, 0);
  const icons = events.filter((event) => event.phase === 'icons');
  assert.equal(icons[icons.length - 1].done, 6);
});

test('the phases arrive in order and end on done', async () => {
  const steamSettings = newInstall();
  const phases = [];
  await goldberg.repair({
    steamSettings,
    appid: 1,
    schema: schemaWith(1),
    writeDlc: false,
    writeMain: false,
    downloadIcon: async () => null,
    onProgress: (progress) => {
      if (phases[phases.length - 1] !== progress.phase) phases.push(progress.phase);
    },
  });
  assert.deepEqual(phases, ['backup', 'icons', 'schema', 'config', 'done']);
});

test('a throwing progress sink cannot fail the repair', async () => {
  const steamSettings = newInstall();
  const summary = await goldberg.repair({
    steamSettings,
    appid: 1,
    schema: schemaWith(1),
    writeDlc: false,
    writeMain: false,
    downloadIcon: async () => null,
    onProgress: () => {
      throw new Error('a broken observer must not take the repair down');
    },
  });
  assert.ok(fs.existsSync(path.join(steamSettings, 'achievements.json')));
  assert.equal(summary.achievementsJson.length, 1);
});

test('the repair still runs with no progress sink at all', async () => {
  const steamSettings = newInstall();
  const summary = await goldberg.repair({
    steamSettings,
    appid: 1,
    schema: schemaWith(2),
    writeDlc: false,
    writeMain: false,
    downloadIcon: async () => null,
  });
  assert.equal(summary.achievementsJson.length, 2);
});
