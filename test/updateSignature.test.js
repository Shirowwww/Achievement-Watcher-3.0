'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { evaluateUpdateSignature } = require('../app/util/updateSignature.js');

test('a Shirow self-signed update is accepted even when Windows does not trust its root', () => {
  assert.equal(
    evaluateUpdateSignature(['Shirow'], {
      Status: 'UnknownError',
      SignerCertificate: { Subject: 'CN=Shirow' },
    }),
    null
  );
});

test('an installer signed by another publisher is rejected', () => {
  assert.match(
    evaluateUpdateSignature(['Shirow'], {
      Status: 'Valid',
      SignerCertificate: { Subject: 'CN=Someone Else' },
    }),
    /not signed by Shirow/
  );
});

test('legacy unsigned updates remain compatible with their SHA-512 manifest', () => {
  assert.equal(evaluateUpdateSignature(['Shirow'], { Status: 'NotSigned' }), null);
});
