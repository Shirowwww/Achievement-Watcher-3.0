'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { mergeTranslatedAchievements } = require('../../app/parser/achievementTranslations.js');

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

test('translation merge matches full icon URLs against SteamCommunity image hashes', () => {
  const achievement = {
    icon: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/440/abc123.jpg',
    icongray: 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/440/abc123_gray.jpg',
    description: 'English hidden text',
  };

  mergeTranslatedAchievements([achievement], [
    { img: 'abc123', title: 'Titre français', description: '' },
  ]);

  assert.equal(achievement.displayName, 'Titre français');
  // The page blanks hidden descriptions: the English text must survive the merge.
  assert.equal(achievement.description, 'English hidden text');
});

test('translation merge still replaces blank schema descriptions with real page text', () => {
  const achievement = { icon: 'https://cdn.example/apps/440/hash.jpg', description: '' };
  mergeTranslatedAchievements([achievement], [{ img: 'hash.jpg', title: 'Visible', description: 'Page text' }]);
  assert.equal(achievement.description, 'Page text');
  assert.equal(achievement.displayName, 'Visible');
});

test('an empty image string never matches a schema entry whose icons are missing', () => {
  const noIcon = { name: 'SH_ENTRY', icon: '', icongray: '', description: 'Real text' };
  const withIcon = { name: 'ICONED', icon: 'https://cdn.example/real.jpg', icongray: 'https://cdn.example/real_gray.jpg' };

  mergeTranslatedAchievements([noIcon, withIcon], [{ img: '', title: 'Wrong title', description: '' }]);

  assert.equal(noIcon.displayName, undefined);
  assert.equal(noIcon.description, 'Real text');
  assert.equal(withIcon.displayName, undefined);
});
