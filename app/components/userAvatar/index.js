'use strict';

import { template } from './template.js';

// Renderer `require()` resolves relative to app/view/app.html, not this ES module. Keep these
// paths document-relative so the custom-element registry can load both title-bar and avatar.
const { getAvatar } = require('../components/userAvatar/avatar.js');
const { selectFileDialog } = require('../components/userAvatar/selectFileDialog.js');
const { contextMenu } = require('../components/userAvatar/contextMenu.js');

export default class titleBar extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({ mode: 'open' }).innerHTML = template;
    this.steamUsers = [];
  }

  /* Life Cycle */
  connectedCallback() {
    this._selectFileDialogHandler = selectFileDialog.bind(this);
    this._contextMenuHandler = contextMenu.bind(this);
    this.addEventListener('click', this._selectFileDialogHandler);
    this.addEventListener('contextmenu', this._contextMenuHandler, false);

    localStorage['avatarSquared'] == 'true' ? this.classList.remove('round') : this.classList.add('round');

    this.update();
  }

  disconnectedCallback() {
    this.removeEventListener('click', this._selectFileDialogHandler);
    this.removeEventListener('contextmenu', this._contextMenuHandler, false);
    this._selectFileDialogHandler = null;
    this._contextMenuHandler = null;
  }

  /* Custom method */

  update() {
    const self = this;
    getAvatar()
      .then((avatar) => {
        self.style['background'] = `url(${avatar})`;
      })
      .catch(() => {
        /*Do Nothing*/
      });
  }
}
