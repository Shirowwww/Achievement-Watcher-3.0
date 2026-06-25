'use strict';

/*
  Tiny read-only PE (Portable Executable) helpers used by the emulator-fix pipeline:
    - exeArch(exePath)        → 'x64' | 'x86' | null   (COFF machine type)
    - detectSteamStub(exePath)→ true | false           (Valve SteamStub DRM, ".bind" section)

  Both are pure header reads — no execution, no writes. They were previously housed in coldclient.js;
  now that AW applies the emulator standalone (no ColdClient), they live here as a neutral utility
  shared by achievements.js (background auto-fix) and app.js (right-click fix).
*/

const fs = require('fs');

// Read a PE executable's machine type from its COFF header → 'x64' | 'x86' | null. Used to pick the
// matching GBE Fork steam_api DLL architecture. Pure header read, no execution.
function exeArch(exePath) {
  let fd;
  try {
    fd = fs.openSync(exePath, 'r');
    const head = Buffer.alloc(64);
    fs.readSync(fd, head, 0, 64, 0);
    if (head.readUInt16LE(0) !== 0x5a4d) return null; // 'MZ'
    const peOff = head.readUInt32LE(0x3c); // e_lfanew
    const coff = Buffer.alloc(6);
    fs.readSync(fd, coff, 0, 6, peOff);
    if (coff.readUInt32LE(0) !== 0x00004550) return null; // 'PE\0\0'
    const machine = coff.readUInt16LE(4);
    if (machine === 0x8664) return 'x64';
    if (machine === 0x014c) return 'x86';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

// Detect Valve's SteamStub DRM by scanning the PE section table for a ".bind" section (SteamStub's
// tell). Read-only, offline. When present, a plain steam_api DLL swap usually fails because the stub
// runs first — so the caller strips it with Steamless before replacing the DLL. Returns true/false.
function detectSteamStub(exePath) {
  let fd;
  try {
    fd = fs.openSync(exePath, 'r');
    const head = Buffer.alloc(64);
    fs.readSync(fd, head, 0, 64, 0);
    if (head.readUInt16LE(0) !== 0x5a4d) return false; // 'MZ'
    const peOff = head.readUInt32LE(0x3c);
    const coff = Buffer.alloc(24);
    fs.readSync(fd, coff, 0, 24, peOff);
    if (coff.readUInt32LE(0) !== 0x00004550) return false; // 'PE\0\0'
    const numSections = coff.readUInt16LE(6);
    const sizeOptHdr = coff.readUInt16LE(20);
    if (numSections <= 0 || numSections > 96) return false;
    const tableOff = peOff + 24 + sizeOptHdr;
    const table = Buffer.alloc(numSections * 40);
    fs.readSync(fd, table, 0, table.length, tableOff);
    for (let i = 0; i < numSections; i++) {
      const name = table.toString('latin1', i * 40, i * 40 + 8).replace(/\0+$/, '');
      if (name === '.bind') return true;
    }
    return false;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = { exeArch, detectSteamStub };
