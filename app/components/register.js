const { ipcRenderer } = require('electron');

import titleBar from './titleBar/titleBar.js';
import userAvatar from './userAvatar/index.js';

customElements.define('title-bar', titleBar);
customElements.define('user-avatar', userAvatar);

// Fire-and-forget: this only releases the main process's "window is ready to show" gate, which is
// registered once per window. A second delivery for the same window (a renderer reload) finds no
// handler and rejects — nothing to report, but an unhandled rejection if it is not swallowed.
ipcRenderer.invoke('components-loaded').catch(() => {});
