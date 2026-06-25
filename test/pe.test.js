'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pe = require(path.join(__dirname, '..', 'app', 'util', 'pe.js'));

// Minimal valid PE header with a chosen machine type (0x8664 x64, 0x014c x86).
function fakePE(machine) {
  const buf = Buffer.alloc(0x100, 0);
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(0x80, 0x3c); // e_lfanew → PE header at 0x80
  buf.writeUInt32LE(0x00004550, 0x80); // 'PE\0\0'
  buf.writeUInt16LE(machine, 0x84); // COFF Machine
  return buf;
}

// PE with a section table (to exercise SteamStub's ".bind" detection).
function fakePEWithSections(sections) {
  const buf = Buffer.alloc(0x400, 0);
  const peOff = 0x80;
  buf.write('MZ', 0, 'ascii');
  buf.writeUInt32LE(peOff, 0x3c);
  buf.writeUInt32LE(0x00004550, peOff); // 'PE\0\0'
  buf.writeUInt16LE(0x8664, peOff + 4); // machine
  buf.writeUInt16LE(sections.length, peOff + 6); // NumberOfSections
  const sizeOpt = 0xe0;
  buf.writeUInt16LE(sizeOpt, peOff + 20); // SizeOfOptionalHeader
  const tableOff = peOff + 24 + sizeOpt;
  sections.forEach((name, i) => buf.write(name, tableOff + i * 40, 8, 'latin1'));
  return buf;
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pe-'));
try {
  // exeArch reads the PE machine type.
  const x64exe = path.join(temp, 'g64.exe');
  const x86exe = path.join(temp, 'g86.exe');
  fs.writeFileSync(x64exe, fakePE(0x8664));
  fs.writeFileSync(x86exe, fakePE(0x014c));
  fs.writeFileSync(path.join(temp, 'notpe.txt'), 'hello');
  assert.strictEqual(pe.exeArch(x64exe), 'x64', 'x64 machine type detected');
  assert.strictEqual(pe.exeArch(x86exe), 'x86', 'x86 machine type detected');
  assert.strictEqual(pe.exeArch(path.join(temp, 'notpe.txt')), null, 'non-PE → null');
  assert.strictEqual(pe.exeArch(path.join(temp, 'does-not-exist.exe')), null, 'missing file → null');

  // SteamStub DRM detection via the ".bind" section.
  const stubExe = path.join(temp, 'stub.exe');
  const cleanExe = path.join(temp, 'clean.exe');
  fs.writeFileSync(stubExe, fakePEWithSections(['.text', '.rdata', '.bind']));
  fs.writeFileSync(cleanExe, fakePEWithSections(['.text', '.rdata', '.data']));
  assert.strictEqual(pe.detectSteamStub(stubExe), true, 'SteamStub (.bind) detected');
  assert.strictEqual(pe.detectSteamStub(cleanExe), false, 'no false positive on a clean exe');
  assert.strictEqual(pe.detectSteamStub(path.join(temp, 'notpe.txt')), false, 'non-PE → false');
  assert.strictEqual(pe.detectSteamStub(path.join(temp, 'does-not-exist.exe')), false, 'missing file → false');

  console.log('PASS: pe util (exeArch machine type + SteamStub .bind detection)');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
