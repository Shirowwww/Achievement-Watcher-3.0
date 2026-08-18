'use strict';

/*
  Two pieces of window chrome, measured in a real engine because both are pure layout/paint and
  neither is observable from the DOM alone:

    - the title bar has to touch the top and both sides of the window. It did not: body carried a
      1px layout border, so the bar - the first child - started one pixel in on three sides and the
      body background showed through as a hairline frame around it.
    - a pinned settings section header has to hide the row scrolling under it. It was translucent,
      so the description passing behind printed straight through the heading.
    - the strip ABOVE that header - the gap between the top of the panel and the next card's
      heading - showed the previous card's last row sliced in half by the hard edge of the
      scrollport. A sticky band blurs that strip, and where it pins is the whole trick: Chromium
      measures a sticky child against the scroller's CONTENT box, so `top: 0` parks the band level
      with the headers and leaves exactly the strip it exists for untouched.
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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_CHROME_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_CHROME_PROFILE: userDataDir } }
    );
  } catch {
    // Closing Chromium normally is enough; this only clears a failed launch that detached itself.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-chrome-browser-'));
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

function appCss() {
  return fs.readFileSync(path.join(appDir, 'resources', 'css', 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
}

// The window as app.html builds it: the title bar is body's first child, main follows.
const windowHarness = `<!doctype html><html><head><meta charset="utf-8"><style>${appCss()}</style>
  <style>
    /* The real bar is a shadow-DOM custom element; only its host box matters here. */
    title-bar { display: flex; width: 100%; height: 30px; position: relative; z-index: 999; background: #000; }
  </style>
  </head><body><title-bar></title-bar><main id="main"><section id="home"></section></main></body></html>`;

// Two settings cards, each with a pinned header and rows long enough to scroll under it.
const settingsHarness = `<!doctype html><html><head><meta charset="utf-8"><style>${appCss()}</style>
  <style>
    body { margin: 0; }
    #settings, #settings .box, #settings .container, #settings section.content {
      display: block !important; opacity: 1 !important; visibility: visible !important; position: static !important; transform: none !important;
    }
    #settings .box .content { height: 160px; overflow-y: auto; }
  </style>
  </head><body>
    <div id="settings"><div class="box"><div class="container">
      <section class="content active" data-view="general">
        <div class="arrow-list" id="card-a">
          <div class="title"><span>Interface and behaviour</span></div>
          <ul><li class="hasHelper"><div class="help">Interface language. Game data is fetched in this language whenever possible.</div></li>
          <li><div class="help">filler</div></li><li><div class="help">filler</div></li><li><div class="help">filler</div></li>
          <li><div class="help">filler</div></li><li><div class="help">filler</div></li></ul>
        </div>
        <div class="arrow-list" id="card-b">
          <div class="title"><span>Sources</span></div>
          <ul><li><div class="help">filler</div></li><li><div class="help">filler</div></li><li><div class="help">filler</div></li></ul>
        </div>
        <div class="emulator-login" id="card-login">
          <div class="emulator-login-heading">
            <div class="title"><span>Steam login</span></div>
            <span class="emulator-warning"><span>Throwaway account</span></span>
          </div>
          <p>filler</p><p>filler</p><p>filler</p>
        </div>
        <div class="settings-card" id="card-theme">
          <div class="emulator-login-heading">
            <div class="title"><span>Custom theme</span></div>
            <span class="emulator-warning"><span>Per-layer preview</span></span>
          </div>
          <p>filler</p><p>filler</p><p>filler</p>
        </div>
      </section>
    </div></div></div>
  </body></html>`;

test('window chrome: the title bar reaches the window edges and pinned headers are opaque enough to read over', async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(`no Chromium-based browser available (${failures.join('; ') || 'none found'})`);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 400 });

    await page.setContent(windowHarness, { waitUntil: 'load' });
    const chrome = await page.evaluate(() => {
      const bar = document.querySelector('title-bar').getBoundingClientRect();
      const body = getComputedStyle(document.body);
      return {
        top: bar.top,
        left: bar.left,
        right: window.innerWidth - bar.right,
        borderTop: body.borderTopWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        mainHeight: document.querySelector('main').getBoundingClientRect().height,
      };
    });
    assert.equal(chrome.top, 0, 'the title bar must sit flush against the top of the window');
    assert.equal(chrome.left, 0, 'flush against the left edge');
    assert.equal(chrome.right, 0, 'flush against the right edge');
    assert.equal(chrome.borderTop, '0px', 'no layout border may push the chrome inward');
    assert.equal(chrome.docScrollWidth, chrome.viewport, 'the window must never scroll horizontally');
    // 100vh - the 30px bar: the removed border must not have left a gap or an overflow.
    assert.equal(chrome.mainHeight, 400 - 30);

    await page.setContent(settingsHarness, { waitUntil: 'load' });
    const header = await page.evaluate(() => {
      const title = document.querySelector('#settings .arrow-list > .title');
      const row = document.querySelector('#settings .arrow-list .help');
      const content = document.querySelector('#settings .box .content');
      const style = getComputedStyle(title);
      const at = (node) => node.getBoundingClientRect().top - content.getBoundingClientRect().top;

      const before = { title: at(title), row: at(row) };
      content.scrollTop = 60;
      const after = { title: at(title), row: at(row) };
      return {
        position: style.position,
        titleMoved: Math.abs(after.title - before.title),
        rowMoved: Math.abs(after.row - before.row),
        // The row must end up behind the heading, which is the whole reason the header needs to hide it.
        rowIsUnderTitle: after.row < after.title + title.getBoundingClientRect().height,
        backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
        // Chromium reports this as color(srgb r g b / a) once color-mix is involved.
        alpha: (/\/\s*([\d.]+)\s*\)/.exec(style.backgroundColor) || /rgba?\([^)]*?,\s*([\d.]+)\s*\)/.exec(style.backgroundColor) || [null, '1'])[1],
      };
    });
    assert.equal(header.position, 'sticky', 'the section header stays pinned while its rows scroll');
    assert.ok(header.rowMoved > 40, 'the rows really scrolled');
    assert.ok(header.titleMoved <= 2, `the pinned header must stay put while they do (moved ${header.titleMoved}px)`);
    assert.ok(header.rowIsUnderTitle, 'the scrolled row ends up behind the heading');
    assert.match(header.backdropFilter, /blur\(14px\)/, 'what passes behind it is blurred, not printed through it');
    // Opaque enough that the heading always wins, translucent enough for the blur to be visible.
    const alpha = Number(header.alpha);
    assert.ok(alpha >= 0.75 && alpha < 1, `pinned header alpha should be frosted, got ${alpha}`);

    // The band above the pinned header. Its box is a pseudo-element, so its geometry is measured
    // through a probe element copying the same computed rules onto the same place in the flow.
    const band = await page.evaluate(async () => {
      const content = document.querySelector('#settings .box .content');
      content.scrollTop = 0;
      const style = getComputedStyle(content, '::before');
      const probe = document.createElement('div');
      for (const prop of ['position', 'top', 'zIndex', 'height', 'margin', 'display']) probe.style[prop] = style[prop];
      content.insertBefore(probe, content.firstChild);

      content.scrollTop = 120;
      const rect = probe.getBoundingClientRect();
      const opacityAt = (top) => {
        content.scrollTop = top;
        // A scroll-driven timeline is sampled off the compositor, so the value has to be read after
        // the frame that carries the new scroll offset.
        return new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(Number(getComputedStyle(content, '::before').opacity)))
          )
        );
      };
      const atRest = await opacityAt(0);
      const scrolled = await opacityAt(120);
      const contentRect = content.getBoundingClientRect();
      const header = document.querySelector('#card-b > .title');
      probe.remove();
      return {
        filter: style.backdropFilter || style.webkitBackdropFilter,
        mask: style.maskImage || style.webkitMaskImage,
        pointerEvents: style.pointerEvents,
        zIndex: style.zIndex,
        headerZIndex: getComputedStyle(header).zIndex,
        // Distance from the top edge of the scroller, borders included: 1px is the border itself.
        topRelative: rect.top - contentRect.top,
        height: rect.height,
        atRest,
        scrolled,
      };
    });

    // Nothing may move because the band exists: with the list at rest the first card still starts
    // exactly one border plus one padding down, as it would with no pseudo-element at all.
    const flow = await page.evaluate(() => {
      const content = document.querySelector('#settings .box .content');
      content.scrollTop = 0;
      const style = getComputedStyle(content);
      return {
        cardOffset: document.querySelector('#card-a').getBoundingClientRect().top - content.getBoundingClientRect().top,
        expected: parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
      };
    });
    assert.ok(
      Math.abs(flow.cardOffset - flow.expected) <= 1,
      `the band takes no room in the flow (first card at ${flow.cardOffset}px, expected ${flow.expected}px)`
    );
    assert.match(band.filter, /blur\(/, 'the band blurs what scrolls under it');
    assert.match(band.mask, /linear-gradient/, 'and fades out downward instead of ending on a line');
    assert.equal(band.pointerEvents, 'none', 'it must never swallow a click meant for a row');
    assert.ok(
      Number(band.zIndex) < Number(band.headerZIndex),
      `the band sits under the pinned headers so they stay crisp (${band.zIndex} vs ${band.headerZIndex})`
    );
    assert.ok(
      band.topRelative <= 1.5,
      `the band must reach the top edge of the scroller, not the padding box (was ${band.topRelative}px down)`
    );
    assert.ok(band.height >= 24, `and be deep enough to cover the strip (${band.height}px)`);
    // At the top of a tab nothing is scrolling out yet, so the band would only be a haze over the
    // first card: it belongs to the act of scrolling and has to fade in with it.
    assert.equal(band.atRest, 0, 'no band while the list sits at the top');
    assert.equal(band.scrolled, 1, 'and a fully faded-in one once it has scrolled');

    /*
      The veil rides a scroll timeline, and app.css blanks every animation under reduced motion.
      That reset is about things that move on their own: here it would strand the band at opacity 0
      and quietly delete the feature for anyone who asked Windows to calm its animations.
    */
    const reduced = await browser.newPage();
    try {
      await reduced.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await reduced.setViewport({ width: 1000, height: 400 });
      await reduced.setContent(settingsHarness, { waitUntil: 'load' });
      const opacity = await reduced.evaluate(async () => {
        const content = document.querySelector('#settings .box .content');
        content.scrollTop = 120;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return Number(getComputedStyle(content, '::before').opacity);
      });
      assert.equal(opacity, 1, 'reduced motion must not blank a scroll-position state');
    } finally {
      await reduced.close().catch(() => {});
    }

    /*
      Every section header in Settings has to behave the same way under that band. The account and
      custom-theme cards put their title inside an `.emulator-login-heading` row (it carries a status
      badge beside the text), which sat one level deeper than the pinned-header selectors reached: on
      those cards alone the header scrolled away and smeared under the blur while every other section
      kept a crisp bar.
    */
    const parity = await page.evaluate(() => {
      const of = (selector) => {
        const el = document.querySelector(selector);
        const style = getComputedStyle(el);
        return { position: style.position, zIndex: style.zIndex, blur: style.backdropFilter || style.webkitBackdropFilter };
      };
      return {
        plain: of('#card-a > .title'),
        login: of('#card-login > .emulator-login-heading'),
        theme: of('#card-theme > .emulator-login-heading'),
      };
    });
    for (const [who, style] of Object.entries(parity)) {
      assert.equal(style.position, 'sticky', `the ${who} card header pins like the rest`);
      assert.equal(style.zIndex, parity.plain.zIndex, `and rides at the same height as the rest (${who})`);
      assert.equal(style.blur, parity.plain.blur, `with the same frosted treatment (${who})`);
    }
  } finally {
    await browser.close().catch(() => {});
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
