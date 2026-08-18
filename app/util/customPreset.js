'use strict';

// Build notification preset files from the Settings preset designer.
// Everything below is string work driven by util/presetSchema.js; init.js writes the result to
// userData. The one exception is presetSound(), which reads a preset folder that is already on disk.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const schema = require('./presetSchema.js');
const { PRESET_PROPERTIES, FONT_STACKS, MOTION_OFFSETS, EASINGS, normalizeOptions, cssValue } = schema;

/*
  The preset engine: the inline script every generated preset carries.

  It is the only JavaScript in a generated preset and it is identical in all of them - the design
  lives entirely in the generated stylesheet. That split is what lets the designer preview a draft by
  rendering this same markup and this same engine with a different stylesheet, instead of a second
  renderer that would drift from the real one.

  What it does with the payload createNotificationWindow() sends:
    displayName / description   the two lines of text
    gameName                    the game the unlock came from, on its own line when asked for
    iconPath                    the icon, hidden when there is none
    imagePath / headerPath      artwork, published as --artwork for presets painting a background
    rarityPercent               <= 10% adds the rare state, tiered gold / silver / bronze; also the
                                number printed on the rarity chip
    notificationType/isPlatinum the completion (100%) state
    progress                    the progress line
    scale                       kept neutral: the host zooms the page, presets must not scale twice
*/
const PRESET_ENGINE = [
  "window.addEventListener('DOMContentLoaded', function () {",
  "  var root = document.querySelector('.ach');",
  '  var metaDur = document.querySelector(\'meta[name="duration"]\');',
  '  var total = Math.max(600, Number((metaDur && metaDur.content) || 6000));',
  '  // Timings live in the stylesheet, so the designer changes them by swapping the CSS alone.',
  '  function timing(name, fallback) {',
  '    try {',
  '      var raw = getComputedStyle(root).getPropertyValue(name).trim();',
  '      var value = parseFloat(raw);',
  "      if (!isFinite(value)) return fallback;",
  "      return raw.indexOf('ms') > -1 ? value : value * 1000;",
  '    } catch (e) { return fallback; }',
  '  }',
  '  // A Windows path becomes a file URL; anything that already carries a scheme is left alone, so a',
  '  // data: or https: image (the designer previews with data: URIs) is not turned into file:///data:.',
  '  function fileUrl(value) {',
  "    var p = String(value || '').replace(/\\\\/g, '/');",
  "    if (!p) return '';",
  "    return /^(?:file|data|https?|blob):/i.test(p) ? p : 'file:///' + p;",
  '  }',
  '  function applyState(data) {',
  "    root.classList.remove('state-rare', 'state-platinum', 'tier-gold', 'tier-silver', 'tier-bronze');",
  "    var type = String((data && data.notificationType) || '').toLowerCase();",
  "    if ((data && data.isPlatinum) || type === 'platinum') { root.classList.add('state-platinum'); return; }",
  "    if (type === 'progress' || type === 'playtime') return;",
  '    // An ordinary unlock carries rarityPercent null, and Number(null) is 0 - which would make',
  '    // every notification the rarest tier there is. Absence has to be checked before the number.',
  '    var raw = data && data.rarityPercent;',
  "    if (raw == null || raw === '') return;",
  '    var percent = Number(raw);',
  '    if (!isFinite(percent) || percent < 0 || percent > 10) return;',
  "    root.classList.add('state-rare');",
  "    root.classList.add(percent < 3 ? 'tier-gold' : percent < 6 ? 'tier-silver' : 'tier-bronze');",
  '  }',
  '  function applyArtwork(data) {',
  '    var art = fileUrl((data && (data.imagePath || data.headerPath)) || (data && data.gameIconPath) || "");',
  '    root.style.setProperty(\'--artwork\', art ? \'url("\' + art + \'")\' : \'none\');',
  '  }',
  '  function normalizeProgress(data) {',
  '    var src = (data && data.progress) || data || {};',
  '    var max = Number(src.max != null ? src.max : src.progressMax);',
  '    if (!isFinite(max) || max <= 1) return null;',
  '    var currentRaw = Number(src.current != null ? src.current : src.progressCurrent);',
  '    var current = Math.max(0, Math.min(max, isFinite(currentRaw) ? currentRaw : 0));',
  '    var percentRaw = Number(src.percent != null ? src.percent : src.progressPercent);',
  '    var percent = isFinite(percentRaw)',
  '      ? Math.max(0, Math.min(100, Math.floor(percentRaw)))',
  '      : Math.max(0, Math.min(100, Math.floor((current / max) * 100)));',
  '    return { current: current, max: max, percent: percent };',
  '  }',
  '  function applyProgress(data) {',
  "    var line = document.querySelector('.progress_line');",
  "    var meter = document.querySelector('.progress_meter');",
  "    var label = document.querySelector('.progress_label');",
  '    if (!line || !meter || !label) return;',
  '    var progress = normalizeProgress(data);',
  '    if (!progress) { line.hidden = true; meter.style.width = "0%"; label.textContent = ""; return; }',
  '    line.hidden = false;',
  '    meter.style.width = progress.percent + "%";',
  '    label.textContent = progress.current + "/" + progress.max + " - " + progress.percent + "%";',
  '  }',
  '  function startMarqueeIfOverflow(lineEl) {',
  '    if (!lineEl) return;',
  '    try { lineEl.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) {}',
  "    lineEl.classList.remove('marquee');",
  '    void lineEl.offsetWidth;',
  "    var clip = lineEl.closest('.text_wrap') || lineEl;",
  '    var overflow = Math.round((lineEl.scrollWidth || 0) - (clip.clientWidth || 0));',
  '    if (overflow > 2) {',
  '      var px = Math.ceil(overflow + 24);',
  "      lineEl.classList.add('marquee');",
  '      lineEl.animate([{ transform: "translateX(0)" }, { transform: "translateX(-" + px + "px)" }], { duration: Math.max(3000, Math.round(px / 50) * 1000), delay: 1000, easing: "linear", fill: "both" });',
  '    }',
  '  }',
  '  /*',
  '    The line above the title: the game the unlock came from, and how rare it was. Each half is',
  '    hidden when the payload has nothing to put in it, and the row itself disappears with both, so',
  '    a preset that asks for them never reserves an empty line for a notification that has neither.',
  '  */',
  '  function applyMeta(data) {',
  "    var row = document.querySelector('.meta');",
  "    var gameEl = document.querySelector('.game');",
  "    var rarityEl = document.querySelector('.rarity');",
  '    if (!row || !gameEl || !rarityEl) return;',
  "    var game = String((data && data.gameName) || '').trim();",
  '    gameEl.textContent = game;',
  '    gameEl.hidden = !game;',
  '    var percent = data && data.rarityPercent;',
  "    var hasRarity = percent != null && percent !== '' && isFinite(Number(percent));",
  "    rarityEl.textContent = hasRarity ? (Math.round(Number(percent) * 10) / 10) + '%' : '';",
  '    rarityEl.hidden = !hasRarity;',
  '    row.hidden = !game && !hasRarity;',
  '  }',
  '  var closeTimer = null;',
  '  function onPayload(displayName, description, iconPath, scale, data) {',
  "    var titleEl = document.querySelector('.title');",
  "    var detailEl = document.querySelector('.detail');",
  "    var iconEl = document.querySelector('.icon img');",
  '    if (displayName != null) titleEl.textContent = displayName;',
  '    if (description != null) detailEl.textContent = description;',
  '    if (iconPath) { iconEl.src = fileUrl(iconPath); iconEl.style.display = "block"; }',
  "    else { iconEl.style.display = 'none'; }",
  '    var s = Math.max(0.01, parseFloat(scale || 1) || 1);',
  "    root.style.setProperty('--scale', String(s));",
  '    applyState(data);',
  '    applyArtwork(data);',
  '    applyMeta(data);',
  '    applyProgress(data);',
  "    var inMs = timing('--ach-in', 520);",
  "    var outMs = timing('--ach-out', 380);",
  '    var holdMs = Math.max(0, total - inMs - outMs);',
  "    root.style.setProperty('--ach-hold', holdMs + 'ms');",
  "    root.classList.remove('active');",
  '    void root.offsetWidth;',
  "    root.classList.add('active');",
  '    if (window.api && window.api.notificationRenderReady) window.api.notificationRenderReady();',
  '    requestAnimationFrame(function () { startMarqueeIfOverflow(titleEl); startMarqueeIfOverflow(detailEl); });',
  '    clearTimeout(closeTimer);',
  '    closeTimer = setTimeout(function () {',
  "      root.classList.remove('active');",
  '      if (window.api && window.api.closeNotificationWindow) window.api.closeNotificationWindow();',
  '    }, total);',
  '  }',
  '  if (window.api && window.api.onNotification) window.api.onNotification(function (d) {',
  '    onPayload(d && d.displayName, d && d.description, d && (d.iconPath || d.icon), d && d.scale, d || {});',
  '  });',
  '});',
].join('\n');

