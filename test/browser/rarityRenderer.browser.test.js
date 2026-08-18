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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_RARITY_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_RARITY_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // Closing Chromium normally is enough; this only clears a failed launch that detached itself.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rarity-browser-'));
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
  const gameScript = fs
    .readFileSync(path.join(appDir, 'ui', 'game.js'), 'utf8')
    .replace(/<\/script/gi, '<\\/script');
  const jquery = fs.readFileSync(path.join(appDir, 'ui', 'lib', 'jquery-3.7.1.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    <section id="achievement">
      <div class="achievement-list">
        <div class="header"><div class="sort-ach"><span class="sort percentage"></span></div></div>
        <ul>
          <li><div class="achievement rarity-silver" data-name='quote"name'><div class="stats"><span class="community"><span class="data">old</span></span></div></div></li>
          <li><div class="achievement rare rarity-gold" data-name="duplicate"><div class="stats"><span class="community"><span class="data">old-first</span></span></div></div></li>
          <li><div class="achievement rare rarity-gold" data-name="duplicate"><div class="stats"><span class="community"><span class="data">old-second</span></span></div></div></li>
          <li><div class="achievement rare rarity-gold" data-name="bronze"><div class="stats"><span class="community"><span class="data">old-bronze</span></span></div></div></li>
          <li><div class="achievement rare rarity-gold" data-name="untouched"><div class="stats"><span class="community"><span class="data">keep</span></span></div></div></li>
        </ul>
      </div>
    </section>
    <script>${jquery}<\/script>
    <script>
      window.restoreCalls = 0;
      window.restoreAchievementSorts = () => { window.restoreCalls += 1; };
      window.require = (request) => {
        if (request === '@electron/remote') return { app: { getAppPath: () => '/app' } };
        if (request === 'path') return { join: (...parts) => parts.join('/') };
        if (request === '/app/util/overlayUi.js') {
          return {
            rarityTier(percent) {
              if (!Number.isFinite(percent) || percent < 0 || percent > 10) return null;
              if (percent < 3) return 'gold';
              if (percent < 6) return 'silver';
              return 'bronze';
            },
          };
        }
        throw new Error('unexpected require: ' + request);
      };
      ${gameScript}
    <\/script>
  </body></html>`;
}

test('rarity renderer indexes rendered rows without selector injection or duplicate loss', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-rarity-harness-'));
  const harness = path.join(harnessDir, 'rarity.html');
  fs.writeFileSync(harness, buildHarness());

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(harness).href);
    const result = await page.evaluate(() => {
      window.applyRarity([
        { name: 'quote"name', percent: 3.04 },
        { name: 'duplicate', percent: 100.06 },
        { name: 'bronze', percent: 6 },
        { name: 'missing', percent: 1 },
      ]);
      const rows = (name) =>
        $('#achievement li .achievement')
          .filter(function () {
            return this.getAttribute('data-name') === name;
          })
          .map(function () {
            return { text: $(this).find('.stats .community span.data').text(), classes: this.className };
          })
          .get();
      return {
        quote: rows('quote"name'),
        duplicates: rows('duplicate'),
        bronze: rows('bronze'),
        untouched: rows('untouched'),
        headerShown: $('.achievement-list > .header .sort-ach .sort.percentage').hasClass('show'),
        restoreCalls: window.restoreCalls,
      };
    });

    assert.deepEqual(result.quote, [{ text: '3', classes: 'achievement rare rarity-silver' }]);
    assert.deepEqual(
      result.duplicates,
      [
        { text: '100', classes: 'achievement' },
        { text: '100', classes: 'achievement' },
      ],
      'every duplicate row must receive the same update'
    );
    assert.deepEqual(result.bronze, [{ text: '6', classes: 'achievement rare rarity-bronze' }]);
    assert.deepEqual(result.untouched, [{ text: 'keep', classes: 'achievement rare rarity-gold' }]);
    assert.equal(result.headerShown, true);
    assert.equal(result.restoreCalls, 1);
  } finally {
    if (browser) await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    fs.rmSync(harnessDir, { recursive: true, force: true });
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
