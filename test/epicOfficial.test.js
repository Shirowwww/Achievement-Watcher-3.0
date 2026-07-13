'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-epic-official-'));

const epicAuth = require('../app/util/epicAuth.js');
const epicOfficial = require('../app/parser/epicOfficial.js');

(async () => {
  try {
    // ---- epicAuth: encrypted token round-trip
    const token = { access_token: 'AT', refresh_token: 'RT', account_id: 'abcdef0123456789', displayName: 'Tester', expires_in: 3600 };
    const enc = epicAuth.encryptTokens(token, 'passphrase');
    const dec = epicAuth.decryptTokens(enc, 'passphrase');
    assert.equal(dec.access_token, 'AT');
    assert.equal(dec.account_id, 'abcdef0123456789');
    // wrong secret fails closed (throws), never returns garbage
    assert.throws(() => epicAuth.decryptTokens(enc, 'wrong'));

    // ---- epicAuth: config + login URL use the public launcher client by default
    const cfg = epicAuth.getEpicAuthConfig();
    assert.equal(cfg.configured, true);
    assert.equal(cfg.source, 'epic');
    const loginUrl = epicAuth.buildEpicLoginUrl();
    assert.ok(loginUrl.startsWith('https://www.epicgames.com/id/login'), loginUrl);
    const codeUrl = epicAuth.buildEpicAuthCodeUrl();
    assert.ok(codeUrl.includes('/id/api/redirect') && codeUrl.includes('responseType=code'));

    // ---- epicAuth: save/load/status/clear against a sandbox file
    const tokensFile = path.join(tmp, 'epic_tokens.enc');
    await epicAuth.saveEpicTokensEncrypted(tokensFile, token, 'passphrase');
    const status = await epicAuth.getEpicAuthStatus({ tokensFile, tokenSecret: 'passphrase' });
    assert.equal(status.connected, true);
    assert.equal(status.accountId, 'abcdef0123456789');
    assert.equal(status.displayName, 'Tester');
    await epicAuth.clearEpicTokens({ tokensFile });
    assert.equal((await epicAuth.getEpicAuthStatus({ tokensFile, tokenSecret: 'passphrase' })).connected, false);

    // account id validation
    assert.equal(epicAuth.normalizeEpicAccountId('ABCDEF0123456789'), 'ABCDEF0123456789');
    assert.equal(epicAuth.normalizeEpicAccountId('nope!'), '');

    // ---- locale mapping
    assert.equal(epicOfficial._internal.localeFor('french'), 'fr');
    assert.equal(epicOfficial._internal.localeFor('brazilian'), 'pt-BR');
    assert.equal(epicOfficial._internal.localeFor('klingon'), 'en');

    // ---- local manifest discovery from synthetic .item files
    const manifests = path.join(tmp, 'Manifests');
    fs.mkdirSync(manifests, { recursive: true });
    fs.writeFileSync(
      path.join(manifests, 'a.item'),
      JSON.stringify({ DisplayName: 'Rocket League', CatalogNamespace: '9773aa1aa54f4f7b80e44bef04986cea', CatalogItemId: 'CID', AppName: 'Sugar', InstallLocation: tmp, LaunchExecutable: 'RL.exe' })
    );
    fs.writeFileSync(path.join(manifests, 'b.item'), JSON.stringify({ DisplayName: 'No Namespace Game', LaunchExecutable: 'x.exe' }));
    fs.writeFileSync(path.join(manifests, 'ignore.txt'), 'not a manifest');
    const index = epicOfficial._internal.buildEpicLocalInstallIndex(manifests);
    assert.equal(index.length, 2);
    const rl = index.find((e) => e.title === 'Rocket League');
    assert.equal(rl.namespace, '9773aa1aa54f4f7b80e44bef04986cea');
    assert.equal(rl.processName, 'RL.exe');
    assert.equal(rl.executablePath, path.join(tmp, 'RL.exe'));

    console.log('PASS: epicOfficial auth + discovery (offline)');

    // ---- live: public sandbox schema (no auth). Network-gated: warn instead of failing the suite.
    epicOfficial.setUserDataPath(path.join(tmp, 'ud'));
    try {
      const schema = await epicOfficial._internal.resolveSchema('9773aa1aa54f4f7b80e44bef04986cea', 'french');
      if (schema && schema.list.length) {
        assert.ok(schema.list.length > 10, `expected many achievements, got ${schema.list.length}`);
        assert.ok(schema.list.some((a) => a.rarity != null), 'expected rarity on at least one');
        assert.ok(schema.list.every((a) => typeof a.name === 'string'), 'names present');
        console.log(`PASS(live): Epic public schema returned ${schema.list.length} achievements (Rocket League, fr)`);
      } else {
        console.log('SKIP(live): Epic public schema returned nothing (offline or endpoint change)');
      }
    } catch (err) {
      console.log(`SKIP(live): Epic public schema unreachable (${err && err.message ? err.message : err})`);
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
