'use strict';

const args_split = require('argv-split');

/*
  Split the per-game launch arguments into an argv array. argv-split understands quotes and strips the
  grouping quotes (the old regex kept them, breaking paths); on an unmatched quote it throws, so fall
  back to a plain whitespace split.
*/
function splitLaunchArgs(args, log) {
  const raw = String(args == null ? '' : args).trim();
  if (!raw) return [];
  try {
    return args_split(raw);
  } catch (err) {
    if (typeof log === 'function') {
      log(`[launch] could not parse launch arguments (${(err && err.message) || err}); falling back to a whitespace split`);
    }
    return raw.split(/\s+/);
  }
}

module.exports = { splitLaunchArgs };
