'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const Logger = require('../util/logger');

test('legacy settings dumps are redacted without deleting surrounding diagnostics', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-log-privacy-'));
  const file = path.join(dir, 'notification.log');
  try {
    const source = [
      '===== session 2026-08-13T08:00:00.000Z pid=123 =====',
      '[2026-08-13T08:00:00.001Z INFO] Loading Options ...',
      "[2026-08-13T08:00:00.002Z INFO] [Object: null prototype] { steam: { apiKey: 'legacy-secret' },",
      "  emulator: { loginPassword: 'encrypted-password' }, account: 'identifier' }",
      '[2026-08-13T08:00:00.003Z INFO] Watchdog started',
      "[2026-08-13T08:00:00.004Z INFO] { harmless: 'structured diagnostic' }",
      '[2026-08-13T08:00:00.005Z INFO] Ready',
      '',
    ].join('\n');
    fs.writeFileSync(file, source);
    const originalSize = fs.statSync(file).size;

    assert.strictEqual(Logger.redactLegacySettingsDumps(file), 1);
    const redacted = fs.readFileSync(file, 'utf8');
    assert.strictEqual(fs.statSync(file).size, originalSize, 'in-place redaction must preserve file length');
    assert.doesNotMatch(redacted, /legacy-secret|encrypted-password|identifier|loginPassword|apiKey/);
    assert.match(redacted, /legacy settings dump redacted/);
    assert.match(redacted, /Loading Options/);
    assert.match(redacted, /Watchdog started/);
    assert.match(redacted, /harmless: 'structured diagnostic'/);
    assert.match(redacted, /Ready/);
    assert.strictEqual(Logger.redactLegacySettingsDumps(file), 0, 'redaction must be idempotent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
