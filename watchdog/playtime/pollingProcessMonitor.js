'use strict';

const { EventEmitter } = require('events');

function normalizeProcess(entry) {
  const pid = Number(entry && entry.pid);
  const process = String(entry && (entry.process || entry.name) || '').trim();
  if (!Number.isInteger(pid) || pid <= 0 || !process) return null;
  return {
    pid,
    process,
    filepath: String(entry.filepath || entry.path || entry.exePath || ''),
  };
}

function indexProcesses(entries, shouldObserve = () => true) {
  const indexed = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const process = normalizeProcess(entry);
    if (process && shouldObserve(process)) indexed.set(process.pid, process);
  }
  return indexed;
}

// The native WQL observer can terminate the whole Node process on some Windows builds. Polling the
// task list is slower but keeps process tracking available and has no native callback lifetime.
function createPollingProcessMonitor({ list, initialProcesses = [], intervalMs = 3000, setIntervalFn = setInterval, clearIntervalFn = clearInterval, onError, shouldObserve = () => true } = {}) {
  if (typeof list !== 'function') throw new TypeError('list must be a function');

  const emitter = new EventEmitter();
  let known = indexProcesses(initialProcesses, shouldObserve);
  let polling = false;
  let closed = false;

  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      const current = indexProcesses(await list(), shouldObserve);
      if (closed) return;

      for (const process of current.values()) {
        if (!known.has(process.pid)) emitter.emit('creation', [process.process, process.pid, process.filepath]);
      }
      for (const process of known.values()) {
        if (!current.has(process.pid)) emitter.emit('deletion', [process.process, process.pid]);
      }
      known = current;
    } catch (err) {
      onError?.(err);
    } finally {
      polling = false;
    }
  }

  const timer = setIntervalFn(poll, intervalMs);
  return Object.assign(emitter, {
    close() {
      if (closed) return;
      closed = true;
      clearIntervalFn(timer);
      emitter.removeAllListeners();
    },
    poll,
  });
}

module.exports = { createPollingProcessMonitor, indexProcesses, normalizeProcess };
