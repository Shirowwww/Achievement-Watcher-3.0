'use strict';

/*
  The row of notification test buttons, laid out with the app's real stylesheet and the real labels
  of all eighteen locales.

  It is a row of peers, so it should read as one: every button an equal share of the line, one gap
  between them all, nothing spilling out of a button. None of that is visible to a unit test — the
  rule that broke it was a later `#settings` override turning the row back into content-width flex
  items, which left a ragged gap at the end of the line — and the labels differ by more than twice in
  length between languages, so the one that overflows first is never the one you are looking at.
*/

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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_TESTROW_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_TESTROW_PROFILE: userDataDir } }
    );
  } catch {
    // Closing Chromium normally is enough; this only clears a failed launch that detached itself.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-testrow-browser-'));
    try {
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        timeout: 30000,
        protocolTimeout: 60000,
        userDataDir,
        args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
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

// The five buttons, in the order app.html lists them.
const TEST_KEYS = ['achievement', 'rare', 'progress', 'playtime', 'platinum'];
const TEST_ICONS = ['trophy', 'gem', 'tachometer-alt', 'stopwatch', 'medal'];

const localeDir = path.join(appDir, 'locale', 'lang');
const locales = fs
  .readdirSync(localeDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    name: path.basename(file, '.json'),
    labels: TEST_KEYS.map((key) => JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8')).settings.notification.test[key]),
  }));

// The row as the panel really nests it, with the panel's own stylesheet.
function harness(labels, width) {
  const css = fs.readFileSync(path.join(appDir, 'resources', 'css', 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
  const buttons = labels
    .map((label, index) => `<li><div class="btn"><i class="fas fa-${TEST_ICONS[index]}"></i> <span>${label}</span></div></li>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${new URL('file:///' + path.join(appDir, 'resources', 'css', 'fontawesome.css').replace(/\\/g, '/')).href}">
    <style>${css}</style>
    <style>
      body { margin: 0; }
      /* The settings panel is a modal that is hidden until it is opened. */
      #settings, #settings .box, #settings .container, #settings section.content {
        display: block !important; opacity: 1 !important; visibility: visible !important; position: static !important; transform: none !important;
      }
      #stage { width: ${width}px; }
    </style>
  </head><body>
    <div id="settings"><div class="box"><div class="container">
      <section class="content active" data-view="notification"><div id="stage">
        <div class="arrow-list"><div class="title"><span>TEST</span></div>
          <ul id="options-notify-test">${buttons}</ul>
        </div>
      </div></section>
    </div></div></div>
  </body></html>`;
}

async function measureRow(page, labels, width) {
  await page.setViewport({ width: width + 60, height: 400 });
  await page.setContent(harness(labels, width), { waitUntil: 'load' });
  return page.evaluate(() => {
    const list = document.querySelector('#options-notify-test');
    const items = [...list.querySelectorAll('li')];
    const boxes = items.map((li) => li.getBoundingClientRect());

    // Group by the line each button landed on: wrapping is allowed, a ragged line is not.
    const byLine = new Map();
    boxes.forEach((box) => {
      const key = Math.round(box.top);
      if (!byLine.has(key)) byLine.set(key, []);
      byLine.get(key).push(box);
    });

    return {
      listWidth: Math.round(list.getBoundingClientRect().width),
      lines: [...byLine.values()].map((line) => ({
        widths: line.map((box) => Math.round(box.width)),
        gaps: line.slice(1).map((box, index) => Math.round(box.left - line[index].right)),
        used: Math.round(line[line.length - 1].right - line[0].left),
      })),
      overflowing: items.filter((li) => {
        const button = li.querySelector('.btn');
        return button.scrollWidth > button.clientWidth + 1;
      }).length,
    };
  });
}

test('the notification test buttons share the line evenly, in every locale', { concurrency: 1, timeout: 300000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser — ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  try {
    const page = await browser.newPage();
    assert.equal(locales.length, 18);

    // The width the row gets in the panel at the app's default window size.
    for (const { name, labels } of locales) {
      const row = await measureRow(page, labels, 720);
      assert.equal(row.lines.length, 1, `${name}: the five buttons should fit one line at the normal panel width`);
      const [line] = row.lines;
      assert.equal(new Set(line.widths).size, 1, `${name}: the buttons are not equal shares — ${line.widths.join(', ')}`);
      assert.equal(new Set(line.gaps).size, 1, `${name}: the gaps between the buttons differ — ${line.gaps.join(', ')}`);
      assert.ok(Math.abs(line.used - row.listWidth) <= 1, `${name}: the row leaves ${row.listWidth - line.used}px unused at the end of the line`);
      assert.equal(row.overflowing, 0, `${name}: a label is clipped by its button`);
    }

    /*
      Cramped: at the app's minimum window the row has to wrap. Every line it wraps into must still
      fill itself in equal shares — the failure this guards against is a last line holding one button
      at its natural width, which is what the row looked like before.
    */
    for (const { name, labels } of locales) {
      const row = await measureRow(page, labels, 460);
      assert.ok(row.lines.length >= 1);
      for (const line of row.lines) {
        assert.equal(new Set(line.widths).size, 1, `${name}: a wrapped line is not in equal shares`);
        assert.ok(Math.abs(line.used - row.listWidth) <= 1, `${name}: a wrapped line does not fill the row`);
      }
      assert.equal(row.overflowing, 0, `${name}: a label is clipped when the panel is narrow`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
