'use strict';

/*
  Guard for URLs handed to shell.openExternal(): a remote source (CrakFiles catalog) could name any
  scheme, so only http(s) is forwarded. App-built URLs (steam://uninstall/…) don't go through here.
*/
function isSafeExternalUrl(url) {
  if (typeof url !== 'string' || url === '') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false; // not an absolute URL at all
  }
}

/**
 * Open `url` externally when it is safe to do so.
 * @param {object} shell        Electron's shell (or remote.shell in the renderer).
 * @param {string} url          Candidate URL, possibly from a remote catalog.
 * @param {function} [onReject] Called with the rejected URL instead of opening it.
 * @returns {boolean} whether the URL was forwarded to the OS.
 */
function openExternalSafe(shell, url, onReject) {
  if (!isSafeExternalUrl(url)) {
    if (typeof onReject === 'function') onReject(url);
    return false;
  }
  Promise.resolve(shell.openExternal(url)).catch(() => {});
  return true;
}

module.exports = { isSafeExternalUrl, openExternalSafe };
