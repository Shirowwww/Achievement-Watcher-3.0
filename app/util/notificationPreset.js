'use strict';

/*
  Overlay notification preset resolution.
  Priority: platform preset (Xenia/RPCS3/ShadPS4) > main preset.

  There is deliberately no per-type preset here. A rare unlock and a 100% completion are STATES that
  every preset paints itself - the engine adds `state-rare`/`tier-*`/`state-platinum` and the
  stylesheet answers - so picking a second preset for them was a second way to express the same
  thing, and the one that could disagree with itself (a rare popup in one design, an ordinary one in
  another, for the same game).
*/

// The preset a fresh install uses, and the one every fallback lands on.
const DEFAULT_PRESET = 'AW Next';

/*
  Bundled presets that no longer ship, mapped to the redesigned preset that carries the same idea.

  This is a FALLBACK, never a rewrite: resolvePresetFolder() looks the saved name up across every
  preset root first, so a preset the user made or imported under one of these names keeps working
  and keeps winning. Only a name that resolves to nothing - which is what a removed bundled preset
  becomes - is looked up here, so an existing config keeps a notification that looks like the one it
  asked for instead of silently falling back to the default.
*/
const LEGACY_PRESET_ALIASES = {
  // The former default, and the name it carried before that.
  Shirow: DEFAULT_PRESET,
  Raposo: DEFAULT_PRESET,
  Default: DEFAULT_PRESET,
  Midnight: DEFAULT_PRESET,
  xqjan: DEFAULT_PRESET,
  // Console looks. The platform keeps its own name, so these are the older spellings of it.
  PS4: 'PlayStation',
  'PS5 enhanced': 'PlayStation',
  Trophy: 'PlayStation',
  'Xbox 360': 'Xbox',
  'Xbox One': 'Xbox',
  Orbit: 'Xbox',
  Deck: 'Steam',
  // Artwork behind the text.
  'Game Cover': 'Cover',
  Sunset: 'Cover',
  // Quiet, uncoloured cards.
  Clean: 'Glass',
  Modern: 'Glass',
  'Smooth Pop': 'Glass',
  // Loud, high-contrast cards.
  'Neon Future': 'Arcade',
  LAZ0RBOX: 'Arcade',
  /*
    The Xbox Series family. Its rare and 100% variants existed only to be picked in the per-type
    preset settings, which no longer exist - a preset paints those states itself now - so they all
    fold back into the one preset they were variations of.
  */
  'Xbox Series - Purple': 'Xbox Series',
  'Xbox Series Rare': 'Xbox Series',
  'Xbox Series Rare - Purple': 'Xbox Series',
  'Xbox Series Platinum': 'Xbox Series',
  'Xbox Series Platinum - Purple': 'Xbox Series',
  // Community presets renamed for what they look like rather than who submitted them.
  ArmsofGod: 'Pantheon',
  'Epic Preset': 'Onyx',
  'TigerDX Award': 'Hexagon',
  mudoss: 'Outline',
};

// The preset a removed bundled name stands in for, or '' when the name is not one of them.
function legacyPresetAlias(name) {
  const raw = String(name == null ? '' : name).trim();
  return Object.prototype.hasOwnProperty.call(LEGACY_PRESET_ALIASES, raw) ? LEGACY_PRESET_ALIASES[raw] : '';
}

const EMULATOR_PLATFORM_BY_SOURCE = {
  xenia: ['xenia', 'xenia emulator'],
  rpcs3: ['rpcs3', 'rpcs3 emulator'],
  shadps4: ['shadps4', 'shadps4 emulator'],
};

function sourcePlatform(source) {
  const key = String(source || '').trim().toLowerCase();
  if (!key) return null;
  for (const [platform, aliases] of Object.entries(EMULATOR_PLATFORM_BY_SOURCE)) {
    if (aliases.includes(key)) return platform;
  }
  return null;
}

function resolvePreset({ presets = {}, source = '' } = {}) {
  const main = presets.main || DEFAULT_PRESET;

  const platform = sourcePlatform(source);
  if (platform && presets[platform]) return presets[platform];

  return main;
}

module.exports = { DEFAULT_PRESET, LEGACY_PRESET_ALIASES, legacyPresetAlias, sourcePlatform, resolvePreset };
