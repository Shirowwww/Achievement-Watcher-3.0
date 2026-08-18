'use strict';

// Placeholder tiles are sized from a guess until makeList reports the real count. They used to be
// re-queried out of the DOM per streamed game (two `:has()` traversals of a growing list) and to
// leave a shimmering tail for games that were never coming.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { removeBrowserProfile } = require('../helpers/browserProfileCleanup');

const appDir = path.join(__dirname, '..', '..', 'app');
const puppeteer = require(path.join(appDir, 'node_modules', 'puppeteer-core'));

function findBrowsers() {
  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
    .filter(Boolean)
    .filter((file) => fs.existsSync(file));
}

function killBrowserUsing(userDataDir) {
  if (process.platform !== 'win32' || !userDataDir) return;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_SKELETON_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_SKELETON_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // A normal Chromium close is sufficient; this only handles a failed detached launch.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-skeleton-browser-'));
    try {
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        timeout: 30000,
        protocolTimeout: 60000,
        userDataDir,
        args: ['--no-sandbox', '--disable-gpu'],
      });
      return { browser, userDataDir, failures };
    } catch (error) {
      failures.push(`${path.basename(executablePath)}: ${String(error.message || error).split('\n')[0]}`);
      killBrowserUsing(userDataDir);
      await removeBrowserProfile(userDataDir, killBrowserUsing);
    }
  }
  return { browser: null, userDataDir: null, failures };
}

// The skeleton helpers are plain functions in app.js; lift that block and run it against real jQuery.
function skeletonSource() {
  const source = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  const start = source.indexOf('const MAX_SKELETON_TILES');
  const end = source.indexOf('// Repaint one tile and the header counters');
  assert.ok(start > 0 && end > start, 'the skeleton helper block must stay locatable in app.js');
  return source.slice(start, end);
}

test('placeholder tiles track the real game count and never outlive the stream', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const jquery = fs.readFileSync(path.join(appDir, 'ui', 'lib', 'jquery-3.7.1.min.js'), 'utf8');
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body><div id="game-list"><ul></ul></div></body></html>');
    await page.evaluate(`${jquery}\nwindow.$ = window.jQuery = jQuery;`);

    const result = await page.evaluate((code) => {
      const api = new Function(
        '$',
        `${code}; return { addSkeletonTiles, replaceSkeletonWith, clearSkeletonTiles, setSkeletonExpected };`
      )(window.$);
      const tile = (i) => window.$(`<li><div class="game-box" data-appid="${i}"></div></li>`);
      const count = () => window.$('#game-list .game-box.skeleton').length;
      const real = () => window.$('#game-list .game-box').not('.skeleton').length;

      const out = {};

      // A small library: the first scan of a session seeds the default block before the count is known.
      window.$('#game-list ul').empty();
      api.addSkeletonTiles(12);
      out.seededBeforeTotal = count();
      api.setSkeletonExpected(3);
      out.afterTotalKnown = count();
      for (let i = 0; i < 3; i++) api.replaceSkeletonWith(tile(i));
      out.smallTail = count();
      out.smallReal = real();

      // A larger library keeps a tail while games are still arriving, then runs it down to nothing.
      window.$('#game-list ul').empty();
      api.addSkeletonTiles(18);
      api.setSkeletonExpected(30);
      for (let i = 0; i < 10; i++) api.replaceSkeletonWith(tile(i));
      out.midStreamTail = count();
      for (let i = 10; i < 30; i++) api.replaceSkeletonWith(tile(i));
      out.endTail = count();
      out.largeReal = real();

      // Placeholders are inert and hidden from assistive tech.
      window.$('#game-list ul').empty();
      api.addSkeletonTiles(4);
      out.ariaHidden = window.$('#game-list .game-box.skeleton[aria-hidden="true"]').length;
      api.clearSkeletonTiles();
      out.afterClear = count();

      // A stream with no reported total keeps the original tail behaviour.
      window.$('#game-list ul').empty();
      api.addSkeletonTiles(18);
      for (let i = 0; i < 5; i++) api.replaceSkeletonWith(tile(i));
      out.unknownTotalTail = count();

      /*
        Installed-only mode. makeList reports every game it will deliver, but the filter hides part
        of them in CSS, so that total counts tiles the user never sees: a 10-game scan with 7
        uninstalled games is a 3-tile grid, and the placeholders have to say 3, not 10.
      */
      const installedTile = (i, installed) =>
        window.$(`<li><div class="game-box" data-appid="${i}" data-installed="${installed}"></div></li>`);
      window.installedOnlyEnabled = () => true;
      window.$('#game-list ul').empty();
      api.addSkeletonTiles(18);
      api.setSkeletonExpected(10);
      out.installedSeeded = count();
      // Three installed games among ten delivered.
      for (let i = 0; i < 7; i++) api.replaceSkeletonWith(installedTile(i, '0'));
      out.installedAfterHidden = count();
      for (let i = 7; i < 10; i++) api.replaceSkeletonWith(installedTile(i, '1'));
      out.installedEndTail = count();

      // With the filter off the same stream keeps promising all ten.
      window.installedOnlyEnabled = () => false;
      window.$('#game-list ul').empty();
      api.addSkeletonTiles(18);
      api.setSkeletonExpected(10);
      for (let i = 0; i < 7; i++) api.replaceSkeletonWith(installedTile(i, '0'));
      out.unfilteredAfterSeven = count();
      return out;
    }, skeletonSource());

    assert.equal(result.seededBeforeTotal, 12, 'the pre-count seed is the caller-chosen block');
    // The real total plus the one deliberate extra, so the grid keeps saying the scan is not done.
    assert.equal(result.afterTotalKnown, 4, 'learning the real total shrinks the block to it, plus one');
    assert.equal(result.smallTail, 1, 'the single trailing placeholder stays until the scan ends');
    assert.equal(result.smallReal, 3);

    assert.ok(result.midStreamTail > 0, 'games still to come keep a visible tail');
    assert.ok(result.midStreamTail <= 6, 'the tail stays short');
    assert.equal(result.endTail, 1, 'the last game leaves the one extra placeholder, not a tail');
    assert.equal(result.largeReal, 30);

    assert.equal(result.ariaHidden, 4, 'placeholders stay hidden from assistive tech');
    assert.equal(result.afterClear, 0, 'clearing removes every placeholder');
    assert.equal(result.unknownTotalTail, 6, 'without a total the short rolling tail is kept');

    // Installed-only: the placeholders must count the tiles the grid will actually show.
    assert.equal(result.installedSeeded, 11, 'the reported total plus one, before anything is known about the filter');
    assert.equal(
      result.installedAfterHidden,
      4,
      'seven hidden arrivals must take seven off what is still expected, leaving the three installed games plus one'
    );
    assert.equal(result.installedEndTail, 1, 'the three installed games run the tail down to the single extra');
    assert.equal(result.unfilteredAfterSeven, 4, 'with the filter off the same seven games are real tiles, so three remain plus one');
  } finally {
    await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
