'use strict';

// Overlay notification preset resolution.
// Priority: platinum popup > rare unlock > platform preset (Xenia/RPCS3/ShadPS4) > main preset.

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

function resolvePreset({ presets = {}, source = '', notificationType = '', rarityPercent = null } = {}) {
  const main = presets.main || 'Shirow';

  if (notificationType === 'platinum' && presets.platinum) return presets.platinum;

  const isRare = rarityPercent != null && Number.isFinite(Number(rarityPercent)) && Number(rarityPercent) <= 10;
  if (isRare && notificationType !== 'progress' && notificationType !== 'playtime' && presets.rare) {
    return presets.rare;
  }

  const platform = sourcePlatform(source);
  if (platform && presets[platform]) return presets[platform];

  return main;
}

module.exports = { sourcePlatform, resolvePreset };
