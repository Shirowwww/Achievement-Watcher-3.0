'use strict';

let modulePromise;

module.exports = async (...args) => {
  modulePromise ||= import('powerballoon');
  const { default: balloon } = await modulePromise;
  return balloon(...args);
};
