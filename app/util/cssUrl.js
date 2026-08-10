'use strict';

/*
  Build a CSS `url(...)` token from a path or URL.

  pathToFileURL() percent-encodes spaces but leaves apostrophes and parentheses literal, and the
  renderer feeds those file URLs straight into background declarations. Both quoting styles used to
  break on perfectly ordinary Windows paths, and the failure is silent — the browser drops the whole
  declaration, so the cover/icon just never appears:

    url('…')   ends early on an apostrophe   -> "Assassin's Creed", %APPDATA% under an account
                                                 named O'Brien, …
    url(…)     ends early on a parenthesis   -> "C:\Program Files (x86)\…"

  Emitting a single escaped, quoted token from one helper covers both cases. Per CSS syntax only the
  backslash and the delimiting quote need escaping inside a quoted string.
*/
function cssUrl(value) {
  const escaped = String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
  return `url('${escaped}')`;
}

module.exports = { cssUrl };
