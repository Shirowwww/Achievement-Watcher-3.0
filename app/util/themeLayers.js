'use strict';

/*
 * Layer-based theme engine.
 *
 * The app is split into visual "layers" (window background, header, library
 * panel, cards, settings modal, overlay panel, ...). Built-in themes provide a
 * color per layer; the Custom theme additionally lets the user pick a color and
 * an optional image per layer. This module owns the layer model and generates
 * the CSS that applies a theme to the main window and to the in-game overlay.
 *
 * Custom themes are persisted as <userData>/cfg/customTheme.json. Images are
 * copied into <userData>/theme-images so the theme survives the source file
 * being moved or deleted.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const LAYER_IDS = ['bg', 'header', 'panel', 'card', 'settings', 'text', 'muted', 'border', 'accent'];
const IMAGE_LAYER_IDS = ['bg', 'header', 'panel', 'card', 'settings'];
const FITS = ['cover', 'contain', 'repeat', 'fill'];
const EFFECT_TYPES = ['veil', 'blur'];

// One color per layer for each built-in theme. These mirror the values in
// app/resources/css/app.css (2026 interface pass for `default`, data-theme
// blocks for the others) and are the source of truth for the overlay, which
// has no stylesheet of its own.
const BUILTIN_COLORS = {
  default: {
    bg: '#1b2838',
    header: '#26384c',
    panel: '#15202d',
    card: '#27374a',
    settings: '#27374a',
    text: '#d9dfe4',
    muted: '#a8b5c5',
    border: '#3e5065',
    accent: '#5b8dff',
  },
  oled: {
    bg: '#000000',
    header: '#101014',
    panel: '#060608',
    card: '#141419',
    settings: '#0a0a0f',
    text: '#e8ecf2',
    muted: '#9aa3b2',
    border: '#2c2c34',
    accent: '#4da3ff',
  },
  dracula: {
    bg: '#282a36',
    header: '#343747',
    panel: '#1e1f29',
    card: '#343746',
    settings: '#21222c',
    text: '#f8f8f2',
    muted: '#9ba3c7',
    border: '#4b4e63',
    accent: '#bd93f9',
  },
  graphite: {
    bg: '#1d1f22',
    header: '#2a2d31',
    panel: '#17181b',
    card: '#292c30',
    settings: '#202327',
    text: '#e3e6ea',
    muted: '#a4aab2',
    border: '#45494f',
    accent: '#6fbf73',
  },
  // Established community color schemes, ported with their canonical palettes.
  nord: {
    bg: '#2e3440',
    header: '#3b4252',
    panel: '#242933',
    card: '#3b4252',
    settings: '#2e3440',
    text: '#eceff4',
    muted: '#9099ab',
    border: '#4c566a',
    accent: '#88c0d0',
  },
  gruvbox: {
    bg: '#282828',
    header: '#3c3836',
    panel: '#1d2021',
    card: '#3c3836',
    settings: '#32302f',
    text: '#ebdbb2',
    muted: '#a89984',
    border: '#504945',
    accent: '#fe8019',
  },
  tokyonight: {
    bg: '#1a1b26',
    header: '#24283b',
    panel: '#16161e',
    card: '#24283b',
    settings: '#1f2335',
    text: '#c0caf5',
    muted: '#565f89',
    border: '#3b4261',
    accent: '#7dcfff',
  },
};

function customThemeFile(userDataPath) {
  return path.join(String(userDataPath || ''), 'cfg', 'customTheme.json');
}

function themeImagesDir(userDataPath) {
  return path.join(String(userDataPath || ''), 'theme-images');
}

function isHex(value) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value || '').trim());
}

function isRgb(value) {
  return /^rgba?\(\s*\d{1,3}(\s*,\s*\d{1,3}){2,3}\s*\)$/i.test(String(value || '').trim());
}

function normalizeColor(value, fallback) {
  const raw = String(value || '').trim();
  if (isHex(raw) || isRgb(raw)) return raw;
  return fallback;
}

function normalizeFit(value) {
  return FITS.includes(value) ? value : 'cover';
}

function normalizeImage(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

const GRADIENT_ANGLES = [0, 45, 90, 135, 180, 270];

function darkenHex(value, percent = 48) {
  const rgb = hexToRgbTriplet(value).split(',').map((n) => Math.round(Number(n.trim()) * (1 - percent / 100)));
  return `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

// Per-layer gradient model: two user-chosen colors + a direction angle. A legacy `gradient: true`
// (the first simple toggle) is converted into a default dark fade.
function normalizeGradient(raw, baseColor) {
  const legacy = raw === true;
  const value = raw && typeof raw === 'object' ? raw : {};
  const from = normalizeColor(value.from, baseColor);
  return {
    enabled: value.enabled === true || legacy,
    from,
    to: normalizeColor(value.to, legacy ? darkenHex(from, 48) : from),
    angle: GRADIENT_ANGLES.includes(Number(value.angle)) ? Number(value.angle) : 180,
  };
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

function normalizeEffect(raw) {
  const effect = (raw && typeof raw === 'object' ? raw : {}) || {};
  return {
    enabled: effect.enabled === true,
    type: effect.type === 'blur' ? 'blur' : 'veil',
    color: normalizeColor(effect.color, '#000000'),
    opacity: clampInt(effect.opacity, 0, 100, 40),
    blur: clampInt(effect.blur, 0, 40, 8),
    blurImage: typeof effect.blurImage === 'string' ? effect.blurImage : '',
  };
}

function defaultCustomTheme() {
  const theme = {};
  for (const id of LAYER_IDS) {
    const color = BUILTIN_COLORS.default[id] || '#1b2838';
    theme[id] = {
      color,
      gradient: { enabled: false, from: color, to: darkenHex(color, 48), angle: 180 },
    };
    if (IMAGE_LAYER_IDS.includes(id)) {
      theme[id].image = '';
      theme[id].fit = 'cover';
      theme[id].effect = {
        enabled: false,
        type: 'veil',
        color: '#000000',
        opacity: 40,
        blur: 8,
        blurImage: '',
      };
    }
  }
  return theme;
}

function sanitizeCustomTheme(raw) {
  const fallback = defaultCustomTheme();
  const theme = {};
  for (const id of LAYER_IDS) {
    const layer = (raw && raw[id]) || {};
    const base = fallback[id] || {};
    theme[id] = {
      color: normalizeColor(layer.color, base.color),
      // The legacy `gradient: true` fade is derived from this layer's own color,
      // never from the built-in fallback color.
      gradient: normalizeGradient(layer.gradient, layer.color || base.color),
    };
    if (IMAGE_LAYER_IDS.includes(id)) {
      theme[id].image = normalizeImage(layer.image);
      theme[id].fit = normalizeFit(layer.fit);
      theme[id].effect = normalizeEffect(layer.effect);
    }
  }
  return theme;
}

function loadCustomTheme(userDataPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(customThemeFile(userDataPath), 'utf8'));
    return sanitizeCustomTheme(raw);
  } catch {
    return defaultCustomTheme();
  }
}

function saveCustomTheme(userDataPath, theme) {
  const clean = sanitizeCustomTheme(theme);
  fs.mkdirSync(path.dirname(customThemeFile(userDataPath)), { recursive: true });
  fs.writeFileSync(customThemeFile(userDataPath), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}

function hexToRgbTriplet(value) {
  const raw = String(value || '#6c91ff').trim().toLowerCase();
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(raw)) {
    const full = raw.length === 4 ? raw.slice(1).split('').map((c) => c + c).join('') : raw.slice(1);
    const n = parseInt(full, 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(raw);
  if (m) return `${m[1]}, ${m[2]}, ${m[3]}`;
  return '108, 145, 255';
}

function imageUrl(filePath) {
  if (!filePath) return 'none';
  try {
    if (!fs.existsSync(filePath)) return 'none';
    const href = pathToFileURL(path.resolve(filePath)).href.replace(/'/g, "\\'");
    return `url('${href}')`;
  } catch {
    return 'none';
  }
}

// The image actually rendered for a layer: a pre-blurred copy when either the blur
// or the colored-veil effect is active (the blur is baked into the asset so the
// element's own text/content stay crisp), otherwise the source image. The veil uses
// the same pipeline with a light fixed frosted blur, so images under a colored veil
// look softer and more polished instead of flat/sharp.
function effectiveImage(layer) {
  if (!layer) return '';
  if (layer.effect && layer.effect.enabled === true && layer.effect.blurImage) {
    return layer.effect.blurImage;
  }
  return layer.image || '';
}

function veilRgba(layer) {
  if (!layer || !layer.effect || layer.effect.enabled !== true || layer.effect.type !== 'veil' || layer.effect.opacity <= 0) {
    return 'transparent';
  }
  return `rgba(${hexToRgbTriplet(layer.effect.color)}, ${(layer.effect.opacity / 100).toFixed(3)})`;
}

function veilLayer(layer) {
  return `linear-gradient(${veilRgba(layer)}, ${veilRgba(layer)})`;
}

// Optional per-layer gradient: a subtle top-to-bottom depth fade of the chosen color. Used as an
// extra background layer on surface layers (bg/header/panel/card/settings) when the toggle is on.
function layerGradient(layer) {
  if (!layer || !layer.gradient || layer.gradient.enabled !== true) return 'none';
  const from = layer.gradient.from || layer.color || '#1b2838';
  const to = layer.gradient.to || from;
  const angle = Number.isFinite(Number(layer.gradient.angle)) ? Number(layer.gradient.angle) : 180;
  return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`;
}

function gradientEnabled(layer) {
  return !!(layer && layer.gradient && layer.gradient.enabled === true);
}

function fitProps(fit) {
  if (fit === 'repeat') return 'size:auto; repeat:repeat';
  if (fit === 'contain') return 'size:contain; repeat:no-repeat';
  if (fit === 'fill') return 'size:100% 100%; repeat:no-repeat';
  return 'size:cover; repeat:no-repeat';
}

function layerVars(theme, prefix) {
  const lines = [];
  for (const id of LAYER_IDS) {
    const layer = theme[id] || {};
    lines.push(`  --${prefix}${id}: ${layer.color || '#142236'};`);
    lines.push(`  --aw-grad-${id}: ${layerGradient(layer)};`);
  }
  for (const id of IMAGE_LAYER_IDS) {
    const layer = theme[id] || {};
    const fit = fitProps(layer.fit);
    lines.push(`  --aw-img-${id}: ${imageUrl(effectiveImage(layer))};`);
    lines.push(`  --aw-veil-${id}: ${veilRgba(layer)};`);
    lines.push(`  --aw-img-${id}-size: ${fit.split('; ')[0].replace('size:', '')};`);
    lines.push(`  --aw-img-${id}-repeat: ${fit.split('; ')[1].replace('repeat:', '')};`);
  }
  return lines.join('\n');
}

function imageRule(selector, imageVar, fitVar, repeatVar, extra = '') {
  return `${selector} {
    background-image: var(${imageVar}, none);
    background-size: var(${fitVar}, cover);
    background-repeat: var(${repeatVar}, no-repeat);
    background-position: center;
    ${extra}
  }`;
}

function buildCustomAppCss(theme) {
  const clean = sanitizeCustomTheme(theme);
  const bg = clean.bg.color;
  const header = clean.header.color;
  const panel = clean.panel.color;
  const card = clean.card.color;
  const settings = clean.settings.color;
  const text = clean.text.color;
  const muted = clean.muted.color;
  const border = clean.border.color;
  const accent = clean.accent.color;
  const accentRgb = hexToRgbTriplet(accent);
  const bgGrad = gradientEnabled(clean.bg);
  const headerGrad = gradientEnabled(clean.header);
  const panelGrad = gradientEnabled(clean.panel);
  const cardGrad = gradientEnabled(clean.card);
  const settingsGrad = gradientEnabled(clean.settings);

  const rules = [
    ':root {',
    `  --bg-base: ${bg};`,
    `  --bg-glow: ${header};`,
    `  --bg-panel: ${panel};`,
    '  --bg-panel-translucent: color-mix(in srgb, var(--bg-panel) 78%, transparent);',
    `  --surface: ${card};`,
    '  --surface-elevated: color-mix(in srgb, var(--surface) 88%, white 12%);',
    '  --surface-sunken: color-mix(in srgb, var(--surface) 82%, black);',
    // Settings-modal-only surfaces: derived from the "settings" layer, not "card", so a custom
    // Cards/tiles color/image never bleeds into the Settings UI chrome (see app.css --set-* tokens).
    `  --set-surface: ${settings};`,
    '  --set-surface-elevated: color-mix(in srgb, var(--set-surface) 88%, white 12%);',
    '  --set-surface-sunken: color-mix(in srgb, var(--set-surface) 82%, black);',
    `  --text: ${text};`,
    `  --text-muted: ${muted};`,
    `  --border: ${border};`,
    `  --accent: ${accent};`,
    '  --accent-strong: color-mix(in srgb, var(--accent) 88%, white 12%);',
    `  --accent-soft: rgba(${accentRgb}, 0.16);`,
    `  --aw-settings-color: ${settings};`,
    layerVars(clean, 'aw-'),
    '}',
    '',
    'body {',
    `  background-color: ${bgGrad ? 'transparent' : bg} !important;`,
    `  background-image: ${veilLayer(clean.bg)}, ${bgGrad ? 'var(--aw-grad-bg, none)' : `radial-gradient(140% 90% at 50% -10%, ${header} 0%, ${bg} 60%)`}, ${bgGrad ? 'none' : 'var(--aw-grad-bg, none)'}, var(--aw-img-bg, none) !important;`,
    `  background-size: auto, 100% 100%, 100% 100%, var(--aw-img-bg-size, cover) !important;`,
    '  background-repeat: no-repeat, no-repeat, no-repeat, var(--aw-img-bg-repeat, no-repeat) !important;',
    '  background-position: center !important;',
    '}',
    '',
    'title-bar {',
    `  background-color: ${headerGrad ? 'transparent' : `color-mix(in srgb, ${header} 72%, transparent)`};`,
    `  background-image: ${veilLayer(clean.header)}, var(--aw-grad-header, none), var(--aw-img-header, none);`,
    '  background-size: auto, 100% 100%, var(--aw-img-header-size, cover);',
    '  background-repeat: no-repeat, no-repeat, var(--aw-img-header-repeat, no-repeat);',
    '  background-position: center;',
    '}',
    '',
    `#game-list {
  background-color: ${panelGrad ? 'transparent' : 'color-mix(in srgb, var(--bg-panel) 62%, transparent)'};
  background-image: ${veilLayer(clean.panel)}, var(--aw-grad-panel, none), var(--aw-img-panel, none);
  background-size: auto, 100% 100%, var(--aw-img-panel-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-panel-repeat, no-repeat);
  background-position: center;
}`,
    '',
    `#game-list .game-box .info {
  ${cardGrad ? 'background-color: transparent;' : ''}
  background-image: ${veilLayer(clean.card)}, var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
  background-position: center;
}`,
    '',
    `#settings .box,
#game-config .box {
  --set-modal-top: var(--aw-settings-color);
  --set-modal-bottom: var(--aw-settings-color);
  ${settingsGrad ? 'background-color: transparent;' : ''}
  /* Keep the box's color gradient as the bottom layer: without an image (and with
     no effect) the two upper layers are transparent/none, so the settings surface
     must still render its chosen color instead of becoming transparent. An enabled
     per-layer gradient replaces that base color entirely. */
  background-image: ${veilLayer(clean.settings)}, var(--aw-grad-settings, none), var(--aw-img-settings, none)${settingsGrad ? '' : ', linear-gradient(180deg, var(--set-modal-top) 0%, var(--set-modal-bottom) 100%)'};
  background-size: auto, 100% 100%, var(--aw-img-settings-size, cover)${settingsGrad ? '' : ', cover'};
  background-repeat: no-repeat, no-repeat, var(--aw-img-settings-repeat, no-repeat)${settingsGrad ? '' : ', no-repeat'};
  background-position: center;
}`,
  ];

  // When a layer has an image, the layer color must NOT hide it: drop the opaque
  // surface to a dark scrim so the image is clearly visible and text stays readable.
  if (clean.bg.image) {
    rules.push(`body {
  background-color: rgba(0, 0, 0, 0.25) !important;
  background-image: ${veilLayer(clean.bg)}, linear-gradient(180deg, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.55)), var(--aw-grad-bg, none), var(--aw-img-bg, none) !important;
  background-size: auto, auto, 100% 100%, var(--aw-img-bg-size, cover) !important;
  background-repeat: no-repeat, no-repeat, no-repeat, var(--aw-img-bg-repeat, no-repeat) !important;
}`);
  }
  if (clean.header.image) {
    rules.push(`title-bar {
  background-color: rgba(0, 0, 0, 0.30);
}`);
  }
  if (clean.panel.image) {
    rules.push(`#game-list {
  background-color: rgba(0, 0, 0, 0.28);
}`);
  }
  if (clean.card.image) {
    rules.push(`#game-list .game-box .info {
  background-color: rgba(0, 0, 0, 0.30);
}

