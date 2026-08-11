'use strict';

// Strip HTML tags from untrusted text. A single regex pass can be bypassed by overlapping/nested
// tags that reform a live tag once the match is removed (e.g. "<scri<script>pt>" loses only the
// inner match, leaving "<script>" behind), so this re-applies the pass until the string stops
// changing.
function stripTags(value) {
  let str = String(value ?? '');
  let prev;
  do {
    prev = str;
    str = str.replace(/<\/?[^>]+>/gi, '');
  } while (str !== prev);
  return str;
}

module.exports = { stripTags };
