'use strict';

const path = require('path');
const { app } = require('electron');
app.setName('Achievement Watcher');
app.setPath('userData', path.join(app.getPath('appData'), app.getName()));
// Keep GPU acceleration enabled, but avoid Chromium background services AW does not use in tray mode.
for (const sw of ['disable-extensions', 'disable-component-extensions-with-background-pages', 'disable-default-apps', 'disable-background-networking']) {
  app.commandLine.appendSwitch(sw);
}
// Cap V8 old-space for the main process. It drives the on-demand puppeteer scrape and the windows, but
// spends most of its life as a resident tray daemon — a 256 MB ceiling bounds heap growth and forces
// the GC to reclaim earlier when idle, without starving the brief scrape/HTML-parse bursts.
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256');
const CHROMIUM_REVISION = '1108766';
const { BrowserWindow, dialog, session, shell, ipcMain, globalShortcut, Tray, Menu, nativeImage, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
autoUpdater.autoInstallOnAppQuit = false;
const minimist = require('minimist');
const { exec, execSync, spawn } = require('child_process');
const fs = require('fs');
const ipc = require(path.join(__dirname, 'ipc.js'));
const { pathToFileURL } = require('url');
const BASE_URL = 'https://www.steamgriddb.com/api/v2';
const API_KEY = '2a9d32ddd0bfe4e1191b4f6ff56fef60'; // TODO: remove this and load from config file

let remoteMain = null;
function getRemoteMain() {
  if (!remoteMain) {
    remoteMain = require('@electron/remote/main');
    remoteMain.initialize();
  }
  return remoteMain;
}

let fetchImpl = null;
function fetch(...args) {
  if (!fetchImpl) fetchImpl = require('node-fetch');
  return fetchImpl(...args);
}

function createXmlParser() {
  const { XMLParser } = require('fast-xml-parser');
  return new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true, cdataPropName: '__cdata' });
}

function fetchSteamIcon(url, appid) {
  return require(path.join(__dirname, '../parser/steam.js')).fetchIcon(url, appid);
}

let client; //lazyload SteamUser
let clientLoginPromise;

function clientLogOn() {
  const SteamUser = require('steam-user');
  if (!client) client = new SteamUser();
  if (client.steamID) return Promise.resolve();
  if (clientLoginPromise) return clientLoginPromise;
  clientLoginPromise = new Promise((resolve) => {
    client.logOn({ anonymous: true });
    client.on('loggedOn', () => {
      clientLoginPromise = null;
      resolve();
    });
  });
  return clientLoginPromise;
}

const manifest = require('../package.json');
const userData = app.getPath('userData');
let currentlyscraping = { steamcommunity: false, steamhunters: false };
let settingsJS = null;
let configJS = null;
let achievementsJS = null;

// Keep GPU hardware acceleration ON (default). Disabling it shaves ~30 MB idle but makes the library
// scroll janky under software compositing (cover images), which is not worth it for an app whose
// window is used interactively. Honour the explicit config opt-out, plus the user-facing General-tab
// toggle. disableHardwareAcceleration() must run before app 'ready', so we read options.ini directly
// here rather than via the async settings loader / renderer.
let userDisableGpu = false;
try {
  const parsed = require('@xan105/ini').parse(fs.readFileSync(path.join(userData, 'cfg/options.ini'), 'utf8'));
  const v = parsed && parsed.general && parsed.general.disableHardwareAccel;
  userDisableGpu = v === true || v === 'true';
} catch {
  /* no options.ini yet (first run) -> keep GPU acceleration on */
}
if (manifest.config['disable-gpu'] || userDisableGpu) app.disableHardwareAcceleration();
if (manifest.config.appid) app.setAppUserModelId(manifest.config.appid);
manifest.config.debug = process.env.NODE_ENV === 'development' || process.defaultApp || /[\\/]electron/.test(process.execPath);

let puppeteerWindow = {};
let MainWin = null;
let overlayWindow = null;
let isOverlayShowing = false;
let debug = new (require('@xan105/log'))({
  console: manifest.config.debug || false,
  file: path.join(userData, `logs/renderer.log`),
});


