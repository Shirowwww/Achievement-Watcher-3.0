'use strict';

const args_split = require('argv-split');

/*
  Split the per-game launch arguments the user typed in the game-config panel into an argv array.

  The hand-rolled regex this replaced (/(?:[^\s"]+|"[^"]*")+/g) tokenised on quotes but *kept* them
  in the token. spawn() runs without a shell, so Node re-quotes each element and a game asked for

    -savedir "D:\My Games\Save"

  received the literal quotes as part of the path, and could not find it. argv-split understands the
  same quoting and strips the grouping quotes.

  argv-split throws on an unmatched quote; a typo in the arguments field should not make the game
  unlaunchable, so fall back to a plain whitespace split in that case.
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
