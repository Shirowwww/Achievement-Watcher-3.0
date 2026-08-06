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

// Read FileDescription / ProductName from a PE's VS_VERSIONINFO resource. Repacks frequently
// rename the install folder ("Game123", "0xdeadbeef"), so the exe's own metadata is the most
// reliable display name for an unconfigured install. Pure read-only header/resource parsing,
// capped to the resource section; returns '' when there is no usable version string.
function readExeProductName(exePath) {
  let fd;
  try {
    fd = fs.openSync(exePath, 'r');
    const head = Buffer.alloc(64);
    fs.readSync(fd, head, 0, 64, 0);
    if (head.readUInt16LE(0) !== 0x5a4d) return ''; // 'MZ'
    const peOff = head.readUInt32LE(0x3c);
    const coff = Buffer.alloc(24);
    fs.readSync(fd, coff, 0, 24, peOff);
    if (coff.readUInt32LE(0) !== 0x00004550) return ''; // 'PE\0\0'
    const numSections = coff.readUInt16LE(6);
    const sizeOptHdr = coff.readUInt16LE(20);
    if (numSections <= 0 || numSections > 96) return '';

    // Optional header: data directory 2 = resource table (RVA + size).
    const magicBuf = Buffer.alloc(2);
    fs.readSync(fd, magicBuf, 0, 2, peOff + 24);
    const magic = magicBuf.readUInt16LE(0);
    const ddOffset = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1; // PE32+ / PE32
    if (ddOffset < 0) return '';
    const dd = Buffer.alloc(8);
    fs.readSync(fd, dd, 0, 8, peOff + 24 + ddOffset + 2 * 8); // entry index 2
    const rsrcRva = dd.readUInt32LE(0);
    const rsrcSize = dd.readUInt32LE(4);
    if (!rsrcRva || rsrcSize <= 0 || rsrcSize > 16 * 1024 * 1024) return '';

    // Map the resource RVA onto the .rsrc section's file offset.
    const tableOff = peOff + 24 + sizeOptHdr;
    const table = Buffer.alloc(numSections * 40);
    fs.readSync(fd, table, 0, table.length, tableOff);
    let fileOff = -1;
    let avail = 0;
    for (let i = 0; i < numSections; i++) {
      const va = table.readUInt32LE(i * 40 + 12);
      const rawSize = table.readUInt32LE(i * 40 + 16);
      const rawPtr = table.readUInt32LE(i * 40 + 20);
      if (va <= rsrcRva && rsrcRva < va + rawSize) {
        fileOff = rawPtr + (rsrcRva - va);
        avail = Math.min(rawSize - (rsrcRva - va), rsrcSize);
        break;
      }
    }
    if (fileOff < 0 || avail <= 0) return '';

    const res = Buffer.alloc(Math.min(avail, 8 * 1024 * 1024));
    fs.readSync(fd, res, 0, res.length, fileOff);

    // Walk the resource directory: RT_VERSION (16) → id 1 → any language → data entry.
    let leafDataEntry = -1;
    const findLeaf = (dirOff, depth) => {
      if (depth > 2 || dirOff + 16 > res.length) return;
      const numNamed = res.readUInt16LE(dirOff + 12);
      const numId = res.readUInt16LE(dirOff + 14);
      const count = numNamed + numId;
      let base = dirOff + 16;
      for (let i = 0; i < count; i++) {
        if (base + 8 > res.length) return;
        const name = res.readUInt32LE(base);
        const offset = res.readUInt32LE(base + 4);
        const isDir = (offset & 0x80000000) !== 0;
        const target = offset & 0x7fffffff;
        if (name >= 0x80000000) {
          // Named resource entries (icons etc.) — not the version block we are after.
          base += 8;
          continue;
        }
        if (depth < 2) {
          const want = depth === 0 ? 16 : 1; // RT_VERSION type / version id levels
          if ((name & 0xffff) !== want) {
            base += 8;
            continue;
          }
        }
        if (isDir) {
          findLeaf(target, depth + 1);
        } else if (depth === 2) {
          leafDataEntry = target;
          return;
        }
        if (leafDataEntry >= 0) return;
        base += 8;
      }
    };
    findLeaf(0, 0);
    if (leafDataEntry < 0 || leafDataEntry + 8 > res.length) return '';

    const dataRva = res.readUInt32LE(leafDataEntry);
    const dataSize = res.readUInt32LE(leafDataEntry + 4);
    const dataStart = dataRva - rsrcRva;
    if (dataStart < 0 || dataStart + 6 > res.length || dataSize <= 0) return '';
    const dataEnd = Math.min(res.length, dataStart + dataSize);

    // VS_VERSIONINFO root: wLength, wValueLength, wType, "VS_VERSION_INFO", pad, fixed info.
    let pos = dataStart;
    const blockKey = (p) => {
      if (p + 6 > dataEnd) return null;
      const wValueLength = res.readUInt16LE(p + 2);
      let keyEnd = p + 6;
      while (keyEnd + 1 < dataEnd) {
        if (res.readUInt16LE(keyEnd) === 0) {
          keyEnd += 2;
          break;
        }
        keyEnd += 2;
      }
      return { wValueLength, valuePos: (keyEnd + 3) & ~3 };
    };
    const root = blockKey(pos);
    if (!root) return '';
    let childPos = root.valuePos + 52; // VS_FIXEDFILEINFO
    childPos = (childPos + 3) & ~3;

    const readString = (p, maxEnd) => {
      let end = p;
      while (end + 1 < maxEnd) {
        if (res.readUInt16LE(end) === 0) break;
        end += 2;
      }
      return res.toString('utf16le', p, end);
    };

    let found = '';
    const scanBlocks = (blockPos, blockEnd) => {
      while (blockPos + 6 <= blockEnd) {
        const wLength = res.readUInt16LE(blockPos);
        if (wLength < 6 || blockPos + wLength > blockEnd) return;
        const wValueLength = res.readUInt16LE(blockPos + 2);
        let keyEnd = blockPos + 6;
        while (keyEnd + 1 < blockEnd) {
          if (res.readUInt16LE(keyEnd) === 0) {
            keyEnd += 2;
            break;
          }
          keyEnd += 2;
        }
        const key = res.toString('utf16le', blockPos + 6, keyEnd - 2).toLowerCase();
        const valuePos = (keyEnd + 3) & ~3;
        // StringFileInfo → StringTable → strings. The StringTable block's key is the 8-hex-digit
        // language id ("040904b0"), not the literal "stringtable", so both forms recurse.
        if (key === 'stringfileinfo' || key === 'stringtable' || /^[0-9a-f]{8}$/.test(key)) {
          scanBlocks(valuePos, blockPos + wLength);
        } else if (wValueLength > 0 && (key === 'filedescription' || key === 'productname')) {
          const value = readString(valuePos, Math.min(blockEnd, valuePos + wValueLength * 2)).trim();
          if (value) {
            found = value;
            return;
          }
        }
        blockPos += wLength;
      }
    };
    scanBlocks(childPos, dataEnd);
    return found;
  } catch {
    return '';
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

module.exports = { exeArch, detectSteamStub, readExeProductName };