#achievement .achievement-list ul > li {
  background-image: ${veilLayer(clean.card)}, linear-gradient(145deg, rgba(0, 0, 0, 0.28), rgba(0, 0, 0, 0.42)), var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: repeat, no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
  background-position: 0 0, center;
}

#achievement .achievement-list ul > li:hover {
  background-image: ${veilLayer(clean.card)}, linear-gradient(145deg, rgba(0, 0, 0, 0.26), rgba(0, 0, 0, 0.40)), var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: repeat, no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
  background-position: 0 0, center;
}`);
  }
  if (clean.settings.image) {
    rules.push(`#settings .box {
  background-color: rgba(0, 0, 0, 0.12);
}`);
  }

  return rules.join('\n\n') + '\n';
}

function buildOverlayCss(colors, imageTheme) {
  const bg = colors.bg;
  const header = colors.header;
  const card = colors.card;
  const text = colors.text;
  const muted = colors.muted;
  const border = colors.border;
  const accent = colors.accent;
  const accentRgb = hexToRgbTriplet(accent);
  const images = imageTheme
    ? {
        bg: imageTheme.bg,
        header: imageTheme.header,
        panel: imageTheme.panel,
        card: imageTheme.card,
      }
    : { bg: null, header: null, panel: null, card: null };

  const imgVars = [];
  for (const id of ['bg', 'header', 'panel', 'card']) {
    const layer = images[id];
    imgVars.push(`  --aw-img-${id}: ${layer && effectiveImage(layer) ? imageUrl(effectiveImage(layer)) : 'none'};`);
    imgVars.push(`  --aw-veil-${id}: ${layer ? veilRgba(layer) : 'transparent'};`);
    imgVars.push(`  --aw-grad-${id}: ${layerGradient(layer)};`);
    const fit = layer && layer.fit ? fitProps(layer.fit) : fitProps('cover');
    imgVars.push(`  --aw-img-${id}-size: ${fit.split('; ')[0].replace('size:', '')};`);
    imgVars.push(`  --aw-img-${id}-repeat: ${fit.split('; ')[1].replace('repeat:', '')};`);
  }

  const rules = [
    ':root {',
    `  --aw-theme-bg: ${bg};`,
    `  --aw-theme-header: ${header};`,
    `  --aw-theme-surface: ${card};`,
    `  --aw-theme-text: ${text};`,
    `  --aw-theme-muted: ${muted};`,
    `  --aw-theme-border: ${border};`,
    `  --aw-theme-accent: ${accent};`,
    ...imgVars,
    `  --accent: var(--aw-theme-accent);
  --accent-rgb: ${accentRgb};
  --bg: color-mix(in srgb, var(--aw-theme-bg) calc(var(--panel-alpha, 0.88) * 100%), transparent);
  --bg-soft: color-mix(in srgb, var(--aw-theme-surface) 55%, transparent);
  --bg-hover: color-mix(in srgb, var(--aw-theme-surface) 72%, transparent);
  --text: var(--aw-theme-text);
  --muted: var(--aw-theme-muted);
  --border: color-mix(in srgb, var(--aw-theme-border) 55%, transparent);`,
    '}',
    '',
    `.overlay-panel {
  ${gradientEnabled(images.bg) ? 'background-color: transparent;' : ''}
  background-image: ${veilLayer(images.bg)}, var(--aw-grad-bg, none), var(--aw-img-bg, none);
  background-size: auto, 100% 100%, var(--aw-img-bg-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-bg-repeat, no-repeat);
  background-position: center;
}`,
    '',
    `.overlay-header {
  background-color: ${gradientEnabled(images.header) ? 'transparent' : 'color-mix(in srgb, var(--aw-theme-header) 70%, transparent)'};
  background-image: ${veilLayer(images.header)}, var(--aw-grad-header, none), var(--aw-img-header, none);
  background-size: auto, 100% 100%, var(--aw-img-header-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-header-repeat, no-repeat);
  background-position: center;
}`,
    '',
    `.overlay-tools,
