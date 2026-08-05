'use strict';

// Renderer-side avatar persistence. A user's chosen avatar (uploaded locally or imported from
// Steam/Windows) used to live only in `localStorage.avatar`, which is Chromium profile state — the
// one-time %APPDATA%\Achievement Watcher 3.0 migration deliberately never imports the Chromium
// profile (see util/migrateUserData.js), so a returning user's avatar silently vanished on upgrade
// (issue #10). Storing it as a plain file under `cfg/` instead puts it on the same migration path as
// every other durable setting, with no changes needed to the migration plan.

const fs = require('fs');
const path = require('path');
const { ipcRenderer } = require('electron');

let cachedFile = null;
function avatarFile() {
  if (cachedFile) return cachedFile;
  const userDataPath = ipcRenderer.sendSync('get-user-data-path-sync');
  cachedFile = path.join(userDataPath, 'cfg', 'avatar.txt');
  return cachedFile;
}

function getAvatar() {
  try {
    const data = fs.readFileSync(avatarFile(), 'utf8');
    return data || null;
  } catch {
    return null;
  }
}

function setAvatar(dataUri) {
  const file = avatarFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(dataUri || ''), 'utf8');
}

function clearAvatar() {
  try {
    fs.unlinkSync(avatarFile());
  } catch {
    /* already absent */
  }
}

module.exports = { getAvatar, setAvatar, clearAvatar };
