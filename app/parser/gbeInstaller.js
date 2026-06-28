'use strict';

/*
  Emulator-DLL installer — the runtime "crack" half of the achievement pipeline.

  Downloads the upstream Detanup01/gbe_fork Windows release once (the most actively-maintained
  Goldberg/GBE continuation, whose steam_api tracks Steamworks closely and ships far more often than
  the downstream alex47exe/gse_fork), caches the extracted steam_api.dll (32-bit) and steam_api64.dll
  (64-bit) and the generate_interfaces tools, and drops them into a game's install folder(s) —
  replacing whatever steam_api(64).dll is already there and keeping a one-time .bak of the original.
  Taking the WHOLE runtime from one matched build (rather than mixing forks) is the most compatible,
  least-breakage option. AW applies the emulator standalone (DLL swap) — there is no ColdClient path.

  The achievement-schema generator (generate_emu_config) is deliberately NOT here — it lives in
  genEmuConfig.js and uses alex47exe/gse_fork_tools, the maintained "improved" config tool (Detanup01
  froze their own gbe_fork_tools, shipping it as "..._old"). So: gbe for the emulator runtime, gse for
  the config tooling — best of both.

  Release layout (shared by both forks): steam_api under release/regular/<arch>/, generate_interfaces
  under release/tools/generate_interfaces/. Interface-tool basenames tolerate both gbe ("x86") and gse
  ("x32") spellings, so a future asset reshuffle still resolves.

  This module is renderer-side (it uses request-zero / node-7z / 7zip-bin); the pure, unit-tested
  achievement logic stays in goldberg.js. Nothing here ever throws for a "couldn't reach the network"
  case when a usable cached build already exists — installs degrade gracefully to the cached version.
*/

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const request = require('request-zero');

const RELEASE_API = 'https://api.github.com/repos/Detanup01/gbe_fork/releases/latest';
const RELEASES_PAGE = 'https://github.com/Detanup01/gbe_fork/releases';
const RECHECK_TTL_MS = 24 * 60 * 60 * 1000; // only re-ask GitHub for a newer build once per day
const USER_AGENT = 'Achievement-Watcher'; // GitHub's API 403s requests without a User-Agent

// steam_api.dll = 32-bit, steam_api64.dll = 64-bit. The release archive keeps them under
// release/regular/<arch>/ — "x32" historically, with "x86" tolerated since gbe uses that spelling.
const ARCH = {
  x64: { file: 'steam_api64.dll', dirs: ['x64'] },
  x86: { file: 'steam_api.dll', dirs: ['x86', 'x32'] },
};


// GSE/GBE require steam_interfaces.txt to be generated from the game's ORIGINAL Steam API DLL. Both
// generators are bundled in the same official emu-win-release.7z as the emulator binaries, so cache
// them with the matching build instead of downloading an unrelated helper or guessing interfaces.
const INTERFACE_TOOLS = {
  x86: 'generate_interfaces_x86.exe',
  x64: 'generate_interfaces_x64.exe',
};
const INTERFACE_SOURCE = {
  x86: ['generate_interfaces_x86.exe', 'generate_interfaces_x32.exe'],
};

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

// A cached build is "usable" once at least one of the two arch DLLs is present for that tag.
function cachedDlls(cacheDir, tag) {
  if (!tag) return null;
  const dir = path.join(cacheDir, tag);
  const out = { tag, dir, x64: null, x86: null, interfaces: null };
  for (const key of Object.keys(ARCH)) {
    const p = path.join(dir, ARCH[key].file);
    if (fs.existsSync(p)) out[key] = p;
  }
  out.interfaces = cachedInterfaceTools(cacheDir, tag);
  return out.x64 || out.x86 ? out : null;
}

function cachedInterfaceTools(cacheDir, tag) {
  const dir = path.join(cacheDir, tag, 'tools');
  const out = { dir, x86: null, x64: null };
  for (const [arch, name] of Object.entries(INTERFACE_TOOLS)) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) out[arch] = file;
  }
  return out.x86 || out.x64 ? out : null;
}

