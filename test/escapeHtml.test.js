'use strict';

// Standalone validation of escapeHtml (XSS hardening helper).
// Run: node test/escapeHtml.test.js

const path = require('path');
const assert = require('assert');
const { escapeHtml } = require(path.join(__dirname, '..', 'app', 'util', 'escapeHtml.js'));

assert.strictEqual(escapeHtml('hello world'), 'hello world');
assert.strictEqual(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.strictEqual(escapeHtml('Tom & Jerry'), 'Tom &amp; Jerry');
assert.strictEqual(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
assert.strictEqual(escapeHtml("it's a test"), 'it&#39;s a test');

// Non-string / nullish inputs must never throw (game.name can be null/number, see #54).
assert.strictEqual(escapeHtml(null), '');
assert.strictEqual(escapeHtml(undefined), '');
assert.strictEqual(escapeHtml(42), '42');

// A full payload is fully neutralised (no raw angle brackets or quotes survive).
const payload = '"><script>require("child_process").exec("calc")</script>';
const escaped = escapeHtml(payload);
assert.ok(!/[<>]/.test(escaped), 'angle brackets must be escaped');
assert.ok(!escaped.includes('"'), 'double quotes must be escaped');

console.log('escapeHtml.test.js: all assertions passed');
