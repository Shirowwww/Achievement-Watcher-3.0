'use strict';

/*
  Guard for URLs that are handed to shell.openExternal().

  openExternal() asks Windows to launch whatever handler is registered for the scheme, so it must
  never receive a URL that came from a remote source verbatim. The CrakFiles community-fix catalog is
  fetched over the network and its `fixes[].href` / `source_crack[]` values are opened on a button
  click; a catalog entry could name any scheme (ms-msdt:, search-ms:, file:, a UNC path) and the click
  would launch it.

  Policy: only http(s) is forwarded. URLs the app builds itself from validated parts — notably
  util/uninstall.js's `steam://uninstall/<numeric appid>` — do not go through here, because they are
  constructed rather than received.
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
