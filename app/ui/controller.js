'use strict';

function centerOf(element) {
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : element;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function chooseDirectionalCandidate(current, candidates, horizontal, vertical) {
  if (!current || !Array.isArray(candidates) || candidates.length === 0) return candidates && candidates[0];
  const origin = centerOf(current);
  let best;
  let bestScore = Infinity;

  for (const candidate of candidates) {
    if (!candidate || candidate === current) continue;
    const target = centerOf(candidate);
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const primary = horizontal ? dx * horizontal : dy * vertical;
    if (primary <= 2) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    const distance = Math.hypot(dx, dy);
    const score = primary + cross * 2.4 + distance * 0.08;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { chooseDirectionalCandidate };

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  (() => {
    if (window.__awControllerNavigationLoaded) return;
    window.__awControllerNavigationLoaded = true;
    const SELECTOR = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[role="button"]',
      '#game-list .game-box',
      '#game-list .play-button',
      '#game-list .config-button',
      '#sort-box .sort',
      '#sort-box .installed-filter',
      '#home .btn',
      '#achievement .achievement-list > ul > li',
      '#achievement .sort',
      '#achievement .toggle',
      '#btn-previous',
      '#btn-scrollup',
      '#settingNav li',
      '#settings .previous',
      '#settings .next',
      '#settings .btn',
      '#btn-settings-cancel',
      '#btn-settings-save',
      '#game-config .controls li',
      '#btn-game-config-cancel',
      '#btn-game-config-save',
      '.aw-prompt-button',
    ].join(',');

    const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
    const held = new Map();
    let selected = null;
    let activeByController = false;

    function isVisible(element) {
      if (!element || !element.isConnected || element.hidden || element.disabled) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function isContainerVisible(element) {
      if (!element || !element.isConnected) return false;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      if (isVisible(element)) return true;
      return Array.from(element.children).some(isVisible);
    }

    function activeRoot() {
      const prompt = document.querySelector('.aw-prompt-overlay');
      if (isContainerVisible(prompt)) return prompt;
      for (const selector of ['#onboarding', '#game-config', '#settings', '#achievement', '#home']) {
        const root = document.querySelector(selector);
        if (isContainerVisible(root)) return root;
      }
      return document.body;
    }

    function candidates() {
      const root = activeRoot();
      return Array.from(root.querySelectorAll(SELECTOR)).filter(isVisible);
    }

    function setSelected(element) {
      if (!element || !isVisible(element)) return;
      if (selected) selected.classList.remove('controller-focus');
      selected = element;
      selected.classList.add('controller-focus');
      if (!selected.hasAttribute('tabindex') && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/i.test(selected.tagName)) selected.setAttribute('tabindex', '-1');
      try {
        selected.focus({ preventScroll: true });
      } catch {}
      selected.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    function ensureSelected() {
      const items = candidates();
      if (selected && items.includes(selected)) return items;
      const preferred = items.find((element) => element.matches('.active, :checked, #game-list .game-box')) || items[0];
      if (preferred) setSelected(preferred);
      return items;
    }

    function adjustControl(direction) {
      if (!selected) return false;
      if (selected.matches('select')) {
        const next = Math.max(0, Math.min(selected.options.length - 1, selected.selectedIndex + direction));
        if (next === selected.selectedIndex) return true;
        selected.selectedIndex = next;
      } else if (selected.matches('input[type="range"], input[type="number"]')) {
        direction < 0 ? selected.stepDown() : selected.stepUp();
      } else {
        return false;
      }
      selected.dispatchEvent(new Event('input', { bubbles: true }));
      selected.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    function move(horizontal, vertical) {
      if (horizontal && adjustControl(horizontal)) return;
      const items = ensureSelected();
      const next = chooseDirectionalCandidate(selected, items, horizontal, vertical);
      if (next) setSelected(next);
      else activeRoot().scrollBy({ top: vertical * Math.round(window.innerHeight * 0.55), behavior: 'smooth' });
    }

    function activate() {
      ensureSelected();
      if (!selected) return;
      if (selected.matches('select')) {
        adjustControl(1);
        return;
      }
      selected.click();
      if (selected.matches('input[type="text"], input[type="search"], input[type="password"], textarea')) {
        selected.focus();
        selected.select?.();
      }
      setTimeout(() => ensureSelected(), 80);
    }

    function back() {
      const active = document.activeElement;
      if (active && active.matches?.('input, textarea')) {
        active.blur();
        return;
      }
      const promptCancel = document.querySelector('.aw-prompt-overlay .aw-prompt-button.secondary');
      if (isVisible(promptCancel)) return promptCancel.click();
      if (isContainerVisible(document.querySelector('#onboarding'))) {
        const previous = document.querySelector('#onboarding-prev');
        const close = document.querySelector('#onboarding-close');
        return (isVisible(previous) && !previous.disabled ? previous : close)?.click();
      }
      for (const selector of ['#btn-game-config-cancel', '#btn-settings-cancel', '#btn-previous']) {
        const button = document.querySelector(selector);
        if (isVisible(button)) return button.click();
      }
    }

    function focusSearch() {
      const root = activeRoot();
      const input = root.querySelector('#achievement-search-input, #search-bar input[type="search"], #search-bar-float input[type="search"]');
      if (isVisible(input)) {
        setSelected(input);
        input.select();
      }
    }

    function openSettings() {
      if (isContainerVisible(document.querySelector('#settings'))) return;
      document.querySelector('title-bar')?.dispatchEvent(new CustomEvent('open-settings'));
      setTimeout(() => ensureSelected(), 120);
    }

    function changeSettingsTab(direction) {
      if (!isContainerVisible(document.querySelector('#settings'))) {
        activeRoot().scrollBy({ top: direction * Math.round(window.innerHeight * 0.75), behavior: 'smooth' });
        return;
      }
      const tabs = Array.from(document.querySelectorAll('#settingNav li')).filter(isVisible);
      if (!tabs.length) return;
      const now = performance.now();
      if (now - (window.__awControllerLastTabChange || 0) < 300) return;
      window.__awControllerLastTabChange = now;
      const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.classList.contains('active')));
      const next = tabs[(activeIndex + direction + tabs.length) % tabs.length];
      next.click();
      setSelected(next);
    }

    function pressed(gamepad, button) {
      return Boolean(gamepad.buttons[button]?.pressed);
    }

    function repeat(name, down, callback, repeatable = false) {
      const now = performance.now();
      const state = held.get(name);
      if (!down) {
        held.delete(name);
        return;
      }
      if (!state) {
        held.set(name, { first: now, last: now });
        callback();
        return;
      }
      if (repeatable && now - state.first >= 330 && now - state.last >= 115) {
        state.last = now;
        callback();
      }
    }

    function poll() {
      const gamepad = Array.from(navigator.getGamepads?.() || []).find(Boolean);
      if (gamepad && document.hasFocus()) {
        const axisX = Math.abs(gamepad.axes[0] || 0) >= 0.55 ? Math.sign(gamepad.axes[0]) : 0;
        const axisY = Math.abs(gamepad.axes[1] || 0) >= 0.55 ? Math.sign(gamepad.axes[1]) : 0;
        const up = pressed(gamepad, BUTTON.UP) || axisY < 0;
        const down = pressed(gamepad, BUTTON.DOWN) || axisY > 0;
        const left = pressed(gamepad, BUTTON.LEFT) || axisX < 0;
        const right = pressed(gamepad, BUTTON.RIGHT) || axisX > 0;
        const anyInput = up || down || left || right || [BUTTON.A, BUTTON.B, BUTTON.X, BUTTON.Y, BUTTON.LB, BUTTON.RB, BUTTON.START].some((b) => pressed(gamepad, b));
        if (anyInput && !activeByController) {
          activeByController = true;
          document.documentElement.dataset.controllerActive = 'true';
          ensureSelected();
        }
        repeat('up', up, () => move(0, -1), true);
        repeat('down', down, () => move(0, 1), true);
        repeat('left', left, () => move(-1, 0), true);
        repeat('right', right, () => move(1, 0), true);
        repeat('a', pressed(gamepad, BUTTON.A), activate);
        repeat('b', pressed(gamepad, BUTTON.B), back);
        repeat('x', pressed(gamepad, BUTTON.X), focusSearch);
        repeat('y', pressed(gamepad, BUTTON.Y), openSettings);
        repeat('lb', pressed(gamepad, BUTTON.LB), () => changeSettingsTab(-1));
        repeat('rb', pressed(gamepad, BUTTON.RB), () => changeSettingsTab(1));
        repeat('start', pressed(gamepad, BUTTON.START), openSettings);
      }
      requestAnimationFrame(poll);
    }

    function leaveControllerMode() {
      activeByController = false;
      document.documentElement.removeAttribute('data-controller-active');
      if (selected) selected.classList.remove('controller-focus');
    }

    window.addEventListener('gamepaddisconnected', () => {
      held.clear();
      leaveControllerMode();
    });
    window.addEventListener('pointerdown', leaveControllerMode, { passive: true });
    window.addEventListener('keydown', leaveControllerMode, { passive: true });
    requestAnimationFrame(poll);
  })();
}
