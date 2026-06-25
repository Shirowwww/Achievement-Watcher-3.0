'use strict';

// Standalone test runner. Run with: node watchdog/test/shadps4Watch.test.js
// Verifies the dependency-free ShadPS4 TROP*.XML reader (schema + unlock state) used for live toasts.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const shadps4Watch = require('../console/shadps4Watch.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok   - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`  FAIL - ${name}\n         ${e.stack || e.message || e}`);
    process.exitCode = 1;
  }
}

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<trophyconf>
  <title-name>Demo &amp; Co</title-name>
  <trophy id="0" hidden="no" ttype="P"><name>Platinum</name><detail>Get all</detail></trophy>
  <trophy id="1" hidden="no" ttype="G" unlockstate="true" timestamp="1700000000"><name>Gold One</name><detail>Do the gold thing</detail></trophy>
  <trophy id="2" hidden="yes" ttype="B"><name>Secret</name><detail>hidden detail</detail></trophy>
</trophyconf>`;

function makeTarget() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-shadwatch-'));
  const xmlDir = path.join(root, 'Xml');
  const iconsDir = path.join(root, 'Icons');
  fs.mkdirSync(xmlDir, { recursive: true });
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.writeFileSync(path.join(xmlDir, 'TROP.XML'), XML, 'utf8');
  return { appid: 'CUSA00001', xmlDir, iconsDir };
}

test('parseXml decodes title (entities) and every trophy', () => {
  const parsed = shadps4Watch._internal.parseXml(XML);
  assert.strictEqual(parsed.title, 'Demo & Co');
  assert.strictEqual(parsed.trophies.length, 3);
});

test('read builds the schema with types, hidden flag, and icon paths', () => {
  const data = shadps4Watch._internal.read(makeTarget(), 'english');
  assert.strictEqual(data.name, 'Demo & Co');
  assert.strictEqual(data.list.length, 3);
  const byId = Object.fromEntries(data.list.map((t) => [t.id, t]));
  assert.strictEqual(byId[0].type, 'P');
  assert.strictEqual(byId[2].hidden, 1);
  assert.ok(byId[0].icon.endsWith(path.join('Icons', 'TROP000.PNG')));
});

test('read reflects unlockstate + timestamp from the XML', () => {
  const data = shadps4Watch._internal.read(makeTarget(), 'english');
  const gold = data.list.find((t) => t.id === 1);
  assert.strictEqual(gold.achieved, true);
  assert.strictEqual(gold.time, 1700000000);
  const platinum = data.list.find((t) => t.id === 0);
  assert.strictEqual(platinum.achieved, false);
});

console.log(`\n${passed} passed`);
