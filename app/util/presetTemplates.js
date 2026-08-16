'use strict';

/*
  Starting points for the preset designer.

  A template is an ordinary set of designer options — nothing here is a special case for the
  generator, and a template applied to the controls is indistinguishable from having moved every
  slider by hand. That is the whole point: they are a faster way to reach a design, never a second
  kind of preset.

  Names are proper names, like the bundled presets, so they read the same in every language.
*/

const { PRESET_PROPERTIES, normalizeOptions } = require('./presetSchema.js');

const PRESET_TEMPLATES = [
  {
    // The design the builder has always produced, kept as a template so "back to the classic look"
    // is one click rather than a memory exercise.
    name: 'Classic',
    options: {},
  },
  {
    name: 'Aurora',
    options: {
      bgMode: 'gradient',
      bg: '#0b1224',
      bg2: '#1d4f6c',
      bgAngle: 120,
      accent: '#57e8c3',
      text: '#eaf6ff',
      radius: 18,
      accentBar: 'left',
      accentBarSize: 5,
      glow: 35,
      shadow: 55,
      iconRadius: 22,
      animIn: 'left',
      animOut: 'left',
      rareAccent: '#ffd76e',
      platinumAccent: '#d8f4ff',
    },
  },
  {
    name: 'Neon',
    options: {
      bgMode: 'gradient',
      bg: '#12002b',
      bg2: '#3d0d63',
      bgAngle: 135,
      accent: '#ff3ea5',
      text: '#ffffff',
      radius: 22,
      accentBar: 'outline',
      accentBarSize: 2,
      glow: 75,
      shadow: 60,
      fontFamily: 'condensed',
      fontSize: 19,
      titleCase: 'uppercase',
      letterSpacing: 1,
      iconRadius: 20,
      iconBorder: 2,
      iconGlow: 60,
      animIn: 'right',
      animOut: 'right',
      easing: 'back',
      rareAccent: '#ffe14e',
      platinumAccent: '#8affd8',
    },
  },
  {
    name: 'Cover',
    options: {
      bgMode: 'artwork',
      artworkDim: 55,
      artworkBlur: 4,
      bg: '#05070c',
      accent: '#7ee787',
      text: '#ffffff',
      textShadow: 60,
      radius: 16,
      accentBar: 'bottom',
      accentBarSize: 3,
      width: 480,
      padX: 22,
      padY: 16,
      iconSize: 76,
      iconRadius: 50,
      fontSize: 18,
      detailScale: 85,
      showGameName: true,
      animIn: 'top',
      animOut: 'top',
      shadow: 70,
    },
  },
  {
    name: 'Minimal',
    options: {
      layout: 'icon-top',
      align: 'center',
      width: 320,
      padY: 18,
      gap: 8,
      bg: '#0f1115',
      accent: '#e6e6e6',
      text: '#f5f5f5',
      radius: 26,
      accentBar: 'none',
      borderWidth: 1,
      borderColor: '#3a3f4b',
      fontFamily: 'serif',
      fontSize: 17,
      iconSize: 72,
      iconRadius: 50,
      animIn: 'zoom',
      animOut: 'fade',
      glow: 15,
      duration: 4000,
      showProgress: false,
    },
  },
  {
    name: 'Console',
    options: {
      bg: '#1b1b1f',
      accent: '#9bf6a0',
      text: '#ffffff',
      radius: 8,
      accentBar: 'left',
      accentBarSize: 6,
      width: 460,
      padX: 20,
      padY: 14,
      iconSize: 72,
      iconRadius: 8,
      fontSize: 17,
      titleWeight: 800,
      shadow: 65,
      animIn: 'right',
      animOut: 'right',
      duration: 5000,
      showRarity: true,
      rareAccent: '#ffd24e',
      platinumAccent: '#bfe9ff',
    },
  },
  {
    name: 'Terminal',
    options: {
      bg: '#04120a',
      accent: '#39ff88',
      text: '#c8ffdd',
      radius: 2,
      accentBar: 'outline',
      accentBarSize: 1,
      borderWidth: 0,
      fontFamily: 'mono',
      fontSize: 15,
      detailScale: 90,
      titleCase: 'uppercase',
      letterSpacing: 1,
      layout: 'text-only',
      align: 'left',
      width: 400,
      padX: 16,
      padY: 12,
      animIn: 'fade',
      animOut: 'fade',
      easing: 'linear',
      glow: 40,
      shadow: 20,
      showRarity: true,
      rareAccent: '#eaff5c',
      platinumAccent: '#8ff5ff',
    },
  },
  {
    name: 'Slate',
    options: {
      bgMode: 'gradient',
      bg: '#20242c',
      bg2: '#12151b',
      bgAngle: 180,
      accent: '#8ab4ff',
      text: '#f2f5fa',
      radius: 14,
      accentBar: 'none',
      borderWidth: 1,
      borderColor: '#39404e',
      width: 470,
      padX: 20,
      padY: 15,
      gap: 14,
      iconSize: 68,
      iconRadius: 16,
      fontSize: 17,
      descriptionLines: 2,
      detailScale: 90,
      showGameName: true,
      shadow: 50,
      animIn: 'bottom',
      animOut: 'bottom',
    },
  },
];

