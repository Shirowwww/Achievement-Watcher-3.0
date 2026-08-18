'use strict';

let modulePromise;
const load = () => modulePromise || (modulePromise = import('powertoast'));

// Boundary contract enforcement: powertoast only understands `aumid`, but the old codebase used
// `appID` for years (silently falling back to the Microsoft Store identity - issue #8). Every
// call site is fixed, and this normalizer guarantees a future `appID` slip can never silently
// break toasts again.
function normalizeToastOptions(options) {
  const normalized = { ...(options || {}) };
  if (normalized.aumid == null && normalized.appID != null) {
    normalized.aumid = normalized.appID;
    delete normalized.appID;
  }
  return normalized;
}

async function toast(options) {
  const { Toast } = await load();
  // powertoast reads `disableWinRT` from the show() options, not from the constructor options.
  // Splitting it here is what actually makes the "use PowerShell" fallback controllable; callers
  // that set `disableWinRT` on the payload were silently ignored before.
  const { disableWinRT, ...toastOptions } = normalizeToastOptions(options);
  return new Toast(toastOptions).show({ disableWinRT: !!disableWinRT });
}

toast.isWinRTAvailable = async () => Boolean((await load()).isWinRTAvailable);

module.exports = toast;
module.exports.normalizeToastOptions = normalizeToastOptions;
