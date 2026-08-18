'use strict';

/*
  Invoke a main-process handler from code that does not know which process it is running in.

  The parsers under app/parser are required from three places: the renderer, the main process
  (electron/init.js and electron/ipc.js) and the background monitor. Only the first has an
  `ipcRenderer`, so `require('electron').ipcRenderer.invoke(...)` throws a bare
  "Cannot read properties of undefined (reading 'invoke')" in the other two - which is what a user's
  parser.log was full of, once per game, for the SteamDB launch and artwork fallbacks.

  Those call sites are optional enrichment, so the honest behaviour outside the renderer is to
  return null rather than to throw or to log the same TypeError for every game in the library.
*/

function getIpcRenderer() {
  try {
    const { ipcRenderer } = require('electron');
    return ipcRenderer && typeof ipcRenderer.invoke === 'function' ? ipcRenderer : null;
  } catch {
    return null;
  }
}

// True only in a renderer, where main-process handlers can actually be reached.
function ipcAvailable() {
  return Boolean(getIpcRenderer());
}

/*
  Always returns a promise; resolves to null when the channel is unreachable or the handler
  rejected. Callers that must tell "no answer" from "answered with nothing" should use ipcRenderer
  directly - none of the artwork or metadata fallbacks need that distinction.
*/
async function ipcInvoke(channel, ...args) {
  const ipcRenderer = getIpcRenderer();
  if (!ipcRenderer) return null;
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch {
    return null;
  }
}

module.exports = { ipcInvoke, ipcAvailable };
