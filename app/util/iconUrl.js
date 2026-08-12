'use strict';

const fs = require('fs');
const { pathToFileURL } = require('url');

/*
  Normalise fetchIcon()'s result into a file:// URL for the renderer, or null. fetchIcon() signals a
  miss by returning the URL it was given; converting that sentinel would create a plausible-looking
  file:// path that callers read as a success, so only real local paths pass through.
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
