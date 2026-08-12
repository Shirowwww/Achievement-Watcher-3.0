'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { steamHeaderImage, steamLibraryImage } = require('../util/steamArtwork.js');

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-steam-artwork-'));
}

function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

test('resolved schema artwork wins over legacy Steam CDN URLs', () => {
  const root = fixture();
  try {
    writeJson(root, 'steam_cache/schema/english/3751950.db', {
      img: {
        header: 'https://cdn.example/3751950/hash/header.jpg',
        portrait: 'https://cdn.example/3751950/hash/library_capsule.jpg',
      },
    });

    assert.equal(
      steamHeaderImage('3751950', { userDataRoot: root }),
      'https://cdn.example/3751950/hash/header.jpg'
    );
    assert.equal(
      steamLibraryImage('3751950', { userDataRoot: root }),
      'https://cdn.example/3751950/hash/library_capsule.jpg'
    );
  } finally {
    cleanup(root);
  }
});

test('SteamDB cover cache supplies a portrait when the schema has none', () => {
  const root = fixture();
  try {
    writeJson(root, 'steam_cache/steamdb_cover/3751950.json', {
      appid: '3751950',
      url: 'https://cdn.example/3751950/hash/library_capsule.jpg',
    });

    assert.equal(
      steamLibraryImage('3751950', { userDataRoot: root }),
      'https://cdn.example/3751950/hash/library_capsule.jpg'
    );
  } finally {
    cleanup(root);
  }
});

test('store cache header is used and the guessable portrait.png placeholder is ignored', () => {
  const root = fixture();
  try {
    writeJson(root, 'steam_cache/store/3751950.json', {
      header: 'https://cdn.example/3751950/hash/capsule_616x353.jpg',
      portrait: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/3751950/portrait.png',
    });

    assert.equal(
      steamHeaderImage('3751950', { userDataRoot: root }),
      'https://cdn.example/3751950/hash/capsule_616x353.jpg'
    );
    assert.equal(
      steamLibraryImage('3751950', { userDataRoot: root }),
      'https://cdn.example/3751950/hash/capsule_616x353.jpg',
      'a guessable placeholder must not be treated as resolved artwork; the hashed header is the better fallback'
    );
  } finally {
    cleanup(root);
  }
});

test('a resolved hashed URL wins over a stale predictable URL in the schema', () => {
  const root = fixture();
  try {
    writeJson(root, 'steam_cache/schema/english/999999.db', {
      img: {
        header: 'https://cdn.akamai.steamstatic.com/steam/apps/999999/header.jpg',
        portrait: 'https://cdn.akamai.steamstatic.com/steam/apps/999999/library_600x900.jpg',
      },
    });
    writeJson(root, 'steam_cache/store/999999.json', {
      header: 'https://cdn.example/999999/hash/header.jpg',
      portrait: 'https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/999999/portrait.png',
    });
    writeJson(root, 'steam_cache/steamdb_cover/999999.json', {
      appid: '999999',
      url: 'https://cdn.example/999999/hash/library_capsule.jpg',
    });

    assert.equal(
      steamHeaderImage('999999', { userDataRoot: root }),
      'https://cdn.example/999999/hash/header.jpg'
    );
    assert.equal(
      steamLibraryImage('999999', { userDataRoot: root }),
      'https://cdn.example/999999/hash/library_capsule.jpg'
    );
  } finally {
    cleanup(root);
  }
});

test('a custom schema portrait is preserved even when SteamDB has a default', () => {
  const root = fixture();
  try {
    writeJson(root, 'steam_cache/schema/english/777777.db', {
      img: {
        header: 'https://cdn.akamai.steamstatic.com/steam/apps/777777/header.jpg',
        portrait: 'https://cdn2.steamgriddb.com/custom.jpg',
      },
    });
    writeJson(root, 'steam_cache/steamdb_cover/777777.json', {
      appid: '777777',
      url: 'https://cdn.example/777777/hash/library_capsule.jpg',
    });

    assert.equal(steamLibraryImage('777777', { userDataRoot: root }), 'https://cdn2.steamgriddb.com/custom.jpg');
  } finally {
    cleanup(root);
  }
});

test('legacy URLs remain the fallback when no cache exists', () => {
  const root = fixture();
  try {
    assert.equal(
      steamHeaderImage('242050', { userDataRoot: root }),
      'https://cdn.cloudflare.steamstatic.com/steam/apps/242050/header.jpg'
    );
    assert.equal(
      steamLibraryImage('242050', { userDataRoot: root }),
      'https://cdn.cloudflare.steamstatic.com/steam/apps/242050/library_600x900.jpg'
    );
  } finally {
    cleanup(root);
  }
});

test('non-numeric appids never produce a broken Steam CDN URL', () => {
  assert.equal(steamHeaderImage('socialclub-smartsteamemu'), undefined);
  assert.equal(steamLibraryImage('socialclub-smartsteamemu'), undefined);
  assert.equal(steamHeaderImage(''), undefined);
  assert.equal(steamLibraryImage(null), undefined);
});
