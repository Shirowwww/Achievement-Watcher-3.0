'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeTranslatedAchievements } = require('../app/parser/achievementTranslations.js');

test('translation merge preserves the first image match from the former Array.find', () => {
  const first = { icon: 'first-icon', icongray: 'shared' };
  const later = { icon: 'shared', icongray: 'later-gray' };

  mergeTranslatedAchievements([first, later], [{ img: 'shared', title: 'Translated', description: 'Desc' }]);

  assert.equal(first.displayName, 'Translated');
  assert.equal(first.description, 'Desc');
  assert.equal(later.displayName, undefined);
});

test('translation merge retains the legacy undefined-image match and leaves misses untouched', () => {
  const missingArtwork = { name: 'first' };
  const normal = { name: 'second', icon: 'icon' };

  mergeTranslatedAchievements(
    [missingArtwork, normal],
    [
      { img: undefined, title: 'Fallback', description: 'Fallback desc' },
      { img: 'absent', title: 'No match', description: 'No match desc' },
    ]
  );

  assert.equal(missingArtwork.displayName, 'Fallback');
  assert.equal(missingArtwork.description, 'Fallback desc');
  assert.equal(normal.displayName, undefined);
});
