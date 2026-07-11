'use strict';

const ini = require('ini');

function coerceBooleans(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (Array.isArray(value)) return value.map(coerceBooleans);
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) value[key] = coerceBooleans(value[key]);
  }
  return value;
}

module.exports = {
  parse(input) {
    return coerceBooleans(ini.parse(input));
  },
  stringify: ini.stringify,
};
