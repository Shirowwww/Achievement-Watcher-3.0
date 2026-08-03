'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/*
  Runs the real settings filter, through the real jQuery, over the real app.html markup in a real
  browser engine — the layer a DOM-less parser cannot check. The filter's selectors (`:not`,
  descendant `.find`, `toggleClass`) and its promise to never restructure the panel only mean
  something against a live DOM, and the panel is translated positionally, so a filter that reordered
  or removed rows would mistranslate every label without failing anything else.

  Skipped (not failed) when no Chromium-family browser is installed: the suite must stay runnable on
  a machine that has none, the same way the app falls back when its scrape browser is missing.
*/

const appDir = path.join(__dirname, '..', 'app');
const puppeteer = require(path.join(appDir, 'node_modules', 'puppeteer-core'));

function findBrowser() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((file) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  });
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

test('the settings filter behaves correctly in a real DOM', { concurrency: 1 }, async (t) => {
  const executablePath = findBrowser();
  if (!executablePath) {
    t.skip('no Chromium-family browser available to host the DOM');
    return;
  }

  const harness = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-settings-')), 'harness.html');
  fs.writeFileSync(harness, buildHarness());

  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
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
    fs.rmSync(path.dirname(harness), { recursive: true, force: true });
  }
});