.overlay-stats {
  ${gradientEnabled(images.panel) ? 'background-color: transparent;' : ''}
  background-image: ${veilLayer(images.panel)}, var(--aw-grad-panel, none), var(--aw-img-panel, none);
  background-size: auto, 100% 100%, var(--aw-img-panel-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-panel-repeat, no-repeat);
  background-position: center;
}`,
    '',
    `.overlay-row {
  ${gradientEnabled(images.card) ? 'background-color: transparent;' : ''}
  background-image: ${veilLayer(images.card)}, var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
  background-position: center;
}`,
    '',
    `.overlay-row:hover {
  background-color: ${gradientEnabled(images.card) ? 'transparent' : 'var(--bg-hover)'};
  background-image: ${veilLayer(images.card)}, var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
  background-position: center;
}`,
  ];

  // Same rule as the main window: when an image is set, the layer color must not
  // cover it — keep a light dark scrim for readability instead.
  if (images.bg && images.bg.image) {
    rules.push(`.overlay-panel {
  background-color: rgba(0, 0, 0, 0.25);
  background-image: ${veilLayer(images.bg)}, var(--aw-grad-bg, none), var(--aw-img-bg, none);
  background-size: auto, 100% 100%, var(--aw-img-bg-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-bg-repeat, no-repeat);
}`);
  }
  if (images.header && images.header.image) {
    rules.push(`.overlay-header {
  background-color: rgba(0, 0, 0, 0.25);
}`);
  }
  if (images.panel && images.panel.image) {
    rules.push(`.overlay-tools,