/*
  One spelling for an inline script, and the CSP hash that matches it.

  The designer previews a draft in an iframe inside the Settings page, and a srcdoc document inherits
  the embedder's Content-Security-Policy - so the preview's scripts only run because view/app.html
  lists these hashes. Pinning them is deliberately strict: change the engine by one character and the
  preview stops running until the policy is updated, which is what the test enforcing this checks.
*/
function inlineScript(source) {
  return `<script>\n${source}\n</script>`;
}

function inlineScriptHash(source) {
  return `sha256-${crypto.createHash('sha256').update(`\n${source}\n`, 'utf8').digest('base64')}`;
}

// The card itself. Shared by the generated preset and by the designer's preview so both lay out the
// exact same DOM.
const PRESET_MARKUP = [
  '<div class="ach"><div class="icon"><img src="" alt="" /></div>',
  '<div class="text_wrap">',
  '<div class="meta" hidden><span class="game" hidden></span><span class="rarity" hidden></span></div>',
  '<p class="title"></p><span class="detail"></span>',
  '<div class="progress_line" hidden><span class="progress_track"><span class="progress_meter"></span></span><span class="progress_label"></span></div></div></div>',
].join('');

/*
  Slack around the card inside its host window. The window is sized from the meta box below, so
  anything painted outside the card's own rectangle - the drop shadow, and the accent glow a rare or
  completion state adds - is clipped unless the box allows for it.

  It is also, exactly, the gap the user sees between the popup and the corner of their screen: the
  host places the WINDOW against the edge, so every pixel reserved here pushes the visible card
  further in. That is why the shadow and the glow are deliberately tight - a softer, wider shadow
  looks better in isolation and costs twice this margin on all four sides.
*/
const CUSTOM_PRESET_WINDOW_MARGIN = 22;
const CUSTOM_PRESET_VERTICAL_MARGIN = 40;
const GLOW_RADIUS_PX = 22;
const MAX_PRESET_HEIGHT = 460;

