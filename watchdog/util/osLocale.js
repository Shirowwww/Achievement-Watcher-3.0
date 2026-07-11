'use strict';

let modulePromise;

module.exports = async (...args) => {
  modulePromise ||= import('os-locale');
  const { default: osLocale } = await modulePromise;
  return osLocale(...args);
};
