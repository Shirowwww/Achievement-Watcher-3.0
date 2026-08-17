'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { imageSize } = require('../../app/util/imageSize.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-image-size-'));
const write = (name, bytes) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, bytes);
  return file;
};

function png(width, height) {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

// SOI, an APP0 segment to skip over, then the SOF0 frame header that carries the size.
function jpeg(width, height, { padding = 0 } = {}) {
  const app0 = Buffer.alloc(4 + 12 + padding);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(app0.length - 2, 2);
  app0.write('JFIF\0', 4, 'latin1');
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(9, 2);
  sof.writeUInt8(8, 4);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}

test('image dimensions are read from the header of every cover format', () => {
  assert.deepEqual(imageSize(write('header.png', png(920, 430))), { width: 920, height: 430 });
  assert.deepEqual(imageSize(write('grid.png', png(600, 900))), { width: 600, height: 900 });
  assert.deepEqual(imageSize(write('header.jpg', jpeg(920, 430))), { width: 920, height: 430 });
  // A large EXIF/ICC block pushes the frame header well past the first bytes of the file.
  assert.deepEqual(imageSize(write('exif.jpg', jpeg(600, 900, { padding: 20000 }))), { width: 600, height: 900 });

  const gif = Buffer.alloc(10);
  gif.write('GIF89a', 0, 'latin1');
  gif.writeUInt16LE(64, 6);
  gif.writeUInt16LE(32, 8);
  assert.deepEqual(imageSize(write('anim.gif', gif)), { width: 64, height: 32 });

  const bmp = Buffer.alloc(26);
  bmp.write('BM', 0, 'latin1');
  bmp.writeInt32LE(320, 18);
  bmp.writeInt32LE(-240, 22); // top-down bitmaps store a negative height
  assert.deepEqual(imageSize(write('art.bmp', bmp)), { width: 320, height: 240 });

  const webp = Buffer.alloc(30);
  webp.write('RIFF', 0, 'latin1');
  webp.write('WEBP', 8, 'latin1');
  webp.write('VP8 ', 12, 'latin1');
  webp.writeUInt16LE(300, 26);
  webp.writeUInt16LE(450, 28);
  assert.deepEqual(imageSize(write('cover.webp', webp)), { width: 300, height: 450 });
});

test('anything that is not a readable image is null, never a guess', () => {
  assert.equal(imageSize(write('notes.txt', Buffer.from('not an image at all'))), null);
  assert.equal(imageSize(write('truncated.png', png(920, 430).subarray(0, 12))), null);
  assert.equal(imageSize(path.join(tmp, 'missing.png')), null);
  assert.equal(imageSize(''), null);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
