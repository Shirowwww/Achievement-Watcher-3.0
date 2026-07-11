'use strict';

const path = require('path');
const debug = new (require('./logger'))({
  console: true,
  file: path.join(process.env['APPDATA'], 'Achievement Watcher/logs/notification.log'),
});

module.exports = debug;
