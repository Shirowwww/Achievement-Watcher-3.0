'use strict';

/*
 * Shared controller vocabulary for the in-game overlay.
 *
 * One canonical button name (BACK, START, A, ...) maps to the label shown in the
 * Settings panel and in the overlay's controller hint, depending on the layout the
 * user picked: Xbox, PlayStation or Switch. "auto" uses the browser's Gamepad API
 * when it can identify the connected pad, otherwise it falls back to Xbox labels.
 */

const CONTROLLER_LAYOUTS = ['auto', 'xbox', 'playstation', 'switch'];

const CONTROLLER_BUTTON_ORDER = [
  'BACK',
  'START',
  'GUIDE',
  'A',
  'B',
  'X',
  'Y',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_THUMB',
  'RIGHT_THUMB',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
];

const CONTROLLER_BUTTONS = new Set(CONTROLLER_BUTTON_ORDER);

// A shortcut is one to three buttons. Toggle can use the system Guide button;
// the renderer-driven modes stay on buttons the browser Gamepad API reports
// reliably (GUIDE is intentionally excluded there).
const TOGGLE_ALLOWED = [...CONTROLLER_BUTTON_ORDER];
const MODE_ALLOWED = [
  'BACK',
  'START',
  'A',
  'B',
  'X',
  'Y',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_THUMB',
  'RIGHT_THUMB',
  'DPAD_UP',
  'DPAD_DOWN',
  'DPAD_LEFT',
  'DPAD_RIGHT',
];

// Standard Gamepad API button indices (same positions on Xbox, PlayStation and
// Switch pads: bottom/right/left/top face buttons, then shoulders, triggers,
// select/start, sticks and D-pad).
const GAMEPAD_BUTTON_INDEX = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LEFT_SHOULDER: 4,
  RIGHT_SHOULDER: 5,
  BACK: 8,
  START: 9,
  LEFT_THUMB: 10,
  RIGHT_THUMB: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
};

const BUTTON_LABELS = {
  xbox: {
    BACK: 'Back',
    START: 'Start',
    GUIDE: 'Guide',
    A: 'A',
    B: 'B',
    X: 'X',
    Y: 'Y',
    LEFT_SHOULDER: 'LB',
    RIGHT_SHOULDER: 'RB',
    LEFT_THUMB: 'L3',
    RIGHT_THUMB: 'R3',
    DPAD_UP: 'Up',
    DPAD_DOWN: 'Down',
    DPAD_LEFT: 'Left',
    DPAD_RIGHT: 'Right',
  },
  playstation: {
    BACK: 'Share',
    START: 'Options',
    GUIDE: 'PS',
    A: 'Cross',
    B: 'Circle',
    X: 'Square',
    Y: 'Triangle',
    LEFT_SHOULDER: 'L1',
    RIGHT_SHOULDER: 'R1',
    LEFT_THUMB: 'L3',
    RIGHT_THUMB: 'R3',
    DPAD_UP: 'Up',
    DPAD_DOWN: 'Down',
    DPAD_LEFT: 'Left',
    DPAD_RIGHT: 'Right',
  },
  switch: {
    BACK: '−',
    START: '+',
    GUIDE: 'Home',
    A: 'B',
    B: 'A',
    X: 'Y',
    Y: 'X',
    LEFT_SHOULDER: 'L',
    RIGHT_SHOULDER: 'R',
    LEFT_THUMB: 'L3',
    RIGHT_THUMB: 'R3',
    DPAD_UP: 'Up',
    DPAD_DOWN: 'Down',
    DPAD_LEFT: 'Left',
    DPAD_RIGHT: 'Right',
  },
};