// Locate a given arch's DLL inside an extracted release tree. Tries the canonical
// release/regular/<arch>/<file> path first, then a scored recursive search so a future archive
// reshuffle still resolves (preferring a "regular" non-debug build for the right arch).
function findDllInTree(extractDir, archKey) {
  const { file, dirs } = ARCH[archKey];
  for (const d of dirs) {
    const direct = path.join(extractDir, 'release', 'regular', d, file);
    if (fs.existsSync(direct)) return direct;
  }
  let all;
  try {
    all = fs.readdirSync(extractDir, { recursive: true });
  } catch {
    return null;
  }
  const target = file.toLowerCase();
  let best = null;
  let bestScore = -1;
  for (const rel of all) {
    const lower = String(rel).toLowerCase();
    if (path.basename(lower) !== target) continue;
    let score = 0;
    if (lower.includes('regular')) score += 2;
    if (dirs.some((d) => lower.includes(`\\${d}\\`) || lower.includes(`/${d}/`))) score += 1;
    if (lower.includes('debug')) score -= 3;
    if (lower.includes('experimental')) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      best = rel;
    }
  }
  return best ? path.join(extractDir, best) : null;
}

// Case-insensitive recursive lookup of a file by basename inside an extracted tree. `basename` may be
// a single name or an array of candidate names (first match wins) to tolerate fork spelling drift.
// `preferDir`, when given, ranks matches whose path contains that substring first.
function findByBasename(extractDir, basename, preferDir) {
  const targets = (Array.isArray(basename) ? basename : [basename]).map((b) => String(b).toLowerCase());
  if (!Array.isArray(basename) && !preferDir) {
    const direct = path.join(extractDir, basename);
    if (fs.existsSync(direct)) return direct;
  }
  let all;
  try {
    all = fs.readdirSync(extractDir, { recursive: true });
  } catch {
    return null;
  }
  const matches = all.filter((rel) => targets.includes(path.basename(String(rel)).toLowerCase()));
  if (matches.length === 0) return null;
  if (preferDir) {
    const pref = matches.find((rel) => String(rel).toLowerCase().includes(preferDir.toLowerCase()));
    if (pref) return path.join(extractDir, pref);
  }
  return path.join(extractDir, matches[0]);
}

