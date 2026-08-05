'use strict';

/*
 * Renderer-side translation helper for imperative strings (dialogs, menus,
 * notifications, busy labels).
 *
 * Each call carries an explicit English fallback and, when available, the
 * existing French fallback used by the legacy `fr ? '…' : '…'` ternaries.
 * Once a locale file provides a real translation under `dialogs.<key>`
 * (added to every bundled locale, per locale/README.md), that value wins.
 * Before that, French users keep the French fallback and every other
 * language keeps English — exactly the behaviour of the old ternaries.
 */

function currentLanguage() {
  try {
    const cfg = (typeof window !== 'undefined' && window.app && window.app.config) || null;
    return String((cfg && cfg.achievement && cfg.achievement.lang) || 'english');
  } catch {
    return 'english';
  }
}

function interpolate(value, params) {
  if (!params || typeof params !== 'object') return value;
  return String(value).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}

function resolveFromLocale(key, params) {
  const locale = (typeof window !== 'undefined' && window.appLocale) || null;
  if (!locale || !locale.dialogs) return null;
  let value = locale.dialogs;
  const parts = String(key).split('.');
  for (const part of parts) {
    if (!value || typeof value !== 'object') return null;
    value = value[part];
  }
  if (typeof value === 'string' && value.trim()) return interpolate(value, params);
  return null;
}

function t(key, english, french, params) {
  const fromLocale = resolveFromLocale(key, params);
  if (fromLocale !== null) return fromLocale;

  const lang = currentLanguage().toLowerCase();
  const fallback = lang.startsWith('fr') && french ? french : english;
  return interpolate(fallback || english || key, params);
}

module.exports = { t };