// Platform button names follow the interface language. PlayStation face buttons
// have real localized names in most languages, and the Switch/Home/Back/Start
// labels are translated too; everything else falls back to the English table.
const LOCALIZED_BUTTON_LABELS = {
  french: {
    xbox: { BACK: 'Select', START: 'Start', GUIDE: 'Guide' },
    playstation: {
      BACK: 'Share',
      START: 'Options',
      GUIDE: 'PS',
      A: 'Croix',
      B: 'Rond',
      X: 'Carré',
      Y: 'Triangle',
    },
    switch: { BACK: '−', START: '+', GUIDE: 'Home' },
  },
  german: {
    xbox: { BACK: 'Ansicht', START: 'Menü', GUIDE: 'Guide' },
    playstation: {
      BACK: 'Teilen',
      START: 'Optionen',
      GUIDE: 'PS',
      A: 'Kreuz',
      B: 'Kreis',
      X: 'Quadrat',
      Y: 'Dreieck',
    },
    switch: { GUIDE: 'Home' },
  },
  spanish: {
    xbox: { BACK: 'Ver', START: 'Menú', GUIDE: 'Guía' },
    playstation: {
      BACK: 'Compartir',
      START: 'Opciones',
      GUIDE: 'PS',
      A: 'Cruz',
      B: 'Círculo',
      X: 'Cuadrado',
      Y: 'Triángulo',
    },
    switch: { GUIDE: 'Inicio' },
  },
  latam: {
    xbox: { BACK: 'Ver', START: 'Menú', GUIDE: 'Guía' },
    playstation: {
      BACK: 'Compartir',
      START: 'Opciones',
      GUIDE: 'PS',
      A: 'Cruz',
      B: 'Círculo',
      X: 'Cuadrado',
      Y: 'Triángulo',
    },
    switch: { GUIDE: 'Inicio' },
  },
  brazilian: {
    xbox: { BACK: 'Exibir', START: 'Menu', GUIDE: 'Guia' },
    playstation: {
      BACK: 'Compartilhar',
      START: 'Opções',
      GUIDE: 'PS',
      A: 'Cruz',
      B: 'Círculo',
      X: 'Quadrado',
      Y: 'Triângulo',
    },
    switch: { GUIDE: 'Início' },
  },
  portuguese: {
    xbox: { BACK: 'Ver', START: 'Menu', GUIDE: 'Guia' },
    playstation: {
      BACK: 'Partilhar',
      START: 'Opções',
      GUIDE: 'PS',
      A: 'Cruz',
      B: 'Círculo',
      X: 'Quadrado',
      Y: 'Triângulo',
    },
    switch: { GUIDE: 'Início' },
  },
  italian: {
    xbox: { BACK: 'Visualizza', START: 'Menu', GUIDE: 'Guida' },
    playstation: {
      BACK: 'Condividi',
      START: 'Opzioni',
      GUIDE: 'PS',
      A: 'Croce',
      B: 'Cerchio',
      X: 'Quadrato',
      Y: 'Triangolo',
    },
    switch: { GUIDE: 'Home' },
  },
  polish: {
    xbox: { BACK: 'Widok', START: 'Menu', GUIDE: 'Przewodnik' },
    playstation: {
      BACK: 'Udostępnij',
      START: 'Opcje',
      GUIDE: 'PS',
      A: 'Krzyżyk',
      B: 'Kółko',
      X: 'Kwadrat',
      Y: 'Trójkąt',
    },
    switch: { GUIDE: 'Strona główna' },
  },
  czech: {
    xbox: { BACK: 'Zobrazit', START: 'Nabídka', GUIDE: 'Průvodce' },
    playstation: {
      BACK: 'Sdílení',
      START: 'Možnosti',
      GUIDE: 'PS',
      A: 'Křížek',
      B: 'Kroužek',
      X: 'Čtverec',
      Y: 'Trojúhelník',
    },
    switch: { GUIDE: 'Domů' },
  },
  slovak: {
    xbox: { BACK: 'Zobraziť', START: 'Ponuka', GUIDE: 'Sprievodca' },
    playstation: {
      BACK: 'Zdieľanie',
      START: 'Možnosti',
      GUIDE: 'PS',
      A: 'Krížik',
      B: 'Krúžok',
      X: 'Štvorec',
      Y: 'Trojuholník',
    },
    switch: { GUIDE: 'Domov' },
  },
  hungarian: {
    xbox: { BACK: 'Nézet', START: 'Menü', GUIDE: 'Útmutató' },
    playstation: {
      BACK: 'Megosztás',
      START: 'Opciók',
      GUIDE: 'PS',
      A: 'Kereszt',
      B: 'Kör',
      X: 'Négyzet',
      Y: 'Háromszög',
    },
    switch: { GUIDE: 'Kezdőképernyő' },
  },
  russian: {
    xbox: { BACK: 'Вид', START: 'Меню', GUIDE: 'Гид' },
    playstation: {
      BACK: 'Поделиться',
      START: 'Параметры',
      GUIDE: 'PS',
      A: 'Крест',
      B: 'Круг',
      X: 'Квадрат',
      Y: 'Треугольник',
    },
    switch: { GUIDE: 'Домой' },
  },
  ukrainian: {
    xbox: { BACK: 'Вид', START: 'Меню', GUIDE: 'Гід' },
    playstation: {
      BACK: 'Поділитися',
      START: 'Параметри',
      GUIDE: 'PS',
      A: 'Хрест',
      B: 'Коло',
      X: 'Квадрат',
      Y: 'Трикутник',
    },
    switch: { GUIDE: 'Додому' },
  },
  turkish: {
    xbox: { BACK: 'Görünüm', START: 'Menü', GUIDE: 'Rehber' },
    playstation: {
      BACK: 'Paylaş',
      START: 'Seçenekler',
      GUIDE: 'PS',
      A: 'Çarpı',
      B: 'Daire',
      X: 'Kare',
      Y: 'Üçgen',
    },
    switch: { GUIDE: 'Ana Ekran' },
  },
  thai: {
    xbox: { BACK: 'ดู', START: 'เมนู', GUIDE: 'ไกด์' },
    playstation: {
      BACK: 'แชร์',
      START: 'ตัวเลือก',
      GUIDE: 'PS',
      A: 'กากบาท',
      B: 'วงกลม',
      X: 'สี่เหลี่ยม',
      Y: 'สามเหลี่ยม',
    },
    switch: { GUIDE: 'หน้าหลัก' },
  },
  japanese: {
    xbox: { BACK: '戻る', START: 'メニュー', GUIDE: 'ガイド' },
    playstation: {
      BACK: '共有',
      START: 'オプション',
      GUIDE: 'PS',
      A: 'クロス',
      B: 'マル',
      X: 'スクエア',
      Y: 'サンカク',
    },
    switch: { GUIDE: 'ホーム' },
  },
  schinese: {
    xbox: { BACK: '视图', START: '菜单', GUIDE: '指南' },
    playstation: {
      BACK: '分享',
      START: '选项',
      GUIDE: 'PS',
      A: '叉',
      B: '圈',
      X: '方块',
      Y: '三角',
    },
    switch: { GUIDE: '主页' },
  },
};

