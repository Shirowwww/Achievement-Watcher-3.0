'use strict';

/*
  Whether an available update may interrupt the user. Answers are durable so the hourly re-check stops
  nagging: "Skip this version" is permanent, "Later" silences until a deadline. Neither ever hides a
  NEWER release (comparisons are remembered >= offered).
*/

const semver = require('semver');

const POSTPONE_MS = 24 * 60 * 60 * 1000;

/*
  When the next check runs. The update dialog is modal and parentless, so it lands on top of
  whatever is on screen — including a fullscreen game. While one is running the check is skipped
  entirely (no dialog, no network), and the moment the session ends the app looks again shortly
  after, which is the polite time to offer an update.
*/
const INTERVALS = {
  recheck: 60 * 60 * 1000, // healthy silent re-check while the app stays resident
  retry: 30 * 60 * 1000, // slower retry after a failed check
  inGame: 10 * 60 * 1000, // a game is running: look again later, do not interrupt
  afterGame: 45 * 1000, // a session just ended: offer whatever was held back
};

function nextCheckDelayMs({ gameRunning = false, failed = false } = {}) {
  if (gameRunning) return INTERVALS.inGame;
  if (failed) return INTERVALS.retry;
  return INTERVALS.recheck;
}

function coerce(version) {
  const raw = String(version || '').trim();
  if (!raw) return null;
  return semver.valid(raw) || semver.valid(semver.coerce(raw)) || null;
}

// Does `remembered` cover `offered`? True when remembered is the same or a newer version.
function covers(remembered, offered) {
  const a = coerce(remembered);
  const b = coerce(offered);
  if (!a || !b) return false;
  return semver.gte(a, b);
}

function isVersionSkipped(general, offered) {
  const skipped = general && typeof general.skippedVersion === 'string' ? general.skippedVersion : '';
  if (!skipped || skipped.toLowerCase() === 'none') return false;
  return covers(skipped, offered);
}

function isUpdatePostponed(general, offered, now = Date.now()) {
  const version = general && typeof general.updatePostponedVersion === 'string' ? general.updatePostponedVersion : '';
  const until = Number(general && general.updatePostponedUntil) || 0;
  if (!version || !(now < until)) return false;
  return covers(version, offered);
}

/*
  The single decision the updater asks before showing anything.
  `manual` is an explicit "Check for updates" from Settings: the user asked, so a postpone they set
  earlier no longer applies — but an explicit "skip this version" still does.
  Returns { suppress, reason }.
*/
function shouldSuppressUpdatePrompt(general, offered, { manual = false, now = Date.now() } = {}) {
  if (isVersionSkipped(general, offered)) return { suppress: true, reason: 'skipped' };
  if (!manual && isUpdatePostponed(general, offered, now)) return { suppress: true, reason: 'postponed' };
  return { suppress: false, reason: '' };
}

// The general-section patch that records a "Later".
function postponePatch(offered, now = Date.now()) {
  return { updatePostponedVersion: String(offered), updatePostponedUntil: now + POSTPONE_MS };
}

// The general-section patch that forgets one.
function clearPostponePatch() {
  return { updatePostponedVersion: '', updatePostponedUntil: 0 };
}

module.exports = {
  POSTPONE_MS,
  INTERVALS,
  nextCheckDelayMs,
  covers,
  isVersionSkipped,
  isUpdatePostponed,
  shouldSuppressUpdatePrompt,
  postponePatch,
  clearPostponePatch,
};
