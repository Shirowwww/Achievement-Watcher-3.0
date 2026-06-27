'use strict';

/*
  GBE Fork "generate_emu_config" integration — the Advanced (complete) steam_settings path.

  Achievement Watcher's own repair already writes achievements.json + DLCs anonymously (the Simple
  path). For deeper coverage (depots, supported languages, inventory/stats, branches) we shell out to
  alex47exe/gse_fork_tools' generate_emu_config — the canonical config generator — downloaded and
  cached like the other tools. It runs anonymously by default; an optional Steam login pulls data
  Steam doesn't expose anonymously (DLCs of unowned games, depots).

  ⚠ Steam login: credentials are passed via the GSE_CFG_USERNAME/GSE_CFG_PASSWORD env vars the tool
  documents (never written to disk by us, never persisted in AW). Steam Guard 2FA is an interactive
  prompt forwarded to onPrompt(). Use a THROWAWAY account — never your main. A refresh_tokens.json the
  tool writes beside its exe means 2FA is only needed once.

  Renderer-side (request-zero / node-7z / child_process). Windows-only. Verified against the
  generate_emu_config.py CLI: `[-anon] [-skip_con -skip_inv -skip_cld] <appid>`, output under
  <cwd>/output/<name>-<appid>/steam_settings/.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const request = require('request-zero');

const RELEASE_API = 'https://api.github.com/repos/alex47exe/gse_fork_tools/releases/latest';
const RELEASES_PAGE = 'https://github.com/alex47exe/gse_fork_tools/releases';
const RECHECK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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

function findExe(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const direct = path.join(dir, 'generate_emu_config.exe');
  if (fs.existsSync(direct)) return direct;
  let all;
  try {
    all = fs.readdirSync(dir, { recursive: true });
  } catch {
    return null;
  }
  const hit = all.find((rel) => path.basename(String(rel)).toLowerCase() === 'generate_emu_config.exe');
  return hit ? path.join(dir, hit) : null;
}

function cachedTool(cacheDir, tag) {
  if (!tag) return null;
  const exe = findExe(path.join(cacheDir, tag));
  return exe ? { tag, exe, dir: path.dirname(exe) } : null;
}

async function downloadAndCache(cacheDir, tag, assetUrl, log) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-emucfg-dl-'));
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
    const exe = findExe(destDir);
    if (!exe) throw new Error('generate_emu_config.exe not found in the downloaded archive');
    fs.writeFileSync(path.join(cacheDir, 'latest.txt'), tag);
    fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    return { tag, exe, dir: path.dirname(exe) };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
}

// Ensure the generate_emu_config tool is available; returns { tag, exe, dir }. Network at most weekly.
async function ensureGenerateEmuConfig({ cacheDir, force = false, preferredTag = null, log = noopLog } = {}) {
  if (process.platform !== 'win32') throw new Error('generate_emu_config is Windows-only');
  if (!cacheDir) throw new Error('ensureGenerateEmuConfig: cacheDir is required');
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachedTag = readText(path.join(cacheDir, 'latest.txt'));
  const lastCheck = parseInt(readText(path.join(cacheDir, '.last-check')), 10) || 0;
  const fresh = Date.now() - lastCheck < RECHECK_TTL_MS;
  const cached = cachedTool(cacheDir, cachedTag);
  const compatibleCached = preferredTag ? cachedTool(cacheDir, preferredTag) : null;
  if (compatibleCached && !force) return compatibleCached;
  if (cached && fresh && !force && !preferredTag) return cached;

  let release;
  if (preferredTag) {
    try {
      release = await request.getJson(`https://api.github.com/repos/alex47exe/gse_fork_tools/releases/tags/${encodeURIComponent(preferredTag)}`, {
        headers: { 'User-Agent': USER_AGENT },
        timeout: 30000,
      });
    } catch (e) {
      log.log(`[emucfg] no tools release matching emulator ${preferredTag}; falling back to latest (${e.message || e})`);
    }
  }
  try {
    if (!release) release = await request.getJson(RELEASE_API, { headers: { 'User-Agent': USER_AGENT }, timeout: 30000 });
  } catch (e) {
    if (cached) {
      log.log(`[emucfg] GitHub unreachable (${e.message || e}); using cached ${cachedTag}`);
      return cached;
    }
    throw new Error(`Could not reach GitHub to fetch generate_emu_config: ${e.message || e}`);
  }
  const tag = release && release.tag_name ? release.tag_name : null;
  if (!tag) {
    if (cached) return cached;
    throw new Error('GitHub returned no generate_emu_config release tag');
  }
  const haveThis = cachedTool(cacheDir, tag);
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
    (a) => a && typeof a.browser_download_url === 'string' && typeof a.name === 'string' && /\.(7z|zip)$/i.test(a.name)
  );
  const asset =
    assets.find((a) => /generate.*emu.*config/i.test(a.name) && /win/i.test(a.name)) ||
    assets.find((a) => /generate.*emu.*config/i.test(a.name)) ||
    assets.find((a) => /win/i.test(a.name)) ||
    assets[0];
  if (!asset) {
    if (cached) return cached;
    throw new Error(`No suitable archive in the latest gbe_fork_tools release. Check ${RELEASES_PAGE}`);
  }
  log.log(`[emucfg] downloading generate_emu_config ${tag} (${asset.name})${preferredTag === tag ? ' matched to emulator build' : ''}`);
  return downloadAndCache(cacheDir, tag, asset.browser_download_url, log);
}

// Older builds wrote to <cwd>/output/<name-appid>; current GSE tools deliberately write beside the
// executable under <tool>/_OUTPUT/<appid>. Support both layouts instead of reporting a successful
// login/generation as a failure merely because the tool changed its output root.
function findGeneratedSteamSettings(...baseDirs) {
  for (const baseDir of baseDirs.filter(Boolean)) {
    for (const folder of ['output', '_OUTPUT']) {
      const outRoot = path.join(baseDir, folder);
      if (!fs.existsSync(outRoot)) continue;
      for (const entry of fs.readdirSync(outRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const ss = path.join(outRoot, entry.name, 'steam_settings');
        if (fs.existsSync(ss)) return ss;
      }
    }
  }
  return null;
}

/*
  Run generate_emu_config for one appid and return the generated steam_settings folder (under a temp
  work dir the caller can copy from). Anonymous unless `login` is given.

  tool         result of ensureGenerateEmuConfig()
  appid        steam appid
  login        { username, password } | null  (null = anonymous, passes -anon)
  onPrompt     async (question) => answer   — forwards interactive prompts (Steam Guard 2FA, etc.)
  timeout      ms (default 300000)

  Returns { steamSettings, workDir, output }.
*/
async function generate({ tool, appid, login = null, onPrompt, timeout = 300000, log = noopLog } = {}) {
  if (!tool || !tool.exe) throw new Error('generate_emu_config is not available');
  const id = parseInt(appid, 10);
  if (!Number.isInteger(id) || id <= 0) throw new Error('generate: a valid numeric appid is required');

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-emucfg-run-'));
  const toolDir = tool.dir || path.dirname(tool.exe);
  // Current GSE builds reuse _OUTPUT/<appid>. Remove the previous result so success can only be
  // attributed to this invocation, never to stale cached files from an earlier run.
  try {
    fs.rmSync(path.join(toolDir, '_OUTPUT', String(id)), { recursive: true, force: true });
  } catch {
    /* best-effort cache cleanup */
  }
  const args = [];
  if (!login) args.push('-anon');
  else args.push('-tok'); // persist the refresh token beside the tool after Steam Guard succeeds
  // Skip the parts AW doesn't consume — faster and avoids extra Steam calls.
  args.push('-skip_con', '-skip_inv', '-skip_cld', String(id));

  const env = { ...process.env };
  if (login && login.username) env.GSE_CFG_USERNAME = login.username;
  if (login && login.password) env.GSE_CFG_PASSWORD = login.password;

  const output = await new Promise((resolve, reject) => {
    const child = spawn(tool.exe, args, { cwd: workDir, env, windowsHide: true, shell: /\.(cmd|bat)$/i.test(tool.exe) });
    // Unattended runs (no onPrompt — the automatic/bulk emulator fix) must never block on interactive
    // input. Close stdin right away so a tool that prompts (a login question it can't ask here, a
    // "press enter", an unexpected Steam Guard) gets EOF and fails fast instead of hanging the full
    // timeout. Interactive callers pass onPrompt and keep stdin open to answer.
    if (!onPrompt) {
      try { child.stdin.end(); } catch { /* stdin may already be closed */ }
    }
    let buf = '';
    let out = '';
    let lastPrompt = '';
    let promptChain = Promise.resolve();
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      reject(new Error('generate_emu_config timed out'));
    }, timeout);

    // Forward interactive prompts (e.g. the Steam Guard code) to the caller. A "prompt" is a trailing
    // line with no newline that asks for input (ends with ':' or mentions a code/user).
    const maybePrompt = () => {
      if (!onPrompt || !buf) return;
      const tail = buf.split(/\r?\n/).pop().replace(/\x1b\[[0-9;]*m/g, '').trim();
      if (!tail || tail === lastPrompt) return;
      const asksForInput = /[:?]\s*$/.test(tail) && /(code|guard|two.?factor|2fa|captcha|password|username|account|select|try again)/i.test(tail);
      if (!asksForInput) return;
      lastPrompt = tail;
      buf = '';
      promptChain = promptChain.then(async () => {
        try {
          const answer = await onPrompt(tail);
          if (answer != null && child.stdin.writable) child.stdin.write(`${answer}\n`);
          else child.stdin.end();
          lastPrompt = ''; // allow the same question again after an invalid/expired Steam Guard code
        } catch {
          child.stdin.end();
        }
      });
    };

    const consume = (d, isError = false) => {
      const s = d.toString();
      out += s;
      buf += s;
      log.log(`[emucfg${isError ? ':err' : ''}] ${s.trim()}`);
      maybePrompt();
    };
    child.stdout.on('data', (d) => consume(d));
    child.stderr.on('data', (d) => consume(d, true));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`generate_emu_config exited with code ${code}${out.trim() ? `: ${out.trim().slice(-1000)}` : ''}`));
    });
  });

  const steamSettings = findGeneratedSteamSettings(workDir, toolDir);
  if (!steamSettings) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    throw new Error('generate_emu_config produced no steam_settings (login/2FA failed or appid invalid)');
  }
  return { steamSettings, workDir, output };
}

// Copy a generated steam_settings into a game's steam_settings, without clobbering files AW already
// wrote well (achievements.json, configs.app/user.ini). Brings in the extra coverage files (depots.txt,
// supported_languages.txt, branches.json, stats.json, …). Returns the list of files added.
function mergeIntoGame(srcSteamSettings, destSteamSettings, { overwrite = false } = {}) {
  if (!fs.existsSync(srcSteamSettings)) return [];
  fs.mkdirSync(destSteamSettings, { recursive: true });
  const keep = new Set(['achievements.json', 'configs.app.ini', 'configs.user.ini', 'configs.main.ini', 'configs.overlay.ini']);
  const added = [];
  const walk = (relDir) => {
    const from = path.join(srcSteamSettings, relDir);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const rel = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        walk(rel);
      } else {
        const dest = path.join(destSteamSettings, rel);
        if (!overwrite && (fs.existsSync(dest) || keep.has(entry.name.toLowerCase()))) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(srcSteamSettings, rel), dest);
        added.push(rel);
      }
    }
  };
  walk('');
  return added;
}

module.exports = { ensureGenerateEmuConfig, generate, mergeIntoGame, findGeneratedSteamSettings };