async function fetchSteamCommunityAchievements(url) {
  // The steamcommunity achievements page is server-rendered HTML, so a plain HTTP fetch + parse
  // fully replaces a puppeteer/Chromium scrape here (verified for visible achievements). Returns the
  // same { img, title, description } shape the callers expect; [] on any failure so nothing throws.
  try {
    const htmlParser = require('node-html-parser');
    const res = await fetch(url, {
      headers: {
        'User-Agent': manifest.config['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept-Language': 'en-US,en;q=0.9',
        Cookie: 'birthtime=662716801; wants_mature_content=1', // bypass age gate; ?l= controls language
      },
      redirect: 'follow',
    });
    if (!res.ok) return [];
    const html = htmlParser.parse(await res.text());
    return html.querySelectorAll('.achieveRow').map((row) => {
      const src = row.querySelector('.achieveImgHolder img')?.getAttribute('src') || '';
      const img = src ? src.split('/').pop().split('.jpg')[0] : null;
      const title = row.querySelector('.achieveTxt h3')?.text?.trim() || null;
      const description = row.querySelector('.achieveTxt h5')?.text?.trim() || null;
      return { img, title, description };
    });
  } catch (err) {
    debug.log(`steamcommunity fetch failed: ${err}`);
    return [];
  }
}

// Browser-free achievement schema via the official Steam Web API. Uses IPlayerService/
// GetGameAchievements rather than the legacy ISteamUserStats/GetSchemaForGame: the legacy endpoint
// always blanks the description of hidden ("secret") achievements as a spoiler guard, key or no key,
// which is why hidden achievements were permanently stuck on "…" even for users with a Steam Web API
// key (#57). GetGameAchievements has no such restriction — verified live against multiple titles
// (007 First Light, Fast Food Simulator, even 2004's Half-Life 2): every hidden achievement comes
// back with a real localized_desc.
// Returns the same shape the steamhunters puppeteer scrape produces, so it is a drop-in
// replacement when the user has configured a Steam Web API key. Returns:
//   - an array of achievements on success
//   - [] when the API responded but the game exposes no achievement schema
//   - null on a transport/auth error, so the caller can fall back to scraping
async function getSchemaFromWebAPI(appid, key, lang) {
  const language = (lang && (lang.api || lang)) || 'english';
  const url = `https://api.steampowered.com/IPlayerService/GetGameAchievements/v1/?key=${key}&appid=${appid}&language=${encodeURIComponent(language)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    debug.log(`[${appid}] GetGameAchievements network error: ${err.message}`);
    return null;
  }
  if (!res.ok) {
    debug.log(`[${appid}] GetGameAchievements HTTP ${res.status}`);
    return null; // 403 = bad/over-quota key, etc. -> let caller decide to scrape
  }
  let json;
  try {
    json = await res.json();
  } catch (err) {
    return null;
  }
  const list = json?.response?.achievements;
  if (!Array.isArray(list)) return []; // valid response, game just has no achievements
  return list.map((a) => ({
    name: a.internal_name,
    default_value: 0,
    displayName: a.localized_name,
    hidden: a.hidden ? 1 : 0,
    description: a.localized_desc || ' ',
    icon: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${a.icon}`,
    icongray: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/${appid}/${a.icon_gray}`,
  }));
}

async function getSteamData(request) {
  const appid = request.appid;
  const type = request.type;
  let user = request.user;
  let userid;
  const lang = request.lang || 'english';
  if (!configJS) {
    try {
      await startEngines(); // makes the Steam Web API key available for the browser-free schema path
    } catch (err) {
      debug.log('startEngines (getSteamData) failed: ' + err.message);
    }
  }
  try {
    if (type === 'user') {
      const url = `https://steamcommunity.com/profiles/${user}/stats/${appid}/?xml=1`;
      const res = await fetch(url);
      const xml = await res.text();
      const parser = createXmlParser();
      const data = parser.parse(xml);
      const achievements = data?.playerstats?.achievements?.achievement || [];
      const list = Array.isArray(achievements) ? achievements : [achievements];

      return list.map((a) => {
        const name = a.apiname?.__cdata || a.apiname || '';
        const unlock = parseInt(a.unlockTimestamp ?? 0);
        return {
          apiname: name,
          achieved: unlock > 0 ? 1 : 0,
          unlocktime: unlock || 0,
        };
      });
    }
    if (type === 'steamcommunity') {
      let info = { appid };
      const url = `https://steamcommunity.com/stats/${appid}/achievements?l=${lang.api}`; //this doesnt give hidden descriptions
      info.achievements = await fetchSteamCommunityAchievements(url);
      currentlyscraping.steamcommunity = false;
      if (info.achievements.length > 0 && info.achievements.every((a) => a.description)) {
        return info;
      }

      let validXml = false;
      let xml;

      //instead of looping steamuserids,
      //lets get users from steamhunters and try those

      await scrapeWithPuppeteer(info, { userlist: true, steamhunters: true, appid });
      currentlyscraping.steamhunters = false;
      let u = info.users.map((user) => user.steamId);

      for (let id of u) {
        userid = id;
        const url = `https://steamcommunity.com/profiles/${userid}/stats/${appid}/?xml=1`; // this for all data
        const res = await fetch(url);
        xml = await res.text();
        validXml = !(xml.startsWith('<!DOCTYPE html') || xml.includes('<html'));
        if (!validXml) continue;

        const parser = createXmlParser();
        const data = parser.parse(xml);
        const achievements = data?.playerstats?.achievements?.achievement || [];
        const list = achievements.map((a) => {
          const unlocked = a['@_closed'] === '1';
          const name = a.name.__cdata;
          const description = a.description.__cdata;
          return { name, description, unlocked };
        });
        const allgood = list.every((a) => a.description);
        if (!allgood) continue;
        const url2 = `https://steamcommunity.com/profiles/${userid}/stats/${appid}?l=${lang.api}`; // this for name and description, match them via icon hash
        info.achievements = await fetchSteamCommunityAchievements(url2);
        currentlyscraping.steamcommunity = false;
        return info;
      }
      // TODO: fallback to steamuserids if noone on steamhunters has 100% the game
      return info;
    }

    if (type === 'data' || type === 'steamhunters') {
      let info = { appid };
      // Fast path: official Steam Web API schema (no headless browser) when a key is configured.
      // A blocking sendSync from the renderer drives this; the puppeteer scrape below can take up to
      // 30s per game and freezes the whole UI, so prefer the ~200ms API call whenever possible.
      const key = configJS?.steam?.apiKey;
      if (key) {
        const ach = await getSchemaFromWebAPI(appid, key, request.lang);
        if (ach !== null) {
          info.achievements = ach;
          return info;
        }
        // ach === null -> API/auth/network failure; fall through to the scraper below
      }
      await scrapeWithPuppeteer(info, { steamhunters: true });
      currentlyscraping.steamhunters = false;
      if (type === 'data') {
        // scrapeWithPuppeteer already ran above; bound this fallback wait so a scrape that never
        // populates achievements can't hang the blocking sendSync IPC forever (~30s cap).
        let waited = 0;
        while (!info.achievements && waited < 60) {
          await delay(500);
          waited++;
        }
      }
      return info;
    }
    await clientLogOn();
    const storeURL = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=en`;
    const storeRes = await fetch(storeURL);
    const json = await storeRes.json();
    const storeData = json[appid] && json[appid].data;
    const { apps, packages, unknownApps, unknownPackages } = await client.getProductInfo([appid], [], false);
    const appInfo = apps[appid]?.appinfo || apps[0]?.appinfo;

    switch (type) {
      case 'name':
        return appInfo?.common?.name;

      case 'header':
        return (
          appInfo.common.header_image?.[lang.api] ||
          appInfo.common.library_assets_full?.library_header?.image[lang.api] ||
          appInfo.common.header_image.english ||
          appInfo.common.library_assets_full?.library_header?.image?.english
        );
      case 'icon':
        return appInfo.common.icon;
      case 'portrait':
        return (
          appInfo.common.library_assets_full?.library_capsule?.image[lang] || appInfo.common.library_assets_full?.library_capsule?.image?.english
        );
      default:
      case 'common':
        return {
          name: appInfo.common.name,
          isGame: appInfo?.common?.type?.toLowerCase() === 'game',
          translated: appInfo?.common?.languages?.[lang.api] || false,
          icon: appInfo.common.icon,
          header:
            appInfo.common.header_image?.[lang.api] ||
            appInfo.common.library_assets_full?.library_header?.image?.[lang.api] ||
            appInfo.common.header_image?.english ||
            appInfo.common.library_assets_full?.library_header?.image?.english ||
            storeData?.header_image,
          portrait:
            appInfo.common.library_assets_full?.library_capsule?.image?.[lang.api] ||
            appInfo.common.library_assets_full?.library_capsule?.image?.english,
          background: storeData?.background.replace(/(\?|&)t=\d+$/, ''),
        };
    }

    await delay(1000);
  } catch (err) {
    debug.log(err);
  }
  return {};
}

async function closePuppeteer() {
  currentlyscraping.steamcommunity = false;
  currentlyscraping.steamhunters = false;
  if (!puppeteerWindow) {
    puppeteerWindow = {};
    return;
  }
  // Detach references FIRST so a concurrent startPuppeteer() spins up a fresh browser instead of
  // grabbing the one being torn down — that race is how orphaned/duplicate Chromium instances
  // accumulated (#32). Then close the captured handles, tolerating an already-closed browser.
  const browser = puppeteerWindow.browser;
  const context = puppeteerWindow.context;
  puppeteerWindow.browser = undefined;
  puppeteerWindow.context = undefined;
  puppeteerWindow.pagesh = undefined;
  puppeteerWindow.pagesc = undefined;
  puppeteerWindow.page = undefined;
  try {
    if (context) await context.close();
  } catch {}
  try {
    if (browser) await browser.close();
  } catch {}
}

async function startEngines() {
  if (!settingsJS) {
    settingsJS = require(path.join(__dirname, '../settings.js'));
    settingsJS.setUserDataPath(userData);
  }
  configJS = await settingsJS.load();
  if (!achievementsJS) {
    achievementsJS = require(path.join(__dirname, '../parser/achievements.js'));
    achievementsJS.initDebug({ isDev: app.isDev || false, userDataPath: userData });
    // The per-game emulator setup now runs in the background (so a slow first-run fix can't blow the
    // scan timeout), finishing after makeList's onGame callback has returned. Register a completion
    // handler so the daemon still fires its "emulator fix applied" toast when each fix actually lands.
    if (achievementsJS.setEmulatorFixedHandler) achievementsJS.setEmulatorFixedHandler((g) => notifyEmulatorFixed(g));
  }
}

async function getCachedData(info) {
  if (!info.source) info.source = 'steam';
  let g = await achievementsJS.getGameFromCache(info.appid, info.source, configJS);
  switch (info.source.toLowerCase()) {
    case 'epic':
    case 'gog':
    case 'luma':
    case 'steam':
    default:
      if (g) {
        info.a = g.achievement.list.find((ac) => ac.name === String(info.ach));
        info.game = g;
        info.description = info.a?.displayName;
        return;
      }
      const [data, com] = await Promise.all([
        getSteamData({ appid: info.appid, type: 'steamhunters' }),
        getSteamData({ appid: info.appid, type: 'common' }),
      ]);
      info.game = com;
      info.game.achievements = data.achievements;

      await achievementsJS.saveGameToCache(info, configJS.achievement.lang);
      info.a = info.game.achievements.find((ac) => ac.name === String(info.ach));
      info.description = info.a?.displayName;
  }
}

ipcMain.on('close-puppeteer', async (event, arg) => {
  await closePuppeteer();
  event.returnValue = true;
});

ipcMain.on('get-steam-data', async (event, arg) => {
  const appid = +arg.appid;
  event.returnValue = await getSteamData({ appid, type: arg.type, user: arg.user, lang: arg.lang });
});

// Reload the cached config when the renderer saves settings (onboarding finish, Settings auto-save).
// Keeps configJS — and everything that reads it (the key-driven schema fast path below, background
// auto-fix, overlay/notification lookups) — in sync without an app restart, so a Steam Web API key
// entered during onboarding takes effect on the very next scan.
ipcMain.on('config-saved', async () => {
  try {
    await startEngines(); // re-reads options.ini into configJS
  } catch (err) {
    debug.log('[config-saved] config reload failed: ' + (err.message || err));
  }
});

// Async (invoke) twin of the handler above. The key-less puppeteer scrape inside getSteamData can take
// up to ~30s per game; driving it through the blocking sendSync above froze the whole renderer for the
// entire load (most visible on a fresh install with no API key and no cache — the UI hangs from the
// very first game). Renderer callers use invoke so the UI thread stays responsive while the scrape runs
// in the main process (which already serialises concurrent scrapes via the currentlyscraping mutex).
ipcMain.handle('get-steam-data', async (event, arg) => {
  const appid = +arg.appid;
  return await getSteamData({ appid, type: arg.type, user: arg.user, lang: arg.lang });
});

ipcMain.on('get-steam-appid-from-title', async (event, arg) => {
  function normalizeTitle(str) {
    return str
      .toLowerCase()
      .normalize('NFKD') // normalize accents
      .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A']/g, '') // single quotes
      .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB"]/g, '') // double quotes
      .replace(/[™®©]/g, '') // trademark symbols
      .replace(/[:.,!?()\\[\\]{}\-]/g, '') // punctuation + hyphens
      .replace(/\s+/g, ' ') // collapse spaces
      .trim();
  }

  let info = { name: arg.title };
  searchForSteamAppId(info);
  let possibleMatch;
  // searchForSteamAppId populates info.games asynchronously; bound the poll so a failed page load
  // can't leave this blocking sendSync hanging forever (~30s cap, then return the best partial match).
  let tries = 0;
  while (tries < 60) {
    if (info.games) {
      for (let game of info.games) {
        if (normalizeTitle(game.title) === normalizeTitle(arg.title)) {
          event.returnValue = game.appid;
          return;
        }
        if (!possibleMatch && normalizeTitle(game.title).includes(normalizeTitle(arg.title))) {
          possibleMatch = game.appid;
        }
      }
      break;
    }
    await delay(500);
    tries++;
  }
  event.returnValue = possibleMatch;
});

ipcMain.on('get-title-from-epic-id', async (event, arg) => {
  let info = { appid: arg.appid };
  await searchForGameName(info); // bounded internally; info.title may be undefined on a miss
  event.returnValue = info.title;
});

ipcMain.on('get-images-for-game', async (event, arg) => {
  const gameName = arg.name;
  try {
    const searchRes = await fetch(`${BASE_URL}/search/autocomplete/${encodeURIComponent(gameName)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    const searchData = await searchRes.json();
    const game = searchData.data[0];
    if (!game) {
      debug.log('Game not found');
      return;
    }

    const gameId = game.id;

    const [iconsRes, gridsRes, heroesRes, logosRes] = await Promise.all([
      fetch(`${BASE_URL}/icons/game/${gameId}`, { headers: { Authorization: `Bearer ${API_KEY}` } }),
      fetch(`${BASE_URL}/grids/game/${gameId}`, { headers: { Authorization: `Bearer ${API_KEY}` } }),
      fetch(`${BASE_URL}/heroes/game/${gameId}`, { headers: { Authorization: `Bearer ${API_KEY}` } }),
      fetch(`${BASE_URL}/logos/game/${gameId}`, { headers: { Authorization: `Bearer ${API_KEY}` } }),
    ]);

    const [icons, grids, heroes, logos] = await Promise.all([iconsRes.json(), gridsRes.json(), heroesRes.json(), logosRes.json()]);

    const portrait = grids.data.find((g) => g.width === 600 && g.height === 900);
    const landscape = grids.data.find((g) => g.width === 920 && g.height === 430);
    const links = {
      icon: icons.data?.[0]?.url || logos.data?.[0]?.url,
      background: heroes.data?.[0]?.url,
      portrait: portrait?.url,
      landscape: landscape?.url,
    };
    event.returnValue = links;
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

ipcMain.on('stylize-background-for-appid', async (event, arg) => {
  const imageUrl = arg.background;
  const t = path.parse(imageUrl).base;
  const outputPath = path.join(app.getPath('userData'), 'steam_cache', 'icon', arg.appid, t);
  const sharp = require('sharp');

  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    const buffer = await res.buffer();

    const metadata = await sharp(buffer).metadata();
    const { width, height } = metadata;

    const processedBuffer = await sharp(buffer)
      .blur(5)
      .modulate({ saturation: 0.5 })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${width}" height="${height}">
              <rect width="100%" height="100%" fill="#3b65a7" fill-opacity="0.8"/>
              <rect width="100%" height="100%" fill="#000000" fill-opacity="0.4"/>
             </svg>`
          ),
          blend: 'over',
        },
      ])
      .toBuffer();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, processedBuffer);
  } catch (err) {
    console.error('❌ Error:', err.message);
  }
});

ipcMain.on('fetch-source-img', async (event, arg) => {
  switch (arg) {
    case 'epic':
      event.returnValue = path.join(process.env['APPDATA'], 'Achievement Watcher', 'Source', 'epic.svg');
      break;
    case 'gog':
      event.returnValue = path.join(process.env['APPDATA'], 'Achievement Watcher', 'Source', 'gog.svg');
      break;
    case 'RPCS3 Emulator':
    case 'ShadPS4 Emulator':
      event.returnValue = path.join(process.env['APPDATA'], 'Achievement Watcher', 'Source', 'playstation.svg');
      break;
    case 'Xenia Emulator':
      event.returnValue = path.join(process.env['APPDATA'], 'Achievement Watcher', 'Source', 'xbox.svg');
      break;
    case 'Unconfigured':
      // Exe-detected-only entry (no Steam appid match) — use a generic file icon instead of the
      // Steam logo so these don't look like confirmed Steam games in the list.
      event.returnValue = path.join(__dirname, '../resources/img/file-text@2x.png');
      break;
    case 'steam':
    default:
      event.returnValue = path.join(process.env['APPDATA'], 'Achievement Watcher', 'Source', 'steam.svg');
      break;
  }
});

ipcMain.handle('get-achievements', async (event, appid) => {
  return await getSteamData({ appid, type: 'steamhunters' });
});

// Kill any Watchdog currently holding the WS port (8082). The Watchdog is a detached nw.exe -> node
// chain we cannot track by PID, so we target it by its well-known port. This is used before launching
// a fresh Watchdog so it always loads the current code, while normal app quits leave the background
// tracker alive for overlay/toast notifications.
function killWatchdog() {
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8', windowsHide: true });
    const pids = new Set();
    for (const line of out.split('\n')) {
      if (line.includes(':8082') && /LISTENING/i.test(line)) {
        const pid = line.trim().split(/\s+/).pop();
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid);
      }
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { windowsHide: true, stdio: 'ignore' });
        debug.log(`[watchdog] killed stale instance PID ${pid} on port 8082`);
      } catch {}
    }
  } catch (err) {
    debug.log(`[watchdog] killWatchdog failed: ${err.message}`);
  }
}

// Supervise the Watchdog monitor as a child of this (resident, tray-resident) main process.
//
// The monitor runs under Electron's OWN runtime: we spawn this very executable in ELECTRON_RUN_AS_NODE
// mode (so it behaves as plain Node) with an 'ipc' stdio channel. Since the A2 koffi migration, the
// monitor's native deps (wql-process-monitor, regodit, xinput-ffi) are ABI-stable (koffi) and load
// fine under Electron's Node ABI, so the bundled portable node.exe (Node 14) is gone. The monitor
// forwards overlay/notification window requests over IPC (see watchdog SpawnOverlayNotification)
// straight into parseArgs() here, instead of spawning a second Electron process. The child is
// supervised (re-spawned on unexpected exit) and killed when the app quits.
let monitorProc = null;
let monitorRespawnTimer = null;
let watchdogStatusInterval = null;

// Route a monitor IPC message. It sends { argv: ['--wintype=overlay'|'notification', ...] } in place
// of the legacy `Achievement Watcher.exe --wintype=...` spawn; feed it through the existing dispatch.
function handleMonitorMessage(msg) {
  try {
    if (msg && Array.isArray(msg.argv)) parseArgs(minimist(msg.argv));
  } catch (err) {
    debug.log(`[monitor] message handling failed: ${err.message || err}`);
  }
}

function launchWatchdog() {
  clearTimeout(monitorRespawnTimer);
  if (monitorProc && monitorProc.exitCode === null && !monitorProc.killed) {
    return { ok: true }; // already running — idempotent
  }

  const baseDir = manifest.config.debug ? path.join(__dirname, '../../') : path.dirname(process.execPath);
  const wdDir = path.join(baseDir, 'watchdog');

  // Validate the launch chain up front. Missing pieces (notably watchdog/node_modules) would
  // otherwise fail in ways that are hard to diagnose from a detached child.
  const requiredPaths = {
    'watchdog dir': wdDir,
    'watchdog/node_modules': path.join(wdDir, 'node_modules'),
  };
  for (const [label, p] of Object.entries(requiredPaths)) {
    if (!fs.existsSync(p)) {
      debug.log(`[monitor] Cannot launch: missing ${label} at ${p}`);
      return { ok: false, error: `missing ${label}` };
    }
  }

  // Sweep any stale detached Watchdog left by an older app version (it would hold port 8082 / the
  // 'Achievement Watchdog' single-instance lock and double-fire notifications). No-op when none runs.
  killWatchdog();

  // Run the monitor under Electron's own Node by re-launching this executable in ELECTRON_RUN_AS_NODE
  // mode (replaces the old bundled portable node.exe). The 'ipc' stdio channel and the child's
  // process.send()/'message' path are unchanged.
  // Cap the monitor's V8 old-space (NODE_OPTIONS is honored under ELECTRON_RUN_AS_NODE): the watchdog
  // is a lightweight event-driven node process (file watchers + WMI + toasts), so a 128 MB ceiling
  // bounds heap growth and makes the GC reclaim earlier without risking the occasional HTML-parse work.
  const nodeOpts = [process.env.NODE_OPTIONS, '--max-old-space-size=128'].filter(Boolean).join(' ');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: nodeOpts };

  try {
    const child = spawn(process.execPath, ['watchdog.js'], {
      cwd: wdDir,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'], // 'ipc' => process.send()/'message' in the child
    });
    monitorProc = child;
    child.stdout?.on('data', (d) => debug.log(`[monitor] ${String(d).trimEnd()}`));
    child.stderr?.on('data', (d) => debug.log(`[monitor:err] ${String(d).trimEnd()}`));
    child.on('message', handleMonitorMessage);
    child.on('error', (err) => debug.log(`[monitor] spawn error: ${err.message}`));
    child.on('exit', (code, signal) => {
      debug.log(`[monitor] exited code=${code}${signal ? ` signal=${signal}` : ''}`);
      if (monitorProc === child) monitorProc = null; // only clear if still the current child
      // Supervise: respawn after a short backoff unless we're quitting on purpose.
      if (!app.isQuiting && monitorProc === null) {
        clearTimeout(monitorRespawnTimer);
        monitorRespawnTimer = setTimeout(() => launchWatchdog(), 3000);
      }
    });
    debug.log('[monitor] launched (node.exe watchdog.js, ipc channel)');
    return { ok: true };
  } catch (err) {
    debug.log(`[monitor] exception launching: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

ipcMain.handle('start-watchdog', async (event, arg) => {
  event.sender.send('reset-watchdog-status');
  // Manual restart from the Settings button: kill the current child then relaunch so it always loads
  // the current code. The brief delay lets the old child release port 8082 before the new one binds.
  if (monitorProc) {
    try {
      monitorProc.kill();
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 500));
  return launchWatchdog();
});

// --- Background emulator auto-fix (daemon) -----------------------------------
// When the app runs headless in the tray (no window), periodically apply the same one-shot GBE/GSE
// emulator fix the UI scan does, so a newly-installed emulated game gets configured without the user
// opening the app. Mirrors the renderer's 15-min new-game poll (app.js scheduleNewGameScan), but only
// runs while the window is CLOSED — when it's open the renderer handles it. Gated by the existing
// emulator.autoApplyNewGames opt-out. Fires a Windows toast for each game it actually fixes.
let bgAutoFixTimer = null;
let bgAutoFixInFlight = false;
let bgKnownAppids = null; // baseline of discovered appids; null until the first full pass seeds it
const BG_AUTOFIX_INTERVAL_MS = 15 * 60 * 1000;

function notifyEmulatorFixed(game) {
  try {
    if (configJS && configJS.notification && configJS.notification.notify === false) return; // master notif switch
    if (!Notification.isSupported || !Notification.isSupported()) return;
    const fr = String((configJS && configJS.achievement && configJS.achievement.lang) || '')
      .toLowerCase()
      .startsWith('fr');
    const name = (game && game.name) || `AppID ${game && game.appid}`;
    new Notification({
      title: fr ? 'Correctif émulateur appliqué' : 'Emulator fix applied',
      body: fr ? `${name} est prêt — succès activés.` : `${name} is ready — achievements enabled.`,
      icon: path.join(__dirname, '../resources/icon/icon.png'),
    }).show();
    debug.log(`[bg-autofix] toast: emulator fix applied for ${name}`);
  } catch (err) {
    debug.log(`[bg-autofix] notify failed: ${err.message || err}`);
  }
}

async function runBackgroundAutoFix(reason) {
  if (MainWin) return; // window open → the renderer's own new-game scan handles fixes
  if (bgAutoFixInFlight) return;
  try {
    await startEngines(); // loads configJS + achievementsJS
  } catch (err) {
    debug.log(`[bg-autofix] startEngines failed: ${err.message || err}`);
    return;
  }
  if (!configJS || !configJS.emulator || configJS.emulator.autoApplyNewGames === false) return;
  bgAutoFixInFlight = true;
  try {
    // Once a baseline exists, do a cheap discovery-only poll first and run the heavier full scan only
    // when a genuinely new install appears (mirrors the renderer's runNewGameScan).
    if (bgKnownAppids !== null) {
      const discovered = await achievementsJS.detectInstalledAppids(configJS);
      const fresh = discovered.filter((id) => !bgKnownAppids.has(String(id)));
      bgKnownAppids = new Set(discovered.map(String));
      if (fresh.length === 0) return;
      debug.log(`[bg-autofix] ${fresh.length} new install(s) detected: ${fresh.join(', ')}`);
    }
    if (MainWin) return; // user opened the window during the poll — defer to the renderer
    debug.log(`[bg-autofix] running headless scan (${reason})`);
    // makeList drives the same one-shot auto-fix as the UI scan, but the per-game emulator setup now
    // runs in the background and completes AFTER makeList returns. The "emulator fix applied" toast is
    // therefore fired by the setEmulatorFixedHandler callback (registered in startEngines) as each fix
    // actually lands — not collected from onGame here.
    await achievementsJS.makeList(configJS, () => {}, () => {});
    try {
      const all = await achievementsJS.detectInstalledAppids(configJS);
      bgKnownAppids = new Set(all.map(String));
    } catch {}
    debug.log(`[bg-autofix] done — background emulator setup (if any) will toast on completion`);
  } catch (err) {
    debug.log(`[bg-autofix] failed: ${err.message || err}`);
  } finally {
    bgAutoFixInFlight = false;
  }
}

function scheduleBackgroundAutoFix() {
  if (bgAutoFixTimer) return;
  // Initial pass shortly after startup (catches games installed while AW was off / closed), then a
  // periodic poll on the same cadence the renderer uses.
  setTimeout(() => runBackgroundAutoFix('startup'), 90 * 1000);
  bgAutoFixTimer = setInterval(() => runBackgroundAutoFix('interval'), BG_AUTOFIX_INTERVAL_MS);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureChromium() {
  const { BrowserFetcher } = require('puppeteer');
  const chromium = path.join(process.env['APPDATA'], 'Achievement Watcher', 'Chromium');
  const fetcher = new BrowserFetcher({ path: chromium });
  const revisionInfo = fetcher.revisionInfo(CHROMIUM_REVISION);
  if (revisionInfo.local) return revisionInfo;
  const info = await fetcher.download(CHROMIUM_REVISION);
  return info;
}

// Microsoft Edge ships with Windows 10/11 and is Chromium-based, so puppeteer can drive it exactly
// like Chrome (the stealth plugin works on the CDP layer, independent of which Chromium binary runs).
// Using it as a fallback lets machines without Google Chrome skip the ~170 MB ensureChromium() download.
function findInstalledEdge() {
  if (process.platform !== 'win32') return null;
  const roots = [process.env['ProgramFiles(x86)'], process.env['ProgramFiles'], 'C:\\Program Files (x86)', 'C:\\Program Files'];
  for (const root of roots) {
    if (!root) continue;
    const p = path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function startPuppeteer(headless, strip) {
  const puppeteer = require('puppeteer-extra');
  const StealthPlugin = require('puppeteer-extra-plugin-stealth');
  puppeteer.use(StealthPlugin());
  const ChromeLauncher = require('chrome-launcher');
  // The old `'…macOS path…' || ChromeLauncher…` form always short-circuited to the (truthy) macOS
  // string, so on Windows Puppeteer never reused an installed Chrome and always downloaded Chromium.
  // Pick per-platform; getInstallations()[0] may be undefined (no Chrome) -> falls back to ensureChromium.
  const installedChromePath =
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : ChromeLauncher.Launcher.getInstallations()[0];
  // Browser preference: installed Chrome → installed Edge (Win10/11) → last-resort ~170 MB Chromium
  // download. The Edge tier is purely additive; the download path still exists as the final fallback.
  const localBrowserPath = (installedChromePath && fs.existsSync(installedChromePath) && installedChromePath) || findInstalledEdge();
  const launchArgs = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-extensions'];
  if (!puppeteerWindow.browser) {
    try {
      const exePath = localBrowserPath || (await ensureChromium()).executablePath;
      puppeteerWindow.browser = await puppeteer.launch({ headless: headless ? 'new' : false, executablePath: exePath, args: launchArgs });
    } catch (err) {
      // A local Chrome/Edge that fails to drive (rare CDP mismatch) must never regress the no-Chrome
      // case: fall back to the standalone Chromium download and retry once.
      if (!localBrowserPath) throw err;
      debug.log(`puppeteer: local browser launch failed (${err.message}); falling back to downloaded Chromium`);
      const exePath = (await ensureChromium()).executablePath;
      puppeteerWindow.browser = await puppeteer.launch({ headless: headless ? 'new' : false, executablePath: exePath, args: launchArgs });
    }
  }
  if (!puppeteerWindow.context) puppeteerWindow.context = await puppeteerWindow.browser.createIncognitoBrowserContext();
  if (!puppeteerWindow.pagesc) {
    puppeteerWindow.pagesc = await puppeteerWindow.context.newPage();
  }
  if (!puppeteerWindow.pagesh) {
    puppeteerWindow.pagesh = await puppeteerWindow.context.newPage();
    if (strip) {
      const page = puppeteerWindow.pagesh;
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const type = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(type)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }
  }
}

async function scrapeWithPuppeteer(info = { appid: 269770 }, alternate) {
  if (alternate?.steamhunters || alternate?.steamcommunity)
    // NB: `await` is essential here — without it this becomes a tight CPU-pinning busy-loop that
    // spins at 100% while two scrapes overlap (a direct cause of the watchdog CPU spikes #24/#39).
    while ((currentlyscraping.steamhunters && alternate?.steamhunters) || (currentlyscraping.steamcommunity && alternate?.steamcommunity))
      await delay(100);
  currentlyscraping.steamcommunity = alternate?.steamcommunity ? true : currentlyscraping.steamcommunity;
  currentlyscraping.steamhunters = alternate?.steamhunters ? true : currentlyscraping.steamhunters;
  await startPuppeteer(alternate, alternate?.steamhunters);
  try {
    if (alternate) {
      if (alternate.steamhunters) {
        if (alternate.userlist) {
          const url = `https://steamhunters.com/apps/${info.appid}/users?sort=completionstate`;
          const page = puppeteerWindow.pagesh;
          try {
            await page.goto(url);
            await page.waitForFunction(() => {
              return Array.from(document.querySelectorAll('script')).some((s) => s.textContent.includes('var sh'));
            });
            await page.evaluate(() => {
              const scripts = Array.from(document.querySelectorAll('script'));
              const target = scripts.find((s) => s.textContent.includes('var sh'));
              eval(target.textContent);
            });
            const users = (await page.evaluate(() => sh.model.listData.pagedList.items)) || [];

            const results = [];
            users.forEach((item) => {
              results.push({
                id: item.steamId,
                isPublic: item.privacyState === 0,
              });
            });
            info.users = users;
          } catch (e) {
            debug.log(e);
          }
          return;
        }
        let start = Date.now();
        const url = `https://steamhunters.com/apps/${info.appid}/achievements?group=&sort=name`;
        const page = puppeteerWindow.pagesh;
        try {
          await page.goto(url);
          await page.waitForFunction(() => {
            return Array.from(document.querySelectorAll('script')).some((s) => s.textContent.includes('var sh'));
          });
          await page.evaluate(() => {
            const scripts = Array.from(document.querySelectorAll('script'));
            const target = scripts.find((s) => s.textContent.includes('var sh'));
            eval(target.textContent);
          });
          const achievements = (await page.evaluate(() => sh.model.listData.pagedList.items)) || [];

          const results = [];
          achievements.forEach((item) => {
            results.push({
              name: item.apiName,
              default_value: 0,
              displayName: item.name,
              hidden: item.hidden ? 1 : 0,
              description: item.description || ' ',
              icon: item.icon,
              icongray: item.iconGray,
            });
          });
          info.achievements = results;
          debug.log(`[${info.appid}] steamhunters took ${(Date.now() - start) / 1000}s`);
        } catch (e) {
          debug.log(e);
        }
        return;
      }

      if (alternate.steamcommunity) {
        const page = puppeteerWindow.pagesc;
        try {
          await page.goto(alternate.url, { waitUntil: 'domcontentloaded' });
        } catch (e) {
          debug.log(e);
        }
        const achs = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.achieveRow')).map((row) => {
            const img = row.querySelector('.achieveImgHolder img')?.src.split('/').pop().split('.jpg')[0] || null;
            const title = row.querySelector('.achieveTxt h3')?.innerText.trim() || null;
            const description = row.querySelector('.achieveTxt h5')?.innerText.trim() || null;
            return { img, title, description };
          });
        });
        info.achievements = achs;
        return;
      }

      const url = `https://steamcommunity.com/profiles/${alternate.steamid}`;
      const page = puppeteerWindow.page;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
      } catch (e) {
        debug.log(e);
      }
      const url3 = page.url();
      await page.goto(`${url3}/stats/${info.appid}/?tab=achievements`, { waitUntil: 'domcontentloaded' });
      return;
    }
    const url1 = `https://steamdb.info/app/${info.appid}/info/`;
    const url2 = `https://steamdb.info/app/${info.appid}/stats/`;
    const page2 = puppeteerWindow.page;

    await page2.goto(url2, { waitUntil: 'domcontentloaded' });
    const pageText = await page2.evaluate(() => document.body.innerText || '');
    if (pageText.includes('No app was found matching this AppID')) {
      info.achievements = [];
      return;
    }
    if (!page2.url().includes('/stats')) {
      info.achievements = [];
      return;
    }
    info.name = await page2.evaluate(() => {
      const el = document.querySelector('.pagehead-title h1');
      return el?.innerText.trim() || null;
    });
    await page2.waitForSelector('.achievements_list', { timeout: 5000 }).catch(() => {
      throw new Error('Achievements list container not found');
    });
    // Get achievements
    info.achievements = await page2.evaluate(() => {
      const items = document.querySelectorAll('.achievements_list .achievement');
      const data = [];

      const appid = document.querySelector('.row.app-row table tbody tr')?.children?.[1]?.innerText.trim() || '';

      items.forEach((item) => {
        const idRaw = item.getAttribute('id') || '';
        const id = idRaw.replace(/^achievement-/, '');
        const name = item.querySelector('.achievement_name')?.innerText.trim() || '';

        const descContainer = item.querySelector('.achievement_desc');
        const spoiler = descContainer?.querySelector('.achievement_spoiler');
        const hidden = !!spoiler;
        const description = hidden ? spoiler?.innerText.trim() : descContainer?.innerText.trim() || '';

        const icon = appid
          ? 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/' +
            appid +
            '/' +
            (item.querySelector('.achievement_image')?.getAttribute('data-name') || '')
          : '';

        const icongray = appid
          ? 'https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/' +
            appid +
            '/' +
            (item.querySelector('.achievement_image_small')?.getAttribute('data-name') || '')
          : '';

        data.push({
          name: id,
          default_value: 0,
          displayName: name,
          hidden: hidden ? 1 : 0,
          description,
          icon,
          icongray,
        });
      });

      return data;
    });
    await delay(Math.floor(Math.random() * (1500 - 800 + 1)) + 800);

    await page2.goto(url1, { waitUntil: 'domcontentloaded' });
    info.icon = await page2.evaluate(() => {
      const el = document.querySelector('#js-assets-table');
      const row = Array.from(el.rows).find((r) => r.cells[0].textContent.trim() === 'icon');

      if (row) {
        return row.cells[1].querySelector('a').textContent.trim();
      }
    });
    return;
  } catch (err) {
    debug.log(err);
  }
}

async function searchForGameName(info = { appid: '' }) {
  if (info.appid.length === 0) {
    info.title = undefined;
    return;
  }

  let locale = 'en-US'; // use AW's languague in the future? does it even make a difference in this context?
  let startIndex = 0;
  let matchResult;
  await startPuppeteer(true, false);

  async function scrapePage(startIndex) {
    const page = await puppeteerWindow.context.newPage();

    const url = `https://store.epicgames.com/pt/browse?sortBy=releaseDate&sortDir=DESC&tag=Windows&priceTier=tier3&category=Game&count=40&start=${
      40 * startIndex
    }`;

    try {
      await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9',
      });
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      );
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      await page.waitForFunction(() => !!window.__REACT_QUERY_INITIAL_QUERIES__, { timeout: 15000 });
      const queries = await page.evaluate(() => window.__REACT_QUERY_INITIAL_QUERIES__);
      if (queries.queries) {
        const catalogQuery = queries.queries.find((q) => q?.state?.data?.Catalog?.searchStore?.elements);
        if (catalogQuery) {
          const elements = catalogQuery.state.data.Catalog.searchStore.elements;
          const found = elements.find((el) => el.namespace === info.appid);
          if (found) {
            matchResult = found.title;
          }
        }
      }
    } catch (err) {
      console.error(`❌ Error on page ${startIndex}:`, err.message);
    } finally {
      await page.close();
    }
    return matchResult;
  }

  async function run(start) {
    const tasks = [];
    for (let i = start; i < start + 5; i++) {
      const startIndex = i;
      tasks.push(scrapePage(startIndex));
    }

    await Promise.all(tasks);
  }

  // Bound the catalog scan: without a cap, a title that never matches (delisted, renamed, region-
  // locked) scrapes Epic's store endlessly. Stop after MAX_PAGES; info.title stays undefined on a miss.
  const MAX_PAGES = 100;
  while (!info.title && startIndex < MAX_PAGES) {
    await run(startIndex);
    info.title = matchResult;
    startIndex += 5;
  }
  return;
}

