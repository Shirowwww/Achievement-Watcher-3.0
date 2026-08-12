'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/*
  Runs the real filter over the real app.html in a real browser engine — the only layer that proves the
  selector/toggle behaviour and the no-restructure promise. Skipped when no Chromium browser is present.
*/

const appDir = path.join(__dirname, '..', 'app');
const puppeteer = require(path.join(appDir, 'node_modules', 'puppeteer-core'));

function findBrowsers() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.filter((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
}

// A browser that fails to launch can leave detached processes behind (Edge re-execs itself), so each
// attempt gets its own profile directory that a failure can clean up by pid.
function killProcessesUsing(userDataDir) {
  if (process.platform !== 'win32') return;
  try {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        // The directory travels in the environment, never interpolated into the script: a temp path
        // holding a quote (a user named O'Brien) would end the string, and `-like` would read `[`,
        // `]`, `*` and `?` in it as wildcards. `.Contains()` on an env var has neither problem.
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_TEST_PROFILE_DIR) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_TEST_PROFILE_DIR: userDataDir } }
    );
  } catch {
    /* best effort: a leftover browser must never fail the test */
  }
}

// An installed browser is not necessarily a usable one, so try each until one actually starts —
// this machine has a working Chrome sitting right behind an Edge that cannot start headless, and
// the first candidate failing used to fail the whole test. The explicit `timeout` matters just as
// much: without it a browser that starts but never speaks CDP hangs this test, and the suite with
// it, forever.
async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-browser-'));
    try {
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        timeout: 30000,
        protocolTimeout: 60000,
        userDataDir,
        args: ['--no-sandbox', '--disable-gpu'],
      });
      return { browser, executablePath, userDataDir, failures };
    } catch (err) {
      failures.push(`${path.basename(executablePath)}: ${String(err.message || err).split('\n')[0]}`);
      killProcessesUsing(userDataDir);
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
  return { browser: null, executablePath: null, userDataDir: null, failures };
}

// The settings panel, jQuery and the filter module, wired into a standalone page. `module.exports`
// is shimmed so the CommonJS module used by the app loads unchanged.
function buildHarness() {
  const html = fs.readFileSync(path.join(appDir, 'view', 'app.html'), 'utf8');
  const start = html.indexOf('<section id="settings">');
  const end = html.indexOf('</section>', html.indexOf('<div class="footer">', start)) + '</section>'.length;
  assert.ok(start > 0 && end > start, 'could not isolate the settings section from app.html');

  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
    ${html.slice(start, end)}
    <script>${fs.readFileSync(path.join(appDir, 'ui', 'lib', 'jquery-3.7.1.min.js'), 'utf8')}<\/script>
    <script>
      const module = { exports: {} };
      ${fs.readFileSync(path.join(appDir, 'util', 'settingsSearch.js'), 'utf8')}
      window.searchRules = module.exports;
    <\/script>
  </body></html>`;
}

test('the settings filter behaves correctly in a real DOM', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    // Skipped, not failed: with no browser that will start, this test can say nothing at all about
    // the filter. The reasons are printed so an environment fault stays visible instead of hiding
    // behind a quiet skip.
    t.skip(failures.length ? `no usable Chromium-family browser — ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harness = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-settings-')), 'harness.html');
  fs.writeFileSync(harness, buildHarness());

  try {
    const page = await browser.newPage();
    await page.goto('file://' + harness.replace(/\\/g, '/'));

    // Rows as the filter defines them: outermost matches per tab (see settingsSearch.ROW_SELECTOR).
    await page.evaluate(() => {
      window.allRows = () =>
        $('#settings .box section.content[data-view]')
          .toArray()
          .reduce((set, section) => set.add(window.searchRules.rowsIn($, $(section))), $());
    });
    const rowCount = () => page.evaluate(() => window.allRows().length);
    const visibleRows = () => page.evaluate(() => window.allRows().not('.search-hidden').length);
    const signature = () =>
      page.evaluate(() =>
        $('#settings')
          .find('li')
          .map(function () {
            return this.id || (this.querySelector('[id]') || {}).id || '';
          })
          .get()
          .join('|')
      );

    const totalRows = await rowCount();
    assert.ok(totalRows > 40, `the harness must contain the real settings rows, got ${totalRows}`);
    const before = await signature();

    // A narrow query leaves only its own matches visible.
    const narrow = await page.evaluate(() => window.searchRules.filterSections($, 'steamlessAutoUnpack'));
    assert.strictEqual(narrow.total, 1, `one row should match an option id, got ${JSON.stringify(narrow.perView)}`);
    assert.strictEqual(narrow.perView.emulator, 1, 'that row lives in the Emulator tab');
    assert.strictEqual(await visibleRows(), 1, 'every other row must be hidden');

    // Its list is kept, and lists left with nothing visible are collapsed.
    const blocks = await page.evaluate(() => ({
      hidden: $('#settings').find(window.searchRules.BLOCK_SELECTOR).filter('.search-hidden').length,
      shown: $('#settings').find(window.searchRules.BLOCK_SELECTOR).not('.search-hidden').length,
    }));
    assert.ok(blocks.hidden > 0, 'blocks with no visible row must collapse');
    assert.ok(blocks.shown > 0, 'the block holding the match must stay');

    // Filtering must never restructure the panel — positional i18n depends on it.
    assert.strictEqual(await signature(), before, 'filtering moved or removed rows');
    assert.strictEqual(await rowCount(), totalRows, 'filtering changed the number of rows in the DOM');

    // A query nothing matches empties every tab, which is what drives the empty state.
    const none = await page.evaluate(() => window.searchRules.filterSections($, 'zzzznotasetting'));
    assert.strictEqual(none.total, 0);
    assert.strictEqual(await visibleRows(), 0);

    // Clearing the query restores every row and every block.
    const cleared = await page.evaluate(() => window.searchRules.filterSections($, ''));
    assert.strictEqual(cleared.total, totalRows, 'an empty query must match every row');
    assert.strictEqual(await visibleRows(), totalRows);
    assert.strictEqual(
      await page.evaluate(() => $('#settings').find('.search-hidden').length),
      0,
      'no element may be left hidden after the search is cleared'
    );
    assert.strictEqual(await signature(), before);
  } finally {
    await browser.close();
    // close() returns before the OS has torn the processes down; anything still holding the profile
    // would keep it locked and strand the directory.
    killProcessesUsing(userDataDir);
    fs.rmSync(path.dirname(harness), { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
