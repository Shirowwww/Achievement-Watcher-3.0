'use strict';

// User themes (ported from PSerban93/Achievements: "Move Themes code outside the app").
// Any *.css dropped into <userData>\themes appears in Settings > General > Theme. The CSS is
// injected as-is on top of the built-in stylesheet, so it can override variables or any rule.

const fs = require('fs');
const path = require('path');

function themesDir(userDataPath) {
  return path.join(String(userDataPath || ''), 'themes');
}

function listUserThemes(userDataPath) {
  const dir = themesDir(userDataPath);
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => /\.css$/i.test(f))
    .sort((a, b) => String(a).localeCompare(String(b)))
    .map((f) => ({ name: f.replace(/\.css$/i, ''), file: path.join(dir, f) }));
}

function readThemeFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Value stored in options.ini (`user:<name>`) so bundled and user themes share one dropdown.
function valueFor(name) {
  return `user:${String(name || '').trim()}`;
}

// Extract the user-theme name from a stored value; null for built-in themes.
function parseValue(value) {
  const m = /^user:(.+)$/i.exec(String(value || '').trim());
  return m ? m[1].trim() : null;
}

// Inject/remove the user-theme <style> element (renderer only).
function applyCss(css) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('aw-user-theme');
  if (!css) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement('style');
    el.id = 'aw-user-theme';
    document.head.appendChild(el);
  }
  el.textContent = css;
}

module.exports = { themesDir, listUserThemes, readThemeFile, valueFor, parseValue, applyCss };
