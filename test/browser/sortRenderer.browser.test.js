'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { removeBrowserProfile } = require('../helpers/browserProfileCleanup');

const appDir = path.join(__dirname, '..', '..', 'app');
const puppeteer = require(path.join(appDir, 'node_modules', 'puppeteer-core'));

function findBrowsers() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.filter((file) => fs.existsSync(file));
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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_SORT_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_SORT_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // A normal browser close is sufficient; this only handles a failed detached launch.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sort-browser-'));
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

function buildHarness() {
  const sortScript = fs.readFileSync(path.join(appDir, 'ui', 'sort.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const jquery = fs.readFileSync(path.join(appDir, 'ui', 'lib', 'jquery-3.7.1.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    #games.installed-only li:has(.game-box[data-installed='0']) { display: none; }
  </style></head><body>
    <div id="sort-box"><button class="sort alpha"></button><button class="sort percentage"></button><button class="sort time"></button><button class="sort played"></button><button class="installed-filter"></button></div>
    <div id="game-list"><ul id="games"></ul><div class="isEmpty"></div></div>
    <script>${jquery}<\/script>
    <script>
      localStorage.showInstalledOnly = 'false';
      window.profileStatsRefreshes = [];
      window.refreshProfileStats = (options) => window.profileStatsRefreshes.push(options);
      window.require = (request) => {
        if (request === 'fs') return { existsSync: () => false };
        if (request === 'path') return { join: (...parts) => parts.join('/') };
        if (request === 'electron') return { ipcRenderer: { sendSync: () => '/tmp' } };
        throw new Error('unexpected require: ' + request);
      };
      ${sortScript}
      window.sortFixture = [
        { id: 'a', appid: 10, installed: 1, title: 'Beta', lastplayed: 10, time: 5, percent: 20 },
        { id: 'b', appid: 2, installed: 0, title: 'Alpha', lastplayed: 10, time: 20, percent: 80 },
        { id: 'c', appid: 3, installed: 1, title: 'Gamma', lastplayed: 30, time: 20, percent: 80 },
        { id: 'd', appid: 4, installed: 0, title: 'Delta', lastplayed: 5, time: 40, percent: 10 },
      ];
      window.runSortFixture = (options) => {
        $('#games').html(window.sortFixture.map((game) =>
          '<li data-id="' + game.id + '"><div class="game-box" data-appid="' + game.appid + '" data-installed="' + game.installed + '" data-lastplayed="' + game.lastplayed + '" data-time="' + game.time + '"></div><div class="info"><span class="title">' + game.title + '</span></div><span class="progressBar" data-percent="' + game.percent + '"></span></li>'
        ).join(''));
        window.sort($('#games'), options);
        return $('#games > li').map(function () { return this.dataset.id; }).get();
      };
    <\/script>
  </body></html>`;
}

test('game sort snapshots DOM values while preserving every ordering rule', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-sort-harness-'));
  const harness = path.join(harnessDir, 'sort.html');
  fs.writeFileSync(harness, buildHarness());

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(harness).href);
    const result = await page.evaluate(() => ({
      playedDescending: window.runSortFixture({ played: true, direction: 'desc' }),
      playedAscending: window.runSortFixture({ played: true, direction: 'asc' }),
      timeDescending: window.runSortFixture({ time: true, direction: 'desc' }),
      percentDescending: window.runSortFixture({ percent: true, direction: 'desc' }),
      percentAscending: window.runSortFixture({ percent: true, direction: 'asc' }),
      alphaAscending: window.runSortFixture({ alpha: true, direction: 'asc' }),
      alphaDescending: window.runSortFixture({ alpha: true, direction: 'desc' }),
      noCriterion: window.runSortFixture({ direction: 'desc' }),
    }));

    assert.deepEqual(result.playedDescending, ['c', 'b', 'a', 'd']);
    assert.deepEqual(result.playedAscending, ['d', 'b', 'a', 'c']);
    assert.deepEqual(result.timeDescending, ['d', 'b', 'c', 'a']);
    assert.deepEqual(result.percentDescending, ['b', 'c', 'a', 'd']);
    assert.deepEqual(result.percentAscending, ['d', 'a', 'b', 'c']);
    assert.deepEqual(result.alphaAscending, ['b', 'a', 'd', 'c']);
    assert.deepEqual(result.alphaDescending, ['c', 'd', 'a', 'b']);
    assert.deepEqual(result.noCriterion, ['b', 'c', 'd', 'a'], 'AppID ties remain ascending regardless of direction');
  } finally {
    await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    fs.rmSync(harnessDir, { recursive: true, force: true });
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});

test('installed-only toggle refreshes profile statistics and visible games together', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-installed-filter-harness-'));
  const harness = path.join(harnessDir, 'installed-filter.html');
  fs.writeFileSync(harness, buildHarness());

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(harness).href);
    const result = await page.evaluate(async () => {
      window.runSortFixture({ alpha: true, direction: 'asc' });
      window.profileStatsRefreshes = [];
      document.querySelector('.installed-filter').click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        enabled: localStorage.showInstalledOnly,
        active: document.querySelector('.installed-filter').classList.contains('active'),
        visible: $('#games > li:visible').map(function () { return this.dataset.id; }).get(),
        refreshes: window.profileStatsRefreshes,
      };
    });

    assert.equal(result.enabled, 'true');
    assert.equal(result.active, true);
    assert.deepEqual(result.visible, ['a', 'c']);
    assert.deepEqual(result.refreshes, [{ animate: true }]);
  } finally {
    await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    fs.rmSync(harnessDir, { recursive: true, force: true });
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
