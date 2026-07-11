'use strict';

let modulePromise;

async function isProcessRunning(...args) {
  modulePromise ||= import('win-tasklist');
  const { isProcessRunning: check } = await modulePromise;
  return check(...args);
}

module.exports = { isProcessRunning };
