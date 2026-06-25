'use strict';

// Standalone unit test for the installed-state classifier.
// Run: node test/installState.test.js

const path = require('path');
const { isInstalled } = require(path.join(__dirname, '..', 'app', 'parser', 'installState.js'));

const cases = [
  // [label, input, expected]
  ['legit Steam (steamAPI)', { dataType: 'steamAPI' }, true],
  ['RPCS3 emulator', { dataType: 'rpcs3' }, true],
  ['ShadPS4 trophy residue, no game => phantom', { dataType: 'shadps4' }, false],
  ['ShadPS4 configured game with disk proof', { dataType: 'shadps4', trustedInstalled: true }, true],
  // gog/epic parsers scan Nemirtingas EMULATOR saves, not real launchers -> need disk proof.
  ['GOG emu save, no proof => phantom', { dataType: 'file', source: 'gog' }, false],
  ['Epic emu save, no proof => phantom', { dataType: 'file', source: 'epic' }, false],
  ['GOG emu save + resolved exe', { dataType: 'file', source: 'gog', hasResolvedExe: true }, true],
  // Uplay legit lists OWNED games; installed only when the Ubisoft Installs registry confirms it.
  ['Uplay owned, not in Installs registry => phantom', { dataType: 'uplay', trustedInstalled: false }, false],
  ['Uplay installed (registry-confirmed)', { dataType: 'uplay', trustedInstalled: true }, true],
  ['emu save folder + resolved exe', { dataType: 'file', source: 'Goldberg', hasResolvedExe: true }, true],
  ['emu save folder + exeList exe', { dataType: 'file', source: 'Codex', hasExeListExe: true }, true],
  ['emu save folder, no proof => phantom', { dataType: 'file', source: 'Goldberg' }, false],
  ['cache import, no proof => phantom', { dataType: 'cached', source: 'Achievement Watcher : Watchdog' }, false],
  ['cache import but resolved exe', { dataType: 'cached', hasResolvedExe: true }, true],
  ['greenluma reg, no proof => phantom', { dataType: 'reg', source: 'Steam' }, false],
  ['lumaplay, no proof => phantom', { dataType: 'lumaplay', source: 'Lumaplay' }, false],
  ['empty/unknown => phantom', {}, false],
];

let fail = 0;
for (const [label, input, expected] of cases) {
  const got = isInstalled(input);
  const ok = got === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label} -> ${got} (expected ${expected})`);
}

console.log(fail === 0 ? '\nPASS: all installState cases.' : `\n${fail} failure(s).`);
process.exit(fail === 0 ? 0 : 1);