function searchForSteamAppId(info = { name: '' }) {
  if (info.name.length === 0) {
    info.appid = undefined;
    return;
  }
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  const closeHiddenSearchWindow = () => {
    try {
      if (!win.isDestroyed()) win.close();
    } catch {}
  };
  const searchTimeout = setTimeout(() => {
    if (!info.games) info.games = [];
    closeHiddenSearchWindow();
  }, 30000);
  win.on('closed', () => clearTimeout(searchTimeout));
  win.webContents.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36');
  // Inject JS *before* the page starts executing its own scripts
  win.webContents.on('dom-ready', async () => {
    await win.webContents.executeJavaScript(`
      // Override navigator.userAgent
      Object.defineProperty(navigator, 'userAgent', {
        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      });

      // Override platform
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32'
      });

      // Override vendor
      Object.defineProperty(navigator, 'vendor', {
        get: () => 'Google Inc.'
      });

      // Fake Chrome object
      window.chrome = { runtime: {} };
    `);
  });
  //win.loadURL(`https://steamdb.info/search/?a=app&q=${info.name}&type=1&category=0`);
  win.loadURL(`https://store.steampowered.com/search/?term=${info.name}&category1=998&ndl=1`);
  win.webContents.on('did-finish-load', async () => {
    let games = undefined;
    try {
      while (!games) {
        games = await win.webContents.executeJavaScript(`
          (() => {
            const rows = document.querySelectorAll('#search_resultsRows a[data-ds-appid]');
            const list = [];

            for (const row of rows) {
              if (list.length >= 10) break;

              const appid = row.getAttribute('data-ds-appid');
              const title = row.querySelector('.title')?.innerText.trim() || '';

              if (appid && title) {
                list.push({ appid, title });
              }
            }

            return list;
          })();
        `);

        /* // this is for steamdb
        games = await win.webContents.executeJavaScript(`
          (() => {
            const rows = document.querySelectorAll('#table-sortable tbody tr.app');
            const matches = [];
            debug.log(rows);
            rows.forEach(row => {
              const appid = row.getAttribute('data-appid');
              const nameLink = row.querySelector('td:nth-child(3) a');
              const name = nameLink?.innerText.trim();

              if (appid && name) {
                matches.push({ appid, name });
              }
            });

            return matches;
          })();
        `);
        */
        await delay(500);
      }
      info.games = games;
    } catch (error) {
      console.error('Failed to find appid:', error);
      if (!info.games) info.games = [];
    } finally {
      closeHiddenSearchWindow();
    }
  });
}

