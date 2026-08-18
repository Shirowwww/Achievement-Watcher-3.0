'use strict';

// Defer a module until something actually touches it.
//
// The Watchdog is a resident tray daemon: it can idle for days without ever unlocking an
// achievement, fetching a schema or scraping a page. Requiring the modules those paths need at
// startup costs RSS for the whole session, so they are wrapped here instead. The proxy is callable
// and forwards property access, which covers both `request(url)` and `request.getJson(url)` without
// the call sites having to know they are talking to a stub.
//
// Keep this for genuinely occasional dependencies only - a module used on every poll should be a
// plain require, since the first access pays the full load cost inline.
function lazyRequire(id) {
  let loaded;
  const load = () => (loaded ||= require(id));
  return new Proxy(function lazy() {}, {
    apply: (target, thisArg, args) => Reflect.apply(load(), thisArg, args),
    get: (target, prop) => {
      const value = load()[prop];
      return typeof value === 'function' ? value.bind(load()) : value;
    },
    has: (target, prop) => prop in load(),
  });
}

module.exports = { lazyRequire };
