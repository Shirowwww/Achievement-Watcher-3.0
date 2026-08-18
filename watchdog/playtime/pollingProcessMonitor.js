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
// process list keeps process tracking available with no native callback lifetime; the snapshot
// itself is a ToolHelp call (see util/processSnapshot.js), so the poll is cheap enough to run for
// the whole life of the tray daemon.
//
// `resolvePath` is optional and is called only for processes that appeared since the previous poll,
// never for the whole snapshot: the image path costs one OpenProcess per row and only a creation
// event consumes it.
function createPollingProcessMonitor({
  list,
  initialProcesses = [],
  intervalMs = 3000,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  onError,
  shouldObserve = () => true,
  resolvePath = null,
} = {}) {
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
        if (known.has(process.pid)) continue;
        let filepath = process.filepath;
        if (!filepath && typeof resolvePath === 'function') {
          try {
            filepath = resolvePath(process.pid) || '';
          } catch {
            filepath = '';
          }
        }
        emitter.emit('creation', [process.process, process.pid, filepath]);
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