function createMainWindow() {
  try {
    if (MainWin) {
      if (MainWin.isMinimized()) MainWin.restore();
      MainWin.focus();
      return;
    }
    let options = manifest.config.window;
    options.show = false;
    options.webPreferences = {
      devTools: manifest.config.debug || false,
      // Full contextIsolation is a separate, larger migration (the renderer relies on nodeIntegration
      // for require/remote). Until then the XSS->RCE surface is held shut by the page CSP (no
      // 'unsafe-inline' / 'unsafe-eval') + output escaping; the flags below are cheap defence-in-depth.
      nodeIntegration: true,
      contextIsolation: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      enableWebSQL: false,
      spellcheck: false,
      v8CacheOptions: manifest.config.debug ? 'none' : 'code',
      // Tray daemon: the main UI window spends most of its life hidden/minimized. Let Chromium
      // throttle its background timers then (cuts idle CPU). Safe here because the only renderer
      // timer is the 15-min new-game scan (far slower than the ~1/min throttle floor) and WebSocket
      // message handling is unaffected by throttling. The hidden scrape window (searchForSteamAppId)
      // and the overlay/notification windows keep backgroundThrottling:false — they must run hidden.
      backgroundThrottling: true,
    };
    //electron 9 crash if no icon exists to specified path
    try {
      fs.accessSync(options.icon, fs.constants.F_OK);
    } catch {
      delete options.icon;
    }
    //getSteamData({ appid: 2321470, type: 'user' });
    MainWin = new BrowserWindow(options);
    getRemoteMain().enable(MainWin.webContents);

    //Frameless
    if (options.frame === false) MainWin.isFrameless = true;

    //Debug tool
    if (manifest.config.debug) {
      MainWin.webContents.openDevTools({ mode: 'undocked' });
      MainWin.isDev = true;
      console.info((({ node, electron, chrome }) => ({ node, electron, chrome }))(process.versions));
      // electron-context-menu is ESM-only in v4+ — must use dynamic import
      import('electron-context-menu').then((mod) => {
        const contextMenuFn = mod.default || mod;
        if (typeof contextMenuFn === 'function') {
          contextMenuFn({
            append: (defaultActions, params, browserWindow) => [
              {
                label: 'Reload',
                visible: params,
                click: () => { if (MainWin) MainWin.reload(); },
              },
            ],
          });
        }
      }).catch((err) => {
        console.warn('electron-context-menu init failed:', err.message);
      });
    }

    //User agent
    MainWin.webContents.userAgent = manifest.config['user-agent'];
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = manifest.config['user-agent'];
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    //External open links
    const openExternal = function (event, url) {
      if (!url.startsWith('file:///')) {
        event.preventDefault();
        shell.openExternal(url).catch(() => {});
      }
    };
    MainWin.webContents.on('will-navigate', openExternal); //a href
    MainWin.webContents.on('new-window', openExternal); //a href target="_blank"

    // Hardening: never let the renderer spawn its own BrowserWindow; route real links to the OS
    // browser instead (modern replacement for the deprecated 'new-window' path above).
    MainWin.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });

    // Hardening: the app needs no web permissions (camera, mic, geolocation, web-notifications, …) —
    // its toasts are native and audio samples use <audio>/main-process playback. Deny every request
    // and check so a compromised renderer can't obtain one.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    MainWin.loadFile(manifest.config.window.view);

    let mainWindowShown = false;
    const showMainWindow = (reason) => {
      if (mainWindowShown || !MainWin) return;
      mainWindowShown = true;
      debug.log(`[MainWindow] showing (${reason})`);
      MainWin.show();
      MainWin.focus();
      const net = require('net');
      const PIPE_NAME = '\\\\.\\pipe\\AchievementWatchdogPipe';
      function checkWatchdogStatus(callback) {
        const client = net.createConnection(PIPE_NAME);

        client.on('connect', () => {
          callback(true);
          client.end();
        });

        client.on('error', () => {
          callback(false);
        });
      }
      // Report monitor status to the renderer (its connection indicator). The monitor is launched and
      // supervised by the daemon itself (spawned on 'ready', respawned on unexpected exit), so there
      // is no auto-launch here. Stored + cleared on window close so repeated open/close never leaks
      // intervals.
      clearInterval(watchdogStatusInterval);
      watchdogStatusInterval = setInterval(() => {
        checkWatchdogStatus((running) => {
          if (MainWin) MainWin.webContents.send('watchdog-status', running);
        });
      }, 5000);
    };

    const isReady = [
      new Promise(function (resolve) {
        MainWin.once('ready-to-show', () => {
          debug.log('[MainWindow] ready-to-show');
          return resolve();
        }); //Window is loaded and ready to be drawn
      }),
      new Promise(function (resolve) {
        ipcMain.handleOnce('components-loaded', () => {
          debug.log('[MainWindow] components-loaded');
          return resolve();
        }); //Wait for custom event
      }),
    ];

    Promise.all(isReady).then(() => showMainWindow('ready'));
    // Resilience: never let a hung or failed renderer (e.g. a component import error, or a slow/blocked
    // data load) keep the window hidden forever. Once the page can paint, show it after a short grace
    // period even if the 'components-loaded' IPC never arrives.
    MainWin.once('ready-to-show', () => {
      setTimeout(() => showMainWindow('fallback-timeout'), 8000);
    });
    // Absolute last resort: show regardless of paint/IPC events so the app is never invisible.
    setTimeout(() => showMainWindow('absolute-timeout'), 15000);

    MainWin.on('closed', () => {
      MainWin = null;
      // Daemon stays alive in the tray; just release the window-bound status poller. The monitor and
      // tray are untouched, so background tracking continues.
      clearInterval(watchdogStatusInterval);
      watchdogStatusInterval = null;
      // Closing the window mid-scrape would otherwise leave an orphaned headless Chromium resident
      // (the renderer fires 'close-puppeteer' only once the game list finishes). Tear it down here so
      // a key-less scrape can't leak ~100-200 MB into the background tray state (cf. #32).
      closePuppeteer().catch(() => {});
    });
  } catch (e) {
    debug.log(`Error creating main window: ${e}`);
    if (shouldQuitApp()) app.quit();
  }
}

