'use strict';

const os = require('os');

/*
  Set a process's scheduling priority.

  Previously shelled out to `wmic process ... CALL setpriority`, but WMIC is deprecated and
  removed from Windows 11 24H2+, where the call fails. Node's built-in os.setPriority() does
  the same thing with no external process and works on every supported OS/version. The legacy
  WMIC priority words are mapped to the equivalent Node nice values (os.constants.priority).
*/
const niceByLevel = {
  idle: os.constants.priority.PRIORITY_LOW, // 19
  'below normal': os.constants.priority.PRIORITY_BELOW_NORMAL, // 10
  normal: os.constants.priority.PRIORITY_NORMAL, // 0
  'above normal': os.constants.priority.PRIORITY_ABOVE_NORMAL, // -7
  'high priority': os.constants.priority.PRIORITY_HIGH, // -14
  'real time': os.constants.priority.PRIORITY_HIGHEST, // -20
};

module.exports.set = async (level, pid = process.pid) => {
  if (!Object.prototype.hasOwnProperty.call(niceByLevel, level)) throw 'Unknown priority level';
  os.setPriority(pid, niceByLevel[level]);
};
