'use strict';

/*
  What a designed preset actually paints.

  The rest of the preset tests read the generated stylesheet as text, which proves a property was
  written but not that it renders - a variable can be declared and never read, a state class can be
  added to an element no rule matches, and a card can overflow the window it was measured for. This
  renders the real preset (markup, engine and generated stylesheet) in a Chromium-family browser and
  reads back what the engine produced.
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
const generator = require(path.join(appDir, 'util', 'customPreset.js'));

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
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:AW_PRESET_TEST_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { stdio: 'ignore', timeout: 30000, env: { ...process.env, AW_PRESET_TEST_PROFILE: userDataDir } }
    );
  } catch {
    // Closing Chromium normally is enough; this only clears a failed launch that detached itself.
  }
}

async function launchBrowser() {
  const failures = [];
  for (const executablePath of findBrowsers()) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-preset-browser-'));
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

// A 1x1 PNG, so artwork can be tested without reading a file the frame is not allowed to load.
const SAMPLE_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const payloadFor = (state) => {
  const base = { iconPath: SAMPLE_IMAGE, imagePath: SAMPLE_IMAGE, displayName: 'Title', description: 'Description', gameName: 'Sample Game', scale: 1 };
  // What the watchdog sends for a game it could not name and an unlock it has no rate for.
  if (state === 'bare') return { ...base, gameName: '', rarityPercent: null, notificationType: 'achievement' };
  if (state === 'rare-gold') return { ...base, notificationType: 'achievement', rarityPercent: 1.4 };
  if (state === 'rare-silver') return { ...base, notificationType: 'achievement', rarityPercent: 4.5 };
  if (state === 'rare-bronze') return { ...base, notificationType: 'achievement', rarityPercent: 8.2 };
  if (state === 'platinum') return { ...base, notificationType: 'platinum', isPlatinum: true };
  // What an ordinary unlock actually carries: the app sends null when it knows no rarity.
  if (state === 'no-rarity') return { ...base, notificationType: 'achievement', rarityPercent: null };
  if (state === 'empty-rarity') return { ...base, notificationType: 'achievement', rarityPercent: '' };
  if (state === 'playtime') return { ...base, notificationType: 'playtime', rarityPercent: null };
  if (state === 'progress') return { ...base, notificationType: 'progress', progress: { current: 3, max: 10, percent: 30 } };
  // A rare percentage on a progress notification must not turn it into a rare card.
  if (state === 'progress-rare') return { ...base, notificationType: 'progress', rarityPercent: 1, progress: { current: 1, max: 4, percent: 25 } };
  return { ...base, notificationType: 'achievement' };
};

// Render one design in one state and report what the browser computed for it.
async function renderPreset(page, options, state = 'normal') {
  const box = generator.presetBoxSize(options);
  await page.setViewport({ width: box.width, height: box.height });
  await page.setContent(generator.buildPresetPreviewHtml(options), { waitUntil: 'load' });
  await page.evaluate((payload) => window.awPreviewApply(payload), payloadFor(state));
  // Let the entry animation finish, so opacity and transform are the resting values.
  await new Promise((resolve) => setTimeout(resolve, 800));
  return page.evaluate(() => {
    const card = document.querySelector('.ach');
    const title = document.querySelector('.title');
    const detail = document.querySelector('.detail');
    const icon = document.querySelector('.icon img');
    const line = document.querySelector('.progress_line');
    const meter = document.querySelector('.progress_meter');
    const cardStyle = getComputedStyle(card);
    const before = getComputedStyle(card, '::before');
    const rect = card.getBoundingClientRect();
    return {
      classes: card.className,
      accent: cardStyle.getPropertyValue('--accent').trim(),
      opacity: Number(cardStyle.opacity),
      flexDirection: cardStyle.flexDirection,
      borderLeft: cardStyle.borderLeftWidth,
      borderTop: cardStyle.borderTopWidth,
      borderLeftColor: cardStyle.borderLeftColor,
      background: cardStyle.backgroundImage,
      boxShadow: cardStyle.boxShadow,
      radius: cardStyle.borderTopLeftRadius,
      paddingLeft: cardStyle.paddingLeft,
      paddingTop: cardStyle.paddingTop,
      gap: cardStyle.rowGap,
      fontFamily: cardStyle.fontFamily,
      fontSize: cardStyle.fontSize,
      letterSpacing: cardStyle.letterSpacing,
      titleColor: getComputedStyle(title).color,
      titleWeight: getComputedStyle(title).fontWeight,
      titleTransform: getComputedStyle(title).textTransform,
      titleText: title.textContent,
      detailSize: getComputedStyle(detail).fontSize,
      detailText: detail.textContent,
      iconDisplay: getComputedStyle(icon.closest('.icon')).display,
      iconWidth: getComputedStyle(icon).width,
      iconRadius: getComputedStyle(icon).borderTopLeftRadius,
      iconVisible: icon.style.display !== 'none',
      artworkImage: before.backgroundImage,
      artworkOpacity: before.opacity,
      artworkFilter: before.filter,
      progressDisplay: getComputedStyle(line).display,
      progressHidden: line.hidden,
      meterWidth: meter.style.width,
      textAlign: getComputedStyle(document.querySelector('.text_wrap')).textAlign,
      metaHidden: document.querySelector('.meta').hidden,
      metaDisplay: getComputedStyle(document.querySelector('.meta')).display,
      gameText: document.querySelector('.game').textContent,
      gameHidden: document.querySelector('.game').hidden,
      gameDisplay: getComputedStyle(document.querySelector('.game')).display,
      rarityText: document.querySelector('.rarity').textContent,
      rarityHidden: document.querySelector('.rarity').hidden,
      rarityDisplay: getComputedStyle(document.querySelector('.rarity')).display,
      detailClamp: getComputedStyle(detail).webkitLineClamp,
      detailWhiteSpace: getComputedStyle(detail).whiteSpace,
      textShadow: cardStyle.textShadow,
      iconShadow: getComputedStyle(icon).boxShadow,
      progressTrackHeight: getComputedStyle(document.querySelector('.progress_track')).height,
      textOverflow: getComputedStyle(document.querySelector('.text_wrap')).overflow,
      textWrapRect: (() => {
        const wrap = document.querySelector('.text_wrap').getBoundingClientRect();
        const line = document.querySelector('.title').getBoundingClientRect();
        return { wrapRight: wrap.right, lineRight: line.right };
      })(),
      card: { width: rect.width, height: rect.height, left: rect.left, top: rect.top },
      window: { width: window.innerWidth, height: window.innerHeight },
      duration: Number(document.querySelector('meta[name="duration"]').content),
    };
  });
}

test('a designed preset renders every property it was given', { concurrency: 1, timeout: 300000 }, async (t) => {
  const { browser, userDataDir, failures } = await launchBrowser();
  if (!browser) {
    t.skip(failures.length ? `no usable Chromium-family browser - ${failures.join(' | ')}` : 'no Chromium-family browser installed');
    return;
  }

  try {
    const page = await browser.newPage();

    await t.test('the default design paints the look the builder always had', async () => {
      const rendered = await renderPreset(page, {});
      assert.equal(rendered.accent, '#4aa3ff');
      assert.equal(rendered.titleColor, 'rgb(74, 163, 255)');
      assert.equal(rendered.borderLeft, '4px', 'the accent bar is the 4px left edge');
      assert.equal(rendered.borderLeftColor, 'rgb(74, 163, 255)');
      assert.equal(rendered.radius, '12px');
      assert.equal(rendered.paddingLeft, '18px');
      assert.equal(rendered.paddingTop, '12px');
      assert.equal(rendered.gap, '12px');
      assert.equal(rendered.fontSize, '16px');
      assert.equal(rendered.iconWidth, '64px');
      assert.equal(rendered.flexDirection, 'row');
      assert.equal(rendered.opacity, 1, 'the card must be fully faded in once the entry animation ends');
      assert.equal(rendered.titleText, 'Title');
      assert.equal(rendered.detailText, 'Description');
    });

    await t.test('a rare unlock repaints the card, tier by tier', async () => {
      const design = { accent: '#4aa3ff', rareAccent: '#ffd24e', rareSilver: '#9fb2cc', rareBronze: '#cd7f32', rareGlow: 60 };
      const gold = await renderPreset(page, design, 'rare-gold');
      assert.match(gold.classes, /state-rare/);
      assert.match(gold.classes, /tier-gold/);
      assert.equal(gold.accent, '#ffd24e');
      assert.equal(gold.titleColor, 'rgb(255, 210, 78)', 'the title does not follow the rare colour');
      assert.equal(gold.borderLeftColor, 'rgb(255, 210, 78)', 'the accent bar does not follow the rare colour');
      /*
        The glow is a second shadow whose blur radius is the state's glow strength, so a rare card is
        literally lit where a normal one is not: the same two shadows, an accent-coloured blur
        against 0px. Reading the radius is the only way to tell them apart.

        Asserted as "more than none", not as a number of pixels: the radius is the glow strength
        times util/customPreset.js's GLOW_RADIUS_PX, and that constant is tuned for how close the
        popup lands to the corner of the screen - every pixel of glow is a pixel of transparent
        margin the window has to reserve. Pinning the product here made a placement decision fail as
        if it were a rendering bug.
      */
      const glowBlur = (shadow) => Number(/(?:\d+px\s+){2}([\d.]+)px[^,]*$/.exec(shadow.split('), ').pop())[1]);
      const normal = await renderPreset(page, design, 'normal');
      assert.equal(glowBlur(normal.boxShadow), 0, 'a normal card should not glow at the default strength');
      assert.ok(glowBlur(gold.boxShadow) > 0, 'the rare glow is not painted');
      assert.ok(glowBlur(gold.boxShadow) > glowBlur(normal.boxShadow), 'a rare card is not lit any more than a normal one');
      assert.match(gold.boxShadow, /1 0\.823529 0\.305882|255, 210, 78/, 'the glow is not the rare colour');

      /*
        An unlock whose rarity the app does not know sends rarityPercent null, and Number(null) is 0 -
        the rarest tier there is. Every ordinary notification came out gold until the engine checked
        for absence before converting.
      */
      for (const state of ['no-rarity', 'empty-rarity', 'playtime']) {
        const ordinary = await renderPreset(page, design, state);
        assert.doesNotMatch(ordinary.classes, /state-rare/, `${state} was styled as a rare unlock`);
        assert.equal(ordinary.accent, '#4aa3ff', `${state} did not keep the preset's own accent`);
      }

      const silver = await renderPreset(page, design, 'rare-silver');
      assert.match(silver.classes, /tier-silver/);
      assert.equal(silver.accent, '#9fb2cc');

      const bronze = await renderPreset(page, design, 'rare-bronze');
      assert.match(bronze.classes, /tier-bronze/);
      assert.equal(bronze.accent, '#cd7f32');
    });

    await t.test('a 100% completion has its own colour, and progress never borrows a state', async () => {
      const design = { platinumAccent: '#cfe3ff', platinumGlow: 70 };
      const platinum = await renderPreset(page, design, 'platinum');
      assert.match(platinum.classes, /state-platinum/);
      assert.equal(platinum.accent, '#cfe3ff');
      assert.equal(platinum.titleColor, 'rgb(207, 227, 255)');

      // A progress notification carrying a rare percentage is still a progress notification: the
      // watchdog sends both, and styling it as a rare unlock would misreport what happened.
      const progress = await renderPreset(page, design, 'progress-rare');
      assert.doesNotMatch(progress.classes, /state-rare/);
      assert.doesNotMatch(progress.classes, /state-platinum/);
    });

    await t.test('the progress line only appears for a progress notification, and can be switched off', async () => {
      const shown = await renderPreset(page, { showProgress: true }, 'progress');
      assert.equal(shown.progressHidden, false);
      assert.equal(shown.progressDisplay, 'flex');
      assert.equal(shown.meterWidth, '30%');

      const idle = await renderPreset(page, { showProgress: true }, 'normal');
      assert.equal(idle.progressHidden, true, 'an ordinary unlock must not show an empty progress line');

      const off = await renderPreset(page, { showProgress: false }, 'progress');
      assert.equal(off.progressDisplay, 'none', 'the progress bar cannot be switched off');
    });

    await t.test('layout, alignment and typography reach the rendered card', async () => {
      const stacked = await renderPreset(page, { layout: 'icon-top', align: 'center', iconSize: 80 });
      assert.equal(stacked.flexDirection, 'column');
      assert.equal(stacked.textAlign, 'center');
      assert.equal(stacked.iconWidth, '80px');

      const mirrored = await renderPreset(page, { layout: 'icon-right' });
      assert.equal(mirrored.flexDirection, 'row-reverse');

      const textOnly = await renderPreset(page, { layout: 'text-only' });
      assert.equal(textOnly.iconDisplay, 'none', 'a text-only preset still reserves room for the icon');

      const typography = await renderPreset(page, {
        fontFamily: 'mono',
        fontSize: 24,
        detailScale: 70,
        titleWeight: 900,
        titleCase: 'uppercase',
        letterSpacing: 2,
      });
      assert.match(typography.fontFamily, /Consolas|monospace/);
      assert.equal(typography.fontSize, '24px');
      assert.equal(typography.detailSize, '16.8px', 'the description size is not a share of the title size');
      assert.equal(typography.titleWeight, '900');
      assert.equal(typography.titleTransform, 'uppercase');
      assert.equal(typography.letterSpacing, '2px');
    });

    await t.test('backgrounds, borders and effects render as chosen', async () => {
      const gradient = await renderPreset(page, { bgMode: 'gradient', bg: '#112233', bg2: '#445566', bgAngle: 90 });
      assert.match(gradient.background, /linear-gradient\(90deg, rgb\(17, 34, 51\) 0%, rgb\(68, 85, 102\) 100%\)/);

      const artwork = await renderPreset(page, { bgMode: 'artwork', artworkDim: 40, artworkBlur: 6 });
      assert.match(artwork.artworkImage, /^url\("data:image\/png/, 'the payload artwork is not painted');
      assert.equal(artwork.artworkOpacity, '0.6', 'artwork dimming is not applied');
      assert.equal(artwork.artworkFilter, 'blur(6px)');

      // A preset with no artwork in its payload falls back to the plain background rather than a hole.
      await page.evaluate(() => window.awPreviewApply({ displayName: 'x', description: 'y' }));
      const withoutArt = await page.evaluate(() => getComputedStyle(document.querySelector('.ach'), '::before').backgroundImage);
      assert.equal(withoutArt, 'none');

      const bordered = await renderPreset(page, { accentBar: 'top', accentBarSize: 6, borderWidth: 2, borderColor: '#ff0000', radius: 0 });
      assert.equal(bordered.borderTop, '6px', 'the accent bar is not on the chosen edge');
      assert.equal(bordered.borderLeft, '2px', 'the border is not painted beside the accent bar');
      assert.equal(bordered.borderLeftColor, 'rgb(255, 0, 0)');
      assert.equal(bordered.radius, '0px');

      const outline = await renderPreset(page, { accentBar: 'outline', accentBarSize: 3, accent: '#00ff88' });
      assert.equal(outline.borderTop, '3px');
      assert.equal(outline.borderLeft, '3px');
      assert.equal(outline.borderLeftColor, 'rgb(0, 255, 136)');

      const bare = await renderPreset(page, { accentBar: 'none', borderWidth: 0 });
      assert.equal(bare.borderLeft, '0px', 'a preset with no bar and no border still draws one');
    });

    await t.test('a title too long to fit is scrolled inside the card, never over it', async () => {
      // The engine animates an overflowing line past its own box; with nothing clipping the text
      // column it was drawn across the icon and out through the side of the popup.
      await page.setViewport({ width: 500, height: 200 });
      await page.setContent(generator.buildPresetPreviewHtml({ width: 320 }), { waitUntil: 'load' });
      await page.evaluate((image) => {
        window.awPreviewApply({
          displayName: 'An achievement with a title far too long to ever fit inside this card',
          description: 'And a description that does not fit either, by a wide margin',
          iconPath: image,
          scale: 1,
        });
      }, SAMPLE_IMAGE);
      await new Promise((resolve) => setTimeout(resolve, 1800));
      const scrolled = await page.evaluate(() => {
        const wrap = document.querySelector('.text_wrap');
        const title = document.querySelector('.title');
        return {
          marquee: title.classList.contains('marquee'),
          overflow: getComputedStyle(wrap).overflow,
          spill: title.getBoundingClientRect().right - wrap.getBoundingClientRect().right,
        };
      });
      assert.equal(scrolled.marquee, true, 'a title that does not fit is not scrolled at all');
      assert.equal(scrolled.overflow, 'hidden', 'the text column does not clip its scrolling lines');
      assert.ok(scrolled.spill <= 1, 'the scrolling title is painted outside the text column');
    });

    await t.test('the game name and rarity badge are printed, and never leave an empty row', async () => {
      const design = { showGameName: true, showRarity: true };
      const shown = await renderPreset(page, design, 'rare-gold');
      assert.equal(shown.metaHidden, false);
      assert.equal(shown.gameText, 'Sample Game', 'the game the unlock came from is not printed');
      assert.equal(shown.rarityText, '1.4%', 'the rarity badge does not show the unlock rate');
      assert.equal(shown.gameHidden, false);
      assert.equal(shown.rarityHidden, false);

      // An ordinary unlock has no rate, so the badge goes rather than printing a bare "%".
      const ordinary = await renderPreset(page, design, 'normal');
      assert.equal(ordinary.rarityHidden, true, 'the badge stays for a notification with no rarity');
      assert.equal(ordinary.gameHidden, false, 'the game name should still be printed');
      assert.equal(ordinary.metaHidden, false);

      // Neither: the whole row disappears instead of reserving a blank line at the top of the card.
      const bare = await renderPreset(page, design, 'bare');
      assert.equal(bare.metaHidden, true, 'the row survives a payload with nothing to put in it');
      assert.equal(bare.metaDisplay, 'none');

      // A design that never asked for them keeps both switched off whatever the payload carries.
      const off = await renderPreset(page, { showGameName: false, showRarity: false }, 'rare-gold');
      assert.equal(off.gameDisplay, 'none');
      assert.equal(off.rarityDisplay, 'none');
    });

    await t.test('a description can wrap instead of being clipped to one line', async () => {
      const single = await renderPreset(page, { descriptionLines: 1 });
      assert.equal(single.detailWhiteSpace, 'nowrap', 'one line must stay on one line');

      const wrapped = await renderPreset(page, { descriptionLines: 3 });
      assert.equal(wrapped.detailClamp, '3', 'the description is not clamped to the chosen number of lines');
      assert.notEqual(wrapped.detailWhiteSpace, 'nowrap');
    });

    await t.test('shadow and glow reach the text, the icon and the progress bar', async () => {
      const plain = await renderPreset(page, { textShadow: 0, iconGlow: 0, progressHeight: 8 }, 'progress');
      // 0 means "no shadow at all", not "a shadow of zero blur in some colour".
      assert.match(plain.textShadow, /rgba\(0, 0, 0, 0\)|none/, 'text is shadowed at zero strength');
      assert.equal(plain.progressTrackHeight, '8px');

      const dressed = await renderPreset(page, { textShadow: 80, iconGlow: 60, progressHeight: 16 }, 'progress');
      assert.match(dressed.textShadow, /rgba\(0, 0, 0, 0\.8\) 0px 1px 4\.8px/, 'the text shadow is not applied');
      assert.ok(!/0px 0px 0px/.test(dressed.iconShadow), 'the icon glow is not applied');
      assert.equal(dressed.progressTrackHeight, '16px', 'the progress bar thickness is not applied');
    });

    await t.test('the window the popup is given always fits the card it renders', async () => {
      // createNotificationWindow sizes the window from presetBoxSize, and a card larger than that is
      // cropped on screen with no way to notice from the stylesheet alone.
      const designs = [
        {},
        { layout: 'icon-top', iconSize: 110, padY: 40, fontSize: 28, detailScale: 130 },
        { width: 620, padX: 48, borderWidth: 6, accentBar: 'outline', accentBarSize: 14 },
        { layout: 'text-only', width: 280, fontSize: 10, padY: 4 },
        { glow: 100, rareGlow: 100, platinumGlow: 100 },
        { showGameName: true, showRarity: true, descriptionLines: 3, progressHeight: 20, fontSize: 24 },
      ];
      for (const design of designs) {
        const rendered = await renderPreset(page, design);
        const label = JSON.stringify(design);
        assert.ok(rendered.card.width <= rendered.window.width + 0.5, `${label}: the card is wider than its window`);
        assert.ok(rendered.card.height <= rendered.window.height + 0.5, `${label}: the card is taller than its window`);
        assert.ok(rendered.card.left >= -0.5 && rendered.card.top >= -0.5, `${label}: the card starts outside its window`);
      }
    });

    await t.test('the entry animation lands the card at the opacity it was designed with', async () => {
      const faded = await renderPreset(page, { opacity: 0.5, animIn: 'zoom', animInMs: 200 });
      assert.equal(faded.opacity, 0.5);
      // The display time is the preset's own, and the engine reads it from the document.
      const timed = await renderPreset(page, { duration: 3000 });
      assert.ok(timed.duration > 60000, 'the designer holds the preview instead of playing it out');
      const played = generator.buildPresetPreviewHtml({ duration: 3000 }, { hold: false });
      assert.match(played, /<meta name="duration" content="3000"/);
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
    killBrowserUsing(userDataDir);
    await removeBrowserProfile(userDataDir, killBrowserUsing);
  }
});
