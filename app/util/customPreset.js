'use strict';

// Notification-preset generator for the Settings > Notification custom-preset builder.
//
// A generated preset is an ordinary preset folder: a FIXED, payload-consuming index.html (same
// contract as the bundled presets — window.api.onNotification → fill .title/.detail/.icon, add
// .active, close after the duration) plus a style.css driven by :root CSS variables. Only the CSS
// differs between two generated presets, which is what keeps every one of them structurally
// compatible with createNotificationWindow.
//
// Pure string/number work, deliberately free of electron and fs: init.js owns writing the files,
// this module owns what goes in them — and, since it decides the layout of a generated preset, the
// directory they belong in (generatedPresetsDir below; `path` only, still no fs).

const path = require('path');

const CUSTOM_PRESET_INDEX_HTML_PARTS = [
  '<!DOCTYPE html>',
  '<html lang="en"><head>',
  '<meta charset="UTF-8" />',
  '<link rel="stylesheet" href="style.css" />',
  '<meta name="duration" content="6000" />',
  '<meta width="__W__" height="150" />',
  '<title>AW Custom Preset</title>',
  '</head><body>',
  '<div class="ach"><div class="icon"><img src="" alt="" /></div>',
  '<div class="text_wrap"><p class="title"></p><span class="detail"></span>',
  '<div class="progress_line" hidden><span class="progress_track"><span class="progress_meter"></span></span><span class="progress_label"></span></div></div></div>',
  '<script>',
  "window.addEventListener('DOMContentLoaded', function () {",
  "  var metaDur = document.querySelector('meta[name=\"duration\"]');",
  '  var base = Math.max(1, Number((metaDur && metaDur.content) || 6000));',
  '  function applyRarityTier(rootEl, value) {',
  "    if (!rootEl) return;",
  "    rootEl.classList.remove('rarity-gold', 'rarity-silver', 'rarity-bronze');",
  "    if (value == null || value === '') return;",
  '    var percent = Number(value);',
  '    if (!isFinite(percent) || percent < 0 || percent > 10) return;',
  "    if (percent < 3) rootEl.classList.add('rarity-gold');",
  "    else if (percent < 6) rootEl.classList.add('rarity-silver');",
  "    else rootEl.classList.add('rarity-bronze');",
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
  '  function onPayload(displayName, description, iconPath, scale, data) {',
  "    var ach = document.querySelector('.ach');",
  "    var titleEl = document.querySelector('.title');",
  "    var detailEl = document.querySelector('.detail');",
  "    var iconEl = document.querySelector('.icon img');",
  '    if (displayName != null) titleEl.textContent = displayName;',
  '    if (description != null) detailEl.textContent = description;',
  '    if (iconPath) { var p = String(iconPath).replace(/\\\\/g, "/"); iconEl.src = p.indexOf("file://") === 0 ? p : "file:///" + p; }',
  "    else { iconEl.style.display = 'none'; }",
  '    var s = Math.max(0.01, parseFloat(scale || 1) || 1);',
  "    ach.style.setProperty('--scale', String(s));",
  '    applyRarityTier(ach, data && data.rarityPercent);',
  '    applyProgress(data);',
  '    var total = Math.max(0, Number((metaDur && metaDur.content) || base));',
  '    var t = Math.max(0.1, total / base);',
  '    var inMs = Math.max(120, Math.round(520 * t));',
  '    var outMs = Math.max(120, Math.round(380 * t));',
  '    var holdMs = Math.max(0, total - inMs - outMs);',
  "    ach.style.setProperty('--ach-in', inMs + 'ms');",
  "    ach.style.setProperty('--ach-hold', holdMs + 'ms');",
  "    ach.style.setProperty('--ach-out', outMs + 'ms');",
  "    ach.classList.add('active');",
  '    if (window.api && window.api.notificationRenderReady) window.api.notificationRenderReady();',
  '    requestAnimationFrame(function () { startMarqueeIfOverflow(titleEl); startMarqueeIfOverflow(detailEl); });',
  '    setTimeout(function () {',
  "      ach.classList.remove('active');",
  '      if (window.api && window.api.closeNotificationWindow) window.api.closeNotificationWindow();',
  '    }, total);',
  '  }',
  '  if (window.api && window.api.onNotification) window.api.onNotification(function (d) {',
  '    onPayload(d && d.displayName, d && d.description, d && (d.iconPath || d.icon), d && d.scale, d || {});',
  '  });',
  '});',
  '</script></body></html>',
].join('\n');

// The popup's own width is a builder option, and the host BrowserWindow is sized from the preset's
// <meta width>, so the two have to be generated together or a wider card is clipped by its window.
const CUSTOM_PRESET_WINDOW_MARGIN = 30;
function buildCustomPresetHtml(o) {
  return CUSTOM_PRESET_INDEX_HTML_PARTS.replace('__W__', String(customPresetNumbers(o).width + CUSTOM_PRESET_WINDOW_MARGIN));
}

// Every numeric/colour option, clamped to the range the Settings controls offer. Shared by the CSS
// and HTML generators so a value can never be clamped differently in the two files.
function customPresetNumbers(o = {}) {
  const num = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const color = (v, def) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(v.trim()) ? v.trim() : def);
  return {
    bg: color(o.bg, '#16181d'),
    text: color(o.text, '#ffffff'),
    accent: color(o.accent, '#4aa3ff'),
    opacity: num(o.opacity, 1, 0.2, 1),
    fontSize: num(o.fontSize, 16, 10, 28),
    radius: num(o.radius, 12, 0, 40),
    iconSize: num(o.iconSize, 64, 24, 110),
    width: Math.round(num(o.width, 420, 280, 620)),
  };
}