// Download the latest release .7z and extract both arch DLLs into cacheDir/<tag>/. Returns the same
// shape as cachedDlls(). Throws only on a genuine failure with no cached fallback available.
async function downloadAndCache(cacheDir, tag, assetUrl, log) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gbe-'));
  try {
    const dl = await request.download(assetUrl, tmpDir);
    if (!dl || !dl.path) throw new Error('download produced no file');

    const Seven = require('node-7z');
    const sevenBin = resolveUnpackedBinary(require('7zip-bin').path7za);
    if (!fs.existsSync(sevenBin)) throw new Error(`7za.exe not found at "${sevenBin}"`);
    const extractDir = path.join(tmpDir, 'extracted');
    await new Promise((resolve, reject) => {
      const stream = Seven.extractFull(dl.path, extractDir, { $bin: sevenBin });
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const destDir = path.join(cacheDir, tag);
    fs.mkdirSync(destDir, { recursive: true });
    let found = 0;
    for (const key of Object.keys(ARCH)) {
      const src = findDllInTree(extractDir, key);
      if (src) {
        const buf = fs.readFileSync(src);
        if (buf && buf.length > 0) {
          fs.writeFileSync(path.join(destDir, ARCH[key].file), buf);
          found++;
        }
      } else {
        log.log(`[gbe] ${ARCH[key].file} not found in ${tag} archive`);
      }
    }
    if (found === 0) throw new Error('no steam_api DLL found in the downloaded archive');

    // Cache the exact generate_interfaces tools shipped with this emulator build. They must stay
    // version-coupled to the DLLs because interface support changes along with the fork.
    const toolsDir = path.join(destDir, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    for (const [arch, name] of Object.entries(INTERFACE_TOOLS)) {
      const src = findByBasename(extractDir, INTERFACE_SOURCE[arch] || name);
      if (src) fs.copyFileSync(src, path.join(toolsDir, name));
      else log.log(`[gbe] ${name} not found in ${tag} archive`);
    }

    fs.writeFileSync(path.join(cacheDir, 'latest.txt'), tag);
    fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    return cachedDlls(cacheDir, tag);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* temp cleanup is best-effort */
    }
  }
}

// Generate steam_settings/steam_interfaces.txt from the original game DLL. When AW has already
// replaced the DLL, its one-time .bak remains the authoritative original and is preferred. The tool
// works in a private temp directory so it never drops files beside the game unexpectedly.
async function generateInterfaces({ dllPath, steamSettings, dlls, log = noopLog } = {}) {
  if (!dllPath) return { generated: false, reason: 'missing-dll' };
  if (!steamSettings) throw new Error('generateInterfaces: steamSettings path is required');
  const isBackupPath = /\.bak$/i.test(dllPath);
  const original = isBackupPath ? dllPath : fs.existsSync(`${dllPath}.bak`) ? `${dllPath}.bak` : dllPath;
  if (!fs.existsSync(original)) return { generated: false, reason: 'missing-dll' };
  const originalName = path.basename(original).replace(/\.bak$/i, '').toLowerCase();
  const arch = originalName === 'steam_api64.dll' ? 'x64' : 'x86';
  const tool = dlls && dlls.interfaces && dlls.interfaces[arch];
  if (!tool || !fs.existsSync(tool)) return { generated: false, reason: `missing-${arch}-tool` };

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-gse-interfaces-'));
  try {
    const localDll = path.join(workDir, ARCH[arch].file);
    fs.copyFileSync(original, localDll);
    const run = await new Promise((resolve, reject) => {
      const child = spawn(tool, [localDll], { cwd: workDir, windowsHide: true, shell: /\.(cmd|bat)$/i.test(tool) });
      let output = '';
      child.stdout.on('data', (d) => { output += d.toString(); });
      child.stderr.on('data', (d) => { output += d.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        resolve({ code, output });
      });
    });
    if (run.code !== 0) {
      const output = String(run.output || '').trim();
      if (/no interfaces were found/i.test(output)) {
        log.log(`[gbe] steam_interfaces.txt skipped: no interfaces found in ${path.basename(original)} (${arch})`);
        return { generated: false, reason: 'no-interfaces', original, arch };
      }
      throw new Error(`generate_interfaces exited with code ${run.code}${output ? `: ${output}` : ''}`);
    }
    const generated = path.join(workDir, 'steam_interfaces.txt');
    if (!fs.existsSync(generated) || fs.statSync(generated).size === 0) {
      log.log(`[gbe] steam_interfaces.txt skipped: generator produced no output for ${path.basename(original)} (${arch})`);
      return { generated: false, reason: 'no-output', original, arch };
    }
    fs.mkdirSync(steamSettings, { recursive: true });
    const dest = path.join(steamSettings, 'steam_interfaces.txt');
    fs.copyFileSync(generated, dest);
    log.log(`[gbe] generated ${dest} from original ${path.basename(original)} (${arch}, ${dlls.tag || 'cached'})`);
    return { generated: true, file: dest, original, arch };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

function matchesCachedDll(file, cacheDir, archKey) {
  if (!file || !cacheDir || !archKey || !ARCH[archKey] || !fs.existsSync(file)) return false;
  const tag = readText(path.join(cacheDir, 'latest.txt'));
  if (!tag) return false;
  const cached = path.join(cacheDir, tag, ARCH[archKey].file);
  if (!fs.existsSync(cached)) return false;
  try {
    const live = fs.readFileSync(file);
    const expected = fs.readFileSync(cached);
    return live.length === expected.length && live.equals(expected);
  } catch {
    return false;
  }
}

const AUXILIARY_DLL_DIRS = new Set([
  '__overlay',
  'overlay',
  '__installer',
  '_commonredist',
  'commonredist',
  'redist',
  'directx',
  'dotnet',
  'vc',
  'vcredist',
  'prerequisites',
  'prereq',
  'support',
  'tools',
]);

function sameDir(a, b) {
  if (!a || !b) return false;
  try {
    return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  } catch {
    return false;
  }
}

function isAuxiliaryDllDir(dir, gameDir) {
  if (!dir) return false;
  let relative;
  try {
    relative = gameDir ? path.relative(gameDir, dir) : dir;
  } catch {
    relative = dir;
  }
  const parts = String(relative || dir)
    .split(/[\\/]+/)
    .map((p) => p.toLowerCase())
    .filter(Boolean);
  return parts.some((p) => AUXILIARY_DLL_DIRS.has(p));
}

function runtimeDllDirs({ gameDir, dllPaths = [], exePath = null, steamSettings = null, fallbackDir = null } = {}) {
  const exeDir = exePath ? path.dirname(exePath) : null;
  const settingsDir = steamSettings && path.basename(steamSettings).toLowerCase() === 'steam_settings' ? path.dirname(steamSettings) : null;
  const preferred = [exeDir, settingsDir].filter(Boolean);
  const out = [];
  const add = (dir) => {
    if (!dir) return;
    const key = path.resolve(dir).toLowerCase();
    if (!out.some((d) => path.resolve(d).toLowerCase() === key)) out.push(dir);
  };

  for (const dllPath of dllPaths || []) {
    if (!dllPath || !/^steam_api(64)?\.dll$/i.test(path.basename(dllPath))) continue;
    const dir = path.dirname(dllPath);
    const preferredDir = preferred.some((p) => sameDir(p, dir));
    if (!preferredDir && isAuxiliaryDllDir(dir, gameDir)) continue;
    add(dir);
  }

  if (out.length === 0) {
    add(exeDir);
    add(settingsDir);
    add(fallbackDir || gameDir);
  }
  return out;
}

/*
  Ensure the GBE Fork DLLs are available locally and return { tag, dir, x64, x86, interfaces } (paths
  may be null if a piece is missing from the release). Hits GitHub at most once per day; otherwise
  reuses the cached build, so the per-scan automatic installer is effectively offline after the first
  download.

  cacheDir   where to keep <tag>/steam_api(64).dll + tools/ + latest.txt + .last-check
  force      ignore the daily re-check throttle and ask GitHub now (used by the manual action)
  log        optional @xan105/log-style logger
*/
async function ensureEmulatorDlls({ cacheDir, force = false, log = noopLog } = {}) {
  if (!cacheDir) throw new Error('ensureEmulatorDlls: cacheDir is required');
  fs.mkdirSync(cacheDir, { recursive: true });

  const cachedTag = readText(path.join(cacheDir, 'latest.txt'));
  const lastCheck = parseInt(readText(path.join(cacheDir, '.last-check')), 10) || 0;
  const fresh = Date.now() - lastCheck < RECHECK_TTL_MS;
  const cached = cachedDlls(cacheDir, cachedTag);

  // Reuse the cached build without touching the network when it's recent enough.
  if (cached && cached.interfaces && fresh && !force) return cached;

  // Otherwise ask GitHub for the latest tag; fall back to whatever is cached on any failure.
  let release;
  try {
    release = await request.getJson(RELEASE_API, { headers: { 'User-Agent': USER_AGENT }, timeout: 30000 });
  } catch (e) {
    if (cached) {
      log.log(`[gbe] GitHub unreachable (${e.message || e}); using cached build ${cachedTag}`);
      return cached;
    }
    throw new Error(`Could not reach GitHub to fetch GBE Fork: ${e.message || e}`);
  }

  const tag = release && release.tag_name ? release.tag_name : null;
  if (!tag) {
    if (cached) return cached;
    throw new Error('GitHub returned no release tag for GBE Fork');
  }

  // Already have this exact build cached — just refresh the throttle marker.
  const haveThis = cachedDlls(cacheDir, tag);
  if (haveThis && haveThis.interfaces) {
    try {
      fs.writeFileSync(path.join(cacheDir, 'latest.txt'), tag);
      fs.writeFileSync(path.join(cacheDir, '.last-check'), String(Date.now()));
    } catch {
      /* marker is an optimization only */
    }
    return haveThis;
  }

  // GBE Fork ships .7z assets (debug/release, vs22, migrate_gse variants); prefer the plain Windows
  // release build, loosening the match in case asset names drift between releases.
  const assets = (release && Array.isArray(release.assets) ? release.assets : []).filter(
    (a) => a && typeof a.browser_download_url === 'string' && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.7z')
  );
  const asset =
    assets.find((a) => a.name.toLowerCase() === 'emu-win-release.7z') ||
    assets.find((a) => {
      const n = a.name.toLowerCase();
      return n.includes('win') && n.includes('release') && !n.includes('debug') && !n.includes('vs22') && !n.includes('migrate');
    }) ||
    assets.find((a) => a.name.toLowerCase().includes('win') && !a.name.toLowerCase().includes('debug'));
  if (!asset) {
    if (cached) {
      log.log(`[gbe] no suitable asset in ${tag}; using cached build ${cachedTag}`);
      return cached;
    }
    throw new Error(`No suitable .7z asset in the latest GBE Fork release. Check ${RELEASES_PAGE}`);
  }

  log.log(`[gbe] downloading GBE Fork ${tag} (${asset.name})`);
  return downloadAndCache(cacheDir, tag, asset.browser_download_url, log);
}

/*
  Install the cached DLLs into one or more directories. In each dir, every emulator DLL already
  present (steam_api.dll and/or steam_api64.dll) is replaced with the matching-arch GBE Fork build,
  backing up the original as <name>.bak the first time only (so the .bak always holds the genuine
  pre-GBE DLL, never a previously-installed GBE one). When a dir has neither DLL and writeIfMissing is
  set ('x64'/'x86'), that arch is written fresh. ensureArch can additionally seed a required arch
  even when the directory already contains only the opposite Steam API DLL.

  dllDirs         array of absolute directory paths
  dlls            result of ensureEmulatorDlls() ({ x64, x86, tag })
  writeIfMissing  arch key to drop into dirs that have no emulator DLL yet (default: none)
  ensureArch      arch key that must exist after install, even if another arch was already present
  log             optional logger

  Returns { installed, backedUp, tag, perDir: [{ dir, wrote: [...], backedUp: [...] }] }.
*/
function installDlls({ dllDirs, dlls, writeIfMissing = null, ensureArch = null, log = noopLog } = {}) {
  if (!dlls || (!dlls.x64 && !dlls.x86)) throw new Error('installDlls: no cached GBE Fork DLLs available');
  const dirs = (Array.isArray(dllDirs) ? dllDirs : [dllDirs]).filter(Boolean);
  if (dirs.length === 0) throw new Error('installDlls: no target directories');

  const buffers = {
    x64: dlls.x64 ? fs.readFileSync(dlls.x64) : null,
    x86: dlls.x86 ? fs.readFileSync(dlls.x86) : null,
  };
  const summary = { installed: 0, backedUp: 0, tag: dlls.tag || null, perDir: [] };

  for (const dir of dirs) {
    const entry = { dir, wrote: [], backedUp: [] };
    fs.mkdirSync(dir, { recursive: true });

    const present = Object.keys(ARCH).filter((key) => fs.existsSync(path.join(dir, ARCH[key].file)));
    const targets = present.length > 0 ? [...present] : writeIfMissing ? [writeIfMissing] : [];
    if (ensureArch && !targets.includes(ensureArch)) targets.push(ensureArch);

    for (const key of targets) {
      const buf = buffers[key];
      if (!buf) continue; // this arch wasn't in the release
      const dest = path.join(dir, ARCH[key].file);
      if (fs.existsSync(dest)) {
        const bak = `${dest}.bak`;
        if (!fs.existsSync(bak)) {
          try {
            fs.copyFileSync(dest, bak);
            entry.backedUp.push(ARCH[key].file);
            summary.backedUp++;
          } catch (e) {
            log.error(`[gbe] could not back up ${dest} => ${e}`);
          }
        }
      }
      fs.writeFileSync(dest, buf);
      entry.wrote.push(ARCH[key].file);
      summary.installed++;
    }
    summary.perDir.push(entry);
  }
  return summary;
}

module.exports = { ensureEmulatorDlls, installDlls, generateInterfaces, matchesCachedDll, runtimeDllDirs, ARCH, INTERFACE_TOOLS };
