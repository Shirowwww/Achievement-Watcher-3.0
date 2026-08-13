'use strict';

const assert = require('assert');
const test = require('node:test');
const { resolveOverlayRequest } = require('../../app/util/overlayRequest.js');

test('a close request with no overlay open is ignored (issue #19)', () => {
  // The Watchdog sends `--appid=0 --description=close` when a game exits. With nothing open that
  // request used to fall through to the open path and pop the overlay onto the desktop.
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'close', appid: '0', isOpen: false }), { action: 'ignore' });
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'close', appid: '271590', isOpen: false }), { action: 'ignore' });
});

test('a refresh request with no overlay open is ignored', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'refresh', appid: '271590', isOpen: false }), { action: 'ignore' });
});

test('an open request opens the requested game', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'open', appid: '271590', isOpen: false }), {
    action: 'open',
    appid: '271590',
  });
  // No action at all means "open", like createOverlayWindow's default.
  assert.deepStrictEqual(resolveOverlayRequest({ appid: '271590', isOpen: false }), { action: 'open', appid: '271590' });
});

test('appid 0 with no game running resolves a fallback game', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'open', appid: '0', isOpen: false }), { action: 'fallback' });
});

test('close and refresh act on an open overlay', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'close', appid: '0', isOpen: true, openAppid: '271590' }), {
    action: 'close',
  });
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'refresh', appid: '271590', isOpen: true, openAppid: '271590' }), {
    action: 'refresh',
    appid: '271590',
  });
});

test('opening the game already shown is a no-op, a different game reopens', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'open', appid: '271590', isOpen: true, openAppid: '271590' }), {
    action: 'ignore',
  });
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'open', appid: '480', isOpen: true, openAppid: '271590' }), {
    action: 'reopen',
    appid: '480',
  });
});

test('a fallback overlay is not replaced by another appid-less open', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'open', appid: '0', isOpen: true, openAppid: '271590' }), {
    action: 'ignore',
  });
});

test('numeric appids are compared as strings', () => {
  assert.deepStrictEqual(resolveOverlayRequest({ action: 'open', appid: 271590, isOpen: true, openAppid: '271590' }), {
    action: 'ignore',
  });
});
