'use strict';

/*
  Every property the notification preset designer can edit, in one declarative list.

  This is the single source of truth for four things that used to be written out by hand, once each,
  and drifted the moment a property was added:

    * the generator      (util/customPreset.js turns these into CSS custom properties)
    * the designer UI    (ui/settings.js reads/writes `#pd-<key>` from this list)
    * validation         (normalizeOptions clamps everything the same way, wherever it came from)
    * the package format (util/presetPackage.js re-clamps a manifest through the same normalizer)

  Adding a property means adding one entry here, one control in view/app.html and one label in the
  locales — never a fifth place where a value can be clamped differently.

  Compatibility rules that must not be broken:

    * every property has a default that reproduces what the builder rendered before it existed, so an
      options file (or an .awpreset manifest) written by an older build still normalizes to the same
      design. `rareGlow` / `platinumGlow` are the deliberate exception, see the `state` group.
    * a preset already generated on disk is never regenerated: its index.html and style.css are read
      as written. Defaults here only apply when the user opens a preset in the designer and saves it.
    * nothing here reaches CSS unvalidated. Colours match a colour syntax, numbers are clamped,
      selects must be one of their listed values, and a sound is a bare filename.
*/

// Groups, in the order the designer shows them. `advanced: true` on a property folds it away behind
// the group's own "Advanced" disclosure rather than hiding a whole group.
const PRESET_GROUPS = ['layout', 'text', 'color', 'icon', 'border', 'effect', 'motion', 'state', 'sound'];

// Font stacks a preset may use. Deliberately a fixed list of families Windows ships: a preset that
// named an arbitrary font would render differently on the machine it was shared with, and a free-text
// font name is also a string that ends up in the stylesheet.
const FONT_STACKS = {
  sans: "'Segoe UI', system-ui, sans-serif",
  rounded: "'Segoe UI Variable Display', 'Trebuchet MS', 'Segoe UI', sans-serif",
  condensed: "'Bahnschrift', 'Segoe UI Semibold', 'Franklin Gothic Medium', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
};

/*
  Where a notification enters from and leaves to, as a transform offset. Named by the side of the
  screen rather than by direction of travel, so `bottom` means "the bottom edge" for both the entry
  and the exit and one list can serve both.

  The offsets are percentages of the card itself, large enough to sit outside the host window (which
  is the card's box plus a small margin), so a preset is never half-visible before it animates in.
*/
const MOTION_OFFSETS = {
  bottom: { dx: '0%', dy: '170%', scale: 1 },
  top: { dx: '0%', dy: '-170%', scale: 1 },
  left: { dx: '-130%', dy: '0%', scale: 1 },
  right: { dx: '130%', dy: '0%', scale: 1 },
  fade: { dx: '0%', dy: '0%', scale: 1 },
  zoom: { dx: '0%', dy: '0%', scale: 0.82 },
};