// --- In-game overlay manipulation: nudge / snap / click-through toggle + position persistence -------
// The overlay (overlay.html) is already drag-movable via -webkit-app-region on its header. These add
// keyboard fine-positioning and a click-through toggle (so it can pass clicks to the game), registered
// as global shortcuts only while the overlay is open. Bounds persist to <userData>/cfg/overlayBounds.json
// (a tiny standalone store, like progressMute.json) and are restored next time the overlay opens.
function overlayBoundsFile() {
  return path.join(userData, 'cfg', 'overlayBounds.json');
}
function readOverlayBounds() {
  try {
    return JSON.parse(fs.readFileSync(overlayBoundsFile(), 'utf8')) || {};
  } catch {
    return {};
  }
}
function writeOverlayBounds(patch) {
  try {
    const next = Object.assign(readOverlayBounds(), patch);
    fs.mkdirSync(path.dirname(overlayBoundsFile()), { recursive: true });
    fs.writeFileSync(overlayBoundsFile(), JSON.stringify(next), 'utf8');
  } catch (e) {
    debug.log('[overlay-bounds] ' + (e.message || e));
  }
}
let overlayClickThrough = false;
function persistInGameBounds() {
  if (overlayWindow && !overlayWindow.isDestroyed()) writeOverlayBounds({ inGame: overlayWindow.getBounds() });
}
function nudgeOverlay(dx, dy) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const b = overlayWindow.getBounds();
  overlayWindow.setBounds({ x: b.x + dx, y: b.y + dy, width: b.width, height: b.height });
  persistInGameBounds();
}
function snapOverlay(corner) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const { x: ax, y: ay, width: aw, height: ah } = require('electron').screen.getPrimaryDisplay().workArea;
  const b = overlayWindow.getBounds();
  let x = ax;
  let y = ay;
  switch (corner) {
    case 1: x = ax; y = ay; break; // top-left
    case 2: x = ax + aw - b.width; y = ay; break; // top-right
    case 3: x = ax + Math.floor((aw - b.width) / 2); y = ay + Math.floor((ah - b.height) / 2); break; // center
    case 4: x = ax; y = ay + ah - b.height; break; // bottom-left
    case 5: x = ax + aw - b.width; y = ay + ah - b.height; break; // bottom-right
  }
  overlayWindow.setBounds({ x, y, width: b.width, height: b.height });
  persistInGameBounds();
}
function toggleOverlayClickThrough() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayClickThrough = !overlayClickThrough;
  overlayWindow.setIgnoreMouseEvents(overlayClickThrough, { forward: true });
}
const OVERLAY_SHORTCUT_KEYS = ['Up', 'Down', 'Left', 'Right', '1', '2', '3', '4', '5', 'C'];
function registerOverlayShortcuts() {
  const reg = (accel, fn) => {
    try {
      globalShortcut.register(accel, fn);
    } catch (e) {
      debug.log('[overlay-shortcut] register failed ' + accel + ': ' + (e.message || e));
    }
  };
  reg('CommandOrControl+Alt+Shift+Up', () => nudgeOverlay(0, -20));
  reg('CommandOrControl+Alt+Shift+Down', () => nudgeOverlay(0, 20));
  reg('CommandOrControl+Alt+Shift+Left', () => nudgeOverlay(-20, 0));
  reg('CommandOrControl+Alt+Shift+Right', () => nudgeOverlay(20, 0));
  reg('CommandOrControl+Alt+Shift+1', () => snapOverlay(1));
  reg('CommandOrControl+Alt+Shift+2', () => snapOverlay(2));
  reg('CommandOrControl+Alt+Shift+3', () => snapOverlay(3));
  reg('CommandOrControl+Alt+Shift+4', () => snapOverlay(4));
  reg('CommandOrControl+Alt+Shift+5', () => snapOverlay(5));
  reg('CommandOrControl+Alt+Shift+C', () => toggleOverlayClickThrough());
}
function unregisterOverlayShortcuts() {
  for (const k of OVERLAY_SHORTCUT_KEYS) {
    try {
      globalShortcut.unregister('CommandOrControl+Alt+Shift+' + k);
    } catch {}
  }
}

/**
 * @param {{appid: string, action:string}} info
 */
