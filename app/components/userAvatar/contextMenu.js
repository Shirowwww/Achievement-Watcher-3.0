'use strict';

const remote = require('@electron/remote');
const { Menu, MenuItem, nativeImage } = remote;
const request = require('request-zero');

const { selectFileDialog } = require('./selectFileDialog.js');
const { getSteamPath, getSteamUsers } = require('../../parser/steam.js');
const avatarStore = require('../../util/avatarStore.js');

const appPath = remote.app.getAppPath();
const { t } = require(path.join(appPath, 'locale/t.js'));

// Native Windows menus render icons at their natural size; the bundled icons are
// 32×32 and look oversized at typical DPI. Normalize to the standard 16×16 size.
function menuIcon(name) {
  const img = nativeImage.createFromPath(path.join(appPath, 'resources/img', name));
  if (img.isEmpty()) return img;
  return img.resize({ width: 16, height: 16, quality: 'best' });
}

function contextMenu(e, position = null) {
  e.preventDefault();
  const self = this;

  const oldPosition = { x: e.pageX, y: e.pageY };

  const menu = new Menu();

  menu.append(
    new MenuItem({
      label: t('avatar-squared', 'Squared', 'Carré'),
      type: 'checkbox',
      checked: !self.classList.contains('round'),
      click: function () {
        const status = self.classList.toggle('round');
        localStorage.setItem('avatarSquared', !status);
      },
    })
  );

  menu.append(new MenuItem({ type: 'separator' }));

  menu.append(
    new MenuItem({
      icon: menuIcon('folder-open.png'),
      label: t('avatar-browse', 'Browse...', 'Parcourir…'),
      click: function () {
        selectFileDialog.call(self);
      },
    })
  );

  menu.append(
    new MenuItem({
      icon: menuIcon('redo-alt.png'),
      label: t('avatar-reset-default', 'Reset to default avatar', 'Réinitialiser l’avatar par défaut'),
      click: function () {
        avatarStore.clearAvatar();
        self.update();
      },
    })
  );

  menu.append(new MenuItem({ type: 'separator' }));

  if (self.steamUsers.length === 0) {
    menu.append(
      new MenuItem({
        icon: menuIcon('steam.png'),
        label: t('avatar-import-steam', 'Import from Steam...', 'Importer depuis Steam…'),
        click: function () {
          getSteamPath()
            .then((SteamPath) => {
              return getSteamUsers(SteamPath);
            })
            .then((SteamUsers) => {
              self.steamUsers = SteamUsers;
            })
            .then(() => {
              menu.closePopup();
              contextMenu.call(self, e, oldPosition);
            })
            .catch((err) => {
              remote.dialog.showMessageBoxSync({
                type: 'error',
                title: t('error', 'Error', 'Erreur'),
                message: t('failed-to-import-from-steam', 'Failed to import from Steam.', 'Échec de l’importation depuis Steam.'),
                detail: `${err}`,
              });
            });
        },
      })
    );
  } else {
    for (let i = 0; i < self.steamUsers.length; i++) {
      menu.append(
        new MenuItem({
          icon: menuIcon('steam.png'),
          // A lone "&" in a native menu label is an accelerator marker (swallowed); double it so a
          // Steam name containing "&" renders literally.
          label: `Import ${String(self.steamUsers[i].name).replace(/&/g, '&&')}'s Steam avatar`,
          click: function () {
            request(self.steamUsers[i].profile.avatarFull, { encoding: 'base64' })
              .then((res) => {
                const base64 = `data:${res.headers['content-type']};charset=utf-8;base64,${res.body}`;
                avatarStore.setAvatar(base64);
                self.update();
              })
              .catch((err) => {
                remote.dialog.showMessageBoxSync({
                  type: 'error',
                  title: t('error', 'Error', 'Erreur'),
                  message: t('failed-to-fetch-avatar', 'Failed to fetch {name}\'s avatar.', 'Échec de la récupération de l’avatar de {name}.', { name: self.steamUsers[i].name }),
                  detail: `${err}`,
                });
              });
          },
        })
      );
    }
  }

  if (position && position.x && position.y) {
    menu.popup({ x: position.x, y: position.y });
  } else {
    menu.popup();
  }
}

module.exports = { contextMenu };
