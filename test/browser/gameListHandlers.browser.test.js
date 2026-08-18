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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_LIBRARY_HANDLERS_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_LIBRARY_HANDLERS_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // A normal Chromium close is sufficient; this only handles a failed detached launch.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-library-handlers-browser-'));
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
  const gameScript = fs.readFileSync(path.join(appDir, 'ui', 'game.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const jquery = fs.readFileSync(path.join(appDir, 'ui', 'lib', 'jquery-3.7.1.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <input id="achievement-search-input" value="stale filter">
    <section id="achievement"><div class="achievement-list"><ul><li class="search-hidden">stale row</li></ul></div></section>
    <section id="game-list"><div class="game-box" data-appid="480"></div></section>
    <script>${jquery}<\/script>
    <script>${gameScript}<\/script>
  </body></html>`;
}

test('library rescan removes only its own handlers and preserves game-view interaction', { concurrency: 1, timeout: 180000 }, async (t) => {
  const appSource = fs.readFileSync(path.join(appDir, 'app.js'), 'utf8');
  assert.match(appSource, /\$\('#game-list'\)\.off\('\.awLibrary'\)/, 'rescans must remove only the app-owned event namespace');
  assert.match(
    appSource,
    /onStart: function \(options = \{\}\)[\s\S]*?reloadCoverOverrides\(\);[\s\S]*?debug\.log\(`\$\{remote\.app\.name\} loading/,
    'a refresh must reload cover overrides promoted by the cache-clear path'
  );
  const appOwnedEvents = [...appSource.matchAll(/\.on\('(mouseenter|mouseleave|click)\.awLibrary'/g)].map((match) => match[1]);
  assert.deepEqual(appOwnedEvents, ['mouseenter', 'mouseleave', 'click', 'click', 'click'], 'every scan-owned game-list handler must join the namespace');

  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-library-handlers-harness-'));
  const harness = path.join(harnessDir, 'handlers.html');
  fs.writeFileSync(harness, buildHarness());

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(harness).href);
    const result = await page.evaluate(() => {
      let appOwnedClicks = 0;
      $('#game-list').on('click.awLibrary', '.game-box', () => {
        appOwnedClicks += 1;
      });

      // This is the exact cleanup shape used by app.onStart() before a rescan.
      $('#game-list').off('.awLibrary');
      const box = $('#game-list .game-box').get(0);
      $(box).trigger('click');

      return {
        appOwnedClicks,
        rememberedBox: window.__awMouseNavGameBox === box,
        searchValue: $('#achievement-search-input').val(),
        remainingHiddenRows: $('#achievement .achievement-list ul > li.search-hidden').length,
      };
    });

    assert.deepEqual(result, {
      appOwnedClicks: 0,
      rememberedBox: true,
      searchValue: '',
      remainingHiddenRows: 0,
    });
  } finally {
    await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    fs.rmSync(harnessDir, { recursive: true, force: true });
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
