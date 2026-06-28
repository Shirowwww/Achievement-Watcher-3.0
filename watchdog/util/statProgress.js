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

function mapEntriesByName(entries) {
  const map = new Map();
  for (const entry of entries || []) {
    if (!entry || entry.name == null) continue;
    map.set(String(entry.name).toUpperCase(), entry);
  }
  return map;
}

function mapStatProgressEntries(entries, localSchema) {
  if (!Array.isArray(entries) || !Array.isArray(localSchema) || localSchema.length === 0) return 0;
  const byName = mapEntriesByName(entries);
  const consumedStats = new Set();
  const achievementNames = new Set();
  let applied = 0;
  for (const achievement of localSchema) {
    const statName = achievement && achievement.progress && achievement.progress.value && achievement.progress.value.operand1;
    if (!achievement || !achievement.name || !statName) continue;
    achievementNames.add(String(achievement.name).toUpperCase());
    const stat = byName.get(String(statName).toUpperCase());
    if (!stat) continue;
    const value = numericStatValue(stat);
    if (value == null) continue;
    const max = Number(achievement.progress.max_val || achievement.progress.max || achievement.progress.maxProgress || 0) || 0;
    let target = byName.get(String(achievement.name).toUpperCase());
    if (!target) {
      target = {
        name: achievement.name,
        Achieved: false,
        CurProgress: 0,
        MaxProgress: 0,
        UnlockTime: 0,
      };
      entries.push(target);
      byName.set(String(achievement.name).toUpperCase(), target);
    }
    if (!target.CurProgress || value > Number(target.CurProgress || 0)) target.CurProgress = value;
    if (!target.MaxProgress && max) target.MaxProgress = max;
    if (!target.Achieved && max > 0 && value >= max) target.Achieved = true;
    consumedStats.add(String(statName).toUpperCase());
    applied++;
  }
  if (consumedStats.size > 0) {
    for (let i = entries.length - 1; i >= 0; i--) {
      const name = entries[i] && entries[i].name != null ? String(entries[i].name).toUpperCase() : '';
      if (consumedStats.has(name) && !achievementNames.has(name)) entries.splice(i, 1);
    }
  }
  return applied;
}

module.exports = { mapStatProgressEntries, numericStatValue };
