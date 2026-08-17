'use strict';

// Pixel dimensions of an image file, read from its header only — no decoding, no native module.
// Enough for the cover formats the app stores (PNG, JPEG, GIF, BMP, WebP); anything else, or a
// truncated file, returns null rather than a guess.

const fs = require('fs');

const HEADER_BYTES = 64 * 1024; // a JPEG's SOF marker can sit past a large EXIF/ICC block

function readHeader(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const buffer = Buffer.alloc(Math.min(size, HEADER_BYTES));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return read > 0 ? buffer.subarray(0, read) : null;
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

function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  // IHDR is always the first chunk; its width/height follow the 8-byte length+type pair.
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < b.length) {
    if (b[offset] !== 0xff) {
      offset++; // fill byte or padding between segments
      continue;
    }
    const marker = b[offset + 1];
    // SOF0..SOF15 carry the frame size; DHT (c4), DAC (cc) and RSTn share the range but do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // standalone markers have no payload
      continue;
    }
    offset += 2 + b.readUInt16BE(offset + 2);
  }
  return null;
}

function gifSize(b) {
  if (b.length < 10 || b.toString('latin1', 0, 3) !== 'GIF') return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function bmpSize(b) {
  if (b.length < 26 || b.toString('latin1', 0, 2) !== 'BM') return null;
  return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
}

function webpSize(b) {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const format = b.toString('latin1', 12, 16);
  if (format === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (format === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') return { width: (b.readUIntLE(24, 3) & 0xffffff) + 1, height: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
  return null;
}

// { width, height } or null.
function imageSize(file) {
  const header = readHeader(file);
  if (!header) return null;
  for (const read of [pngSize, jpegSize, gifSize, bmpSize, webpSize]) {
    const size = read(header);
    if (size && size.width > 0 && size.height > 0) return size;
  }
  return null;
}

module.exports = { imageSize };