const LOCALE_ALIASES = {
  fr: 'french',
  de: 'german',
  es: 'spanish',
  pt: 'portuguese',
  it: 'italian',
  pl: 'polish',
  cs: 'czech',
  sk: 'slovak',
  hu: 'hungarian',
  ru: 'russian',
  uk: 'ukrainian',
  tr: 'turkish',
  th: 'thai',
  ja: 'japanese',
  zh: 'schinese',
};

// D-pad directions are platform-neutral, so they live in one per-language table
// applied to every layout (Xbox, PlayStation and Switch).
const LOCALIZED_COMMON_LABELS = {
  french: {
    DPAD_UP: 'Haut',
    DPAD_DOWN: 'Bas',
    DPAD_LEFT: 'Gauche',
    DPAD_RIGHT: 'Droite',
  },
  german: {
    DPAD_UP: 'Oben',
    DPAD_DOWN: 'Unten',
    DPAD_LEFT: 'Links',
    DPAD_RIGHT: 'Rechts',
  },
  spanish: {
    DPAD_UP: 'Arriba',
    DPAD_DOWN: 'Abajo',
    DPAD_LEFT: 'Izquierda',
    DPAD_RIGHT: 'Derecha',
  },
  latam: {
    DPAD_UP: 'Arriba',
    DPAD_DOWN: 'Abajo',
    DPAD_LEFT: 'Izquierda',
    DPAD_RIGHT: 'Derecha',
  },
  brazilian: {
    DPAD_UP: 'Cima',
    DPAD_DOWN: 'Baixo',
    DPAD_LEFT: 'Esquerda',
    DPAD_RIGHT: 'Direita',
  },
  portuguese: {
    DPAD_UP: 'Cima',
    DPAD_DOWN: 'Baixo',
    DPAD_LEFT: 'Esquerda',
    DPAD_RIGHT: 'Direita',
  },
  italian: {
    DPAD_UP: 'Su',
    DPAD_DOWN: 'Giù',
    DPAD_LEFT: 'Sinistra',
    DPAD_RIGHT: 'Destra',
  },
  polish: {
    DPAD_UP: 'Góra',
    DPAD_DOWN: 'Dół',
    DPAD_LEFT: 'Lewo',
    DPAD_RIGHT: 'Prawo',
  },
  czech: {
    DPAD_UP: 'Nahoru',
    DPAD_DOWN: 'Dolů',
    DPAD_LEFT: 'Vlevo',
    DPAD_RIGHT: 'Vpravo',
  },
  slovak: {
    DPAD_UP: 'Hore',
    DPAD_DOWN: 'Dole',
    DPAD_LEFT: 'Vľavo',
    DPAD_RIGHT: 'Vpravo',
  },
  hungarian: {
    DPAD_UP: 'Fel',
    DPAD_DOWN: 'Le',
    DPAD_LEFT: 'Balra',
    DPAD_RIGHT: 'Jobbra',
  },
  russian: {
    DPAD_UP: 'Вверх',
    DPAD_DOWN: 'Вниз',
    DPAD_LEFT: 'Влево',
    DPAD_RIGHT: 'Вправо',
  },
  ukrainian: {
    DPAD_UP: 'Вгору',
    DPAD_DOWN: 'Вниз',
    DPAD_LEFT: 'Вліво',
    DPAD_RIGHT: 'Вправо',
  },
  turkish: {
    DPAD_UP: 'Yukarı',
    DPAD_DOWN: 'Aşağı',
    DPAD_LEFT: 'Sol',
    DPAD_RIGHT: 'Sağ',
  },
  thai: {
    DPAD_UP: 'บน',
    DPAD_DOWN: 'ล่าง',
    DPAD_LEFT: 'ซ้าย',
    DPAD_RIGHT: 'ขวา',
  },
  japanese: {
    DPAD_UP: '上',
    DPAD_DOWN: '下',
    DPAD_LEFT: '左',
    DPAD_RIGHT: '右',
  },
  schinese: {
    DPAD_UP: '上',
    DPAD_DOWN: '下',
    DPAD_LEFT: '左',
    DPAD_RIGHT: '右',
  },
};

