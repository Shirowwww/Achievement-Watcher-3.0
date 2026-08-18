'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// init.js is the Electron main entry (it requires 'electron' on load), so the cache policy is
// asserted on its source and then exercised through a faithful model, as watchdogReload.test.js does.
const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'electron', 'init.js'), 'utf8');

test('a SteamDB launch-metadata miss is remembered, not retried every scan', () => {
  // Field logs showed appid 1913120 relaunching a doomed headless browser on every single rescan
  // because only successes were ever written to disk.
  assert.match(source, /const NEGATIVE_TTL = /, 'misses need their own, shorter TTL');
  assert.match(source, /const rememberMiss = \(\) =>/, 'a miss must be persisted');
  const fetchBody = source.slice(source.indexOf('async function fetchSteamDbLaunch'), source.indexOf("ipcMain.handle('get-steamdb-launch'"));
  assert.match(fetchBody, /SteamDB launch metadata: no usable launch option found`\);\s*\n\s*rememberMiss\(\);/, 'the "no option" path must record the miss');
  assert.match(fetchBody, /SteamDB launch metadata fetch failed[\s\S]{0,80}rememberMiss\(\);/, 'the thrown-error path must record the miss');
});

test('the cache honours a long TTL for hits and a short one for misses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steamdb-cache-'));
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const NEGATIVE_TTL = 6 * 60 * 60 * 1000;

  // Faithful model of the cache-read branch in fetchSteamDbLaunch.
  const readCache = (cacheFile, now) => {
    if (!fs.existsSync(cacheFile)) return 'refetch';
    const age = now - fs.statSync(cacheFile).mtimeMs;
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached && cached.best_process_name) {
      if (age < TTL) return cached;
    } else if (age < NEGATIVE_TTL) {
      return null; // known miss, still fresh -> no browser launch
    }
    return 'refetch';
  };

  const hit = path.join(dir, 'hit.json');
  const miss = path.join(dir, 'miss.json');
  fs.writeFileSync(hit, JSON.stringify({ best_process_name: 'game.exe', process_name: 'game.exe' }));
  fs.writeFileSync(miss, JSON.stringify({ miss: true, at: new Date().toISOString() }));
  // Anchor the clock on each file's own mtime: a filesystem timestamp can land slightly ahead of
  // Date.now(), which would otherwise make the boundary cases flaky under a loaded test run.
  const at = (file, offset) => fs.statSync(file).mtimeMs + offset;

  assert.equal(readCache(hit, at(hit, 0)).best_process_name, 'game.exe', 'a fresh hit is served from disk');
  assert.equal(readCache(miss, at(miss, 0)), null, 'a fresh miss short-circuits without refetching');

  // A miss ages out far sooner than a hit, so a transient outage is retried the same day...
  assert.equal(readCache(miss, at(miss, NEGATIVE_TTL)), 'refetch', 'a stale miss is retried');
  // ...while a good answer is still trusted well past that point.
  assert.notEqual(readCache(hit, at(hit, NEGATIVE_TTL)), 'refetch', 'a hit is not thrown away on the miss TTL');
  assert.equal(readCache(hit, at(hit, TTL)), 'refetch', 'a hit does eventually expire');

  assert.equal(readCache(path.join(dir, 'absent.json'), Date.now()), 'refetch', 'an unknown appid is fetched');
});

test('Steam product info is consulted before any browser is launched', () => {
  const fetchBody = source.slice(source.indexOf('const pending = (async () => {', source.indexOf('async function fetchSteamDbLaunch')), source.indexOf("ipcMain.handle('get-steamdb-launch'"));
  const appInfoAt = fetchBody.indexOf('await launchMetadataFromAppInfo(id)');
  const puppeteerAt = fetchBody.indexOf('await startPuppeteer(');
  assert.ok(appInfoAt !== -1, 'the product-info source must be attempted');
  assert.ok(puppeteerAt !== -1, 'the scrape must remain as the last resort');
  assert.ok(appInfoAt < puppeteerAt, 'product info must be tried BEFORE spending a browser launch');
  assert.match(fetchBody.slice(appInfoAt, puppeteerAt), /return fromAppInfo;/, 'a product-info hit must short-circuit the scrape');
  assert.match(fetchBody.slice(appInfoAt, puppeteerAt), /writeCache\(fromAppInfo\)/, 'and must be cached like any other hit');
});

test('the product-info attempt is bounded so a Steam outage cannot stall a scan', () => {
  // clientLogOn() resolves only on 'loggedOn' - it neither rejects nor times out - and this runs on
  // every library scan, so an unbounded await here would hang the scan instead of falling through.
  assert.match(source, /const STEAM_APPINFO_LAUNCH_TIMEOUT_MS = \d+/, 'the bound must be named');
  const helper = source.slice(source.indexOf('async function launchMetadataFromAppInfo'), source.indexOf('async function fetchSteamDbLaunch'));
  assert.match(helper, /STEAM_APPINFO_LAUNCH_TIMEOUT_MS/, 'and actually applied to the attempt');
  assert.match(helper, /Promise\.race\(/, 'the attempt must race against that bound');
  assert.match(helper, /'timeout' \? null : result/, 'a timeout must fall through, not throw');
  assert.match(helper, /catch \(err\)[\s\S]{0,160}return null;/, 'any failure must fall through to the scrape');
});