.overlay-stats {
  background-color: rgba(0, 0, 0, 0.25);
}`);
  }
  if (images.card && images.card.image) {
    rules.push(`.overlay-row {
  background-color: rgba(0, 0, 0, 0.18);
  background-image: ${veilLayer(images.card)}, var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
}

.overlay-row:hover {
  background-color: rgba(0, 0, 0, 0.28);
  background-image: ${veilLayer(images.card)}, var(--aw-grad-card, none), var(--aw-img-card, none);
  background-size: auto, 100% 100%, var(--aw-img-card-size, cover);
  background-repeat: no-repeat, no-repeat, var(--aw-img-card-repeat, no-repeat);
}`);
  }

  return rules.join('\n\n') + '\n';
}

function buildCustomOverlayCss(theme) {
  const clean = sanitizeCustomTheme(theme);
  return buildOverlayCss(
    {
      bg: clean.bg.color,
      header: clean.header.color,
      card: clean.card.color,
      text: clean.text.color,
      muted: clean.muted.color,
      border: clean.border.color,
      accent: clean.accent.color,
    },
    clean
  );
}

function buildBuiltinOverlayCss(themeName) {
  return buildOverlayCss(BUILTIN_COLORS[themeName] || BUILTIN_COLORS.default, null);
}

// Main-process IPC helpers ---------------------------------------------------

function themePayload(userDataPath, themeName, customTheme, userCss) {
  const isCustom = themeName === 'custom';
  const isUserCss = /^user:/.test(String(themeName || ''));
  const theme = isCustom ? sanitizeCustomTheme(customTheme) : null;
  return {
    name: themeName || 'default',
    custom: isCustom,
    appCss: isCustom ? buildCustomAppCss(theme) : '',
    overlayCss: isCustom ? buildCustomOverlayCss(theme) : buildBuiltinOverlayCss(themeName),
    userCss: isUserCss ? userCss || '' : '',
    customTheme: theme,
    builtinColors: BUILTIN_COLORS[themeName] || BUILTIN_COLORS.default,
    accent: theme ? theme.accent.color : (BUILTIN_COLORS[themeName] || BUILTIN_COLORS.default).accent,
  };
}

module.exports = {
  LAYER_IDS,
  IMAGE_LAYER_IDS,
  FITS,
  BUILTIN_COLORS,
  customThemeFile,
  themeImagesDir,
  defaultCustomTheme,
  sanitizeCustomTheme,
  loadCustomTheme,
  saveCustomTheme,
  hexToRgbTriplet,
  buildCustomAppCss,
  buildCustomOverlayCss,
  buildBuiltinOverlayCss,
  buildOverlayCss,
  themePayload,
};