/*
  Extra room the strongest glow of any state needs, per side, beyond the slack the base margin
  already leaves. The card is centred in its window, so half of each margin sits on either side and
  a modest glow costs nothing - only a design that glows harder than that widens the box, which
  keeps the popup anchored where it has always been for the presets that do not.
*/
function glowRoom(values, margin) {
  const strongest = Math.max(values.glow, values.rareGlow, values.platinumGlow) / 100;
  return Math.max(0, Math.round(strongest * GLOW_RADIUS_PX - margin / 2));
}

/*
  The host window's size, written into the preset as `<meta width height>`.

  createNotificationWindow() reads that tag and gives the popup exactly that box, so a card taller
  than the box is cropped on screen. It used to be a fixed 150px, which was only ever right for the
  one layout the builder could produce; the designer can stack the icon above the text, so the height
  has to be derived from the same options that generate the stylesheet.
*/
function presetBoxSize(options = {}) {
  const values = normalizeOptions(options);
  const lineHeight = 1.35;
  const titleHeight = values.fontSize * lineHeight;
  const detailHeight = values.fontSize * (values.detailScale / 100) * lineHeight * values.descriptionLines;
  // Everything below only appears for some notifications, but the window cannot be resized once it
  // is up - so a preset that CAN show a row is measured as though it does.
  const metaHeight = values.showGameName || values.showRarity ? values.fontSize * 0.66 * 1.2 + 2 : 0;
  const progressHeight = values.showProgress ? values.progressHeight + 12 : 0;
  const textHeight = metaHeight + titleHeight + detailHeight + progressHeight;
  const iconHeight = values.layout === 'text-only' ? 0 : values.iconSize;
  const contentHeight = values.layout === 'icon-top' ? iconHeight + values.gap + textHeight : Math.max(iconHeight, textHeight);
  const cardHeight = contentHeight + values.padY * 2 + values.borderWidth * 2;
  return {
    width: values.width + CUSTOM_PRESET_WINDOW_MARGIN + glowRoom(values, CUSTOM_PRESET_WINDOW_MARGIN) * 2,
    height: Math.min(
      MAX_PRESET_HEIGHT,
      Math.round(cardHeight) + CUSTOM_PRESET_VERTICAL_MARGIN + glowRoom(values, CUSTOM_PRESET_VERTICAL_MARGIN) * 2
    ),
  };
}

