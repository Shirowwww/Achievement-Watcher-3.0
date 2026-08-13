'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const scanScope = require('../../app/parser/scanScope.js');

test('a selected scan scope de-duplicates Windows paths without losing their display path', () => {
  const scope = scanScope.normalizeScanScope({
    userDirs: ['C:\\Games', 'c:/games\\', 'D:\\Saves'],
    libraryDirs: ['D:\\Library\\', 'D:\\Library'],
  });

  assert.deepEqual(scope, {
    userDirs: ['C:\\Games', 'D:\\Saves'],
    libraryDirs: ['D:\\Library\\'],
  });
  assert.deepEqual(scanScope.selectedDirectories(scope), ['C:\\Games', 'D:\\Saves', 'D:\\Library\\']);
});

test('a selected scan includes only configured entries whose directory was checked', () => {
  const configured = [{ path: 'C:\\Games' }, { path: 'D:\\Saves' }, { path: 'E:\\Elsewhere' }];
  const scope = scanScope.normalizeScanScope({ userDirs: ['d:/saves/'], libraryDirs: [] });

  assert.deepEqual(scanScope.filterSelectedDirectories(configured, scope.userDirs, (entry) => entry.path), [{ path: 'D:\\Saves' }]);
});

test('preserved game entries are replaced only when they live inside a selected directory', () => {
  const scope = scanScope.normalizeScanScope({ userDirs: [], libraryDirs: ['D:\\Games'] });

  assert.equal(scanScope.pathIsWithinSelectedDirectories('D:\\Games\\Hollow Knight\\game.exe', scope), true);
  assert.equal(scanScope.pathIsWithinSelectedDirectories('D:\\Games 2\\Hollow Knight\\game.exe', scope), false);
  assert.equal(scanScope.pathIsWithinSelectedDirectories('C:\\Games\\Hollow Knight\\game.exe', scope), false);
  assert.equal(scanScope.pathIsWithinSelectedDirectories('C:\\Games\\Hollow Knight\\game.exe', { userDirs: ['C:\\'], libraryDirs: [] }), true);
});

test('the discovery cache distinguishes a full scan from every selected-folder scope', () => {
  const first = scanScope.normalizeScanScope({ userDirs: ['C:\\Saves'], libraryDirs: ['D:\\Games'] });
  const second = scanScope.normalizeScanScope({ userDirs: ['C:\\Saves'], libraryDirs: ['E:\\Games'] });

  assert.notDeepEqual(scanScope.cacheValue(first), scanScope.cacheValue(second));
  assert.equal(scanScope.cacheValue(null), null);
});
