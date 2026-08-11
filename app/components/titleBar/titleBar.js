'use strict';

const { ipcRenderer } = require('electron');

const template = `
    
    <link rel="stylesheet" href="../resources/css/normalize.css" type="text/css"/>
    <link rel="stylesheet" href="../resources/css/fontawesome.css" type="text/css"/>
    <link rel="stylesheet" href="../resources/css/common.css" type="text/css" />
    <link rel="stylesheet" href="../resources/css/titlebar.css" type="text/css" />

    <div class="sf-indicator">
    <ul id="watchdog-status" class="sf-indicator"><span class="status-dot status-orange"></span><span class="status-text">Vérification du Watchdog…</span> <span id="start-watchdog"></span></ul>
    </div>
    <ul id="window-controls">
      <li id="btn-close"><i class="fas fa-times"></i></li>
      <li id="btn-maximize"><i class="far fa-window-maximize"></i></li>
      <li id="btn-minimize"><i class="far fa-window-minimize"></i></li>
      <li id="btn-settings"><i class="fas fa-cog"></i></li>
    </ul>
`;

export default class titleBar extends HTMLElement {
  constructor() {
    super();

    this.attachShadow({ mode: 'open' }).innerHTML = template;

    this.closeBtn = this.shadowRoot.querySelector('#btn-close');
    this.maximizeBtn = this.shadowRoot.querySelector('#btn-maximize');
    this.settingsBtn = this.shadowRoot.querySelector('#btn-settings');
    this.minimizeBtn = this.shadowRoot.querySelector('#btn-minimize');
    this.watchdogBtn = this.shadowRoot.querySelector('#start-watchdog');
    this.onClose = () => this.close();
    this.onMaximize = () => this.maximize();
    this.onSettings = () => this.settings();
    this.onMinimize = () => this.minimize();
    this.onStartWatchdog = () => this.start_watchdog();
  }

  /* Life Cycle */
  connectedCallback() {
    this.closeBtn.addEventListener('click', this.onClose);
    this.maximizeBtn.addEventListener('click', this.onMaximize);
    this.settingsBtn.addEventListener('click', this.onSettings);
    this.minimizeBtn.addEventListener('click', this.onMinimize);
    this.watchdogBtn.addEventListener('click', this.onStartWatchdog);

    const defaults = [ipcRenderer.invoke('win-isMinimizable'), ipcRenderer.invoke('win-isMaximizable')];
    Promise.allSettled(defaults).then(([isMinimizable, isMaximizable]) => {
      if (isMinimizable.value === true) this.setAttribute('minimizable', '');
      if (isMaximizable.value === true) this.setAttribute('maximizable', '');
      this.update();
    });
  }

  disconnectedCallback() {
    this.closeBtn.removeEventListener('click', this.onClose);
    this.maximizeBtn.removeEventListener('click', this.onMaximize);
    this.settingsBtn.removeEventListener('click', this.onSettings);
    this.minimizeBtn.removeEventListener('click', this.onMinimize);
    this.watchdogBtn.removeEventListener('click', this.onStartWatchdog);
  }

  /* Update */

  static get observedAttributes() {
    return ['maximizable', 'minimizable', 'insettings'];
  }

  attributeChangedCallback(name, oldValue, newValue) {
    this.update();
  }

  update() {
    this.maximizeBtn.style.display = this.hasAttribute('maximizable') ? 'inline-flex' : 'none';
    this.minimizeBtn.style.display = this.hasAttribute('minimizable') ? 'inline-flex' : 'none';
    const disabled = this.hasAttribute('insettings');
    this.settingsBtn.style.pointerEvents = disabled ? 'none' : 'initial';
    this.watchdogBtn.style.pointerEvents = disabled ? 'none' : 'initial';
  }

  /* Getter/Setter */
  get maximizable() {
    return this.hasAttribute('maximizable');
  }

  set maximizable(isMaximizable) {
    if (isMaximizable) {
      this.setAttribute('maximizable', '');
    } else {
      this.removeAttribute('maximizable');
    }
  }

  get minimizable() {
    return this.hasAttribute('minimizable');
  }

  set minimizable(isMinimizable) {
    if (isMinimizable) {
      this.setAttribute('minimizable', '');
    } else {
      this.removeAttribute('minimizable');
    }
  }

  get inSettings() {
    return this.hasAttribute('inSettings');
  }

  set inSettings(isInSettings) {
    if (isInSettings) {
      this.setAttribute('inSettings', '');
    } else {
      this.removeAttribute('inSettings');
    }
  }

  /* Custom method */
  close() {
    //this.dispatchEvent(new CustomEvent('close'));
    ipcRenderer.invoke('win-close');
  }

  maximize() {
    //this.dispatchEvent(new CustomEvent('maximize'));
    ipcRenderer.invoke('win-maximize');
  }

  settings() {
    this.dispatchEvent(new CustomEvent('open-settings'));
  }

  minimize() {
    //this.dispatchEvent(new CustomEvent('minimize'));
    ipcRenderer.invoke('win-minimize');
  }

  start_watchdog() {
    ipcRenderer.invoke('start-watchdog');
  }
}
