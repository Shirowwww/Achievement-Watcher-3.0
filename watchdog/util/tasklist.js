'use strict';

let modulePromise;

async function list() {
  modulePromise ||= import('win-tasklist');
  const { default: tasklist } = await modulePromise;
  return tasklist();
}

async function isProcessRunning(...args) {
  modulePromise ||= import('win-tasklist');
  const { isProcessRunning: check } = await modulePromise;
  return check(...args);
}

module.exports = { list, isProcessRunning };
