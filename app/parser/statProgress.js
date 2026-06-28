'use strict';

function numericStatValue(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number') return Number.isFinite(entry) ? entry : null;
  if (typeof entry === 'string') {
    const n = Number(entry);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof entry === 'object') {
    for (const key of ['value', 'Value', 'CurProgress', 'curProgress', 'progress', 'current', 'Current']) {
      if (!(key in entry)) continue;
      const n = Number(entry[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function applyLocalStatProgress(root, localSchema) {
  if (!root || typeof root !== 'object' || !Array.isArray(localSchema) || localSchema.length === 0) return 0;
  const byKey = new Map(Object.keys(root).map((key) => [String(key).toUpperCase(), key]));
  let applied = 0;
  for (const achievement of localSchema) {
    const statName = achievement && achievement.progress && achievement.progress.value && achievement.progress.value.operand1;
    if (!achievement || !achievement.name || !statName) continue;
    const statKey = byKey.get(String(statName).toUpperCase());
    if (!statKey) continue;
    const value = numericStatValue(root[statKey]);
    if (value == null) continue;
    const max = Number(achievement.progress.max_val || achievement.progress.max || achievement.progress.maxProgress || 0) || 0;
    if (root[achievement.name] && typeof root[achievement.name] === 'object') {
      if (!root[achievement.name].CurProgress && !root[achievement.name].progress) root[achievement.name].CurProgress = value;
      if (!root[achievement.name].MaxProgress && !root[achievement.name].max_progress && max) root[achievement.name].MaxProgress = max;
    } else {
      root[achievement.name] = {
        CurProgress: value,
        MaxProgress: max,
        Achieved: max > 0 && value >= max ? '1' : '0',
      };
    }
    applied++;
  }
  return applied;
}

module.exports = { applyLocalStatProgress, numericStatValue };
