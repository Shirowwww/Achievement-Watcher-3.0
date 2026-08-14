'use strict';

/*
  What actually delivered the last notification of a game, kept next to options.ini
  (<userData>/cfg/notificationHealth.json) so both processes can see it: the Watchdog writes it, the
  app reads it for the Game Health "Notifications" row (app/parser/notificationHealth.js).

  Deliberately a memory, not a compatibility database: one small record per game, pruned by age and
  count, holding only what was observed on this machine. Automatic consults it solely as a
  tie-breaker when the live full-screen signal cannot be read (see transportPolicy.js).
*/

const fs = require('fs');
const path = require('path');
const { userDataDir } = require('./userData.js');

const MAX_ENTRIES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// A burst unlock records the same answer many times over; rewriting the file for each is pointless.
const REWRITE_AFTER_MS = 60 * 1000;

let cache = { at: 0, games: null };

function file() {
  return path.join(userDataDir(), 'cfg', 'notificationHealth.json');
}

function read() {
  // The app rewrites nothing here, so the only writer is this process: cache until it writes.
  if (cache.games) return cache.games;
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    cache.games = parsed && typeof parsed.games === 'object' && parsed.games !== null ? parsed.games : {};
  } catch {
    cache.games = {};
  }
  return cache.games;
}

// The transport that last delivered a notification for this game, or null when it is unknown.
function forGame(appid) {
  const entry = read()[String(appid ?? '')];
  if (!entry || !entry.transport) return null;
  if (Date.now() - Number(entry.at || 0) > MAX_AGE_MS) return null;
  return entry.transport;
}

function entryForGame(appid) {
  const entry = read()[String(appid ?? '')];
  return entry ? { ...entry } : null;
}

function prune(games, now) {
  for (const [key, entry] of Object.entries(games)) {
    if (!entry || now - Number(entry.at || 0) > MAX_AGE_MS) delete games[key];
  }
  const keys = Object.keys(games);
  if (keys.length <= MAX_ENTRIES) return games;
  // Oldest first, so the games being played now are the ones that survive.
  keys
    .sort((left, right) => Number(games[left].at || 0) - Number(games[right].at || 0))
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((key) => delete games[key]);
  return games;
}

/*
  Record what happened. `transport` is what actually delivered ('overlay' | 'toast'), `reason` the
  planner's identifier and `outcome` how it ended ('delivered' | 'fallback' | 'unknown') — the app
  needs the last two to say "Windows fallback active" rather than just naming a transport.
*/
function remember(appid, { transport, reason = '', outcome = 'delivered', now = Date.now() } = {}) {
  const key = String(appid ?? '').trim();
  if (!key || !transport) return false;
  const games = read();
  const previous = games[key];
  if (
    previous &&
    previous.transport === transport &&
    previous.reason === reason &&
    previous.outcome === outcome &&
    now - Number(previous.at || 0) < REWRITE_AFTER_MS
  ) {
    return false;
  }

  games[key] = { transport, reason, outcome, at: now };
  prune(games, now);
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ updated: now, games }), 'utf8');
    return true;
  } catch {
    // Best effort: the in-memory map stays correct for this session either way.
    return false;
  }
}

// Tests point userDataDir() at a temp folder between cases.
function _reset() {
  cache = { at: 0, games: null };
}

module.exports = { forGame, entryForGame, remember, file, MAX_ENTRIES, MAX_AGE_MS, _reset };
