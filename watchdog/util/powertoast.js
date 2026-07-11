'use strict';

let modulePromise;
const load = () => modulePromise || (modulePromise = import('powertoast'));

async function toast(options) {
  const { Toast } = await load();
  return new Toast(options).show();
}

toast.isWinRTAvailable = async () => Boolean((await load()).isWinRTAvailable);

module.exports = toast;
