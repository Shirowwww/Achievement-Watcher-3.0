'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isChecksumMismatchError } = require('../../app/util/updateChecksum.js');

test('isChecksumMismatchError recognizes electron-updater checksum failures', () => {
  assert.equal(isChecksumMismatchError({ code: 'ERR_CHECKSUM_MISMATCH', message: 'anything' }), true);
  assert.equal(
    isChecksumMismatchError(new Error('sha512 checksum mismatch, expected AAA, got BBB')),
    true
  );
  assert.equal(isChecksumMismatchError({ message: 'SHA512 Checksum Mismatch detected' }), true);
});

test('isChecksumMismatchError rejects unrelated failures', () => {
  assert.equal(isChecksumMismatchError(new Error('network timeout')), false);
  assert.equal(isChecksumMismatchError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND' }), false);
  assert.equal(isChecksumMismatchError(null), false);
  assert.equal(isChecksumMismatchError(undefined), false);
});

test('isChecksumMismatchError handles a plain string/object without a message', () => {
  assert.equal(isChecksumMismatchError('checksum mismatch'), true);
  assert.equal(isChecksumMismatchError({}), false);
});