function buildCustomPresetHtml(options) {
  const values = normalizeOptions(options);
  const box = presetBoxSize(values);
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '<meta charset="UTF-8" />',
    '<link rel="stylesheet" href="style.css" />',
    `<meta name="duration" content="${values.duration}" />`,
    `<meta width="${box.width}" height="${box.height}" />`,
    '<title>AW Custom Preset</title>',
    '</head><body>',
    PRESET_MARKUP,
    inlineScript(PRESET_ENGINE),
    '</body></html>',
  ].join('\n');
}

/*
  The same preset, rendered as a standalone document the designer can drop into an iframe: the real
  markup, the real engine and the real stylesheet, with a stub of the notification bridge in front of
  it so a draft can be fed a sample payload.

  `hold` keeps the card on screen instead of playing out and closing, which is what a live preview
  needs; the designer rebuilds the document without it to play the full entry/exit once.
*/
const PRESET_PREVIEW_BRIDGE = [
  'window.api = {',
  '  onNotification: function (cb) { window.__awRender = cb; },',
  '  notificationRenderReady: function () {},',
  '  closeNotificationWindow: function () {},',
  '};',
  '// Called by the designer on every state change; the engine restarts its own animation.',
  'window.awPreviewApply = function (payload) { if (window.__awRender) window.__awRender(payload || {}); };',
].join('\n');

const PREVIEW_HOLD_MS = 3600000;

// What view/app.html must allow for the designer's preview frame to run at all.
const PREVIEW_SCRIPT_HASHES = [inlineScriptHash(PRESET_PREVIEW_BRIDGE), inlineScriptHash(PRESET_ENGINE)];

function buildPresetPreviewHtml(options, { hold = true } = {}) {
  const values = normalizeOptions(options);
  return [
    '<!DOCTYPE html>',
    '<html lang="en"><head>',
    '<meta charset="UTF-8" />',
    `<meta name="duration" content="${hold ? PREVIEW_HOLD_MS : values.duration}" />`,
    '<style id="aw-preview-css">',
    buildCustomPresetCss(values),
    '</style>',
    inlineScript(PRESET_PREVIEW_BRIDGE),
    '</head><body>',
    PRESET_MARKUP,
    inlineScript(PRESET_ENGINE),
    '</body></html>',
  ].join('\n');
}

// --- stylesheet ---------------------------------------------------------------------------------

const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' };

// What the title takes its colour from. `accent` follows the state, so a rare or completion
// notification recolours the title with the rest of the card.
const TITLE_COLOR = { accent: 'var(--accent)', text: 'var(--text)', custom: 'var(--title-color)' };

// Every property that maps straight onto a CSS custom property, plus the values that are looked up
// in a table (font stack, easing, motion offsets) rather than written by the user.
function rootVariables(values) {
  const lines = [];
  for (const property of PRESET_PROPERTIES) {
    if (!property.css) continue;
    lines.push(`  ${property.css}: ${cssValue(property.key, values[property.key])};`);
  }
  // The travel distance multiplies the offsets rather than reaching CSS: the offsets are percentages
  // of the card, so one number keeps every edge consistent and the box below never has to know.
  const travel = (offset) => {
    const number = parseFloat(offset);
    return `${Math.round(number * (values.entryDistance / 100) * 10) / 10}%`;
  };
  const motionIn = MOTION_OFFSETS[values.animIn];
  const motionOut = MOTION_OFFSETS[values.animOut];
  lines.push(`  --font: ${FONT_STACKS[values.fontFamily]};`);
  lines.push(`  --ease: ${EASINGS[values.easing]};`);
  lines.push(`  --in-dx: ${travel(motionIn.dx)}; --in-dy: ${travel(motionIn.dy)}; --in-scale: ${motionIn.scale};`);
  lines.push(`  --out-dx: ${travel(motionOut.dx)}; --out-dy: ${travel(motionOut.dy)}; --out-scale: ${motionOut.scale};`);
  // Set by the engine from the payload's artwork; `none` keeps the plain background when a
  // notification carries no image.
  lines.push('  --artwork: none;');
  lines.push('  --ach-hold: 5000ms;');
  return lines;
}

