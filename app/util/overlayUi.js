'use strict';

// Shared helpers for the in-game achievement overlay (app/view/overlay.html).
// The file is loaded both as a CommonJS module (unit tests) and as a plain
// browser script (the overlay window is sandboxed, so it attaches to
// window.OverlayUi instead of using require).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OverlayUi = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HIDDEN_FALLBACK = 'Hidden';
  const NA_FALLBACK = 'N/A';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  // Achievement texts are either plain strings or {language: text} objects.
  // Missing/broken values fall back to the hidden label like the game view.
  function safeLocalizedText(input, lang, hiddenLabel) {
    const fallback = hiddenLabel || HIDDEN_FALLBACK;
    if (!input) return fallback;
    if (typeof input === 'string') return input.trim() || fallback;
    if (typeof input === 'object') {
      return (
        input[lang] ||
        input.english ||
        Object.values(input).find((v) => typeof v === 'string' && v.trim() !== '') ||
        fallback
      );
    }
    return fallback;
  }

  // App locale ids ("french", "brazilian", "schinese", ...) -> BCP-47 tags used
  // by Intl date formatting. Unknown ids fall back to the browser default.
  const BCP47 = {
    english: 'en-US',
    french: 'fr-FR',
    german: 'de-DE',
    spanish: 'es-ES',
    latam: 'es-419',
    italian: 'it-IT',
    portuguese: 'pt-PT',
    brazilian: 'pt-BR',
    czech: 'cs-CZ',
    slovak: 'sk-SK',
    hungarian: 'hu-HU',
    polish: 'pl-PL',
    russian: 'ru-RU',
    ukrainian: 'uk-UA',
    turkish: 'tr-TR',
    thai: 'th-TH',
    japanese: 'ja-JP',
    schinese: 'zh-CN',
  };

  function toBcp47(lang) {
    const id = String(lang || 'english').toLowerCase();
    return BCP47[id] || (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? undefined : 'en-US');
  }

  function formatTimestamp(timestamp, lang, naLabel) {
    if (!timestamp) return naLabel || NA_FALLBACK;
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) return naLabel || NA_FALLBACK;
    try {
      return date.toLocaleString(toBcp47(lang));
    } catch {
      return date.toLocaleString();
    }
  }

  // Normalized progress for an achievement. Progress is only considered real
  // when the schema declares a max AND the achievement is unlocked or already
  // carries a numeric current value (some schemas set MaxProgress=1 for every
  // row, which would otherwise render a misleading "0 / 1").
  function progressInfo(achievement) {
    const a = achievement || {};
    if (!Number.isFinite(Number(a.MaxProgress)) || Number(a.MaxProgress) <= 0) {
      return { hasProgress: false, current: 0, max: 0, percent: 0 };
    }
    const max = Number(a.MaxProgress);
    const raw = Number(a.CurProgress);
    const hasCurrent = Number.isFinite(raw);
    if (!hasCurrent && !a.Achieved) {
      return { hasProgress: false, current: 0, max, percent: 0 };
    }
    const current = a.Achieved ? max : Math.max(0, Math.min(max, hasCurrent ? raw : 0));
    return { hasProgress: true, current, max, percent: max > 0 ? Math.round((current / max) * 100) : 0 };
  }

  // Community rarity when the source provides it (Epic/GOG official schemas,
  // emulator sidecars). Null when unknown — the overlay simply hides it.
  function rarityPercent(achievement) {
    const a = achievement || {};
    const raw =
      a.rarityPercent ??
      a.globalPercent ??
      (a.rarity && typeof a.rarity === 'object' ? a.rarity.percent : a.rarity);
    if (raw === null || raw === undefined || raw === '') return null;
    const value = typeof raw === 'number' ? raw : Number(String(raw).replace(',', '.').trim());
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
  }

  // Single source of truth for the rarity tiers shared by the game window and
  // the in-game overlay. Matches the historical behavior: only achievements with
  // a community unlock rate of 0–10% get a tier — gold <3%, silver <6%, bronze ≤10%.
  function rarityTier(percent) {
    if (percent === null || percent === undefined || percent === '') return null;
    const raw = Number(percent);
    if (!Number.isFinite(raw)) return null;
    const p = Math.round(raw * 10) / 10;
    if (p < 0 || p > 10) return null;
    if (p < 3) return 'gold';
    if (p < 6) return 'silver';
    return 'bronze';
  }

  function sortAchievements(list, sortState, getTitle) {
    const titleOf = typeof getTitle === 'function' ? getTitle : (a) => String((a && a.displayName) || '');
    return (list || []).slice().sort((a, b) => {
      if (sortState && sortState.status) {
        const aStatus = a && a.Achieved ? 1 : 0;
        const bStatus = b && b.Achieved ? 1 : 0;
        if (aStatus !== bStatus) return (aStatus - bStatus) * sortState.status;
      }
      if (sortState && sortState.achievement) {
        const aTitle = titleOf(a).toLowerCase();
        const bTitle = titleOf(b).toLowerCase();
        if (aTitle < bTitle) return -1 * sortState.achievement;
        if (aTitle > bTitle) return 1 * sortState.achievement;
      }
      if (sortState && sortState.rarity) {
        // Missing rarity always sorts last regardless of direction — there is nothing to compare it
        // against, and burying unranked rows at the bottom beats scattering them through the list.
        const aRarity = rarityPercent(a);
        const bRarity = rarityPercent(b);
        if (aRarity === null && bRarity === null) return 0;
        if (aRarity === null) return 1;
        if (bRarity === null) return -1;
        if (aRarity !== bRarity) return (aRarity - bRarity) * sortState.rarity;
      }
      if (sortState && sortState.time) {
        const aTime = a && a.Achieved && Number.isFinite(Number(a.UnlockTime)) ? Number(a.UnlockTime) : null;
        const bTime = b && b.Achieved && Number.isFinite(Number(b.UnlockTime)) ? Number(b.UnlockTime) : null;
        if (aTime === null && bTime === null) return 0;
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        if (aTime !== bTime) return (aTime - bTime) * sortState.time;
      }
      return 0;
    });
  }

  function buildStats(list) {
    const items = Array.isArray(list) ? list : [];
    const total = items.length;
    const unlocked = items.filter((a) => a && a.Achieved).length;
    const progress = items.filter((a) => a && !a.Achieved && progressInfo(a).hasProgress).length;
    return {
      total,
      unlocked,
      locked: total - unlocked,
      progress,
      percent: total > 0 ? Math.round((unlocked / total) * 100) : 0,
    };
  }

  return {
    escapeHtml,
    safeLocalizedText,
    toBcp47,
    formatTimestamp,
    progressInfo,
    rarityPercent,
    rarityTier,
    sortAchievements,
    buildStats,
  };
});
