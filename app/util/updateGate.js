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
  whatever is on screen - including a fullscreen game. While one is running the check is skipped
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

/*
  Is the offered version actually an upgrade?

  `latest.yml` has to be fetched to answer "am I up to date?" at all - it is the manifest that
  carries the published version, so there is no way to skip reading it and still know. What can be
  guaranteed is what happens afterwards: a manifest naming the version already installed, or an
  older one (a rolled-back release, a stale CDN copy, a local build ahead of the published tag),
  must never turn into a prompt or a download. electron-updater applies its own semver gate before
  emitting update-available; this is the app's own check, so a surprise there cannot cost the user a
  pointless installer download or a dialog offering them what they are already running.

  An unparseable version on either side returns false: that is electron-updater's call to make, and
  suppressing on a version string this cannot read would hide real updates.
*/
function isNotAnUpgrade(offered, currentVersion) {
  const a = coerce(offered);
  const b = coerce(currentVersion);
  if (!a || !b) return false;
  return semver.lte(a, b);
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
  earlier no longer applies - but an explicit "skip this version" still does.
  Returns { suppress, reason }.
*/
function shouldSuppressUpdatePrompt(general, offered, { manual = false, now = Date.now(), currentVersion = '' } = {}) {
  // First, and ahead of `manual`: an explicit "Check for updates" overrules a postpone the user set,
  // but it cannot make a version that is not newer worth offering.
  if (isNotAnUpgrade(offered, currentVersion)) return { suppress: true, reason: 'not-newer' };
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
  isNotAnUpgrade,
  isVersionSkipped,
  isUpdatePostponed,
  shouldSuppressUpdatePrompt,
  postponePatch,
  clearPostponePatch,
};
