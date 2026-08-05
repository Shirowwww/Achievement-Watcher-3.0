'use strict';

const fs = require('fs');
const path = require('path');
const { readRegistryString } = require('../../util/reg');
const avatarStore = require('../../util/avatarStore.js');
const accountPictureModule = require('accountpicture-ms-extractor');
const accountms = accountPictureModule.default || accountPictureModule;

async function imageFileToBase64(filePath) {
  const ext = path.parse(filePath).ext.replace('.', '');
  const buffer = await fs.promises.readFile(filePath);
  const base64 = `data:image/${ext};charset=utf-8;base64,${buffer.toString('base64')}`;
  return base64;
}

async function getWindowsProfileAvatar() {
  const sourceID = readRegistryString('HKCU', 'Software/Microsoft/Windows/CurrentVersion/AccountPicture', 'SourceId');
  if (!sourceID) throw 'No source ID found';

  const candidates = ['AccountPictures', 'Account Pictures'].map((folder) =>
    path.join(process.env['APPDATA'], 'Microsoft/Windows', folder, `${sourceID}.accountpicture-ms`)
  );
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error('Windows account picture file not found');

  const { highres } = await accountms(file);
  return highres.base64();
}

async function getAvatar() {
  let avatar = avatarStore.getAvatar();
  if (!avatar) {
    // One-time carry-over for a build that already had an avatar set in localStorage before this
    // moved to a migration-safe file (or a session that hasn't restarted since the upgrade).
    const legacy = localStorage.getItem('avatar');
    if (legacy) {
      avatarStore.setAvatar(legacy);
      avatar = legacy;
    }
  }
  if (!avatar) avatar = await getWindowsProfileAvatar();
  return avatar;
}

module.exports = { getAvatar, imageFileToBase64 };
