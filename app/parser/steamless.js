'use strict';

/*
  Steam DRM (SteamStub) removal via atom0s/Steamless — the same tool ARMGDDN Autocracker bundles.

  Some cracked games ship an exe still wrapped in Valve's SteamStub DRM; the GBE/Goldberg DLL alone
  won't make them run because the stub phones home before the replaced steam_api is ever loaded.
  Steamless unpacks that stub. This module downloads the official Steamless CLI release once, caches
  it, and runs it on a game exe — producing `<exe>.unpacked.exe`, which we swap in after keeping the
  original as `<exe>.steamstub.bak`. If the exe has no SteamStub, Steamless produces nothing and we
  leave it untouched (a safe no-op).

  Renderer-side (request-zero / node-7z / child_process). Steamless is .NET Framework 4.5.2, which is
  present on every modern Windows, so there's no runtime to install. Windows-only.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const request = require('request-zero');

const RELEASE_API = 'https://api.github.com/repos/atom0s/Steamless/releases/latest';
const RELEASES_PAGE = 'https://github.com/atom0s/Steamless/releases';
const RECHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // Steamless changes rarely — re-check weekly at most
const USER_AGENT = 'Achievement-Watcher';

const noopLog = { log() {}, error() {} };

function resolveUnpackedBinary(binPath) {
  const normalized = String(binPath || '');
  const unpacked = normalized.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  return fs.existsSync(unpacked) ? unpacked : normalized;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

// Find Steamless.CLI.exe inside a cached tag dir (it may sit at the root or one folder deep).
function findCli(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const direct = path.join(dir, 'Steamless.CLI.exe');
  if (fs.existsSync(direct)) return direct;
  let all;
  try {
    all = fs.readdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  const hit = all.find((rel) => path.basename(String(rel)).toLowerCase() === 'steamless.cli.exe');
  return hit ? path.join(dir, hit) : null;
}

function cachedCli(cacheDir, tag) {
  if (!tag) return null;
  const cli = findCli(path.join(cacheDir, tag));
  return cli ? { tag, cli, dir: path.dirname(cli) } : null;
}

async function downloadAndCache(cacheDir, tag, assetUrl, log) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steamless-'));
  try {
    const dl = await request.download(assetUrl, tmpDir);
    if (!dl || !dl.path) throw new Error('download produced no file');

    const Seven = require('node-7z');
    const sevenBin = resolveUnpackedBinary(require('7zip-bin').path7za);
    if (!fs.existsSync(sevenBin)) throw new Error(`7za.exe not found at "${sevenBin}"`);
    const destDir = path.join(cacheDir, tag);
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const stream = Seven.extractFull(dl.path, destDir, { $bin: sevenBin });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const cli = findCli(destDir);
    if (!cli) throw new Error('Steamless.CLI.exe not found in the downloaded archive');
    fs.writeFileSync(path.join(cacheDir, 'latest.txt'), tag);
    fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    return { tag, cli, dir: path.dirname(cli) };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

/*
  Ensure the Steamless CLI is available locally; returns { tag, cli, dir }. Network is hit at most
  once a week; otherwise the cached copy is reused (Steamless is offline after the first download).
*/
async function ensureSteamless({ cacheDir, force = false, log = noopLog } = {}) {
  if (process.platform !== 'win32') throw new Error('Steamless is Windows-only');
  if (!cacheDir) throw new Error('ensureSteamless: cacheDir is required');
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachedTag = readText(path.join(cacheDir, 'latest.txt'));
  const lastCheck = parseInt(readText(path.join(cacheDir, '.last-check')), 10) || 0;
  const fresh = Date.now() - lastCheck < RECHECK_TTL_MS;
  const cached = cachedCli(cacheDir, cachedTag);
  if (cached && fresh && !force) return cached;

  let release;
  try {
    release = await request.getJson(RELEASE_API, { headers: { 'User-Agent': USER_AGENT }, timeout: 30000 });
  } catch (e) {
    if (cached) {
      log.log(`[steamless] GitHub unreachable (${e.message || e}); using cached ${cachedTag}`);
      return cached;
    }
    throw new Error(`Could not reach GitHub to fetch Steamless: ${e.message || e}`);
  }

  const tag = release && release.tag_name ? release.tag_name : null;
  if (!tag) {
    if (cached) return cached;
    throw new Error('GitHub returned no Steamless release tag');
  }
  const haveThis = cachedCli(cacheDir, tag);
  if (haveThis) {
    try {
      fs.writeFileSync(path.join(cacheDir, 'latest.txt'), tag);
      fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    } catch {
      /* marker only */
    }
    return haveThis;
  }

  const assets = (release && Array.isArray(release.assets) ? release.assets : []).filter(
    (a) => a && typeof a.browser_download_url === 'string' && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip')
  );
  const asset = assets.find((a) => a.name.toLowerCase().includes('steamless')) || assets[0];
  if (!asset) {
    if (cached) return cached;
    throw new Error(`No .zip asset in the latest Steamless release. Check ${RELEASES_PAGE}`);
  }
  log.log(`[steamless] downloading Steamless ${tag} (${asset.name})`);
  return downloadAndCache(cacheDir, tag, asset.browser_download_url, log);
}