async function createOverlayWindow(info) {
  try {
    if (!info.action) info.action = 'open';
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      if (String(info.appid) === '0' || info.action == 'close') {
        overlayWindow.close();
        return;
      }
      if (info.action === 'refresh') {
        overlayWindow.webContents.send('refresh-achievements-table', String(info.appid));
        return;
      }
    }
    if (String(info.appid) === '0' || info.action === 'refresh') return;
    const { width, height } = require('electron').screen.getPrimaryDisplay().workAreaSize;
    isOverlayShowing = true;

    await startEngines();
    await getCachedData(info);
    info.game = await achievementsJS.getSavedAchievementsForAppid(configJS, { appid: info.appid });

    overlayWindow = new BrowserWindow({
      width: 450,
      height: 800,
      x: width - 470,
      y: 20,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: true,
      hasShadow: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, '../overlayPreload.js'),
        additionalArguments: [`--isDev=${app.isDev ? 'true' : 'false'}`, `--userDataPath=${userData}`],
        contextIsolation: true,
        nodeIntegration: false,
        devTools: manifest.config.debug || false,
        backgroundThrottling: false,
      },
    });

    if (manifest.config.debug) {
      overlayWindow.webContents.openDevTools({ mode: 'undocked' });
      overlayWindow.isDev = true;
      console.info((({ node, electron, chrome }) => ({ node, electron, chrome }))(process.versions));
      try {
        const contextMenu = require('electron-context-menu')({
          append: (defaultActions, params, browserWindow) => [
            {
              label: 'Reload',
              visible: params,
              click: () => {
                overlayWindow.reload();
              },
            },
          ],
        });
      } catch (err) {
        dialog.showMessageBoxSync({
          type: 'warning',
          title: 'Context Menu',
          message: 'Failed to initialize context menu.',
          detail: `${err}`,
        });
      }
    }

    //User agent
    overlayWindow.webContents.userAgent = manifest.config['user-agent'];
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = manifest.config['user-agent'];
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlayWindow.setFullScreenable(false);
    overlayWindow.setFocusable(true);
    overlayWindow.blur();

    // Restore the user's last overlay position/size (from drag, nudge or snap), if any.
    const savedInGame = readOverlayBounds().inGame;
    if (savedInGame && Number.isFinite(savedInGame.x) && Number.isFinite(savedInGame.y)) {
      overlayWindow.setBounds({
        x: savedInGame.x,
        y: savedInGame.y,
        width: savedInGame.width || 450,
        height: savedInGame.height || 800,
      });
    }
    overlayClickThrough = false; // each open starts interactive (drag/scroll), not click-through

    overlayWindow.loadFile(path.join(manifest.config.debug ? '' : userData, 'view\\overlay.html'));
    let selectedLanguage = 'english';
    overlayWindow.webContents.on('did-finish-load', () => {
      overlayWindow.webContents.send('show-overlay', info.game);
      overlayWindow.showInactive();
      registerOverlayShortcuts(); // nudge / snap / click-through, active only while the overlay is open
    });

    // Persist position after a drag (app-region move fires 'moved').
    overlayWindow.on('moved', persistInGameBounds);

    overlayWindow.on('closed', () => {
      isOverlayShowing = false;
      overlayWindow = null;
      unregisterOverlayShortcuts();
    });
  } catch (e) {
    debug.log(`Error creating overlay window, ${e}`);
    if (shouldQuitApp()) app.quit();
  }
}

function shouldQuitApp() {
  // Resident tray daemon: the app stays alive in the system tray with no window. Closing the main
  // window (or finishing notifications/overlay) must NEVER quit the process — the monitor keeps
  // running in the background. The app quits only via the tray "Quit" item (which sets app.isQuiting
  // and calls app.quit() directly). All the historical `if (shouldQuitApp()) app.quit()` call sites
  // therefore become no-ops.
  return false;
}

function parseArgs(args) {
  let windowType = args['wintype'] || 'main'; // overlay (in-game) or main; notifications are Windows toasts
  let appid = args['appid']; // appid
  let source = args['source'] || 'steam'; // source: steam, epic, gog, luma
  let description = args['description']; // text
  debug.log('opening ' + windowType + ' window');
  switch (windowType) {
    case 'overlay':
      createOverlayWindow({ appid, source, action: description });
      break;
    case 'notification':
      // Styled overlay notification. The monitor forwards these args over IPC (handleMonitorMessage)
      // and they are rendered as a BrowserWindow inside this resident daemon — no transient process,
      // no single-instance forwarding, so no self-quit safety net is needed any more.
      enqueueNotificationFromArgs(args);
      break;
    case 'main':
    default:
      // Resident tray daemon: open the UI window on demand. A login-item / `--hidden` start stays in
      // the tray with no window; a normal launch, a tray "Open", or a second-instance opens it.
      // Startup-only init (resources, tray, monitor, icon-cache prune) runs once in the 'ready'
      // handler, not here, so reopening the window never repeats it.
      if (!args.hidden) createMainWindow();
      break;
  }
}

// --- Overlay notification (optional transport) — Wave 3 ----------------------
// Spawns a frameless, transparent, click-through window that renders a notification
// using a preset (preset = index.html + style.css, copied from the reference project).
// The preset's own script receives the payload through overlayPreload's `window.api`,
// animates, then calls window.api.closeNotificationWindow() (handled in ipc.js).
// Toasts remain the default transport; this only runs when explicitly triggered.
// Resolve a preset by name from the bundled library (Default Presets, then Users Presets),
// falling back to "Default". Mirrors the reference project's preset folder lookup.
function resolvePresetFolder(presetName) {
  const requestedRaw = String(presetName || 'Default');
  const requested = requestedRaw === 'Raposo' ? 'Shirow' : requestedRaw;
  const roots = [
    path.join(__dirname, '../presets/Default Presets'),
    path.join(__dirname, '../presets/Users Presets'),
    path.join(__dirname, '../presets'),
  ];
  for (const root of roots) {
    const f = path.join(root, requested);
    if (fs.existsSync(path.join(f, 'index.html'))) return f;
  }
  for (const root of roots) {
    const f = path.join(root, 'Default');
    if (fs.existsSync(path.join(f, 'index.html'))) return f;
  }
  return null;
}

// Read the preset's window size from its <meta width="" height=""> tag (reference convention).
function getPresetDimensions(presetFolder) {
  try {
    const content = fs.readFileSync(path.join(presetFolder, 'index.html'), 'utf8');
    const m = content.match(/<meta\s+width\s*=\s*"(\d+)"\s+height\s*=\s*"(\d+)"\s*\/?>/i);
    if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  } catch (err) {
    debug.log('[overlay-notif] preset dimensions read failed: ' + (err.message || err));
  }
  return { width: 400, height: 200 };
}

// Place the window within the primary display's work area for a given position keyword.
function computeNotificationBounds(position, w, h) {
  const { x: ax, y: ay, width: aw, height: ah } = require('electron').screen.getPrimaryDisplay().workArea;
  let x = ax + Math.floor((aw - w) / 2);
  let y = ay + ah - h;
  switch (position) {
    case 'center-top':   x = ax + Math.floor((aw - w) / 2); y = ay;                            break;
    case 'top-left':     x = ax;                            y = ay;                            break;
    case 'top-right':    x = ax + aw - w;                   y = ay;                            break;
    case 'middle-left':  x = ax;                            y = ay + Math.floor((ah - h) / 2); break;
    case 'middle-right': x = ax + aw - w;                   y = ay + Math.floor((ah - h) / 2); break;
    case 'bottom-left':  x = ax;                            y = ay + ah - h;                   break;
    case 'bottom-right': x = ax + aw - w - 10;              y = ay + ah - h;                   break;
    case 'custom': {
      // User-positioned via the "Reposition" witness; persisted in overlayBounds.json (notif).
      const saved = readOverlayBounds().notif;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x, y: saved.y };
      x = ax + Math.floor((aw - w) / 2); y = ay + ah - h; // fall back to center-bottom until set
      break;
    }
    case 'center-bottom':
    default:             x = ax + Math.floor((aw - w) / 2); y = ay + ah - h;                   break;
  }
  return { x: Math.max(ax, x), y: Math.max(ay, y) };
}

