'use strict';

function finite(value) {
  return Number.isFinite(value);
}

// Electron's bounds are device-independent pixels. Keep a newly created window fully on the
// matching display: Windows can otherwise restore a DPI-scaled frameless window with its caption
// controls beyond the physical work area.
function clampWindowBoundsToWorkArea(bounds, workArea) {
  if (![bounds?.x, bounds?.y, bounds?.width, bounds?.height, workArea?.x, workArea?.y, workArea?.width, workArea?.height].every(finite)) {
    return bounds;
  }

  const maxX = Math.max(workArea.x, workArea.x + workArea.width - bounds.width);
  const maxY = Math.max(workArea.y, workArea.y + workArea.height - bounds.height);
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY),
  };
}

module.exports = { clampWindowBoundsToWorkArea };
