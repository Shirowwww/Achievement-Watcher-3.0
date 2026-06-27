'use strict';

/*
 * electron-builder afterPack hook.
 *
 * The Watchdog monitor is a separate Node.js process shipped alongside the app and run under
 * Electron's own Node via ELECTRON_RUN_AS_NODE (spawned by the Electron main process with an IPC
 * channel; the old portable node.exe and nw.exe launchers are gone). It has its OWN node_modules
 * tree (production deps), which is NOT part of the Electron app's dependency graph.
 *
 * electron-builder's `extraFiles` object form silently drops `node_modules`
 * from the copied tree (it only keeps the app's own production deps), so the
 * packaged watchdog used to crash instantly with "Cannot find module '@xan105/log'"
 * and, because it is spawned with stdio:'ignore', the failure was invisible.
 *
 * This hook (1) deterministically copies watchdog/node_modules into the packed output so the
 * Watchdog can actually start after install, then (2) prunes dead weight that ships but never
 * loads on Windows x64: the ~50 Chromium locale .pak files (the app has its OWN i18n in
 * locale/lang/*.json), and the per-platform native binaries that koffi / 7zip-bin bundle for
 * Linux/macOS/BSD/ARM. None of these are ever require()'d on a Windows build, so removing them
 * changes nothing at runtime — it only shrinks the installer and on-disk footprint by ~80 MB.
 */

const fs = require('fs');
const path = require('path');

// --- size accounting (for the build log only) ---------------------------------
function dirSize(p) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(p, e.name);
    try {
      if (e.isDirectory()) total += dirSize(full);
      else total += fs.statSync(full).size;
    } catch {}
  }
  return total;
}

function rm(target) {
  // Returns bytes reclaimed; tolerant of a path that does not exist.
  if (!fs.existsSync(target)) return 0;
  let size = 0;
  try {
    const st = fs.statSync(target);
    size = st.isDirectory() ? dirSize(target) : st.size;
    fs.rmSync(target, { recursive: true, force: true });
  } catch {}
  return size;
}

const MB = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

exports.default = async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context;

  // --- (1) copy watchdog/node_modules into the packed output (load-bearing) ----
  // projectDir is app; the watchdog lives next to it at ../watchdog.
  const src = path.join(packager.projectDir, '..', 'watchdog', 'node_modules');
  const dest = path.join(appOutDir, 'watchdog', 'node_modules');

  if (!fs.existsSync(src)) {
    throw new Error(
      `[afterPack] watchdog/node_modules not found at ${src}. ` +
        `Run "npm install" in the watchdog folder before building.`
    );
  }

  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });

  const count = fs.readdirSync(dest).length;
  console.log(`[afterPack] Copied watchdog/node_modules (${count} entries) -> ${dest}`);

  // --- (2) prune dead weight ----------------------------------------------------
  let saved = 0;

  // 2a. Chromium UI locales: keep only en-US.pak. These are Chromium's *own* built-in strings
  //     (context menus, form autofill, PDF viewer); the app's UI i18n is locale/lang/*.json,
  //     loaded by app/locale/loader.js and totally independent of these files.
  const KEEP_LOCALES = new Set(['en-US.pak']);
  const localesDir = path.join(appOutDir, 'locales');
  if (fs.existsSync(localesDir)) {
    let removedLocales = 0;
    for (const f of fs.readdirSync(localesDir)) {
      if (f.endsWith('.pak') && !KEEP_LOCALES.has(f)) {
        saved += rm(path.join(localesDir, f));
        removedLocales++;
      }
    }
    console.log(`[afterPack] Pruned ${removedLocales} Chromium locale .pak files (kept en-US)`);
  }

  // Windows-only binary pruning. The app cannot build for any other OS (registry-js, regodit,
  // xinput, WMI…), so this guard is belt-and-suspenders.
  if (electronPlatformName === 'win32') {
    // 2b. koffi ships ~20 platform binaries (build/koffi/<platform>_<arch>/). Only the win32_*
    //     ones can ever load under Electron's Node on Windows. Keep all win32_* (covers x64/ia32/
    //     arm64 — no arch assumption), drop everything else.
    const koffiDir = path.join(dest, 'koffi', 'build', 'koffi');
    if (fs.existsSync(koffiDir)) {
      let removedKoffi = 0;
      for (const d of fs.readdirSync(koffiDir)) {
        if (!d.startsWith('win32')) {
          saved += rm(path.join(koffiDir, d));
          removedKoffi++;
        }
      }
      console.log(`[afterPack] Pruned ${removedKoffi} non-Windows koffi platform binaries`);
    }

    // 2c. 7zip-bin bundles 7za for win/mac/linux. Only win/ is reachable via require('7zip-bin')
    //     on Windows (it resolves path7za by process.platform). Lives in app.asar.unpacked because
    //     it is a native binary (asarUnpack). Drop mac/ + linux/.
    const sevenZipDir = path.join(
      appOutDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      '7zip-bin'
    );
    for (const plat of ['mac', 'linux']) {
      const before = saved;
      saved += rm(path.join(sevenZipDir, plat));
      if (saved > before) console.log(`[afterPack] Pruned 7zip-bin/${plat}`);
    }

    // 2d. moment ships alternative pre-built bundles in min/ (moment.min.js, moment-with-locales.js
    //     …). require('moment') loads moment.js, never min/, so these are dead weight. (Only the
    //     on-disk watchdog copy is reachable here; the app copy is sealed inside app.asar.)
    const momentMin = path.join(dest, 'moment', 'min');
    const before = saved;
    saved += rm(momentMin);
    if (saved > before) console.log('[afterPack] Pruned watchdog moment/min');
  }

  console.log(`[afterPack] Total reclaimed: ${MB(saved)}`);
};
