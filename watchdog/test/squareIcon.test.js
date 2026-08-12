'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

const { makeSquareIcon, localImagePath, squareOutputPath } = require('../util/squareIcon.js');
const { resolvePowerShell } = require('../util/powershell.js');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-square-icon-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('remote URLs are left untouched (no image processing)', async () => {
  const root = fixture();
  try {
    assert.equal(await makeSquareIcon('https://example.com/art.jpg', '480', { userDataRoot: root }), null);
  } finally {
    cleanup(root);
  }
});

test('a landscape image is center-cropped into a square PNG', { skip: process.platform !== 'win32' }, async () => {
  const root = fixture();
  const src = path.join(root, 'source.png');
  try {
    execFileSync(
      resolvePowerShell(),
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        [
          'Add-Type -AssemblyName System.Drawing;',
          '$b = New-Object System.Drawing.Bitmap(4, 2);',
          '$g = [System.Drawing.Graphics]::FromImage($b);',
          '$g.Clear([System.Drawing.Color]::Red);',
          '$g.Dispose();',
          `$b.Save('${src.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png);`,
          '$b.Dispose();',
        ].join(' '),
      ],
      { windowsHide: true }
    );

    const out = await makeSquareIcon(src, '480', { userDataRoot: root });
    assert.ok(out, 'a square icon should be produced');
    assert.ok(out.startsWith(root), 'the square icon must be written under the configured user-data root');
    assert.equal(out, squareOutputPath('480', src, root));

    const buf = fs.readFileSync(out);
    assert.equal(buf.readUInt32BE(16), 2, 'cropped width must equal the shorter side');
    assert.equal(buf.readUInt32BE(20), 2, 'cropped height must equal the shorter side');
    assert.equal(localImagePath(out), out);
  } finally {
    cleanup(root);
  }
});
