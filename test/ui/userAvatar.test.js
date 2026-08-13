'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const Module = require('node:module');

const appDir = path.join(__dirname, '..', '..', 'app');

test('user avatar component resolves its modules and removes its listeners', async () => {
  const source = fs
    .readFileSync(path.join(appDir, 'components/userAvatar/index.js'), 'utf8')
    .replace("import { template } from './template.js';", 'const template = "<slot></slot>";')
    .replace('export default class titleBar', 'class titleBar')
    .concat('\nmodule.exports = titleBar;\n');
  const events = [];
  const avatarCalls = [];
  const localStorage = { getItem: () => null };

  class FakeElement {
    constructor() {
      this.style = {};
      this.classList = { add() {}, remove() {} };
      this.steamUsers = [];
    }

    attachShadow() {
      return {};
    }

    addEventListener(type, handler) {
      events.push(['add', type, handler]);
    }

    removeEventListener(type, handler) {
      events.push(['remove', type, handler]);
    }
  }

  const context = {
    HTMLElement: FakeElement,
    localStorage,
    Promise,
    require(specifier) {
      if (specifier === '../components/userAvatar/avatar.js') return { getAvatar: async () => 'data:image/png;base64,AAAA' };
      if (specifier === '../components/userAvatar/selectFileDialog.js') return { selectFileDialog: () => avatarCalls.push('select') };
      if (specifier === '../components/userAvatar/contextMenu.js') return { contextMenu: () => avatarCalls.push('menu') };
      throw new Error(`unexpected import: ${specifier}`);
    },
    module: { exports: {} },
  };
  vm.runInNewContext(source, context, { filename: 'userAvatar/index.js' });

  const element = new context.module.exports();
  element.connectedCallback();
  await Promise.resolve();
  element.disconnectedCallback();

  assert.equal(events.length, 4);
  assert.equal(events[0][0], 'add');
  assert.equal(events[1][0], 'add');
  assert.equal(events[2][0], 'remove');
  assert.equal(events[3][0], 'remove');
  assert.equal(events[0][2], events[2][2]);
  assert.equal(events[1][2], events[3][2]);
  assert.deepEqual(avatarCalls, []);
});

test('avatar context menu imports path before creating native icons', () => {
  const source = fs.readFileSync(path.join(appDir, 'components/userAvatar/contextMenu.js'), 'utf8');
  assert.match(source, /const path = require\(['"]path['"]\);/);
});

test('locale loader can be required outside the Electron renderer', () => {
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === '@electron/remote') return { app: { getVersion: () => 'test' } };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const loaderPath = path.join(appDir, 'locale/loader.js');
    delete require.cache[require.resolve(loaderPath)];
    assert.equal(typeof require(loaderPath).load, 'function');
  } finally {
    Module._load = originalLoad;
  }
});