function normalizeButtonName(value) {
  const raw = String(value || '').trim().toUpperCase();
  return CONTROLLER_BUTTONS.has(raw) ? raw : null;
}

function normalizeControllerLayout(value) {
  const raw = String(value || '').trim().toLowerCase();
  return CONTROLLER_LAYOUTS.includes(raw) ? raw : 'auto';
}

// Best-effort detection from the browser Gamepad API. Controller ids differ between
// browsers and drivers, so this stays intentionally loose and falls back to Xbox.
function detectControllerLayout(gamepads) {
  const list = Array.isArray(gamepads) ? gamepads : Array.from(gamepads || []);
  const gamepad = list.find(Boolean);
  const id = String((gamepad && (gamepad.id || gamepad.productId)) || '').toLowerCase();
  if (!id) return 'xbox';
  if (/playstation|dualsense|dualshock|ps5|ps4|wireless controller/.test(id)) return 'playstation';
  if (/nintendo|switch|pro controller/.test(id)) return 'switch';
  if (/xbox|microsoft/.test(id)) return 'xbox';
  return 'xbox';
}

function resolveControllerLayout(value, gamepads) {
  const normalized = normalizeControllerLayout(value);
  if (normalized !== 'auto') return normalized;
  try {
    return detectControllerLayout(gamepads);
  } catch {
    return 'xbox';
  }
}

