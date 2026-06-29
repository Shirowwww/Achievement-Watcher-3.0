'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const crackFix = require(path.join(__dirname, '..', 'app', 'parser', 'crackFix.js'));

// ---- tiny soft-assert harness ------------------------------------------------------------------
// Runs every check (so one failure doesn't hide the rest) and exits non-zero at the end if any failed.
let passed = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) passed++;
  else failures.push(msg);
}
function eq(actual, expected, msg) {
  ok(actual === expected, `${msg} — got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

const tmpDirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

// ---- pixeldrainDirectUrl -----------------------------------------------------------------------
eq(
  crackFix.pixeldrainDirectUrl('https://pixeldrain.com/u/WxSUtWay'),
  'https://pixeldrain.com/api/file/WxSUtWay?download',
  'pixeldrain view link → direct API url'
);
eq(
  crackFix.pixeldrainDirectUrl('http://pixeldrain.com/u/xyz'),
  'https://pixeldrain.com/api/file/xyz?download',
  'http scheme tolerated'
);
eq(
  crackFix.pixeldrainDirectUrl('https://pixeldrain.com/u/abc123/extra/path'),
  'https://pixeldrain.com/api/file/abc123?download',
  'extracts only the file id'
);
eq(crackFix.pixeldrainDirectUrl('https://pixeldrain.com/l/listId'), null, 'list (/l/) links are not auto-applicable');
eq(crackFix.pixeldrainDirectUrl('https://cs.rin.ru/forum/download/file.php?id=170996'), null, 'other hosts → null');
eq(crackFix.pixeldrainDirectUrl(''), null, 'empty string → null');
eq(crackFix.pixeldrainDirectUrl(null), null, 'null → null');
eq(crackFix.pixeldrainDirectUrl(undefined), null, 'undefined → null');

// ---- pixeldrainFileId --------------------------------------------------------------------------
eq(crackFix.pixeldrainFileId('https://pixeldrain.com/u/6yVF7fST'), '6yVF7fST', 'extracts pixeldrain file id');
eq(crackFix.pixeldrainFileId('http://pixeldrain.com/u/abc/extra'), 'abc', 'id only, ignores trailing path');
eq(crackFix.pixeldrainFileId('https://cs.rin.ru/forum/x'), null, 'non-pixeldrain → null');
eq(crackFix.pixeldrainFileId(''), null, 'empty → null');
eq(crackFix.pixeldrainFileId(null), null, 'null → null');

// ---- normalizeProxyBase (pixeldrain proxy list entries → base URL ending in "/") ----------------
eq(crackFix.normalizeProxyBase('cdn.pixeldrain.eu.cc'), 'https://cdn.pixeldrain.eu.cc/', 'bare host → https + trailing slash');
eq(crackFix.normalizeProxyBase('https://cdn.pixeldrain.eu.cc/'), 'https://cdn.pixeldrain.eu.cc/', 'already-normalized passes through');
eq(crackFix.normalizeProxyBase('http://x.example'), 'http://x.example/', 'http scheme preserved, slash added');
eq(crackFix.normalizeProxyBase('  cdn.test  '), 'https://cdn.test/', 'trims whitespace');
eq(crackFix.normalizeProxyBase(''), null, 'empty → null');
eq(crackFix.normalizeProxyBase(null), null, 'null → null');
eq(crackFix.normalizeProxyBase(42), null, 'non-string → null');

// ---- hostOf / isApplicableHost (multi-host support: pixeldrain + buzzheavier auto, rest browser) ---
eq(crackFix.hostOf('https://pixeldrain.com/u/abc'), 'pixeldrain', 'pixeldrain host');
eq(crackFix.hostOf('https://buzzheavier.com/abc123'), 'buzzheavier', 'buzzheavier host');
eq(crackFix.hostOf('https://vikingfile.com/f/xyz'), 'vikingfile', 'vikingfile host');
eq(crackFix.hostOf('https://cs.rin.ru/forum/x'), null, 'unknown host → null');
ok(crackFix.isApplicableHost('https://pixeldrain.com/u/abc'), 'pixeldrain is auto-applicable');
ok(!crackFix.isApplicableHost('https://buzzheavier.com/abc'), 'buzzheavier needs a browser (Cloudflare) — discovery only, not auto-applied');
ok(!crackFix.isApplicableHost('https://vikingfile.com/f/x'), 'vikingfile needs a browser (not auto-applicable)');
ok(!crackFix.isApplicableHost('https://cs.rin.ru/x'), 'cs.rin.ru needs a browser');
// A buzzheavier-only entry has no auto-applicable fix (Cloudflare) — the caller opens the browser.
eq(
  crackFix.pickBestFix(
    { fixes: [{ href: 'https://buzzheavier.com/bz', filename: 'hv.crack.rar', badges: ['Crack'] }] },
    { requireApplicable: true }
  ),
  null,
  'a buzzheavier-only fix is not auto-applicable (browser host)'
);

// ---- findFixes (manual flow: ranked candidates, fuzzy allowed) ----------------------------------
const list = [
  { buildid: '1', name: 'Dead Island 2', fixes: [{ href: 'https://pixeldrain.com/u/aaa', filename: 'di2.rar', badges: ['Crack'] }] },
  { buildid: '2', name: 'Dragon Quest I & II HD-2D Remake', fixes: [{ href: 'https://pixeldrain.com/u/bbb', filename: 'dq.rar' }] },
  { buildid: '3', name: 'Cyberpunk 2077', fixes: [{ href: 'https://pixeldrain.com/u/ccc', filename: 'cp.rar' }] },
];

const m1 = crackFix.findFixes(list, 'Dead Island 2 [FitGirl Repack]');
ok(m1.length > 0 && m1[0].name === 'Dead Island 2', 'repack-suffixed name matches Dead Island 2');
ok(Array.isArray(m1[0].fixes) && m1[0].fixes[0].filename === 'di2.rar', 'carries the fixes array');
ok(typeof m1[0]._score === 'number' && typeof m1[0]._tier === 'string', 'attaches _score/_tier metadata');

const m2 = crackFix.findFixes(list, 'Cyberpunk.2077.v1.6-CODEX');
ok(m2.length > 0 && m2[0].name === 'Cyberpunk 2077', 'scene-tagged name matches Cyberpunk 2077');

eq(crackFix.findFixes(list, 'Totally Unrelated Game Zzz').length, 0, 'no match for an unrelated name');
eq(crackFix.findFixes([], 'anything').length, 0, 'empty list → []');
eq(crackFix.findFixes(list, '').length, 0, 'empty name → []');
eq(crackFix.findFixes(null, 'x').length, 0, 'non-array list → []');

const withNull = [{ name: null, fixes: [] }, { name: 'Cyberpunk 2077', fixes: [{ href: 'https://pixeldrain.com/u/z' }] }];
const fnull = crackFix.findFixes(withNull, 'Cyberpunk 2077');
ok(fnull.length >= 1 && fnull[0].name === 'Cyberpunk 2077', 'null-name entries are skipped, not crashed on');

// ---- findBestMatch (automatic flow: confident only) ---------------------------------------------
ok(crackFix.findBestMatch(list, 'Cyberpunk 2077'), 'exact name is a confident match');
eq(crackFix.findBestMatch(list, 'Cyberpunk 2077').entry.name, 'Cyberpunk 2077', 'returns the matched entry');
ok(crackFix.findBestMatch(list, 'Cyberpunk 2077').tier === 'exact', 'reports the exact tier');
ok(crackFix.findBestMatch(list, 'Dead Island 2 [FitGirl Repack]'), 'repack suffix still confidently matches');
ok(crackFix.findBestMatch(list, 'CYBERPUNK 2077 (GOG)'), 'store-tag + case differences still match');
eq(crackFix.findBestMatch(list, 'Cyberpnuk 2087'), null, 'a typo-only fuzzy hit is NOT confident enough to auto-apply');
eq(crackFix.findBestMatch(list, 'Cyber'), null, 'a bare partial word is not confident');
eq(crackFix.findBestMatch(list, 'Totally Unrelated Game Zzz'), null, 'no confident match for an unrelated name');
eq(crackFix.findBestMatch([], 'Cyberpunk 2077'), null, 'empty list → null');
eq(crackFix.findBestMatch(list, ''), null, 'empty name → null');
eq(crackFix.findBestMatch([{ name: 'No Fix Game', fixes: [] }], 'No Fix Game'), null, 'confident name but no fixes → null');
eq(crackFix.findBestMatch([{ name: 'No Fix Game' }], 'No Fix Game'), null, 'confident name but missing fixes array → null');

const multiName = crackFix.findBestMatchForNames(list, ['Cyber', 'Cyberpunk 2077']);
ok(multiName && multiName.entry.name === 'Cyberpunk 2077', 'multi-name lookup tries later confident candidates');
eq(multiName && multiName.matchedName, 'Cyberpunk 2077', 'multi-name lookup reports the candidate that matched');
eq(crackFix.findBestMatchForNames(list, ['Cyber', 'Totally Unrelated Zzz']), null, 'multi-name lookup still rejects weak candidates');

// ---- pickBestFix --------------------------------------------------------------------------------
const multi = {
  name: 'Some Game',
  fixes: [
    { href: 'https://cs.rin.ru/forum/x', filename: 'browser-only-crack.rar', badges: ['Crack'] }, // needs a browser
    { href: 'https://pixeldrain.com/u/zzz', filename: 'game.update.only.rar', badges: ['Update'] }, // auto-installable, but only an update
    { href: 'https://pixeldrain.com/u/yyy', filename: 'game.x64.crack.rar', badges: ['Crack'] }, // auto-installable + x64 + crack
  ],
};
eq(crackFix.pickBestFix(multi).filename, 'game.x64.crack.rar', 'prefers auto-installable crack over update / browser-only');
eq(crackFix.pickBestFix(multi, { arch: 'x64' }).filename, 'game.x64.crack.rar', 'x64 arch hint keeps the x64 build');
eq(crackFix.pickBestFix(multi, { requireApplicable: true }).filename, 'game.x64.crack.rar', 'requireApplicable excludes the browser-only host');

const archList = {
  fixes: [
    { href: 'https://pixeldrain.com/u/a', filename: 'game.x64.rar' },
    { href: 'https://pixeldrain.com/u/b', filename: 'game.x86.rar' },
  ],
};
eq(crackFix.pickBestFix(archList, { arch: 'x86' }).filename, 'game.x86.rar', 'x86 arch picks the x86 build');
eq(crackFix.pickBestFix(archList, { arch: 'x64' }).filename, 'game.x64.rar', 'x64 arch picks the x64 build');
eq(crackFix.pickBestFix(archList).filename, 'game.x64.rar', 'no arch hint → stable first listed');

const updVsCrack = {
  fixes: [
    { href: 'https://pixeldrain.com/u/a', filename: 'game.update.rar', badges: ['Update'] },
    { href: 'https://pixeldrain.com/u/b', filename: 'game.crack.rar', badges: ['Crack'] },
  ],
};
eq(crackFix.pickBestFix(updVsCrack).filename, 'game.crack.rar', 'a real crack beats a bare update');

const tie = {
  fixes: [
    { href: 'https://pixeldrain.com/u/a', filename: 'first.rar' },
    { href: 'https://pixeldrain.com/u/b', filename: 'second.rar' },
  ],
};
eq(crackFix.pickBestFix(tie).filename, 'first.rar', 'a tie keeps the first listed (list preferred order)');

const noHref = { fixes: [{ filename: 'nohref.rar' }, { href: 'https://pixeldrain.com/u/a', filename: 'good.rar' }] };
eq(crackFix.pickBestFix(noHref).filename, 'good.rar', 'fixes without an href are skipped');

const browserOnly = { name: 'B', fixes: [{ href: 'https://cs.rin.ru/forum/y', filename: 'b.rar' }] };
eq(crackFix.pickBestFix(browserOnly, { requireApplicable: true }), null, 'no applicable fix when every link needs a browser');
eq(crackFix.pickBestFix(browserOnly).filename, 'b.rar', 'without requireApplicable a browser-only fix is still returned (caller can open it)');
eq(crackFix.pickBestFix(null), null, 'null entry → null');
eq(crackFix.pickBestFix({ fixes: [] }), null, 'empty fixes → null');
eq(crackFix.pickBestFix({}), null, 'missing fixes array → null');

// ---- idempotency marker / isAlreadyApplied ------------------------------------------------------
{
  const gd = tmp('aw-crackfix-marker-');
  const fixM = { filename: 'F.rar', href: 'https://pixeldrain.com/u/F' };
  const marker = path.join(gd, '.aw-crackfix-applied.json');
  ok(!crackFix.isAlreadyApplied(gd, fixM), 'no marker → not applied');

  fs.writeFileSync(marker, JSON.stringify({ applied: [{ key: 'other.rar|https://pixeldrain.com/u/other' }] }));
  ok(!crackFix.isAlreadyApplied(gd, fixM), 'a different key → not applied');

  const key = `${fixM.filename.toLowerCase()}|${fixM.href.toLowerCase()}`;
  fs.writeFileSync(marker, JSON.stringify({ applied: [{ key }] }));
  ok(crackFix.isAlreadyApplied(gd, fixM), 'matching key → applied');
  ok(
    crackFix.isAlreadyApplied(gd, { filename: 'F.RAR', href: 'https://PIXELDRAIN.com/u/F' }),
    'key matching is case-insensitive'
  );

  fs.writeFileSync(marker, 'definitely not json {');
  ok(!crackFix.isAlreadyApplied(gd, fixM), 'corrupt marker → not applied (no throw)');

  fs.writeFileSync(marker, JSON.stringify({ nope: true }));
  ok(!crackFix.isAlreadyApplied(gd, fixM), 'marker without an applied[] → not applied');
}

// ---- async: fetchList cache + applyBestFix reason paths -----------------------------------------
(async () => {
  // fetchList returns a FRESH on-disk cache without touching the network (deterministic offline).
  {
    const cd = tmp('aw-crackfix-cache-');
    fs.writeFileSync(path.join(cd, 'crackfiles.json'), JSON.stringify([{ name: 'Cached Game', fixes: [] }]));
    const got = await crackFix.fetchList({ cacheDir: cd });
    ok(Array.isArray(got), 'fetchList returns an array');
    eq(got.length, 1, 'fresh cache is returned without network');
    eq(got[0].name, 'Cached Game', 'cache content is parsed through');
  }

  // applyBestFix — every "did nothing" path returns a structured reason instead of throwing.
  {
    const gameDir = tmp('aw-crackfix-apply-');
    eq((await crackFix.applyBestFix({ list, gameName: '', gameDir })).reason, 'no-game-name', 'missing name → no-game-name');
    eq(
      (await crackFix.applyBestFix({ list, gameName: 'x', gameDir: path.join(gameDir, 'does-not-exist') })).reason,
      'no-game-dir',
      'missing game dir → no-game-dir'
    );
    eq(
      (await crackFix.applyBestFix({ list, gameName: 'Totally Unrelated Zzz', gameDir })).reason,
      'no-confident-match',
      'unrelated name → no-confident-match'
    );
    eq(
      (await crackFix.applyBestFix({ list, gameName: 'Cyberpnuk 2087', gameDir })).reason,
      'no-confident-match',
      'a fuzzy typo is never auto-applied → no-confident-match'
    );

    // A confident match whose only fix needs a browser → no-applicable-fix (caller can surface it).
    const browserList = [{ name: 'Helldivers 2', fixes: [{ href: 'https://cs.rin.ru/forum/z', filename: 'hd2.rar' }] }];
    const r1 = await crackFix.applyBestFix({ list: browserList, gameName: 'Helldivers 2', gameDir });
    eq(r1.reason, 'no-applicable-fix', 'confident match but browser-only link → no-applicable-fix');
    eq(r1.applied, false, 'no-applicable-fix is applied:false');
    ok(r1.entry && r1.entry.name === 'Helldivers 2', 'no-applicable-fix still returns the matched entry');

    // Same path, but driven through the on-disk cache (no `list`, no network).
    const cd2 = tmp('aw-crackfix-apply-cache-');
    fs.writeFileSync(path.join(cd2, 'crackfiles.json'), JSON.stringify(browserList));
    const r1b = await crackFix.applyBestFix({ cacheDir: cd2, gameName: 'Helldivers 2', gameDir });
    eq(r1b.reason, 'no-applicable-fix', 'list is read from cache when not passed in');

    // Idempotency: with the marker already recording this exact fix, applyBestFix skips re-downloading.
    const fix = list[2].fixes[0]; // Cyberpunk 2077 pixeldrain fix
    const key = `${fix.filename.toLowerCase()}|${fix.href.toLowerCase()}`;
    fs.writeFileSync(path.join(gameDir, '.aw-crackfix-applied.json'), JSON.stringify({ applied: [{ key }] }));
    ok(crackFix.isAlreadyApplied(gameDir, fix), 'marker reports the fix as already applied');
    const r2 = await crackFix.applyBestFix({ list, gameName: 'Cyberpunk 2077', gameDir });
    eq(r2.skipped, true, 'already-applied is skipped:true');
    eq(r2.reason, 'already-applied', 'already-applied reason');
    eq(r2.applied, false, 'already-applied is applied:false');
    eq(r2.matchedName, 'Cyberpunk 2077', 'already-applied reports the matched candidate');

    const r3 = await crackFix.applyBestFix({ list, gameName: 'Cyber', gameNames: ['Cyber', 'Cyberpunk 2077'], gameDir });
    eq(r3.reason, 'already-applied', 'applyBestFix can match via alternate local names');
    eq(r3.matchedName, 'Cyberpunk 2077', 'applyBestFix reports alternate matched name');
  }

  // applyLocalArchive — extract a real archive and apply it into the game folder with backup + marker.
  // This is the "I downloaded it myself past the captcha" path. Uses the bundled 7za to build the archive.
  {
    const Seven = require(path.join(__dirname, '..', 'app', 'node_modules', 'node-7z'));
    const sevenBin = require(path.join(__dirname, '..', 'app', 'node_modules', '7zip-bin')).path7za;

    // Build a crack archive: a new file + a nested file that overwrites an existing game file.
    const src = tmp('aw-crackfix-src-');
    fs.writeFileSync(path.join(src, 'steam_api64.dll'), 'CRACKED-DLL');
    fs.mkdirSync(path.join(src, 'steam_settings'), { recursive: true });
    fs.writeFileSync(path.join(src, 'steam_settings', 'configs.app.ini'), 'cfg');
    const archive = path.join(tmp('aw-crackfix-arc-'), 'crack.7z');
    await new Promise((resolve, reject) => {
      const s = Seven.add(archive, path.join(src, '*'), { $bin: sevenBin, recursive: true });
      s.on('end', resolve);
      s.on('error', reject);
    });

    const gameDir = tmp('aw-crackfix-localgame-');
    fs.writeFileSync(path.join(gameDir, 'steam_api64.dll'), 'ORIGINAL-DLL'); // will be backed up + overwritten

    const res = await crackFix.applyLocalArchive({ archivePath: archive, gameDir, entryName: 'Test Game' });
    ok(res.applied.includes('steam_api64.dll'), 'applied the dll from the archive');
    ok(res.applied.some((f) => f.endsWith('configs.app.ini')), 'applied the nested steam_settings file');
    eq(fs.readFileSync(path.join(gameDir, 'steam_api64.dll'), 'utf8'), 'CRACKED-DLL', 'game dll overwritten with cracked one');
    eq(res.backedUp, 1, 'one pre-existing file backed up');
    ok(res.backupDir && fs.existsSync(path.join(res.backupDir, 'steam_api64.dll')), 'original dll saved in the backup dir');
    eq(fs.readFileSync(path.join(res.backupDir, 'steam_api64.dll'), 'utf8'), 'ORIGINAL-DLL', 'backup keeps the original bytes');
    ok(fs.existsSync(path.join(gameDir, '.aw-crackfix-applied.json')), 'idempotency marker written for the local archive');
    const marker = JSON.parse(fs.readFileSync(path.join(gameDir, '.aw-crackfix-applied.json'), 'utf8'));
    ok(marker.applied.some((a) => a.key.includes('crack.7z')), 'marker keyed by the archive file name when no fix object');
  }

  // applyLocalArchive on a RAR — the actual CrakFiles format, which the bundled 7za CANNOT open (so it
  // must go through node-unrar-js). Uses a small committed .rar fixture with a nested folder structure.
  {
    const rarFixture = path.join(__dirname, 'fixtures', 'sample.rar');
    if (fs.existsSync(rarFixture)) {
      const gameDir = tmp('aw-crackfix-rargame-');
      // Pre-place one of the archive's files so we also exercise the backup path.
      fs.mkdirSync(path.join(gameDir, 'Folder1', 'Folder Space'), { recursive: true });
      fs.writeFileSync(path.join(gameDir, 'Folder1', 'Folder Space', 'long.txt'), 'OLD');

      const res = await crackFix.applyLocalArchive({ archivePath: rarFixture, gameDir, entryName: 'Rar Test' });
      ok(res.applied.some((f) => f.endsWith('long.txt')), 'RAR: extracted+applied a nested file (node-unrar-js)');
      ok(fs.existsSync(path.join(gameDir, 'Folder1', 'Folder Space', 'long.txt')), 'RAR: nested file landed in the game dir');
      ok(fs.statSync(path.join(gameDir, 'Folder1', 'Folder Space', 'long.txt')).size > 3, 'RAR: file was actually written from the archive, not the OLD stub');
      eq(res.backedUp, 1, 'RAR: the pre-existing file was backed up');
      ok(res.backupDir && fs.readFileSync(path.join(res.backupDir, 'Folder1', 'Folder Space', 'long.txt'), 'utf8') === 'OLD', 'RAR: backup kept the original bytes');
    } else {
      console.warn('  (skipped RAR test — fixtures/sample.rar missing)');
    }
  }

  // ---- summary ----------------------------------------------------------------------------------
  for (const d of tmpDirs) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {}
  }
  if (failures.length) {
    console.error(`FAIL: ${failures.length} assertion(s) failed (of ${passed + failures.length}):`);
    for (const f of failures) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`PASS: CrakFiles — ${passed} assertions (pixeldrain URL, findFixes, findBestMatch, pickBestFix, marker, fetchList cache, applyBestFix)`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
