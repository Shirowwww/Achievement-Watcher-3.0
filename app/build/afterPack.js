'use strict';

/* Copy the standalone watchdog dependencies and prune unused Windows build artifacts. */

const fs = require('fs');
const path = require('path');

// Size accounting for the build log.
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
  // Return bytes reclaimed; missing paths are fine.
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

  // Copy watchdog/node_modules into the packed output.
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

  // Prune dead weight.
  let saved = 0;

  // Keep only the Chromium locale used by the packaged app.
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

    // Prune non-Windows binaries.
  if (electronPlatformName === 'win32') {
    // Keep koffi's win32 binaries.
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

    // Keep only 7zip-bin's Windows binary.
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

    // Moment's min/ bundle is unused by the watchdog.
    const momentMin = path.join(dest, 'moment', 'min');
    const before = saved;
    saved += rm(momentMin);
    if (saved > before) console.log('[afterPack] Pruned watchdog moment/min');
  }

  console.log(`[afterPack] Total reclaimed: ${MB(saved)}`);
};