function createNotificationWindow(data = {}) {
  const presetFolder = resolvePresetFolder(data.preset);
  if (!presetFolder) {
    debug.log('[overlay-notif] no usable preset found under app/presets');
    return null;
  }
  const presetHtml = path.join(presetFolder, 'index.html');

  const scaleRaw = Number(data.scale);
  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  const { width: baseW, height: baseH } = getPresetDimensions(presetFolder);
  // Grow the window with scale (only when >1) so larger presets are not clipped.
  const w = Math.ceil(baseW * (scale > 1 ? scale : 1));
  const h = Math.ceil(baseH * (scale > 1 ? scale : 1));
  const position = data.position || 'center-bottom';
  const { x, y } = computeNotificationBounds(position, w, h);

  debug.log('[overlay-notif] preset=' + path.basename(presetFolder) + ' pos=' + position + ' scale=' + scale + ' size=' + w + 'x' + h);

  const notif = new BrowserWindow({
    width: w,
    height: h,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, '../notificationPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  notif.setAlwaysOnTop(true, 'screen-saver');
  notif.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Real notifications are click-through; the reposition witness stays interactive so it can be dragged.
  if (!data.reposition) notif.setIgnoreMouseEvents(true, { forward: true });
  notif.loadFile(presetHtml);

  // Match the proven overlayWindow pattern: show inactively once content is loaded
  // (no reliance on 'ready-to-show', which the working in-game overlay also avoids).
  notif.webContents.on('did-finish-load', () => {
    if (notif.isDestroyed()) return;
    notif.webContents.send('show-notification', {
      displayName: data.displayName != null ? data.displayName : 'Achievement Unlocked',
      description: data.description != null ? data.description : '',
      rarityPercent: data.rarityPercent,
      iconPath: data.iconPath || data.icon || '',
      scale,
      // Forwarded so presets that support it can match their animation to the user's duration.
      durationMs: Number.isFinite(Number(data.durationMs)) ? Number(data.durationMs) : undefined,
    });
    notif.showInactive();
    // Optional notification sound — played inside the (renderer) notification window. Volume is a
    // 0–200 percent setting: use a WebAudio gain node for >100% (Audio.volume caps at 1.0), and fall
    // back to Audio.volume (clamped) if WebAudio is unavailable.
    if (data.soundPath) {
      // In packaged builds the sound lives under app.asar.unpacked (see electron-builder asarUnpack).
      const u = String(data.soundPath).replace(/\\/g, '/').replace('app.asar/', 'app.asar.unpacked/');
      const src = u.startsWith('file://') ? u : 'file:///' + u;
      const gain = Math.max(0, Math.min(2, (Number(data.volume) != null && Number.isFinite(Number(data.volume)) ? Number(data.volume) : 100) / 100));
      notif.webContents
        .executeJavaScript(
          '(function(){try{var a=new Audio(' + JSON.stringify(src) + ');var g=' + gain + ';' +
          'try{var C=window.AudioContext||window.webkitAudioContext;if(C&&g!==1){var ctx=new C();var s=ctx.createMediaElementSource(a);var n=ctx.createGain();n.gain.value=g;s.connect(n);n.connect(ctx.destination);}else{a.volume=Math.min(1,g);}}catch(e){a.volume=Math.min(1,g);}' +
          'a.play().catch(function(){});}catch(e){}})();'
        )
        .catch(() => {});
    }
    // Reposition mode: overlay a full-window drag region so the user can place the popup, and persist
    // the chosen top-left as the 'custom' anchor. executeJavaScript is privileged (bypasses preset CSP).
    if (data.reposition) {
      notif.webContents
        .executeJavaScript(
          "(function(){var d=document.createElement('div');d.style.cssText='position:fixed;left:0;top:0;right:0;bottom:0;-webkit-app-region:drag;cursor:move;z-index:2147483647';document.documentElement.appendChild(d);})();"
        )
        .catch(() => {});
    }
    // Custom duration: hold the notification on screen by FREEZING all animations after ~3s for the
    // chosen time, then resume. Preset-agnostic — it pauses existing AND newly-started animations during
    // the hold (an interval catches the exit animation), and the close is deferred (see ipc.js, via
    // awFrozenUntil) so a preset's own self-close can't cut the hold short. 'auto' = no freeze.
    const holdMs = Number.isFinite(Number(data.durationMs)) && Number(data.durationMs) > 0 ? Number(data.durationMs) : 0;
    if (holdMs > 0 && !data.reposition) {
      const FREEZE_AFTER = 3000;
      notif.awFrozenUntil = Date.now() + FREEZE_AFTER + holdMs + 1200; // +tail so the exit can finish
      notif.webContents
        .executeJavaScript(
          '(function(){var F=' + FREEZE_AFTER + ',H=' + holdMs + ';' +
          'function all(){try{return document.getAnimations?document.getAnimations():[];}catch(e){return [];}}' +
          'setTimeout(function(){' +
          'all().forEach(function(a){try{a.pause();}catch(e){}});' +
          'var iv=setInterval(function(){all().forEach(function(a){try{a.pause();}catch(e){}});},100);' +
          'setTimeout(function(){clearInterval(iv);all().forEach(function(a){try{a.play();}catch(e){}});},H);' +
          '},F);})();'
        )
        .catch(() => {});
    }
  });

  if (data.reposition) {
    notif.on('moved', () => writeOverlayBounds({ notif: { x: notif.getBounds().x, y: notif.getBounds().y } }));
  }

  // Safety net: the preset normally closes itself via window.api.closeNotificationWindow(). With a
  // custom duration the freeze-hold above plays ~3s, freezes for that time, then exits, so the catch-all
  // must outlast 3s + hold + exit (never cut it short — the close defer in ipc.js targets ~3s+hold+1.2s).
  // 'auto' keeps the 20s catch-all; the reposition witness stays up much longer so there's time to place it.
  const customMs = Number(data.durationMs);
  const closeAfter = data.reposition ? 120000 : Number.isFinite(customMs) && customMs > 0 ? 3000 + customMs + 4000 : 20000;
  const safety = setTimeout(() => {
    if (!notif.isDestroyed()) notif.close();
  }, closeAfter);
  notif.on('closed', () => clearTimeout(safety));

  return notif;
}

// Serial queue: one overlay notification on screen at a time. The next opens once the current
// window closes (each preset closes itself via window.api.closeNotificationWindow()).
let notifQueue = [];
let notifActive = false;

// Guard against the same overlay notification rendering twice in quick succession. This matters when
// the main app is open: the persistent process receives every Watchdog-forwarded notification, so a
// duplicate spawn (e.g. two rapid playtime/unlock events, or a forwarding race) would stack two
// identical overlays. Keyed by content within a short window. Transient app-closed processes each
// handle a single notification, so their map is always empty and never falsely suppresses.
const recentNotifKeys = new Map();
function isDuplicateNotification(data) {
  try {
    const key = [data.displayName || '', data.description || '', data.iconPath || data.icon || ''].join('');
    const now = Date.now();
    for (const [k, t] of recentNotifKeys) if (now - t > 5000) recentNotifKeys.delete(k);
    const last = recentNotifKeys.get(key);
    recentNotifKeys.set(key, now);
    return last != null && now - last < 5000;
  } catch {
    return false;
  }
}

function enqueueNotification(data) {
  data = data || {};
  if (MainWin && isDuplicateNotification(data)) {
    debug.log('[overlay-notif] duplicate suppressed (app open): ' + (data.displayName || ''));
    return;
  }
  notifQueue.push(data);
  processNotificationQueue();
}
function processNotificationQueue() {
  if (notifActive) return;
  const data = notifQueue.shift();
  if (!data) return;
  notifActive = true;
  let win = null;
  try {
    win = createNotificationWindow(data);
  } catch (err) {
    debug.log('[overlay-notif] spawn failed: ' + (err.message || err));
  }
  if (!win) {
    notifActive = false;
    if (notifQueue.length) {
      setTimeout(processNotificationQueue, 50);
    } else if (shouldQuitApp()) {
      // No window was created (e.g. unresolvable preset) and nothing is queued. In a transient
      // Watchdog-spawned notification process there is now nothing to wait on and 'window-all-closed'
      // will never fire, so quit immediately rather than sit idle holding the single-instance lock
      // (which blocks the main app from launching).
      app.quit();
    }
    return;
  }
  win.on('closed', () => {
    notifActive = false;
    setTimeout(processNotificationQueue, 150);
  });
}

ipcMain.on('spawn-overlay-notification', (event, data) => {
  enqueueNotification(data || {});
});

// Build an overlay notification from the CLI args the Watchdog passes to a `--wintype=notification`
// process. This process never runs startEngines (that's the main-window path), so configJS is null
// here — load the user's overlay settings (preset/position/scale/sound) directly from options.ini so
// the notification respects them. The icon is passed as a URL and resolved from the on-disk cache the
// Watchdog already prefetched into; a short race guards against a slow/offline fetch hanging the
// transient process (it would otherwise never reach window-all-closed and quit).
async function enqueueNotificationFromArgs(args) {
  let cfg = configJS;
  if (!cfg) {
    try {
      // settings.load() is async — it must be awaited, otherwise cfg is a pending Promise and the
      // user's overlay preset/position/scale/sound are silently ignored (always falling back to the
      // 'Default' preset, which also raises the risk of an unresolvable preset → no window).
      cfg = await require(path.join(__dirname, '../settings.js')).load();
    } catch {
      cfg = {};
    }
  }
  const ov = (cfg && cfg.overlay) || {};

  let iconPath = '';
  if (args.icon) {
    try {
      iconPath =
        (await Promise.race([fetchSteamIcon(String(args.icon), args.appid), new Promise((resolve) => setTimeout(() => resolve(''), 4000))])) || '';
    } catch {
      /* icon is optional */
    }
  }

  // Playtime (and any caller passing --silent) must never play the overlay sound.
  const silent = !!args.silent;
  const langFr = String((cfg && cfg.achievement && cfg.achievement.lang) || '')
    .toLowerCase()
    .startsWith('fr');
  const displayName =
    (args.displayName != null && String(args.displayName).trim()) ||
    (args.gameDisplayName != null && String(args.gameDisplayName).trim()) ||
    (langFr ? 'Succès débloqué' : 'Achievement Unlocked');

  const durSec = ov.notificationDuration === 'auto' || ov.notificationDuration == null ? 0 : Number(ov.notificationDuration) || 0;
  enqueueNotification({
    preset: ov.notificationPreset || 'Default',
    position: ov.notificationPosition || 'center-bottom',
    scale: ov.notificationScale || 1,
    volume: Number.isFinite(Number(ov.notificationVolume)) ? Number(ov.notificationVolume) : 100,
    durationMs: durSec > 0 ? durSec * 1000 : undefined,
    // Playtime notifications pass the game name in both fields. Keeping the dedicated game-name
    // fallback prevents a lost/empty displayName argument from becoming "Achievement Unlocked".
    displayName,
    description: args.description != null ? String(args.description) : '',
    rarityPercent: Number.isFinite(Number(args.rarityPercent)) ? Number(args.rarityPercent) : null,
    iconPath,
    soundPath: silent ? '' : resolveNotificationSound(ov.notificationSound),
  });
}

// Notification sounds live in two places: bundled (app/sounds) and user-imported (<userData>/sounds).
// A user file shadows a bundled file of the same name.
function userSoundsDir() {
  return path.join(userData, 'sounds');
}
function resolveNotificationSound(name) {
  if (!name) return '';
  for (const p of [path.join(userSoundsDir(), name), path.join(__dirname, '../sounds', name)]) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return '';
}

// List available preset names (Default Presets + Users Presets) for the settings dropdown.
ipcMain.handle('list-presets', async () => {
  const out = [];
  const roots = [path.join(__dirname, '../presets/Default Presets'), path.join(__dirname, '../presets/Users Presets')];
  for (const root of roots) {
    try {
      for (const name of fs.readdirSync(root)) {
        if (fs.existsSync(path.join(root, name, 'index.html')) && !out.includes(name)) out.push(name);
      }
    } catch {}
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
});

// --- Custom preset builder (Phase 3 customiser) -----------------------------------------------------
// Generate a notification-overlay preset into "Users Presets/<name>" from simple visual settings. The
// index.html is a FIXED, payload-consuming engine (same contract as the bundled presets:
// window.api.onNotification → fill .title/.detail/.icon, add .active, close after the duration); only the
// generated style.css differs, driven by :root CSS variables. This guarantees every generated preset is
// structurally compatible with createNotificationWindow.
const CUSTOM_PRESET_INDEX_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en"><head>',
  '<meta charset="UTF-8" />',
  '<link rel="stylesheet" href="style.css" />',
  '<meta name="duration" content="6000" />',
  '<meta width="450" height="120" />',
  '<title>AW Custom Preset</title>',
  '</head><body>',
  '<div class="ach"><div class="icon"><img src="" alt="" /></div>',
  '<div class="text_wrap"><p class="title"></p><span class="detail"></span></div></div>',
  '<script>',
  "window.addEventListener('DOMContentLoaded', function () {",
  "  var metaDur = document.querySelector('meta[name=\"duration\"]');",
  '  var base = Math.max(1, Number((metaDur && metaDur.content) || 6000));',
  '  function onPayload(displayName, description, iconPath, scale) {',
  "    var ach = document.querySelector('.ach');",
  "    var titleEl = document.querySelector('.title');",
  "    var detailEl = document.querySelector('.detail');",
  "    var iconEl = document.querySelector('.icon img');",
  '    if (displayName != null) titleEl.textContent = displayName;',
  '    if (description != null) detailEl.textContent = description;',
  '    if (iconPath) { var p = String(iconPath).replace(/\\\\/g, "/"); iconEl.src = p.indexOf("file://") === 0 ? p : "file:///" + p; }',
  "    else { iconEl.style.display = 'none'; }",
  '    var s = Math.max(0.01, parseFloat(scale || 1) || 1);',
  "    ach.style.setProperty('--scale', String(s));",
  '    var total = Math.max(0, Number((metaDur && metaDur.content) || base));',
  '    var t = Math.max(0.1, total / base);',
  '    var inMs = Math.max(120, Math.round(520 * t));',
  '    var outMs = Math.max(120, Math.round(380 * t));',
  '    var holdMs = Math.max(0, total - inMs - outMs);',
  "    ach.style.setProperty('--ach-in', inMs + 'ms');",
  "    ach.style.setProperty('--ach-hold', holdMs + 'ms');",
  "    ach.style.setProperty('--ach-out', outMs + 'ms');",
  "    ach.classList.add('active');",
  '    if (window.api && window.api.notificationRenderReady) window.api.notificationRenderReady();',
  '    setTimeout(function () {',
  "      ach.classList.remove('active');",
  '      if (window.api && window.api.closeNotificationWindow) window.api.closeNotificationWindow();',
  '    }, total);',
  '  }',
  '  if (window.api && window.api.onNotification) window.api.onNotification(function (d) {',
  '    onPayload(d && d.displayName, d && d.description, d && (d.iconPath || d.icon), d && d.scale);',
  '  });',
  '});',
  '</script></body></html>',
].join('\n');

function buildCustomPresetCss(o) {
  const num = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
  };
  const color = (v, def) => (typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(v.trim()) ? v.trim() : def);
  const bg = color(o.bg, '#16181d');
  const text = color(o.text, '#ffffff');
  const accent = color(o.accent, '#4aa3ff');
  const opacity = num(o.opacity, 1, 0.2, 1);
  const fontSize = num(o.fontSize, 16, 10, 28);
  const radius = num(o.radius, 12, 0, 40);
  const iconSize = num(o.iconSize, 64, 24, 110);
  return [
    ':root {',
    `  --bg: ${bg};`,
    `  --text: ${text};`,
    `  --accent: ${accent};`,
    `  --opacity: ${opacity};`,
    `  --font-size: ${fontSize}px;`,
    `  --radius: ${radius}px;`,
    `  --icon-size: ${iconSize}px;`,
    '  --ach-in: 520ms; --ach-hold: 5000ms; --ach-out: 380ms;',
    '}',
    'html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }',
    '.ach {',
    '  position: fixed; left: 50%; bottom: 16px;',
    '  transform: translate(-50%, 170%) scale(var(--scale, 1)); transform-origin: center bottom;',
    '  display: flex; align-items: center; gap: 12px; box-sizing: border-box;',
    '  width: 420px; padding: 12px 18px;',
    '  background: var(--bg); color: var(--text);',
    '  border-radius: var(--radius); border-left: 4px solid var(--accent);',
    "  font-family: 'Segoe UI', system-ui, sans-serif; font-size: var(--font-size);",
    '  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45); opacity: 0;',
    '}',
    '.ach .icon img { width: var(--icon-size); height: var(--icon-size); border-radius: 14%; object-fit: cover; display: block; }',
    '.ach .text_wrap { display: flex; flex-direction: column; min-width: 0; }',
    '.ach .title { margin: 0; font-weight: 700; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.ach .detail { margin: 0; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '@keyframes aw_in { from { transform: translate(-50%, 170%) scale(var(--scale, 1)); opacity: 0; } to { transform: translate(-50%, 0) scale(var(--scale, 1)); opacity: var(--opacity); } }',
    '@keyframes aw_hold { from, to { transform: translate(-50%, 0) scale(var(--scale, 1)); opacity: var(--opacity); } }',
    '@keyframes aw_out { from { transform: translate(-50%, 0) scale(var(--scale, 1)); opacity: var(--opacity); } to { transform: translate(-50%, 170%) scale(var(--scale, 1)); opacity: 0; } }',
    '.active { animation: aw_in var(--ach-in) cubic-bezier(0.2, 0.8, 0.2, 1) forwards, aw_hold var(--ach-hold) forwards, aw_out var(--ach-out) ease-in forwards; animation-delay: 0s, var(--ach-in), calc(var(--ach-in) + var(--ach-hold)); }',
    '',
  ].join('\n');
}

ipcMain.handle('create-custom-preset', async (event, opts = {}) => {
  try {
    const rawName = String(opts.name || '').trim();
    // Folder-safe name; keep it readable. Reject empties and reserved/odd names.
    const name = rawName.replace(/[<>:"/\\|?* -]/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!name) return { ok: false, error: 'invalid-name' };
    const dir = path.join(__dirname, '../presets/Users Presets', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), CUSTOM_PRESET_INDEX_HTML, 'utf8');
    fs.writeFileSync(path.join(dir, 'style.css'), buildCustomPresetCss(opts), 'utf8');
    debug.log('[custom-preset] wrote ' + dir);
    return { ok: true, name };
  } catch (err) {
    debug.log('[custom-preset] failed: ' + (err.message || err));
    return { ok: false, error: String(err.message || err) };
  }
});

// List available notification sound files for the overlay sound dropdown (bundled + user-imported).
ipcMain.handle('list-sounds', async () => {
  const set = new Set();
  for (const dir of [path.join(__dirname, '../sounds'), userSoundsDir()]) {
    try {
      for (const f of fs.readdirSync(dir)) if (/\.(wav|mp3|ogg)$/i.test(f)) set.add(f);
    } catch {}
  }
  return [...set].sort((a, b) => a.localeCompare(b));
});

// Import a custom notification sound: copy a user-picked audio file into <userData>/sounds and return
// its (possibly de-duplicated) filename so the renderer can select it. Returns null on cancel/failure.
ipcMain.handle('import-sound', async () => {
  try {
    const res = await dialog.showOpenDialog({
      title: 'Choose a notification sound',
      properties: ['openFile', 'dontAddToRecent'],
      filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg'] }],
    });
    if (res.canceled || !res.filePaths || !res.filePaths.length) return null;
    const src = res.filePaths[0];
    const dir = userSoundsDir();
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(src);
    const stem = path.basename(src, ext);
    let base = stem + ext;
    let dest = path.join(dir, base);
    // Don't clobber a different existing file of the same name — suffix " (n)".
    let i = 1;
    while (fs.existsSync(dest)) {
      try {
        if (fs.realpathSync(dest) === fs.realpathSync(src)) return base; // same file already imported
      } catch {}
      base = `${stem} (${i++})${ext}`;
      dest = path.join(dir, base);
    }
    fs.copyFileSync(src, dest);
    return base;
  } catch (err) {
    debug.log('[import-sound] ' + (err.message || err));
    return null;
  }
});

// NOTE: overlay notifications are no longer rendered from an app-side WebSocket bridge. The Watchdog
// now spawns a `--wintype=notification` process for each overlay notification (see watchdog
// notification/toaster.js), so they appear with the main app closed; when the app is open the
// single-instance lock forwards the args to it via 'second-instance'. This avoids the duplicate that
// a still-listening bridge would cause and removes the "app must be open" requirement.

function checkResources() {
  function copyFolderRecursive(src, dst) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dst, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
      const srcPath = path.join(src, e.name);
      const dstPath = path.join(dst, e.name);
      if (e.isDirectory()) {
        copyFolderRecursive(srcPath, dstPath);
      } else {
        let shouldCopy = false;
        if (!fs.existsSync(dstPath)) shouldCopy = true;
        else {
          try {
            fs.accessSync(dstPath, fs.constants.W_OK);
            const srcStat = fs.statSync(srcPath);
            const dstStat = fs.statSync(dstPath);
            if (srcStat.size !== dstStat.size || srcStat.mtimeMs > dstStat.mtimeMs) shouldCopy = true;
          } catch {}
        }
        if (shouldCopy) fs.copyFileSync(srcPath, dstPath);
      }
    }
  }

  const resourcesPath = path.join(manifest.config.debug ? path.join(__dirname, '..') : path.join(process.resourcesPath, 'userdata'));

  const media = path.join(resourcesPath, 'Media');
  copyFolderRecursive(media, path.join(userData, 'Media'));

  const view = path.join(resourcesPath, 'view');
  copyFolderRecursive(view, path.join(userData, 'view'));

  const source = path.join(resourcesPath, 'Source');
  copyFolderRecursive(source, path.join(userData, 'Source'));

  // Startup registration is user-controlled from Settings > General.
}

