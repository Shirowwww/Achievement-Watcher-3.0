'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { computeFolderContentVersion } = require('../app/util/contentVersion.js');

(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-content-version-'));
  try {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    fs.mkdirSync(path.join(a, 'sub'), { recursive: true });
    fs.mkdirSync(path.join(b, 'sub'), { recursive: true });

    // identical content produces the same version regardless of creation order
    fs.writeFileSync(path.join(a, 'z.txt'), 'zeta');
    fs.writeFileSync(path.join(a, 'a.txt'), 'alpha');
    fs.writeFileSync(path.join(a, 'sub', 'x.json'), '{"k":1}');
    fs.writeFileSync(path.join(b, 'a.txt'), 'alpha');
    fs.writeFileSync(path.join(b, 'sub', 'x.json'), '{"k":1}');
    fs.writeFileSync(path.join(b, 'z.txt'), 'zeta');

    const va = computeFolderContentVersion(a);
    const vb = computeFolderContentVersion(b);
    assert.match(va, /^content-[0-9a-f]{16}$/);
    assert.equal(va, vb, 'same content must hash identically');

    // stable across repeated runs
    assert.equal(computeFolderContentVersion(a), va);

    // an in-place edit that keeps size identical still changes the version (mtime-proof)
    fs.writeFileSync(path.join(b, 'a.txt'), 'alphA');
    const vEdit = computeFolderContentVersion(b);
    assert.notEqual(vEdit, va);

    // a rename alone changes the version
    fs.writeFileSync(path.join(b, 'a.txt'), 'alpha');
    assert.equal(computeFolderContentVersion(b), va);
    fs.renameSync(path.join(b, 'a.txt'), path.join(b, 'renamed.txt'));
    assert.notEqual(computeFolderContentVersion(b), va);

    // custom prefix flows into the string and the hash
    const vp = computeFolderContentVersion(a, { prefix: 'emusetup' });
    assert.match(vp, /^emusetup-[0-9a-f]{16}$/);
    assert.notEqual(vp.split('-')[1], va.split('-')[1], 'prefix participates in the hash');

    // missing folder is reported, not thrown
    assert.equal(computeFolderContentVersion(path.join(tmp, 'nope')), 'content-missing');
    assert.equal(computeFolderContentVersion('', { prefix: 'x' }), 'x-missing');

    console.log('PASS: contentVersion deterministic folder fingerprint');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})();
