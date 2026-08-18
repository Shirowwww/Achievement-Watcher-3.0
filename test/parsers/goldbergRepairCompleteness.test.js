'use strict';

/*
  "The fix did not work": a repair Game Health offers has to be able to clear the warning it was
  offered for. Two cases could not, so pressing the button reported success and left the same yellow
  rows behind on every subsequent report.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const goldberg = require('../../app/parser/goldberg.js');

function tempSettings(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aw-${name}-`));
  const steamSettings = path.join(root, 'steam_settings');
  fs.mkdirSync(steamSettings, { recursive: true });
  return { root, steamSettings };
}

const oneAchievement = (description) => ({ achievement: { list: [{ name: 'A', displayName: 'A', description, hidden: 0 }] } });

/*
  Game Health lists NO_USER_CONFIG / BAD_USER_CONFIG as repairable, but configs.user.ini was written
  only when the app had an account name or a language to stamp into it - which on a default install
  is never.
*/
test('an explicit repair completes configs.user.ini even with no identity to stamp', async () => {
  const { root, steamSettings } = tempSettings('userdefaults');
  try {
    const summary = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: oneAchievement('first'),
      writeDlc: false,
      writeMain: false,
      fillUserDefaults: true,
    });
    assert.ok(summary.user && summary.user.file, 'the repair must write configs.user.ini');
    const ini = fs.readFileSync(path.join(steamSettings, 'configs.user.ini'), 'utf8');
    assert.match(ini, /\[user::general\]/);
    assert.match(ini, /account_name=Player/);
    assert.match(ini, /language=english/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a default completes a setup, it never replaces an identity that was chosen', async () => {
  const { root, steamSettings } = tempSettings('userkeep');
  try {
    fs.writeFileSync(path.join(steamSettings, 'configs.user.ini'), '[user::general]\naccount_name=Shiro\nlanguage=french\n');
    await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: oneAchievement('first'),
      writeDlc: false,
      writeMain: false,
      fillUserDefaults: true,
    });
    const kept = fs.readFileSync(path.join(steamSettings, 'configs.user.ini'), 'utf8');
    assert.match(kept, /account_name=Shiro/);
    assert.match(kept, /language=french/);
    assert.doesNotMatch(kept, /account_name=Player/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('without the flag the silent auto-repair keeps its old, narrower reach', async () => {
  const { root, steamSettings } = tempSettings('userquiet');
  try {
    const quiet = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: oneAchievement('first'),
      writeDlc: false,
      writeMain: false,
    });
    assert.ok(!quiet.user, 'no user config is written when nothing asked for one');
    assert.equal(fs.existsSync(path.join(steamSettings, 'configs.user.ini')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/*
  A generated progress-aware schema is preserved only when rewriting it would not be an improvement.
  Blank entries used to be preserved unconditionally, so the repair offered for BLANK_NAMES /
  BLANK_DESCRIPTIONS wrote nothing at all.
*/
const richSchema = (overrides = {}) =>
  JSON.stringify([
    { name: 'A', description: '', progress: { max_val: 5, value: { operation: 'statvalue', operand1: 'stat' } }, ...overrides },
  ]);

test('a blank description the schema can fill loses to the rewrite', async () => {
  const { root, steamSettings } = tempSettings('richblank');
  try {
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), richSchema());
    const out = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: oneAchievement('a real description'),
      writeDlc: false,
      writeMain: false,
    });
    assert.equal(out.preservedRichSchema, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'))[0].description, 'a real description');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('real progress definitions are never traded for a schema with nothing better to offer', async () => {
  const { root, steamSettings } = tempSettings('richkeep');
  try {
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), richSchema());
    const out = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: oneAchievement(''),
      writeDlc: false,
      writeMain: false,
    });
    assert.equal(out.preservedRichSchema, true);
    assert.ok(JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'))[0].progress);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a blank name is a broken entry whatever the schema says - GBE matches on it', async () => {
  const { root, steamSettings } = tempSettings('richblankname');
  try {
    fs.writeFileSync(path.join(steamSettings, 'achievements.json'), richSchema({ name: '  ', description: 'x' }));
    const out = await goldberg.repair({
      steamSettings,
      appid: '480',
      schema: oneAchievement('x'),
      writeDlc: false,
      writeMain: false,
    });
    assert.equal(out.preservedRichSchema, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(steamSettings, 'achievements.json'), 'utf8'))[0].name, 'A');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
