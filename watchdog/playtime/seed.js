'use strict';

// Process trail: when the Watchdog starts, games that were ALREADY running are seeded into the playtime
// session list so their playtime is recorded on exit instead of being lost. Pure logic, unit-testable.

// Case-insensitive match of a running process name against a game's stored binary, tolerating the
// Unreal Engine "<name>-Win64-Shipping.exe" variant.
function binaryMatchesProcess(binary, process) {
  if (typeof binary !== 'string') return false;
  const b = binary.trim().toLowerCase();
  if (!b) return false;
  const p = String(process || '').toLowerCase();
  if (!p) return false;
  return b === p || b.replace('.exe', '-win64-shipping.exe') === p;
}

// Build playtime sessions for processes that are already running at startup. `processes` is a list
// of { pid, name } snapshots; `createTimer` is injected so tests can fake the timer.
function buildSeededSessions({ gameIndex, processes, now = Date.now(), createTimer = () => ({}) }) {
  const sessions = [];
  if (!Array.isArray(gameIndex) || !Array.isArray(processes)) return sessions;

  for (const proc of processes) {
    if (!proc || !Number.isFinite(Number(proc.pid))) continue;
    const pid = Number(proc.pid);
    const matches = gameIndex.filter((game) => game && binaryMatchesProcess(game.binary, proc.name));
    if (matches.length !== 1) continue; // ambiguous or unknown — the normal creation watcher handles launches from now on
    const game = matches[0];
    const existing = sessions.find((s) => s.appid === game.appid);
    if (existing) {
      existing.pids.add(pid);
      continue;
    }
    sessions.push({
      appid: game.appid,
      name: game.name,
      binary: game.binary,
      icon: game.icon,
      source: game.source || '',
      pids: new Set([pid]),
      timer: createTimer(now),
      exePath: proc.filepath || '',
      gameDir: proc.filepath ? require('path').parse(proc.filepath).dir : '',
      seeded: true,
      startedAt: now,
    });
  }
  return sessions;
}

module.exports = { binaryMatchesProcess, buildSeededSessions };