function buttonLabel(value, button, gamepads, locale) {
  const layout = resolveControllerLayout(value, gamepads);
  const name = normalizeButtonName(button);
  const table = BUTTON_LABELS[layout] || BUTTON_LABELS.xbox;
  if (!name) return String(button || '');
  const localeKey = String(locale || '').toLowerCase().replace(/[-_]/g, '');
  const localizedTable = LOCALIZED_BUTTON_LABELS[LOCALE_ALIASES[localeKey] || localeKey];
  const localizedCommon = LOCALIZED_COMMON_LABELS[LOCALE_ALIASES[localeKey] || localeKey];
  const localized =
    (localizedTable && localizedTable[layout] && localizedTable[layout][name]) ||
    (localizedCommon && localizedCommon[name]);
  return localized || table[name] || name;
}

function normalizeControllerBinding(value, options = {}) {
  const allowSingle = options.allowSingle !== false;
  const maxButtons = Math.max(1, Number(options.maxButtons) || 3);
  const allowedSource = Array.isArray(options.allowedButtons)
    ? options.allowedButtons
    : CONTROLLER_BUTTON_ORDER;
  const allowed = new Set(allowedSource.map(normalizeButtonName).filter(Boolean));
  const rawButtons = Array.isArray(value) ? value : String(value || '').split('+');
  const seen = new Set();
  const out = [];
  for (const raw of rawButtons) {
    const name = normalizeButtonName(raw);
    if (!name || !allowed.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  const valid = (allowSingle ? out.length >= 1 : out.length >= 2) && out.length <= maxButtons;
  return valid ? out : null;
}

function parseControllerBinding(value, fallback) {
  const parsed = normalizeControllerBinding(value, { allowSingle: true, maxButtons: 3 });
  return parsed && parsed.length ? parsed : fallback;
}

function bindingLabel(value, binding, gamepads, locale) {
  const buttons = normalizeControllerBinding(binding, { allowSingle: true, maxButtons: 3 });
  if (!buttons || !buttons.length) return '';
  return buttons.map((button) => buttonLabel(value, button, gamepads, locale)).join(' + ');
}

function comboPressed(gamepad, binding) {
  const buttons = normalizeControllerBinding(binding, { allowSingle: true, maxButtons: 3 });
  if (!buttons || !buttons.length || !gamepad || !gamepad.buttons || typeof gamepad.buttons.length !== 'number') return false;
  return buttons.every((button) => {
    const index = GAMEPAD_BUTTON_INDEX[button];
    return index !== undefined && Boolean(gamepad.buttons[index] && gamepad.buttons[index].pressed);
  });
}

const api = {
  CONTROLLER_LAYOUTS,
  CONTROLLER_BUTTON_ORDER,
  CONTROLLER_BUTTONS,
  TOGGLE_ALLOWED,
  MODE_ALLOWED,
  normalizeControllerLayout,
  detectControllerLayout,
  resolveControllerLayout,
  normalizeButtonName,
  normalizeControllerBinding,
  parseControllerBinding,
  buttonLabel,
  bindingLabel,
  comboPressed,
  GAMEPAD_BUTTON_INDEX,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.ControllerLabels = api;
