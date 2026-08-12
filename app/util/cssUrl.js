'use strict';

/*
  Build a CSS url(...) token from a path or URL. pathToFileURL() leaves apostrophes/parentheses
  literal, which silently broke both quoting styles; emit one escaped, quoted token instead.
*/
function cssUrl(value) {
  const escaped = String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
  return `url('${escaped}')`;
}

module.exports = { cssUrl };
