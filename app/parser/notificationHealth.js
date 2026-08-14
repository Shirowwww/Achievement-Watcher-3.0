'use strict';

/*
  Read-only view of what actually delivered each game's last notification
  (<userData>/cfg/notificationHealth.json). The Watchdog is the only writer
  (watchdog/util/transportMemory.js); the app reads it so Game Health can report the transport a
  game really got rather than the one configured in Settings — the two differ exactly when the
  automatic fallback did its job, which is the case worth telling the user about.

  Absent file, absent entry and unreadable JSON are all "nothing observed yet", never an error: a
  game that has not unlocked anything since the feature existed simply has no record.
*/

const fs = require('fs');
const path = require('path');

let cfgDir = null;
module.exports.setUserDataPath = (p) => {
  if (p) cfgDir = path.join(p, 'cfg');
};

function file() {
  return path.join(cfgDir || '', 'notificationHealth.json');
}

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return parsed && typeof parsed.games === 'object' && parsed.games !== null ? parsed.games : {};
  } catch {
    return {};
  }
}

// { transport, reason, outcome, at } for this game, or null when nothing has been observed.
module.exports.forGame = (appid) => {
  const entry = read()[String(appid ?? '')];
  if (!entry || !entry.transport) return null;
  return {
    transport: String(entry.transport),
    reason: String(entry.reason || ''),
    outcome: String(entry.outcome || 'delivered'),
    at: Number(entry.at) || 0,
  };
};
