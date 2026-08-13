'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..', '..');
const skippedDirectories = new Set(['.codex-local', '.git', 'node_modules', 'dist']);

function collectMarkdown(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectMarkdown(full, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) output.push(full);
  }
  return output;
}

function githubAnchors(source) {
  const anchors = new Set();
  const counts = new Map();
  const stripHtmlTags = (value) => {
    let text = '';
    let inTag = false;
    for (const character of value) {
      if (character === '<') inTag = true;
      else if (character === '>') inTag = false;
      else if (!inTag) text += character;
    }
    return text;
  };
  for (const line of source.split(/\r?\n/)) {
    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = stripHtmlTags(match[1])
      .replace(/[`*_~]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

function withoutCode(source) {
  return source
    .replace(/^ {0,3}(```|~~~)[\s\S]*?^ {0,3}\1.*$/gm, '')
    .replace(/`[^`\r\n]*`/g, '');
}

function exactCaseExists(file) {
  const relative = path.relative(repoRoot, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  let current = repoRoot;
  for (const part of relative.split(path.sep)) {
    const entries = fs.readdirSync(current);
    if (!entries.includes(part)) return false;
    current = path.join(current, part);
  }
  return true;
}

test('all relative Markdown links and anchors resolve with exact casing', () => {
  const files = collectMarkdown(repoRoot).sort();
  const errors = [];
  let checked = 0;

  for (const markdown of files) {
    const source = fs.readFileSync(markdown, 'utf8');
    const linkPattern = /!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g;
    let match;
    while ((match = linkPattern.exec(withoutCode(source)))) {
      const raw = match[1].replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) continue;
      const [rawPath, rawFragment = ''] = raw.split('#', 2);
      let decodedPath;
      let fragment;
      try {
        decodedPath = decodeURIComponent(rawPath).replace(/\?.*$/, '');
        fragment = decodeURIComponent(rawFragment);
      } catch {
        errors.push(`${path.relative(repoRoot, markdown)}: malformed link ${raw}`);
        continue;
      }
      const target = decodedPath ? path.resolve(path.dirname(markdown), decodedPath) : markdown;
      checked++;
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        errors.push(`${path.relative(repoRoot, markdown)}: missing ${raw}`);
        continue;
      }
      if (!exactCaseExists(target)) {
        errors.push(`${path.relative(repoRoot, markdown)}: casing mismatch in ${raw}`);
        continue;
      }
      if (fragment && target.toLowerCase().endsWith('.md')) {
        const anchors = githubAnchors(fs.readFileSync(target, 'utf8'));
        if (!anchors.has(fragment.toLowerCase())) {
          errors.push(`${path.relative(repoRoot, markdown)}: missing anchor #${fragment} in ${path.relative(repoRoot, target)}`);
        }
      }
    }
  }

  assert.ok(files.length >= 20, 'the documentation scan must cover the repository Markdown set');
  assert.ok(checked >= 50, 'the documentation scan must exercise a meaningful number of local links');
  assert.deepStrictEqual(errors, []);
});