// System tray — the app lives here. Single left-click / "Open" shows the UI window; "Quit" is the only
// way to actually exit (it sets app.isQuiting so before-quit tears down the monitor).
let tray = null;
function createTray() {
  if (tray) return tray;
  try {
    const iconPath = path.join(__dirname, '../resources/icon/icon.ico');
    const image = nativeImage.createFromPath(iconPath);
    tray = new Tray(image.isEmpty() ? iconPath : image);
    tray.setToolTip('Achievement Watcher');
    const rebuildMenu = () => {
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Open Achievement Watcher', click: () => createMainWindow() },
        {
          label: 'Restart background monitor',
          click: () => {
            if (monitorProc) {
              try {
                monitorProc.kill();
              } catch {}
            }
            setTimeout(() => launchWatchdog(), 500);
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            app.isQuiting = true;
            app.quit();
          },
        },
      ]);
      tray.setContextMenu(contextMenu);
    };
    rebuildMenu();
    tray.on('click', () => createMainWindow());
    tray.on('double-click', () => createMainWindow());
    debug.log('[tray] created');
  } catch (err) {
    debug.log(`[tray] failed to create: ${err.message || err}`);
  }
  return tray;
}

try {
  const gotSingleInstanceLock = app.requestSingleInstanceLock();
  if (!gotSingleInstanceLock) {
    app.quit();
  } else {
  autoUpdater.on('update-downloaded', async (info) => {
    await startEngines();
    const skippedVersion = configJS.general.skippedVersion;
    if (skippedVersion.toLowerCase() !== 'none' && require('semver').gte(skippedVersion, info.version)) {
      return;
    }
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: `A new version (${info.version}) has been downloaded.`,
      detail: `Would you like to install it now?`,
      buttons: ['Yes', 'Later', 'Skip this version'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) autoUpdater.quitAndInstall();
    else if (response === 2) {
      configJS.general.skippedVersion = info.version;
      settingsJS.save(configJS);
    }
  });

  app
    .on('ready', async function () {
      ipc.window();
      // Startup-only init for the resident tray daemon (runs once, regardless of --hidden):
      // load config, copy resources, sync the login item, create the tray, then spawn/supervise the monitor.
      try {
        await startEngines();
      } catch (err) {
        debug.log('[startEngines] failed before startup sync: ' + err.message);
      }
      try {
        checkResources();
      } catch (err) {
        debug.log('[checkResources] failed: ' + err.message);
      }
      if (!manifest.config.debug) {
        try {
          ipc.setStartWithWindows(configJS?.general?.startWithWindows !== false);
        } catch (err) {
          debug.log('[startup] failed to sync login item: ' + (err.message || err));
        }
      }
      createTray();
      launchWatchdog();
      scheduleBackgroundAutoFix(); // headless emulator auto-fix while the window stays closed
      // Cap the per-appid icon cache off the startup critical path (LRU by access time, ~1 GiB
      // default; no-op when under cap).
      setTimeout(() => {
        try {
          const { pruneIconCache } = require(path.join(__dirname, '../util/iconCache.js'));
          const r = pruneIconCache(path.join(userData, 'steam_cache', 'icon'));
          if (r.count > 0)
            debug.log(`[iconCache] pruned ${r.count} folder(s), freed ${(r.freed / 1048576).toFixed(0)}MB (was ${(r.before / 1048576).toFixed(0)}MB)`);
        } catch (err) {
          debug.log('[iconCache] prune skipped: ' + (err.message || err));
        }
      }, 15000);
      const args = minimist(process.argv.slice(1));
      parseArgs(args); // opens the window unless launched with --hidden
    })
    .on('window-all-closed', function () {
      // Resident tray daemon: do NOT quit when the window closes — the tray + background monitor stay
      // alive. The app exits only via the tray "Quit" item.
    })
    .on('web-contents-created', (event, contents) => {
      contents.on('new-window', (event, url) => {
        event.preventDefault();
      });
    })
    .on('second-instance', async (event, argv, cwd) => {
      // A second launch (user re-running the exe, e.g. from the Start menu while it sits hidden in
      // the tray) should surface the UI window.
      debug.log(`[second-instance] argv=${JSON.stringify(argv || [])}`);
      const args = minimist(argv.slice(1));
      if ((args['wintype'] || 'main') === 'main') createMainWindow();
      else parseArgs(args);
    })
    .on('before-quit', function () {
      // Resident tray daemon: the monitor is our supervised child, so terminate it on a real quit
      // instead of leaking a background process. app.isQuiting also disables the respawn supervisor.
      app.isQuiting = true;
      clearTimeout(monitorRespawnTimer);
      if (monitorProc) {
        debug.log('[monitor] terminating monitor child on quit');
        try {
          monitorProc.kill();
        } catch {}
        monitorProc = null;
      }
    });
  }
} catch (err) {
  dialog.showErrorBox('Critical Error', `Failed to initialize:\n${err}`);
  app.quit();
}
