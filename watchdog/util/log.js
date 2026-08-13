'use strict';

const path = require('path');
const debug = new (require('./logger'))({
  console: true,
  file: path.join(require('./userData.js').userDataDir(), 'logs/notification.log'),
});

module.exports = debug;
