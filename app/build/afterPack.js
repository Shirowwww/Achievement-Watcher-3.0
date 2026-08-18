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

  // Prune payloads that cannot load on a Windows x64 install.
  //
  // Each rule is listed explicitly so a dependency that changes its on-disk layout shows up as
  // "already absent" in the build log instead of silently reclaiming nothing - which is exactly how
  // the old koffi rule went stale: koffi 3.x moved its prebuilt binaries out of
  // koffi/build/koffi/<platform>/ into the scoped @koromix/koffi-win32-<arch> package, so the rule
  // kept running against a path that no longer existed and reported success for years.
  if (electronPlatformName === 'win32') {
    const unpacked = path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules');
    const targetArch = 'x64'; // win/x64 is the only Windows target this project publishes.

    const rules = [
      // regodit picks its DLL as `regodit.${process.arch}.dll` (lib/util/ffi.js), so only the
      // running architecture's copy is ever opened.
      ...['arm64', 'x86'].map((a) => [`watchdog regodit/${a} DLL`, path.join(dest, 'regodit', 'dist', `regodit.${a}.dll`)]),
      // koffi's prebuilt .node lives in @koromix/koffi-win32-x64, but koffi/src is NOT build-only:
      // koffi/index.cjs is a one-line `require("./src/koffi/index.cjs")`, so pruning src/ leaves the
      // module unloadable and silently kills every koffi consumer - the monitor still starts, and
      // only "[controller] XInput backend missing" in the log gives it away. Prune vendor/ (a
      // node-api-headers tree referenced solely by the cnoke build config) and doc/, never src/.
      ...['vendor', 'doc'].map((d) => [`watchdog koffi/${d}`, path.join(dest, 'koffi', d)]),
      // Moment's pre-minified bundle is never required by the watchdog.
      ['watchdog moment/min', path.join(dest, 'moment', 'min')],
      // 7zip-bin ships every platform and architecture; node-7z resolves one by process.arch.
      ...['mac', 'linux'].map((p) => [`7zip-bin/${p}`, path.join(unpacked, '7zip-bin', p)]),
      ...['ia32', 'arm64'].map((a) => [`7zip-bin/win/${a}`, path.join(unpacked, '7zip-bin', 'win', a)]),
    ];

    for (const [label, target] of rules) {
      const before = saved;
      saved += rm(target);
      const delta = saved - before;
      console.log(delta > 0 ? `[afterPack] Pruned ${label} (${MB(delta)})` : `[afterPack] ${label}: already absent`);
    }

    // Guard the assumptions the rules above are built on. Each of these failures is silent at
    // runtime - the monitor still starts, one capability just stops working - so the build has to
    // be what catches them.
    const mustKeep = [
      // The architecture regodit will actually dlopen.
      path.join(dest, 'regodit', 'dist', `regodit.${targetArch}.dll`),
      // koffi/index.cjs is a one-line require of this file, and it in turn loads the prebuilt .node.
      path.join(dest, 'koffi', 'src', 'koffi', 'index.cjs'),
      path.join(dest, '@koromix', `koffi-win32-${targetArch}`, `win32_${targetArch}`, 'koffi.node'),
      // The 7-Zip build node-7z resolves by process.arch.
      path.join(unpacked, '7zip-bin', 'win', targetArch, '7za.exe'),
    ];
    const missing = mustKeep.filter((file) => !fs.existsSync(file));
    if (missing.length) {
      throw new Error(`[afterPack] pruning removed or missed required runtime file(s):\n  ${missing.join('\n  ')}`);
    }
    console.log(`[afterPack] Verified ${mustKeep.length} required runtime file(s) survived pruning`);
  }

  console.log(`[afterPack] Total reclaimed: ${MB(saved)}`);
};