const EASINGS = {
  smooth: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  linear: 'linear',
  back: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

const MOTION_VALUES = Object.keys(MOTION_OFFSETS);

/*
  A property is:
    key       what it is called in aw-preset.json and in an .awpreset manifest
    type      color | number | select | toggle | sound
    def       the default, which must reproduce the pre-designer look (see the header)
    group     which section of the designer shows it
    advanced  folded behind the group's "Advanced" disclosure
    css       the CSS custom property it becomes, when it maps to one directly
    unit      appended in the stylesheet ('' for a bare number)
    scale     value/scale before it reaches CSS (percent sliders that become 0-1 factors)
*/
const PRESET_PROPERTIES = [
  // --- layout & size ---------------------------------------------------------------------------
  { key: 'layout', type: 'select', def: 'icon-left', values: ['icon-left', 'icon-right', 'icon-top', 'text-only'], group: 'layout' },
  { key: 'align', type: 'select', def: 'left', values: ['left', 'center', 'right'], group: 'layout' },
  /*
    The game's name, on the line above the achievement. The notification window forwards it for any
    preset that asks — a popup otherwise only ever prints what was unlocked, never where.
  */
  { key: 'showGameName', type: 'toggle', def: false, group: 'layout' },
  { key: 'width', type: 'number', def: 420, min: 280, max: 620, step: 10, group: 'layout', css: '--width', unit: 'px' },
  { key: 'padX', type: 'number', def: 18, min: 4, max: 48, step: 1, group: 'layout', css: '--pad-x', unit: 'px' },
  { key: 'padY', type: 'number', def: 12, min: 4, max: 40, step: 1, group: 'layout', css: '--pad-y', unit: 'px' },
  { key: 'gap', type: 'number', def: 12, min: 0, max: 36, step: 1, group: 'layout', css: '--gap', unit: 'px' },

  // --- text ------------------------------------------------------------------------------------
  { key: 'fontFamily', type: 'select', def: 'sans', values: Object.keys(FONT_STACKS), group: 'text' },
  { key: 'fontSize', type: 'number', def: 16, min: 10, max: 28, step: 1, group: 'text', css: '--font-size', unit: 'px' },
  { key: 'detailScale', type: 'number', def: 100, min: 60, max: 130, step: 5, group: 'text', css: '--detail-scale', scale: 100 },
  /*
    How many lines the description may use. One keeps the single-line look the builder always had —
    too long a line is scrolled instead. Two or three wrap it, which is what a card wide enough to
    read a full sentence wants.
  */
  { key: 'descriptionLines', type: 'number', def: 1, min: 1, max: 3, step: 1, group: 'text', css: '--detail-lines' },
  /*
    What colours the title. It has always followed the accent — including the accent a rare or a
    completion notification swaps in — so that stays the default; the other two are for designs where
    a coloured title fights the rest of the card.
  */
  { key: 'titleColorMode', type: 'select', def: 'accent', values: ['accent', 'text', 'custom'], group: 'text' },
  { key: 'titleColor', type: 'color', def: '#ffffff', group: 'text', css: '--title-color', shownFor: { titleColorMode: ['custom'] } },
  { key: 'titleWeight', type: 'number', def: 700, min: 400, max: 900, step: 100, group: 'text', advanced: true, css: '--title-weight' },
  { key: 'titleCase', type: 'select', def: 'none', values: ['none', 'uppercase'], group: 'text', advanced: true, css: '--title-case' },
  { key: 'letterSpacing', type: 'number', def: 0, min: -1, max: 4, step: 0.5, group: 'text', advanced: true, css: '--letter-spacing', unit: 'px' },
  // Text needs its own contrast once it sits on artwork rather than on a flat colour.
  { key: 'textShadow', type: 'number', def: 0, min: 0, max: 100, step: 5, group: 'text', advanced: true, css: '--text-shadow', scale: 100 },

  // --- colours & background --------------------------------------------------------------------
  { key: 'bgMode', type: 'select', def: 'solid', values: ['solid', 'gradient', 'artwork'], group: 'color' },
  { key: 'bg', type: 'color', def: '#16181d', group: 'color', css: '--bg' },
  { key: 'bg2', type: 'color', def: '#2b3550', group: 'color', css: '--bg2', shownFor: { bgMode: ['gradient'] } },
  { key: 'bgAngle', type: 'number', def: 135, min: 0, max: 360, step: 5, group: 'color', advanced: true, css: '--bg-angle', unit: 'deg' },
  { key: 'artworkDim', type: 'number', def: 55, min: 0, max: 100, step: 5, group: 'color', css: '--artwork-dim', scale: 100, shownFor: { bgMode: ['artwork'] } },
  { key: 'artworkBlur', type: 'number', def: 0, min: 0, max: 20, step: 1, group: 'color', advanced: true, css: '--artwork-blur', unit: 'px' },
  // Which part of the artwork the card shows. Game headers put their logo in a fixed place, so the
  // difference between the three is the difference between a readable card and one full of lettering.
  { key: 'artworkPosition', type: 'select', def: 'center', values: ['top', 'center', 'bottom'], group: 'color', advanced: true, shownFor: { bgMode: ['artwork'] } },
  { key: 'text', type: 'color', def: '#ffffff', group: 'color', css: '--text' },
  { key: 'accent', type: 'color', def: '#4aa3ff', group: 'color', css: '--accent-base' },
  { key: 'opacity', type: 'number', def: 1, min: 0.2, max: 1, step: 0.01, group: 'color', css: '--opacity', percent: true },

  // --- icon ------------------------------------------------------------------------------------
  { key: 'iconSize', type: 'number', def: 64, min: 24, max: 110, step: 1, group: 'icon', css: '--icon-size', unit: 'px' },
  { key: 'iconRadius', type: 'number', def: 14, min: 0, max: 50, step: 1, group: 'icon', css: '--icon-radius', unit: '%' },
  { key: 'iconBorder', type: 'number', def: 0, min: 0, max: 6, step: 1, group: 'icon', advanced: true, css: '--icon-border', unit: 'px' },
  { key: 'iconGlow', type: 'number', def: 0, min: 0, max: 100, step: 5, group: 'icon', advanced: true, css: '--icon-glow', scale: 100 },

  // --- border & corners ------------------------------------------------------------------------
  { key: 'radius', type: 'number', def: 12, min: 0, max: 40, step: 1, group: 'border', css: '--radius', unit: 'px' },
  { key: 'accentBar', type: 'select', def: 'left', values: ['left', 'right', 'top', 'bottom', 'outline', 'none'], group: 'border' },
  { key: 'accentBarSize', type: 'number', def: 4, min: 1, max: 14, step: 1, group: 'border', css: '--bar-size', unit: 'px' },
  { key: 'borderWidth', type: 'number', def: 0, min: 0, max: 6, step: 1, group: 'border', advanced: true, css: '--border-width', unit: 'px' },
  { key: 'borderColor', type: 'color', def: '#ffffff', group: 'border', advanced: true, css: '--border-color' },

  // --- shadow & glow ---------------------------------------------------------------------------
  { key: 'shadow', type: 'number', def: 45, min: 0, max: 100, step: 5, group: 'effect', css: '--shadow', scale: 100 },
  { key: 'glow', type: 'number', def: 0, min: 0, max: 100, step: 5, group: 'effect', css: '--glow', scale: 100 },

  // --- motion & timing -------------------------------------------------------------------------
  { key: 'animIn', type: 'select', def: 'bottom', values: MOTION_VALUES, group: 'motion' },
  { key: 'animOut', type: 'select', def: 'bottom', values: MOTION_VALUES, group: 'motion' },
  { key: 'duration', type: 'number', def: 6000, min: 2000, max: 12000, step: 250, group: 'motion' },
  // How far the popup travels on its way in and out: a restrained slide against a sweep across the
  // corner of the screen. A multiplier rather than a distance, so it means the same for every edge.
  { key: 'entryDistance', type: 'number', def: 100, min: 30, max: 200, step: 10, group: 'motion', advanced: true, scale: 100 },
  { key: 'animInMs', type: 'number', def: 520, min: 120, max: 1500, step: 20, group: 'motion', advanced: true, css: '--ach-in', unit: 'ms' },
  { key: 'animOutMs', type: 'number', def: 380, min: 120, max: 1500, step: 20, group: 'motion', advanced: true, css: '--ach-out', unit: 'ms' },
  { key: 'easing', type: 'select', def: 'smooth', values: Object.keys(EASINGS), group: 'motion', advanced: true },

  /*
    --- states ------------------------------------------------------------------------------------
    What a rare unlock and a 100% completion look like. The tier colours are the ones the builder has
    always used for the progress meter (gold under 3%, silver under 6%, bronze up to 10%); they now
    drive the whole card, which is what makes a rare unlock read as rare.

    The two glow defaults are the one place a new default is not the old look: a state that changes
    nothing visible is the gap this group exists to close, and a preset on disk keeps its own files,
    so nothing already installed changes because of it.
  */
  { key: 'rareAccent', type: 'color', def: '#ffd24e', group: 'state', css: '--rare-accent' },
  { key: 'rareGlow', type: 'number', def: 55, min: 0, max: 100, step: 5, group: 'state', css: '--rare-glow', scale: 100 },
  { key: 'platinumAccent', type: 'color', def: '#cfe3ff', group: 'state', css: '--platinum-accent' },
  { key: 'platinumGlow', type: 'number', def: 70, min: 0, max: 100, step: 5, group: 'state', css: '--platinum-glow', scale: 100 },
  { key: 'showProgress', type: 'toggle', def: true, group: 'state' },
  /*
    The rarity chip: the unlock rate the popup was told about, printed on the card. Off by default —
    it is information a preset opts into, not something an existing design should suddenly grow.
  */
  { key: 'showRarity', type: 'toggle', def: false, group: 'state' },
  { key: 'progressHeight', type: 'number', def: 8, min: 3, max: 20, step: 1, group: 'state', advanced: true, css: '--progress-height', unit: 'px' },
  { key: 'rareSilver', type: 'color', def: '#9fb2cc', group: 'state', advanced: true, css: '--rare-silver' },
  { key: 'rareBronze', type: 'color', def: '#cd7f32', group: 'state', advanced: true, css: '--rare-bronze' },

  // --- sound -----------------------------------------------------------------------------------
  // '' means "whatever the Notifications tab is set to"; a filename makes the sound part of the
  // preset, which is what lets a shared package sound the way its author intended.
  { key: 'sound', type: 'sound', def: '', group: 'sound' },
];

const PROPERTY_BY_KEY = new Map(PRESET_PROPERTIES.map((property) => [property.key, property]));

// Same colour syntax the builder has always accepted. Anything else falls back to the default, so a
// hand-edited options file cannot smuggle declarations into the generated stylesheet.
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i;

// A sound is a bare filename in the app's or the user's sounds folder — never a path.
const SOUND_RE = /^[^\\/:*?"<>|\x00-\x1f]+\.(?:wav|mp3|ogg|flac|m4a|aac)$/i;

function clampNumber(value, property) {
  const number = Number(value);
  if (!Number.isFinite(number)) return property.def;
  const clamped = Math.max(property.min, Math.min(property.max, number));
  // Round to the control's own step so a hand-written 12.7351 cannot produce a value the designer
  // could never show back to the user.
  const step = property.step || 1;
  const snapped = Math.round(clamped / step) * step;
  const decimals = String(step).includes('.') ? String(step).split('.')[1].length : 0;
  return Number(Math.max(property.min, Math.min(property.max, snapped)).toFixed(decimals));
}

function normalizeValue(raw, property) {
  switch (property.type) {
    case 'color':
      return typeof raw === 'string' && COLOR_RE.test(raw.trim()) ? raw.trim() : property.def;
    case 'number':
      return clampNumber(raw, property);
    case 'select':
      return property.values.includes(raw) ? raw : property.def;
    case 'toggle':
      return raw === true || raw === 'true' ? true : raw === false || raw === 'false' ? false : property.def;
    case 'sound':
      return typeof raw === 'string' && SOUND_RE.test(raw.trim()) ? raw.trim() : property.def;
    default:
      return property.def;
  }
}

/*
  Every option, normalized. Unknown keys are dropped and missing ones take their default, so this is
  also what makes an options file from an older build — or from a newer one — safe to load.
*/
function normalizeOptions(options = {}) {
  const source = options && typeof options === 'object' ? options : {};
  const out = {};
  for (const property of PRESET_PROPERTIES) out[property.key] = normalizeValue(source[property.key], property);
  return out;
}

// The value as it appears in the stylesheet: percent sliders become factors, everything else carries
// its unit. Only for properties with a `css` mapping.
function cssValue(key, value) {
  const property = PROPERTY_BY_KEY.get(key);
  if (!property || !property.css) return '';
  if (property.type === 'select') return String(value);
  if (property.scale) return String(Number((value / property.scale).toFixed(4)));
  return `${value}${property.unit || ''}`;
}

module.exports = {
  PRESET_GROUPS,
  PRESET_PROPERTIES,
  PROPERTY_BY_KEY,
  FONT_STACKS,
  MOTION_OFFSETS,
  MOTION_VALUES,
  EASINGS,
  COLOR_RE,
  SOUND_RE,
  normalizeOptions,
  cssValue,
};
