'use strict';

// A toast click carries the achievement it was fired for, and the game view is supposed to land on
// that row. Exercised in a real DOM because every interesting case is a layout/visibility one:
// a collapsed list has no measurable offset, and a leftover search filter hides the row outright.

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
        'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_FOCUS_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }',
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_FOCUS_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // Closing Chromium normally is enough; this only clears a failed launch that detached itself.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-focus-browser-'));
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

function row(name, extraClass) {
  return (
    '<li class="' +
    (extraClass || '') +
    '"><div class="achievement" data-name=\'' +
    name +
    '\'><div class="content"><div class="title">' +
    name +
    '</div></div></div></li>'
  );
}

function buildHarness() {
  const jquery = fs.readFileSync(path.join(appDir, 'ui', 'lib', 'jquery-3.7.1.min.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const focusModule = fs.readFileSync(path.join(appDir, 'util', 'achievementFocus.js'), 'utf8').replace(/<\/script/gi, '<\\/script');

  // #achievement is the scroll container in the real page, and the rows are tall enough that the
  // target is genuinely off-screen before the scroll runs.
  const rows = [row('first'), row('quote"name'), row('filtered', 'search-hidden'), row('deep')].join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
      #achievement { height: 200px; overflow-y: auto; }
      #achievement li { height: 80px; }
      .search-hidden { display: none; }
    </style></head><body>
    <input id="achievement-search-input" />
    <section id="achievement">
      <div id="unlock" class="achievement-list active">
        <div class="header"><span class="toggle">v</span></div>
        <ul>${rows}</ul>
      </div>
      <div id="lock" class="achievement-list">
        <div class="header"><span class="toggle">v</span></div>
        <ul style="display:none">${row('collapsed')}</ul>
      </div>
    </section>
    <script>${jquery}<\/script>
    <script>
      const focusExports = { exports: {} };
      (function (module) { ${focusModule} })(focusExports);
      window.focusAchievementRow = focusExports.exports.focusAchievementRow;

      // Stand-in for the real toggle handler in ui/game.js: open the list on click.
      $('#achievement .achievement-list .header .toggle').on('click', function () {
        const list = $(this).closest('.achievement-list');
        list.addClass('active');
        list.children('ul').show();
      });

      window.runFocus = (name) => {
        const missing = [];
        const found = window.focusAchievementRow(
          $, $('#achievement'), $('#achievement .achievement-list ul > li'), name,
          { onMissing: (n) => missing.push(n), expandSettleMs: 20, scrollMs: 10 }
        );
        return { found, missing };
      };
    <\/script>
  </body></html>`;
}

test('toast-click focus scrolls to a row, expands its list and survives a missing name', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-focus-harness-'));
  const harness = path.join(harnessDir, 'focus.html');
  fs.writeFileSync(harness, buildHarness());

  const settle = (page, ms) => page.evaluate((delay) => new Promise((resolve) => setTimeout(resolve, delay)), ms);

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(harness).href);

    // A name that is not in the list must report the miss and leave the view alone, never throw:
    // this runs inside the fadeIn callback that restores the clicked tile's pointer-events.
    const missing = await page.evaluate(() => {
      const result = window.runFocus('does-not-exist');
      return { ...result, scrollTop: $('#achievement').scrollTop(), highlights: $('#achievement li.highlight').length };
    });
    assert.equal(missing.found, false);
    assert.deepEqual(missing.missing, ['does-not-exist']);
    assert.equal(missing.scrollTop, 0, 'a miss must not move the view');
    assert.equal(missing.highlights, 0);

    // A quote in the name would break an attribute selector, so matching is done in JS.
    const quoted = await page.evaluate(() => window.runFocus('quote"name'));
    assert.equal(quoted.found, true);
    await settle(page, 200);
    const afterQuoted = await page.evaluate(() => ({
      scrollTop: $('#achievement').scrollTop(),
      highlighted: $('#achievement li.highlight .achievement').attr('data-name'),
    }));
    assert.equal(afterQuoted.highlighted, 'quote"name');
    assert.ok(afterQuoted.scrollTop > 0, 'the row is below the fold, so the container must have scrolled');

    // A row hidden by a leftover search filter is useless to highlight: clear the filter first.
    const filtered = await page.evaluate(() => {
      $('#achievement-search-input').val('stale filter');
      return window.runFocus('filtered');
    });
    assert.equal(filtered.found, true);
    await settle(page, 200);
    const afterFiltered = await page.evaluate(() => ({
      searchValue: $('#achievement-search-input').val(),
      stillHidden: $('#achievement li.search-hidden').length,
      visible: $('#achievement li').has('.achievement[data-name="filtered"]').is(':visible'),
    }));
    assert.equal(afterFiltered.searchValue, '');
    assert.equal(afterFiltered.stillHidden, 0);
    assert.equal(afterFiltered.visible, true);

    // A list the user collapsed has no measurable offset until it is open again.
    const collapsed = await page.evaluate(() => window.runFocus('collapsed'));
    assert.equal(collapsed.found, true);
    await settle(page, 300);
    const afterCollapsed = await page.evaluate(() => ({
      listVisible: $('#lock ul').is(':visible'),
      listActive: $('#lock').hasClass('active'),
      scrollTop: $('#achievement').scrollTop(),
    }));
    assert.equal(afterCollapsed.listVisible, true, 'the collapsed list must be expanded before scrolling');
    assert.equal(afterCollapsed.listActive, true);
    assert.ok(afterCollapsed.scrollTop > 0);
  } finally {
    if (browser) await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    fs.rmSync(harnessDir, { recursive: true, force: true });
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