const TEMPLATE_BY_NAME = new Map(PRESET_TEMPLATES.map((template) => [template.name, template]));

// A template as a complete, validated option set. Unknown or out-of-range values in a template would
// be clamped exactly like anything else, so a template can never describe a design the designer
// cannot show back to the user.
function templateOptions(name) {
  const template = TEMPLATE_BY_NAME.get(String(name));
  return template ? normalizeOptions(template.options) : null;
}

// --- randomiser ---------------------------------------------------------------------------------

const pick = (random, list) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
const between = (random, min, max, step = 1) => {
  const steps = Math.floor((max - min) / step);
  return min + Math.min(steps, Math.floor(random() * (steps + 1))) * step;
};

function hsl(hue, saturation, lightness) {
  // Written as hex rather than hsl() so it lands in a colour input, which only takes #rrggbb.
  const h = ((hue % 360) + 360) % 360 / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  const to255 = (value) => Math.round(Math.max(0, Math.min(1, value)) * 255);
  const [r, g, b] = s === 0 ? [l, l, l] : [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
  return `#${[to255(r), to255(g), to255(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/*
  A random design that is still a design: one hue drives the accent, the background is built from a
  neighbouring hue at low lightness, and the states stay recognisably gold and pale. Rolling every
  property independently produces noise, not a preset someone would keep.

  `random` is injectable so the result can be asserted.
*/
function randomPresetOptions(random = Math.random) {
  const hue = between(random, 0, 350, 10);
  const accentHue = hue;
  const backgroundHue = (hue + pick(random, [-30, -15, 0, 15, 30]) + 360) % 360;
  const gradient = random() < 0.5;
  const dark = between(random, 6, 14);

  return normalizeOptions({
    layout: pick(random, ['icon-left', 'icon-left', 'icon-right', 'icon-top']),
    align: pick(random, ['left', 'left', 'center']),
    width: between(random, 340, 540, 20),
    padX: between(random, 14, 26),
    padY: between(random, 10, 20),
    gap: between(random, 8, 18),
    fontFamily: pick(random, ['sans', 'sans', 'rounded', 'condensed', 'serif', 'mono']),
    fontSize: between(random, 15, 20),
    detailScale: between(random, 80, 100, 5),
    titleCase: pick(random, ['none', 'none', 'uppercase']),
    bgMode: gradient ? 'gradient' : 'solid',
    bg: hsl(backgroundHue, between(random, 20, 45), dark),
    bg2: hsl((backgroundHue + 40) % 360, between(random, 30, 55), dark + between(random, 6, 14)),
    bgAngle: between(random, 0, 350, 15),
    accent: hsl(accentHue, between(random, 65, 95), between(random, 55, 70)),
    text: '#ffffff',
    radius: between(random, 0, 28, 2),
    accentBar: pick(random, ['left', 'left', 'bottom', 'outline', 'none']),
    accentBarSize: between(random, 2, 6),
    shadow: between(random, 30, 70, 5),
    glow: pick(random, [0, 0, 20, 40, 60]),
    iconRadius: pick(random, [8, 14, 20, 50]),
    animIn: pick(random, ['bottom', 'bottom', 'left', 'right', 'top', 'zoom', 'fade']),
    animOut: pick(random, ['bottom', 'bottom', 'left', 'right', 'top', 'fade']),
    easing: pick(random, ['smooth', 'smooth', 'back']),
    duration: between(random, 4000, 8000, 500),
    rareAccent: hsl(between(random, 38, 52), 90, 62),
    platinumAccent: hsl(between(random, 190, 220), 70, 85),
  });
}

// Every property a template or the randomiser can set has to be one the schema knows, or it would be
// dropped on the way in and the design would silently differ from the one that was described.
function unknownTemplateKeys() {
  const known = new Set(PRESET_PROPERTIES.map((property) => property.key));
  const out = [];
  for (const template of PRESET_TEMPLATES) {
    for (const key of Object.keys(template.options)) if (!known.has(key)) out.push(`${template.name}.${key}`);
  }
  return out;
}

module.exports = { PRESET_TEMPLATES, templateOptions, randomPresetOptions, unknownTemplateKeys };
