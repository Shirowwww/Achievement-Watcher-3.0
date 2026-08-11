'use strict';

/*
  Serialise the shared Puppeteer page by scrape type while making the lifecycle
  of its flags exception-safe. The operation owns only the flags it claims:
  an unrelated scrape type can keep running, and a browser-launch failure can
  never leave a future request waiting forever.
*/
function requestedScrapeKinds(alternate) {
  return {
    steamcommunity: alternate?.steamcommunity === true,
    steamhunters: alternate?.steamhunters === true,
  };
}

function conflictsWithActiveScrape(state, kinds) {
  return (kinds.steamcommunity && state.steamcommunity) || (kinds.steamhunters && state.steamhunters);
}

async function withScrapeLease(state, alternate, operation, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))) {
  const kinds = requestedScrapeKinds(alternate);
  if (!kinds.steamcommunity && !kinds.steamhunters) return operation();

  while (conflictsWithActiveScrape(state, kinds)) await wait(100);

  if (kinds.steamcommunity) state.steamcommunity = true;
  if (kinds.steamhunters) state.steamhunters = true;
  try {
    return await operation();
  } finally {
    if (kinds.steamcommunity) state.steamcommunity = false;
    if (kinds.steamhunters) state.steamhunters = false;
  }
}

module.exports = { requestedScrapeKinds, conflictsWithActiveScrape, withScrapeLease };
