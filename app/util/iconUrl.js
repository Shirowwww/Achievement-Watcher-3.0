'use strict';

const fs = require('fs');
const { pathToFileURL } = require('url');

/*
  Normalise what steam.js fetchIcon() returns into a file:// URL for the renderer, or null.

  fetchIcon() signals "could not get this artwork" by handing back the URL it was given (or the last
  candidate it tried) rather than a cached file path. Running that sentinel through pathToFileURL()
  turned it into a plausible-looking

    file:///C:/…/app/https:/cdn.cloudflare.steamstatic.com/steam/apps/440/header.jpg

  which is truthy and never equal to the requested URL — so every caller's failure check
  (`local !== url`, `!local`) read a miss as a success. The portrait<->header fallback never ran, and
  "Use another Steam AppID…" persisted that broken URL into cfg/covers.db as a permanent cover
  override. Convert only real local paths; anything else is a miss and must come back as null.
*/
function iconResultToFileUrl(result) {
  if (!result || typeof result !== 'string') return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(result)) return null; // http(s)://, file://, … = not a local path
  try {
    return fs.existsSync(result) ? pathToFileURL(result).href : null;
  } catch {
    return null;
  }
}

module.exports = { iconResultToFileUrl };