function runCli(cli, args, cwd, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(cli, args, { cwd, timeout, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/*
  Strip SteamStub DRM from a single executable. Returns
    { stripped, exe, backup, reason, output }
  where `stripped` is true only when Steamless actually unpacked a stub and we swapped the exe in.
  A clean exe (no stub) returns stripped:false with reason 'no-steamstub' and is left untouched.

  steamless     result of ensureSteamless() ({ cli, dir })
  exePath       absolute path to the game executable
  experimental  also pass --realign — realigns the unpacked sections, which improves compatibility on
                heavily-protected/repacked EXEs (Steamless' "experimental" knob isn't exposed on the CLI
                otherwise). Off by default since the plain unpack is enough for most games.
*/
async function stripDrm({ steamless, exePath, experimental = false, log = noopLog } = {}) {
  if (!steamless || !steamless.cli) throw new Error('stripDrm: Steamless CLI is not available');
  if (!exePath || !fs.existsSync(exePath)) throw new Error(`stripDrm: exe not found: ${exePath}`);

  const unpacked = `${exePath}.unpacked.exe`;
  try {
    fs.rmSync(unpacked, { force: true }); // clear any stale output from a previous run
  } catch {
    /* ignore */
  }

  // --quiet trims the log spam; --keepbind preserves the .bind section (safest default — some games
  // misbehave without it). Steamless writes "<exe>.unpacked.exe" next to the input on success.
  const args = ['--quiet', '--keepbind'];
  if (experimental) args.push('--realign');
  args.push(exePath);
  const res = await runCli(steamless.cli, args, steamless.dir);

  if (!fs.existsSync(unpacked) || fs.statSync(unpacked).size === 0) {
    log.log(`[steamless] no SteamStub in ${path.basename(exePath)} (left untouched)`);
    return { stripped: false, exe: exePath, backup: null, reason: 'no-steamstub', output: res.stdout || res.stderr };
  }

  const backup = `${exePath}.steamstub.bak`;
  try {
    if (!fs.existsSync(backup)) fs.copyFileSync(exePath, backup); // one-time: keep the genuine DRM'd original
    fs.copyFileSync(unpacked, exePath);
    fs.rmSync(unpacked, { force: true });
  } catch (e) {
    return { stripped: false, exe: exePath, backup: fs.existsSync(backup) ? backup : null, reason: `swap-failed: ${e.message || e}`, output: res.stdout };
  }
  log.log(`[steamless] removed SteamStub from ${path.basename(exePath)} (original kept as .steamstub.bak)`);
  return { stripped: true, exe: exePath, backup, reason: 'unpacked', output: res.stdout };
}

module.exports = { ensureSteamless, stripDrm };