// The card's background, from the three modes the designer offers.
function backgroundRule(values) {
  if (values.bgMode === 'gradient') return '  background: linear-gradient(var(--bg-angle), var(--bg) 0%, var(--bg2) 100%);';
  return '  background: var(--bg);';
}

// Accent bar and border. The border is written first so a bar on one edge overrides it there.
function borderRules(values) {
  const rules = [];
  if (values.borderWidth > 0) rules.push('  border: var(--border-width) solid var(--border-color);');
  const side = { left: 'border-left', right: 'border-right', top: 'border-top', bottom: 'border-bottom' }[values.accentBar];
  if (side) rules.push(`  ${side}: var(--bar-size) solid var(--accent);`);
  else if (values.accentBar === 'outline') rules.push('  border: var(--bar-size) solid var(--accent);');
  return rules;
}

/*
  The description line. One line is the original behaviour - clipped with an ellipsis, and scrolled
  by the engine when it does not fit. Asking for more lets it wrap and clamps it instead, which is
  what a wide card wants and what the marquee cannot do.
*/
function detailRule(values) {
  const base = '.ach .detail { max-width: 100%; margin: 0; opacity: 0.9; font-size: calc(var(--font-size) * var(--detail-scale));';
  if (values.descriptionLines <= 1) return `${base} white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;
  return `${base} display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--detail-lines); overflow: hidden; }`;
}

function layoutRules(values) {
  const rules = [];
  if (values.layout === 'icon-right') rules.push('  flex-direction: row-reverse;');
  else if (values.layout === 'icon-top') rules.push(`  flex-direction: column; align-items: ${FLEX_ALIGN[values.align]};`);
  return rules;
}

// A text-only card drops the icon entirely rather than rendering it at zero size: the gap and the
// alignment are measured from the boxes that are actually there, and presetBoxSize measures the same
// card, so the window it is given matches what it paints.
function iconRules(values) {
  return values.layout === 'text-only' ? ['.ach .icon { display: none; }'] : [];
}

function buildCustomPresetCss(options) {
  const values = normalizeOptions(options);
  const flexAlign = FLEX_ALIGN[values.align];
  const artwork = values.bgMode === 'artwork';

  const css = [
    ':root {',
    ...rootVariables(values),
    '}',
    'html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }',
    '.ach {',
    '  position: fixed; left: 50%; top: 50%;',
    '  transform: translate(-50%, -50%) scale(var(--scale, 1)); transform-origin: center center;',
    '  display: flex; align-items: center; gap: var(--gap); box-sizing: border-box;',
    '  width: var(--width); padding: var(--pad-y) var(--pad-x);',
    '  color: var(--text); border-radius: var(--radius);',
    '  font-family: var(--font); font-size: var(--font-size); letter-spacing: var(--letter-spacing);',
    // One shadow behind every line, so text stays readable once it sits on artwork instead of a flat
    // colour. Costs nothing at 0, which is the default.
    '  text-shadow: 0 1px calc(var(--text-shadow) * 6px) rgba(0, 0, 0, var(--text-shadow));',
    '  opacity: 0;',
    // The state colour every accent-driven rule reads. The state classes below re-point it, which is
    // how one stylesheet paints a normal, a rare and a completion notification.
    '  --accent: var(--accent-base); --glow-strength: var(--glow);',
    backgroundRule(values),
    ...borderRules(values),
    ...layoutRules(values),
    artwork ? '  overflow: hidden;' : '',
    '  box-shadow: 0 4px 12px rgba(0, 0, 0, var(--shadow)), 0 0 calc(var(--glow-strength) * ' + GLOW_RADIUS_PX + 'px) color-mix(in srgb, var(--accent) 65%, transparent);',
    '}',
    '.ach.state-rare { --accent: var(--rare-accent); --glow-strength: var(--rare-glow); }',
    '.ach.state-rare.tier-silver { --accent: var(--rare-silver); }',
    '.ach.state-rare.tier-bronze { --accent: var(--rare-bronze); }',
    '.ach.state-platinum { --accent: var(--platinum-accent); --glow-strength: var(--platinum-glow); }',
  ];

  if (artwork) {
    css.push(
      // A layer rather than a background-image on the card: the artwork can be dimmed and blurred
      // without touching the text drawn on top of it.
      `.ach::before { content: ''; position: absolute; inset: 0; z-index: 0; border-radius: inherit; background-image: var(--artwork); background-size: cover; background-position: center ${values.artworkPosition}; filter: blur(var(--artwork-blur)); opacity: calc(1 - var(--artwork-dim)); }`,
      '.ach > * { position: relative; z-index: 1; }'
    );
  }

  css.push(
    ...iconRules(values),
    '.ach .icon { flex: 0 0 auto; }',
    '.ach .icon img { display: block; box-sizing: border-box; width: var(--icon-size); height: var(--icon-size); border: var(--icon-border) solid var(--accent); border-radius: var(--icon-radius); object-fit: cover; box-shadow: 0 0 calc(var(--icon-glow) * 26px) color-mix(in srgb, var(--accent) 70%, transparent); }',
    // `overflow: hidden` is what keeps a scrolling line inside the card: a title too long to fit is
    // animated past its own box, and with nothing clipping the column it was drawn over the icon and
    // out through the side of the popup.
    `.ach .text_wrap { display: flex; flex: 1 1 auto; flex-direction: column; align-items: ${flexAlign}; min-width: 0; overflow: hidden; text-align: ${values.align}; }`,
    `.ach .title { max-width: 100%; margin: 0; color: ${TITLE_COLOR[values.titleColorMode]}; font-weight: var(--title-weight); text-transform: var(--title-case); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
    detailRule(values),
    '.ach .title.marquee, .ach .detail.marquee { display: inline-block; white-space: nowrap; overflow: visible; will-change: transform; }',
    // Game name and rarity chip. Hidden by the engine when the payload has nothing for them, and by
    // the stylesheet when the design does not ask for them at all.
    `.ach .meta { display: ${values.showGameName || values.showRarity ? 'flex' : 'none'}; align-items: center; gap: 8px; max-width: 100%; margin-bottom: 2px; font-size: calc(var(--font-size) * 0.66); line-height: 1.2; }`,
    '.ach .meta[hidden] { display: none; }',
    `.ach .game { display: ${values.showGameName ? 'block' : 'none'}; min-width: 0; overflow: hidden; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; text-overflow: ellipsis; }`,
    '.ach .game[hidden] { display: none; }',
    `.ach .rarity { display: ${values.showRarity ? 'block' : 'none'}; flex: 0 0 auto; padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--accent) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); color: var(--accent); font-weight: 700; }`,
    '.ach .rarity[hidden] { display: none; }',
    '@keyframes aw_in { from { transform: translate(calc(-50% + var(--in-dx)), calc(-50% + var(--in-dy))) scale(calc(var(--scale, 1) * var(--in-scale))); opacity: 0; } to { transform: translate(-50%, -50%) scale(var(--scale, 1)); opacity: var(--opacity); } }',
    '@keyframes aw_hold { from, to { transform: translate(-50%, -50%) scale(var(--scale, 1)); opacity: var(--opacity); } }',
    '@keyframes aw_out { from { transform: translate(-50%, -50%) scale(var(--scale, 1)); opacity: var(--opacity); } to { transform: translate(calc(-50% + var(--out-dx)), calc(-50% + var(--out-dy))) scale(calc(var(--scale, 1) * var(--out-scale))); opacity: 0; } }',
    '.active { animation: aw_in var(--ach-in) var(--ease) forwards, aw_hold var(--ach-hold) forwards, aw_out var(--ach-out) ease-in forwards; animation-delay: 0s, var(--ach-in), calc(var(--ach-in) + var(--ach-hold)); }',
    `.progress_line { display: ${values.showProgress ? 'flex' : 'none'}; align-items: center; justify-content: ${flexAlign}; gap: 8px; width: 100%; margin-top: 8px; min-width: 0; }`,
    '.progress_line[hidden] { display: none; }',
    '.progress_track { display: block; flex: 1 1 auto; min-width: 70px; height: var(--progress-height); overflow: hidden; border-radius: 999px; background: rgba(0, 0, 0, 0.45); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }',
    '.progress_meter { display: block; width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 45%, #ffffff) 100%); box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 55%, transparent); transition: width 0.35s ease; }',
    '.progress_label { flex: 0 0 auto; max-width: 110px; overflow: hidden; color: var(--text); font-size: 12px; font-weight: 700; line-height: 1; text-align: right; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }',
    ''
  );

  return css.filter((line) => line !== '').join('\n');
}

