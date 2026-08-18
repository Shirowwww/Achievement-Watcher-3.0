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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_CONTROLLER_GRID_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_CONTROLLER_GRID_TEST_PROFILE: userDataDir } }
    );
  } catch {
    /* a normal close is sufficient; this only handles a failed detached launch */
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-controller-grid-'));
    try {
      const browser = await puppeteer.launch({
        executablePath,
        userDataDir,
        headless: true,
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

/*
  A library grid built to the real tile geometry: two tiles side by side, each carrying the three
  controls app.js paints on it - achievements top-left, health/config top-right, play centred and
  resting at opacity 0 until its tile is hovered.

  The tiles are LANDSCAPE here on purpose. That is the layout the bug actually bites in: the wider
  the tile, the further away the neighbouring game's centre is, until the cross-axis penalty stops
  covering the distance and a tile's own top-right button becomes the cheapest "move right" target.
  A portrait grid happens to survive the same scoring, which is why this only reproduced for users
  on landscape covers.
*/
function buildHarness() {
  const controller = fs.readFileSync(path.join(appDir, 'ui', 'controller.js'), 'utf8').replace(/<\/script/gi, '<\/script');
  const tile = (appid, left) => `
    <div class="game-box" data-appid="${appid}" style="position:absolute;left:${left}px;top:0;width:400px;height:190px;">
      <div class="header" style="position:absolute;inset:0;">
        <button type="button" class="play-button" style="position:absolute;top:40%;left:50%;width:44px;height:44px;opacity:0;"></button>
      </div>
      <button type="button" class="achievement-button" style="position:absolute;top:1%;left:1%;width:26px;height:26px;opacity:0.72;"></button>
      <button type="button" class="config-button" style="position:absolute;top:1%;right:1%;width:26px;height:26px;opacity:0.72;"></button>
    </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">
    <section id="game-list" style="position:relative;height:220px;">${tile(480, 0)}${tile(220, 420)}</section>
    <script>
      window.module = { exports: {} };
      window.require = () => ({ ipcRenderer: { on() {} }, webFrame: { clearCache() {} } });
    <\/script>
    <script>${controller}<\/script>
  </body></html>`;
}

test('controller navigation crosses the library grid tile by tile', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  const harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-controller-grid-harness-'));
  const harness = path.join(harnessDir, 'grid.html');
  fs.writeFileSync(harness, buildHarness());

  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(harness).href);

    const result = await page.evaluate(() => {
      const { chooseDirectionalCandidate, isGameTileControl } = window.module.exports;
      const visible = (el) => {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
        if (parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      // Everything the app's SELECTOR would match inside the grid.
      const all = Array.from(document.querySelectorAll('#game-list .game-box, #game-list button')).filter(visible);
      const first = document.querySelector('.game-box[data-appid="480"]');
      const second = document.querySelector('.game-box[data-appid="220"]');

      const kept = all.filter((el) => !isGameTileControl(el));
      const withoutFix = chooseDirectionalCandidate(first, all, 1, 0);
      const withFix = chooseDirectionalCandidate(first, kept, 1, 0);

      return {
        // The play button rests fully transparent, so it must not even reach the candidate list.
        playButtonIsVisible: visible(document.querySelector('.play-button')),
        keptIsTilesOnly: kept.every((el) => el.classList.contains('game-box')),
        keptCount: kept.length,
        regressionLandedOn: withoutFix ? withoutFix.className : null,
        fixedLandedOnSecondTile: withFix === second,
      };
    });

    // Proves the reported symptom is what we think: unfiltered, "right" lands on the first tile's
    // own top-right health button instead of the neighbouring game.
    assert.equal(result.playButtonIsVisible, false, 'an opacity-0 play button must not be focusable');
    assert.equal(result.regressionLandedOn, 'config-button', 'sanity: the un-filtered list reproduces the reported bug');

    assert.equal(result.keptIsTilesOnly, true, 'only tiles may take part in grid navigation');
    assert.equal(result.keptCount, 2);
    assert.equal(result.fixedLandedOnSecondTile, true, 'right must move to the next game');
  } finally {
    await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    await removeBrowserProfile(userDataDir, killBrowserUsing);
    fs.rmSync(harnessDir, { recursive: true, force: true });
  }
});
