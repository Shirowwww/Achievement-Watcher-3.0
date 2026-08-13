'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { withScrapeLease } = require('../../app/util/scrapeLease.js');

test('a failed Puppeteer startup releases the scrape lease for the next request', async () => {
  const state = { steamcommunity: false, steamhunters: false };
  let rejectStartup;
  const first = withScrapeLease(
    state,
    { steamhunters: true },
    () =>
      new Promise((_, reject) => {
        rejectStartup = reject;
      })
  );

  assert.equal(state.steamhunters, true, 'the first scrape owns the SteamHunters lease while startup is pending');

  let secondStarted = false;
  const second = withScrapeLease(
    state,
    { steamhunters: true },
    async () => {
      secondStarted = true;
      return 'recovered';
    },
    () => new Promise((resolve) => setTimeout(resolve, 1))
  );

  rejectStartup(new Error('Chromium failed to launch'));
  await assert.rejects(first, /Chromium failed to launch/);
  assert.equal(await second, 'recovered');
  assert.equal(secondStarted, true, 'a later scrape is not blocked by the failed startup');
  assert.deepEqual(state, { steamcommunity: false, steamhunters: false });
});

test('a lease releases only the scrape kinds it owns', async () => {
  const state = { steamcommunity: true, steamhunters: false };
  await withScrapeLease(state, { steamhunters: true }, async () => {});
  assert.deepEqual(state, { steamcommunity: true, steamhunters: false });
});
