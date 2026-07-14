'use strict';

/*
  Minimal INI section editor, originally written for GBE Fork's configs.*.ini and reused by the
  Uplay R2 emulator's uplay_r2.ini. It preserves everything it doesn't explicitly touch — unknown
  sections, comments, blank lines and key order — so merging AW's settings into a config a cracker
  already shipped never clobbers their other keys. A full INI library would reorder/strip comments;
  both emulators' parsers are line-based and section-scoped, so a line-faithful editor is both safer
  and simpler here.

  Not to be confused with app/util/ini.js, which wraps the `ini` npm package for AW's own
  options.ini settings file — a different format/purpose entirely.

  A "doc" is { preamble: [lines before the first [section]], sections: [{ key, header, body: [lines] }] }.
  `key` is the lower-cased section name (e.g. "app::dlcs" or "settings"); `header` is the original
  "[…]" line.
*/

function parseIni(text) {
  const doc = { preamble: [], sections: [] };
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (m) {
      current = { key: m[1].trim().toLowerCase(), header: line.trim(), body: [] };
      doc.sections.push(current);
    } else if (current) {
      current.body.push(line);
    } else {
      doc.preamble.push(line);
    }
  }
  return doc;
}

function stringifyIni(doc) {
  const blocks = [];
  const pre = doc.preamble.join('\n').replace(/\s+$/, '');
  if (pre) blocks.push(pre);
  for (const s of doc.sections) {
    const body = s.body.join('\n').replace(/\s+$/, '');
    blocks.push(body ? `${s.header}\n${body}` : s.header);
  }
  return blocks.join('\n\n') + '\n';
}

function getIniSection(doc, name) {
  return doc.sections.find((s) => s.key === name.toLowerCase());
}

function upsertIniSection(doc, name, body) {
  const existing = getIniSection(doc, name);
  if (existing) existing.body = body;
  else doc.sections.push({ key: name.toLowerCase(), header: `[${name}]`, body });
  return doc;
}

// Update existing `key=value` lines in place (preserving their indentation, comments and order) and
// append any keys that weren't present. `updates` keys are matched case-insensitively.
function upsertIniKeys(body, updates) {
  const remaining = new Map(Object.entries(updates).map(([k, v]) => [k.toLowerCase(), v]));
  const out = body.map((line) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
    if (m && remaining.has(m[2].toLowerCase())) {
      const key = m[2].toLowerCase();
      const value = remaining.get(key);
      remaining.delete(key);
      return `${m[1]}${m[2]}${m[3]}${value}`;
    }
    return line;
  });
  if (remaining.size > 0) {
    // Append new keys after the last real line so they stay inside the section block (no stray blank
    // line splitting the section when the source ended with a trailing newline).
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }
  return out;
}

// INI values can't span lines and both emulators split on the first '='; strip CR/LF so a stray
// newline in a fetched name can't corrupt the file or smuggle in extra keys.
function sanitizeIniValue(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').trim();
}

module.exports = {
  parseIni,
  stringifyIni,
  getIniSection,
  upsertIniSection,
  upsertIniKeys,
  sanitizeIniValue,
};