/*
  Where generated presets are written. Under <userData>, never under the app folder: once packaged,
  app/presets sits inside app.asar, and a mkdir below a file fails with ENOTDIR - which silently
  broke Preview and Save on every installed build while a dev run, where the same path is a real
  directory, worked. Keeping them in userData also means they survive an update.

  Exported (and tested) rather than inlined in init.js so the rule cannot drift back.
*/
const GENERATED_PRESETS_SUBPATH = ['presets', 'Users Presets'];

function generatedPresetsDir(userDataPath) {
  if (!userDataPath) throw new Error('generatedPresetsDir: userData path is required');
  return path.join(userDataPath, ...GENERATED_PRESETS_SUBPATH);
}

// The builder's own options, stored next to the generated files, and what makes a preset
// re-openable and deletable from the builder.
const PRESET_OPTIONS_FILE = 'aw-preset.json';

// The installed manifest of an imported preset. Owned here, beside the options file, because both
// name a preset's bookkeeping and presetSound() reads whichever one a preset has - util/presetPackage
// imports it from here rather than spelling it a second time.
const PRESET_PACKAGE_FILE = 'aw-package.json';

/*
  The sound a preset asks for, or '' when it does not ask for one.

  A preset that names a sound plays that sound instead of the one picked in the Notifications tab, so
  a shared package sounds the way its author intended. Reading it from the folder means an imported
  preset gets the same treatment as one built here - its manifest options land in the same file.

  Deliberately tolerant: an unreadable or sound-less preset returns '', which means "use the app's
  setting", so this can never be the reason a notification goes silent.
*/
function presetSound(presetDir) {
  if (!presetDir) return '';
  /*
    The designer's own options are authoritative wherever they exist - including an empty sound,
    which is a preset saying it has no opinion rather than one that never had the chance to say so.
    Only a preset without them (hand-authored, installed from a package) falls back to the manifest,
    which is the one place such a preset can name a sound at all.

    Both are re-validated, so a hand-edited file cannot turn either into a path.
  */
  try {
    return normalizeOptions(JSON.parse(fs.readFileSync(path.join(presetDir, PRESET_OPTIONS_FILE), 'utf8'))).sound;
  } catch {}
  try {
    return normalizeOptions({ sound: JSON.parse(fs.readFileSync(path.join(presetDir, PRESET_PACKAGE_FILE), 'utf8')).sound }).sound;
  } catch {}
  return '';
}

// Folder-safe, readable preset name. Returns '' for anything unusable. Shared with the package
// importer so a name that arrives from someone else's machine can never resolve differently.
function sanitizePresetName(raw) {
  return String(raw || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 48)
    .trim();
}

module.exports = {
  CUSTOM_PRESET_WINDOW_MARGIN,
  GENERATED_PRESETS_SUBPATH,
  PRESET_OPTIONS_FILE,
  PRESET_PACKAGE_FILE,
  PRESET_ENGINE,
  PRESET_MARKUP,
  PREVIEW_SCRIPT_HASHES,
  // Kept under its original name: init.js and the package format both clamp through it, and an
  // .awpreset written by any build has always been re-validated by whatever this returns.
  customPresetNumbers: normalizeOptions,
  presetBoxSize,
  buildCustomPresetHtml,
  buildCustomPresetCss,
  buildPresetPreviewHtml,
  generatedPresetsDir,
  presetSound,
  sanitizePresetName,
};
