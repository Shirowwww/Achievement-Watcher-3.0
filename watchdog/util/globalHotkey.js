'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { resolvePowerShell } = require('./powershell.js');

const MODIFIERS = new Map([
  ['alt', 0x0001],
  ['ctrl', 0x0002],
  ['control', 0x0002],
  ['shift', 0x0004],
  ['cmd', 0x0008],
  ['meta', 0x0008],
  ['super', 0x0008],
  ['win', 0x0008],
]);

const NAMED_KEYS = new Map([
  ['backspace', 0x08],
  ['tab', 0x09],
  ['enter', 0x0d],
  ['escape', 0x1b],
  ['esc', 0x1b],
  ['space', 0x20],
  ['pageup', 0x21],
  ['pagedown', 0x22],
  ['end', 0x23],
  ['home', 0x24],
  ['arrowleft', 0x25],
  ['left', 0x25],
  ['arrowup', 0x26],
  ['up', 0x26],
  ['arrowright', 0x27],
  ['right', 0x27],
  ['arrowdown', 0x28],
  ['down', 0x28],
  ['insert', 0x2d],
  ['delete', 0x2e],
  ['+', 0xbb],
  ['=', 0xbb],
  [',', 0xbc],
  ['-', 0xbd],
  ['.', 0xbe],
  ['/', 0xbf],
  ['`', 0xc0],
  ['[', 0xdb],
  ['\\', 0xdc],
  [']', 0xdd],
  ["'", 0xde],
]);

function keyCodeFor(value) {
  const key = String(value || '').trim();
  const lower = key.toLowerCase();
  if (NAMED_KEYS.has(lower)) return NAMED_KEYS.get(lower);
  if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase().charCodeAt(0);
  const fn = /^f([1-9]|1\d|2[0-4])$/i.exec(key);
  return fn ? 0x6f + Number(fn[1]) : null;
}

function parseHotkey(value) {
  const parts = String(value || '')
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  let modifiers = 0;
  let keyCode = null;

  for (const part of parts) {
    const modifier = MODIFIERS.get(part.toLowerCase());
    if (modifier) {
      modifiers |= modifier;
      continue;
    }
    if (keyCode !== null) throw new Error(`Hotkey must contain exactly one non-modifier key: ${value}`);
    keyCode = keyCodeFor(part);
    if (keyCode === null) throw new Error(`Unsupported hotkey key: ${part}`);
  }

  if (keyCode === null) throw new Error(`Hotkey has no non-modifier key: ${value}`);
  // MOD_NOREPEAT prevents a held key from opening and immediately closing the overlay repeatedly.
  return { modifiers: modifiers | 0x4000, keyCode };
}

class GlobalHotkey {
  constructor({ debug } = {}) {
    this.debug = debug || console;
    this.child = null;
    this.registeredValue = null;
  }

  register(value, callback) {
    let parsed;
    try {
      parsed = parseHotkey(value);
    } catch (err) {
      this.debug.error(`[hotkey] ${err.message}`);
      return false;
    }

    if (this.child && this.registeredValue === value) return true;
    this.dispose();

    const script = path.join(__dirname, 'registerHotkey.ps1');
    const child = spawn(
      resolvePowerShell(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Modifiers',
        String(parsed.modifiers),
        '-KeyCode',
        String(parsed.keyCode),
        '-ParentPid',
        String(process.pid),
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    this.child = child;
    this.registeredValue = value;

    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const lines = output.split(/\r?\n/);
      output = lines.pop();
      for (const line of lines) {
        if (line === 'pressed') callback();
        else if (line === 'ready') this.debug.log(`[hotkey] Registered ${value}`);
        else if (line.startsWith('error:')) this.debug.error(`[hotkey] ${line.slice(6)}`);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => this.debug.error(`[hotkey] PowerShell: ${chunk.trim()}`));
    child.on('error', (err) => this.debug.error(`[hotkey] Failed to start helper: ${err.message}`));
    child.on('exit', (code) => {
      if (this.child === child) {
        this.child = null;
        this.registeredValue = null;
      }
      if (code && code !== 0) this.debug.error(`[hotkey] Helper exited with code ${code}`);
    });
    return true;
  }

  dispose() {
    if (this.child) this.child.kill();
    this.child = null;
    this.registeredValue = null;
  }
}

module.exports = GlobalHotkey;
module.exports.parseHotkey = parseHotkey;
