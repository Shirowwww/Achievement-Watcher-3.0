'use strict';

/*
  Resolve a Steam AppID from a messy folder/exe/game name by matching it against the Steam app list.

  Inspired by ARMGDDN Autocracker's three-tier search ("exact / token / fuzzy" — typing "cyberpnuk"
  finds "Cyberpunk 2077"), but tuned for safety: the *automatic* path only ever auto-commits a
  high-confidence match (exact, or every cleaned query word present in the store name), because
  writing the wrong AppID into steam_appid.txt corrupts a game's identity. Low-confidence fuzzy hits
  are returned as ranked *candidates* for the user to confirm in the manual flow, never auto-applied.

  Pure + dependency-free so it can be unit-tested without the Steam app list or Electron.
*/

// Scene/repack groups, store/source tags and packaging words that wrap a real title in a folder name.
// Removing them turns "Cyberpunk 2077 [FitGirl Repack]" into "cyberpunk 2077", which then matches the
// store name exactly. Edition words (deluxe/goty/…) are deliberately NOT stripped — they're part of
// many real Steam names, and the token matcher already tolerates them on either side.
const JUNK_TOKENS = new Set([
  'repack', 'fitgirl', 'dodi', 'elamigos', 'kaos', 'codex', 'plaza', 'cpy', 'skidrow', 'reloaded',
  'razor1911', 'razor', 'flt', 'tenoke', 'rune', 'empress', 'hoodlum', 'prophet', 'tinyiso', 'gog',
  'steamrip', 'steam', 'rip', 'gse', 'goldberg', 'gbe', 'crack', 'cracked', 'proper', 'readnfo',
  'repacked', 'incl', 'dlc', 'win', 'win32', 'win64', 'x86', 'x64', 'x32', 'pcdvd', 'pc', 'edition',
]);

// Lower-case, drop bracketed tags + version/build markers, split on separators, drop junk tokens.
// Returns { clean, tokens }. Note: "edition" is junk here only as a trailing packaging word; the core
// title words survive, which is what matching needs.
function cleanGameName(raw) {
  let s = String(raw || '').toLowerCase();
  s = s.replace(/[[({][^\])}]*[\])}]/g, ' '); // [..] (..) {..} tags
  s = s.replace(/\bv?\d+(\.\d+){1,}[a-z]?\b/g, ' '); // dotted versions: v1.2.3 / 1.0.0.0 (before separators are flattened)
  s = s.replace(/\bmulti\d*\b/g, ' ');
  s = s.replace(/[._\-]+/g, ' '); // flatten separators so "update.5" / "update_5" become "update 5"
  s = s.replace(/\b(build|update|hotfix|patch)\s*\d+\b/g, ' ');
  const tokens = s.split(/\s+/).filter((t) => t && !JUNK_TOKENS.has(t));
  return { clean: tokens.join(' ').trim(), tokens };
}

function normAlnum(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}

// Sørensen–Dice coefficient over character bigrams (0..1). Robust to small typos/transpositions and
// cheap to compute.
function diceCoefficient(a, b) {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, c] of A) {
    total += c;
    if (B.has(g)) inter += Math.min(c, B.get(g));
  }
  for (const [, c] of B) total += c;
  return (2 * inter) / total;
}

const lenRatio = (a, b) => (a && b ? Math.min(a, b) / Math.max(a, b) : 0);

// Score a candidate store name against an already-cleaned query. tiers, high → low:
//   exact   normalized-alphanumeric equality (auto-commit safe)
//   token   one side's words are fully contained in the other's (folder has extra repack/edition
//           words, or vice-versa); score scales with how close the lengths are
//   fuzzy   bigram-similar (typos) — only computed when a cheap prefilter says it's worth it
// Returns { score, tier } or { score: 0, tier: null }.
function scoreName(queryClean, queryTokens, queryNorm, longTok, name) {
  const nNorm = normAlnum(name);
  if (!queryNorm || !nNorm) return { score: 0, tier: null };
  if (queryNorm === nNorm) return { score: 1, tier: 'exact' };

  const nameTokens = String(name).toLowerCase().replace(/[._\-]+/g, ' ').split(/\s+/).filter(Boolean);
  const nameJoined = ' ' + nameTokens.join(' ') + ' ';
  const allQueryInName = queryTokens.length > 0 && queryTokens.every((t) => nameJoined.includes(` ${t} `) || nNorm.includes(normAlnum(t)));
  const allNameInQuery = nameTokens.length > 0 && nameTokens.every((t) => queryTokens.includes(t));
  if (allQueryInName || allNameInQuery) {
    return { score: 0.82 + 0.17 * lenRatio(queryNorm.length, nNorm.length), tier: 'token' };
  }

  // Fuzzy is only worth its cost when there's a shared signal (a shared 3-char head, or the longest
  // query word's head appears in the name); skip the dice for the 99% of unrelated titles.
  const share3 = queryNorm.length >= 3 && nNorm.includes(queryNorm.slice(0, 3));
  const shareTok = longTok.length >= 4 && nameJoined.includes(longTok.slice(0, 4));
  if (!share3 && !shareTok) return { score: 0, tier: null };
  const d = diceCoefficient(queryNorm, nNorm);
  return d >= 0.5 ? { score: d, tier: 'fuzzy' } : { score: 0, tier: null };
}

/*
  Rank Steam apps against a (raw) query. `apps` is any iterable of { appid, name }. Returns the top
  matches sorted by score: [{ appid, name, score, tier }].
*/
function rankAppidCandidates(query, apps, { limit = 5, minScore = 0.5 } = {}) {
  const { clean, tokens } = cleanGameName(query);
  const queryNorm = normAlnum(clean);
  if (!queryNorm) return [];
  const longTok = tokens.reduce((a, t) => (t.length > a.length ? t : a), '');

  const results = [];
  for (const app of apps) {
    if (!app || !app.name) continue;
    const { score, tier } = scoreName(clean, tokens, queryNorm, longTok, app.name);
    if (tier && score >= minScore) results.push({ appid: app.appid, name: app.name, score, tier });
  }
  results.sort((a, b) => b.score - a.score || String(a.name).length - String(b.name).length);
  return results.slice(0, limit);
}

// Best high-confidence AppID for automatic use, or null. Only an exact match or a near-length token
// match (every cleaned query word present, lengths close) is trusted — a fuzzy guess is never
// auto-applied, since the AppID gets written to steam_appid.txt.
function bestConfidentAppid(query, apps) {
  const ranked = rankAppidCandidates(query, apps, { limit: 10, minScore: 0.6 });
  const hit = ranked.find((r) => r.tier === 'exact') || ranked.find((r) => r.tier === 'token' && r.score >= 0.9);
  return hit ? hit.appid : null;
}

module.exports = { cleanGameName, normAlnum, diceCoefficient, rankAppidCandidates, bestConfidentAppid };
