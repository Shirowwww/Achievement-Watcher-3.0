'use strict';

// Persist the selected avatar under cfg/ so it follows normal user-data migration.

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
