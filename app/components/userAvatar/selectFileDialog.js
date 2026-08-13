'use strict';

const path = require('path');
const remote = require('@electron/remote');
const { imageFileToBase64 } = require('./avatar.js');
const avatarStore = require('../../util/avatarStore.js');

const appPath = remote.app.getAppPath();
const { t } = require(path.join(appPath, 'locale/t.js'));

async function selectFileDialog() {
  const self = this;
  self.style['pointer-events'] = 'none';

  try {
    const dialog = await remote.dialog.showOpenDialog({
      properties: ['openFile', 'showHiddenFiles', 'dontAddToRecent'],
      filters: [{ name: 'Image', extensions: ['jpeg', 'jpg', 'png', 'gif', 'bmp'] }],
    });

    if (dialog.filePaths && dialog.filePaths.length > 0) {
      //if cancel will be 0
      const avatar = await imageFileToBase64(dialog.filePaths[0]);
      avatarStore.setAvatar(avatar);
      self.update();
    }
  } catch (err) {
    remote.dialog.showMessageBoxSync({
      type: 'error',
      title: t('unexpected-error', 'Unexpected Error', 'Erreur inattendue'),
      message: t('failedToSetAvatar', 'Failed to set avatar.', 'Échec de la définition de l’avatar.'),
      detail: `${err}`,
    });
  }

  self.style['pointer-events'] = 'initial';
}

module.exports = { selectFileDialog };
