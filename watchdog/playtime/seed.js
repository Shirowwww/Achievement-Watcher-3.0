'use strict';

const path = require('path');

// Seed already-running games so their playtime is recorded on exit.

function normalizeBinary(binary) {
  return typeof binary === 'string' ? binary.trim().toLowerCase() : '';
}

// Case-insensitive match of a running process name against a game's stored binary, tolerating the
// Unreal Engine "<name>-Win64-Shipping.exe" variant.
function binaryMatchesProcess(binary, process) {
  const b = normalizeBinary(binary);
  if (!b) return false;
  const p = String(process || '').toLowerCase();
  if (!p) return false;
  return b === p || b.replace('.exe', '-win64-shipping.exe') === p;
}

function buildBinaryIndex(gameIndex) {
  const byProcessName = new Map();
  if (!gameIndex || typeof gameIndex[Symbol.iterator] !== 'function') return byProcessName;

  const add = (processName, game) => {
    let matches = byProcessName.get(processName);
    if (!matches) {
      matches = [];
      byProcessName.set(processName, matches);
    }
    matches.push(game);
  };

  for (const game of gameIndex) {
    if (!game) continue;
    const binary = normalizeBinary(game.binary);
    if (!binary) continue;
    add(binary, game);

    const shippingVariant = binary.replace('.exe', '-win64-shipping.exe');
    // Only .exe names get an Unreal shipping alias.
    if (shippingVariant !== binary) add(shippingVariant, game);
  }

  return byProcessName;
}

// Preserve game-index order; live filters are applied later.
function getBinaryMatches(binaryIndex, process) {
  if (!(binaryIndex instanceof Map)) return [];
  return binaryIndex.get(String(process || '').toLowerCase()) || [];
}

// Return metadata snapshots without exposing timer or PID state.
function snapshotActiveGames(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions
    .filter((session) => session && session.appid != null)
    .map(({ pids, timer, ...game }) => ({ ...game }));
}

// Select overlay and Xbox targets from active sessions.
function describeActiveGames(sessions) {
  const games = snapshotActiveGames(sessions);
  return {
    games,
    overlayGame: games.length > 0 ? games[games.length - 1] : null,
    xboxGame: [...games].reverse().find((game) => String(game.source || '') === 'Xbox PC') || null,
  };
}

// Build sessions from task-list snapshots; tests inject the timer.
function buildSeededSessions({ gameIndex, processes, now = Date.now(), createTimer = () => ({}) }) {
  if (!Array.isArray(gameIndex) || !Array.isArray(processes)) return [];
  const gamesByProcessName = buildBinaryIndex(gameIndex);
  const sessionsByAppid = new Map();

  for (const proc of processes) {
    if (!proc || !Number.isFinite(Number(proc.pid))) continue;
    const pid = Number(proc.pid);
    const matches = getBinaryMatches(gamesByProcessName, proc.process || proc.name);
    if (matches.length !== 1) continue; // ambiguous or unknown — the normal creation watcher handles launches from now on
    const game = matches[0];
    const existing = sessionsByAppid.get(game.appid);
    if (existing) {
      existing.pids.add(pid);
      continue;
    }
    const filepath = proc.filepath || '';
    sessionsByAppid.set(game.appid, {
      appid: game.appid,
      name: game.name,
      binary: game.binary,
      icon: game.icon,
      source: game.source || '',
      steamappid: game.steamappid,
      iconUrl: game.iconUrl,
      headerUrl: game.headerUrl,
      portraitUrl: game.portraitUrl,
      pids: new Set([pid]),
      timer: createTimer(now),
      exePath: filepath,
      gameDir: filepath ? path.dirname(filepath) : '',
      seeded: true,
      startedAt: now,
    });
  }
  return [...sessionsByAppid.values()];
}

module.exports = { binaryMatchesProcess, buildBinaryIndex, buildSeededSessions, getBinaryMatches, snapshotActiveGames, describeActiveGames };