function buildCustomPresetCss(o) {
  const { bg, text, accent, opacity, fontSize, radius, iconSize, width } = customPresetNumbers(o);
  return [
    ':root {',
    `  --bg: ${bg};`,
    `  --text: ${text};`,
    `  --accent: ${accent};`,
    `  --opacity: ${opacity};`,
    `  --font-size: ${fontSize}px;`,
    `  --radius: ${radius}px;`,
    `  --icon-size: ${iconSize}px;`,
    `  --width: ${width}px;`,
    '  --ach-in: 520ms; --ach-hold: 5000ms; --ach-out: 380ms;',
    '}',
    'html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }',
    '.ach {',
    '  position: fixed; left: 50%; bottom: 16px;',
    '  transform: translate(-50%, 170%) scale(var(--scale, 1)); transform-origin: center bottom;',
    '  display: flex; align-items: center; gap: 12px; box-sizing: border-box;',
    '  width: var(--width); padding: 12px 18px;',
    '  background: var(--bg); color: var(--text);',
    '  border-radius: var(--radius); border-left: 4px solid var(--accent);',
    "  font-family: 'Segoe UI', system-ui, sans-serif; font-size: var(--font-size);",
    '  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); opacity: 0;',
    '}',
    '.ach .icon img { width: var(--icon-size); height: var(--icon-size); border-radius: 14%; object-fit: cover; display: block; }',
    '.ach .text_wrap { display: flex; flex-direction: column; min-width: 0; }',
    '.ach .title { margin: 0; font-weight: 700; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.ach .detail { margin: 0; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '@keyframes aw_in { from { transform: translate(-50%, 170%) scale(var(--scale, 1)); opacity: 0; } to { transform: translate(-50%, 0) scale(var(--scale, 1)); opacity: var(--opacity); } }',
    '@keyframes aw_hold { from, to { transform: translate(-50%, 0) scale(var(--scale, 1)); opacity: var(--opacity); } }',
    '@keyframes aw_out { from { transform: translate(-50%, 0) scale(var(--scale, 1)); opacity: var(--opacity); } to { transform: translate(-50%, 170%) scale(var(--scale, 1)); opacity: 0; } }',
    '.active { animation: aw_in var(--ach-in) cubic-bezier(0.2, 0.8, 0.2, 1) forwards, aw_hold var(--ach-hold) forwards, aw_out var(--ach-out) ease-in forwards; animation-delay: 0s, var(--ach-in), calc(var(--ach-in) + var(--ach-hold)); }',
    '.ach { --aw-accent: ' + accent + '; --aw-accent-soft: ' + accent + '; --aw-glow: color-mix(in srgb, ' + accent + ' 55%, transparent); }',
    '.ach.rarity-gold { --aw-accent: #ffd24e; --aw-accent-soft: #fff0a8; --aw-glow: color-mix(in srgb, #ffd24e 55%, transparent); }',
    '.ach.rarity-silver { --aw-accent: #9fb2cc; --aw-accent-soft: #eef4fb; --aw-glow: color-mix(in srgb, #9fb2cc 55%, transparent); }',
    '.ach.rarity-bronze { --aw-accent: #cd7f32; --aw-accent-soft: #f0bd91; --aw-glow: color-mix(in srgb, #cd7f32 55%, transparent); }',
    '.ach .title.marquee, .ach .detail.marquee { display: inline-block; white-space: nowrap; overflow: visible; will-change: transform; }',
    '.progress_line { display: flex; align-items: center; gap: 8px; margin-top: 8px; min-width: 0; }',
    '.progress_line[hidden] { display: none; }',
    '.progress_track { display: block; flex: 1 1 auto; min-width: 70px; height: 8px; overflow: hidden; border-radius: 999px; background: rgba(0, 0, 0, 0.45); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }',
    '.progress_meter { display: block; width: 0%; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--aw-accent) 0%, var(--aw-accent-soft) 100%); box-shadow: 0 0 12px var(--aw-glow); transition: width 0.35s ease; }',
    '.progress_label { flex: 0 0 auto; max-width: 110px; overflow: hidden; color: #f3f7ff; font-size: 12px; font-weight: 700; line-height: 1; text-align: right; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }',
    '',
  ].join('\n');
}

/*
  Where generated presets are written. Under <userData>, never under the app folder: once packaged,
  app/presets sits inside app.asar, and a mkdir below a file fails with ENOTDIR — which silently
  broke Preview and Save on every installed build while a dev run, where the same path is a real
  directory, worked. Keeping them in userData also means they survive an update.

  Exported (and tested) rather than inlined in init.js so the rule cannot drift back.
*/
const GENERATED_PRESETS_SUBPATH = ['presets', 'Users Presets'];

function generatedPresetsDir(userDataPath) {
  if (!userDataPath) throw new Error('generatedPresetsDir: userData path is required');
  return path.join(userDataPath, ...GENERATED_PRESETS_SUBPATH);
}

module.exports = {
  CUSTOM_PRESET_WINDOW_MARGIN,
  GENERATED_PRESETS_SUBPATH,
  customPresetNumbers,
  buildCustomPresetHtml,
  buildCustomPresetCss,
  generatedPresetsDir,
};
