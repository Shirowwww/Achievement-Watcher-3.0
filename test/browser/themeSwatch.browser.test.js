'use strict';

/*
  The per-layer swatch in the custom-theme builder, measured in a real engine because it is pure
  paint: nothing about the layer order is visible from the DOM.

  Layer colours carry an alpha channel, so the swatch shows the colour over a checkerboard - that is
  the only way "60% of this blue" reads as transparency rather than as a slightly different blue.
  The checkerboard lived in a `::before` at z-index -1, which does NOT put it behind its parent's own
  background: negative z-index only goes behind the parent's CONTENT. So it was painted over every
  colour, and a layer at 100% opacity looked see-through.
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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_SWATCH_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_SWATCH_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // A normal Chromium close is sufficient; this only handles a failed detached launch.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-swatch-browser-'));
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

function appCss() {
  return fs.readFileSync(path.join(appDir, 'resources', 'css', 'app.css'), 'utf8').replace(/<\/style/gi, '<\\/style');
}

// Three swatches written exactly as settings.js writes them: the layer goes in as custom properties.
const swatchHarness = `<!doctype html><html><head><meta charset="utf-8"><style>${appCss()}</style>
  <style>body { margin: 0; background: #101a2c; } #theme-customizer { display: block !important; }</style>
  </head><body>
    <div id="theme-customizer"><div id="theme-customizer-layers">
      <div class="theme-layer-row"><div class="theme-layer-preview" id="sw-100" style="--swatch-color:#192a40;--swatch-image:none"></div></div>
      <div class="theme-layer-row"><div class="theme-layer-preview" id="sw-35" style="--swatch-color:#192a4059;--swatch-image:none"></div></div>
      <div class="theme-layer-row"><div class="theme-layer-preview" id="sw-0" style="--swatch-color:#19204000;--swatch-image:none"></div></div>
    </div></div>
  </body></html>`;

test('the custom-theme swatch composites the layer over the checkerboard, not under it', { concurrency: 1, timeout: 180000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(`no Chromium-based browser available (${failures.join('; ') || 'none found'})`);
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 300 });
    await page.setContent(swatchHarness, { waitUntil: 'load' });

    // How many distinct colours the face of a swatch holds: one means a flat fill, more means the
    // checkerboard is showing through it.
    const tones = async (selector) => {
      const clip = await page.evaluate((sel) => {
        const box = document.querySelector(sel).getBoundingClientRect();
        return { x: box.x + 4, y: box.y + 4, width: box.width - 8, height: box.height - 8 };
      }, selector);
      const shot = await page.screenshot({ clip, encoding: 'base64' });
      return page.evaluate(
        (data) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
              const seen = new Set();
              for (let i = 0; i < pixels.length; i += 4) seen.add([pixels[i], pixels[i + 1], pixels[i + 2]].join(','));
              resolve([...seen]);
            };
            img.src = 'data:image/png;base64,' + data;
          }),
        shot
      );
    };

    const opaque = await tones('#sw-100');
    assert.equal(opaque.length, 1, `a layer at 100% must be a flat fill, saw ${opaque.length} tones`);
    assert.equal(opaque[0], '25,42,64', 'and exactly the colour that was asked for (#192a40)');

    assert.ok((await tones('#sw-35')).length > 1, 'a translucent layer shows the checkerboard through it');
    assert.ok((await tones('#sw-0')).length > 1, 'and a fully clear one is the checkerboard');

    // The structure the fix rests on: the swatch owns the checkerboard, ::after owns the layer.
    const layers = await page.evaluate(() => {
      const el = document.querySelector('#sw-100');
      return {
        ownImage: getComputedStyle(el).backgroundImage,
        overContent: getComputedStyle(el, '::after').content,
        beforeContent: getComputedStyle(el, '::before').content,
      };
    });
    assert.match(layers.ownImage, /linear-gradient/, 'the checkerboard belongs to the swatch itself');
    assert.notEqual(layers.overContent, 'none', 'the layer is painted by ::after, on top of it');
    assert.equal(layers.beforeContent, 'none', 'and nothing may paint over that again');
  } finally {
    await browser.close().catch(() => {});
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
