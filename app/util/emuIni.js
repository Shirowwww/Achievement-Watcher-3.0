'use strict';

/*
  Minimal, line-faithful INI section editor (GBE configs.*.ini and uplay_r2.ini): preserves unknown
  sections, comments, blank lines and key order, unlike a full INI library. Not to be confused with
  app/util/ini.js, which wraps the `ini` package for AW's own options.ini. A "doc" is
  { preamble, sections: [{ key, header, body }] }.
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
  // Keep the caller's spelling alongside the lookup key: an appended line must use the emulator's
  // documented casing (`AchKeyPrefix`, not `achkeyprefix`) - Goldberg's Uplay R2 loader compares
  // key names case-sensitively, so a lower-cased append is silently ignored by the emulator.
  const remaining = new Map(Object.entries(updates).map(([k, v]) => [k.toLowerCase(), { name: k, value: v }]));
  const out = body.map((line) => {
    const m = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
    if (m && remaining.has(m[2].toLowerCase())) {
      const key = m[2].toLowerCase();
      const { value } = remaining.get(key);
      remaining.delete(key);
      return `${m[1]}${m[2]}${m[3]}${value}`;
    }
    return line;
  });
  if (remaining.size > 0) {
    // Append new keys after the last real line so they stay inside the section block (no stray blank
    // line splitting the section when the source ended with a trailing newline).
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    for (const { name, value } of remaining.values()) out.push(`${name}=${value}`);
  }
  return out;
}

// Read a section's `key = value` pairs into a plain object (lower-cased keys). Comment lines
// (`;`/`#`) are ignored, so a documented-but-disabled key such as `;Ticket = fake` never reads back
// as a live setting.
function readIniSectionValues(doc, name) {
  const section = getIniSection(doc, name);
  const values = {};
  if (!section) return values;
  for (const line of section.body) {
    if (/^\s*[;#]/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) values[m[1].toLowerCase()] = m[2];
  }
  return values;
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
  readIniSectionValues,
  upsertIniSection,
  upsertIniKeys,
  sanitizeIniValue,
};
