'use strict';

// Notification presets are independent HTML documents: their meta dimensions and their scale can
// differ substantially. Keep their host BrowserWindow inside the usable desktop area before the
// preset is loaded, so an edge choice remains an edge choice for every theme.
const DEFAULT_MARGIN = 6;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function normalizeWorkArea(workArea) {
  const width = Math.max(1, Math.floor(number(workArea && workArea.width, 1)));
  const height = Math.max(1, Math.floor(number(workArea && workArea.height, 1)));
  return {
    x: Math.floor(number(workArea && workArea.x)),
    y: Math.floor(number(workArea && workArea.y)),
    width,
    height,
  };
}

function usableMargin(workArea, requested = DEFAULT_MARGIN) {
  // A pathological tiny work area must still leave room for a one-pixel window on both axes.
  return Math.min(Math.max(0, Math.floor(number(requested, DEFAULT_MARGIN))), Math.floor(Math.min(workArea.width, workArea.height) / 4));
}

function fitNotificationScale({ baseWidth, baseHeight, scale, workArea, margin = DEFAULT_MARGIN }) {
  const area = normalizeWorkArea(workArea);
  const edge = usableMargin(area, margin);
  const width = Math.max(1, number(baseWidth, 400));
  const height = Math.max(1, number(baseHeight, 200));
  const requestedScale = number(scale, 1) > 0 ? number(scale, 1) : 1;
  const availableWidth = Math.max(1, area.width - edge * 2);
  const availableHeight = Math.max(1, area.height - edge * 2);
  const maximumScale = Math.min(availableWidth / width, availableHeight / height);
  const effectiveScale = Math.min(requestedScale, maximumScale);

  return {
    scale: effectiveScale,
    width: Math.min(availableWidth, Math.max(1, Math.ceil(width * effectiveScale))),
    height: Math.min(availableHeight, Math.max(1, Math.ceil(height * effectiveScale))),
    margin: edge,
  };
}

function placeNotification({ position, width, height, workArea, custom, margin = DEFAULT_MARGIN }) {
  const area = normalizeWorkArea(workArea);
  const edge = usableMargin(area, margin);
  const fittedWidth = Math.min(Math.max(1, Math.ceil(number(width, 1))), Math.max(1, area.width - edge * 2));
  const fittedHeight = Math.min(Math.max(1, Math.ceil(number(height, 1))), Math.max(1, area.height - edge * 2));
  const minX = area.x + edge;
  const minY = area.y + edge;
  const maxX = area.x + area.width - edge - fittedWidth;
  const maxY = area.y + area.height - edge - fittedHeight;
  const centerX = area.x + Math.floor((area.width - fittedWidth) / 2);
  const centerY = area.y + Math.floor((area.height - fittedHeight) / 2);
  let x = centerX;
  let y = maxY;

  switch (position) {
    case 'center-top':
      y = minY;
      break;
    case 'top-left':
      x = minX;
      y = minY;
      break;
    case 'top-right':
      x = maxX;
      y = minY;
      break;
    case 'middle-left':
      x = minX;
      y = centerY;
      break;
    case 'middle-right':
      x = maxX;
      y = centerY;
      break;
    case 'bottom-left':
      x = minX;
      y = maxY;
      break;
    case 'bottom-right':
      x = maxX;
      y = maxY;
      break;
    case 'custom':
      x = number(custom && custom.x, centerX);
      y = number(custom && custom.y, maxY);
      break;
    case 'center-bottom':
    default:
      break;
  }

  return {
    x: Math.round(clamp(x, minX, maxX)),
    y: Math.round(clamp(y, minY, maxY)),
    width: fittedWidth,
    height: fittedHeight,
    margin: edge,
  };
}

module.exports = {
  DEFAULT_MARGIN,
  fitNotificationScale,
  placeNotification,
};
