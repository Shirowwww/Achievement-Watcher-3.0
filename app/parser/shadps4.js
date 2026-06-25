'use strict';

// ShadPS4 (PS4 emulator) trophy reader. Modelled on rpcs3.js, but ShadPS4 keeps both the trophy
// schema AND the unlock state inside the per-game TROP*.XML files (unlockstate / timestamp
// attributes), so there is no separate binary save file to decode (unlike RPCS3's TROPUSR.DAT).
//
// On-disk layout (portable or %APPDATA%\shadPS4):
//   <root>/game_data/<CUSA#####>/TrophyFiles/trophy00/Xml/TROP.XML        (+ TROP_NN.XML per language)
//   <root>/game_data/<CUSA#####>/TrophyFiles/trophy00/Icons/TROP000.PNG   (trophy icons, id padded to 3)
// User scoping: ShadPS4 stores trophies under either <root>/game_data or <root>/user/game_data; both
// are enumerated and de-duplicated by CUSA id (first wins).

const path = require('path');
const util = require('util');
const xml2js = require('xml2js');
const glob = require('fast-glob');
const ffs = require('@xan105/fs');

const binary = ['shadPS4.exe', 'shadps4.exe'];

// Best-effort language → TROP_NN.XML suffix (ShadPS4/Sony index). english has no suffix (TROP.XML).
const LANG_FILE = {
  japanese: '00', english: '01', french: '02', spanish: '03', german: '04', italian: '05',
  dutch: '06', portuguese: '07', russian: '08', koreana: '09', tchinese: '10', schinese: '11',
  polish: '16', brazilian: '17', turkish: '19', latam: '20',
};

const toUnixSeconds = (raw) => {
  let n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e12) n = Math.floor(n / 1000000); // microseconds
  else if (n > 1e11) n = Math.floor(n / 1000); // milliseconds
  return n;
};

const ttype = (t) => {
  const c = String(t || '').trim().toUpperCase();
  if (['P', 'G', 'S', 'B'].includes(c)) return c;
  if (c.startsWith('PLAT')) return 'P';
  if (c.startsWith('GOLD')) return 'G';
  if (c.startsWith('SILV')) return 'S';
  if (c.startsWith('BRON')) return 'B';
  return c || 'B';
};

async function gameDataRoots(dir) {
  // Accept a watched folder that either contains the emulator binary or is itself a data root.
  const roots = new Set();
  for (const sub of ['game_data', 'user/game_data']) {
    const p = path.join(dir, sub);
    if (await ffs.exists(p)) roots.add(p);
  }
  return [...roots];
}

function configArray(config, key) {
  const match = String(config || '').match(new RegExp(`^\\s*${key}\\s*=\\s*(\\[[^\\]]*\\])`, 'm'));
  if (!match) return [];
  try {
    const value = JSON.parse(match[1]);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// Trophy data survives a game uninstall, so it is not proof that the PS4 game itself is still
// present. Resolve shadPS4's enabled install directories and require a real game layout
// (sce_sys/param.sfo + eboot.bin). The CUSA id is embedded as plain ASCII in PARAM.SFO.
async function installedGames(dir) {
  const games = new Map();
  let config;
  try {
    config = await ffs.readFile(path.join(dir, 'config.toml'), 'utf-8');
  } catch {
    return games;
  }

  const installDirs = configArray(config, 'installDirs');
  const enabled = configArray(config, 'installDirsEnabled');
  for (let i = 0; i < installDirs.length; i++) {
    if (enabled[i] === false || typeof installDirs[i] !== 'string' || !installDirs[i].trim()) continue;
    const installDir = path.resolve(installDirs[i]);
    let sfos = [];
    try {
      sfos = await glob('**/sce_sys/param.sfo', {
        cwd: installDir,
        onlyFiles: true,
        absolute: true,
        deep: 5,
      });
    } catch {
      continue;
    }

    for (const sfo of sfos) {
      const gameDir = path.normalize(path.dirname(path.dirname(sfo)));
      if (!(await ffs.exists(path.join(gameDir, 'eboot.bin')))) continue;
      try {
        const raw = await ffs.readFile(sfo);
        const match = raw.toString('latin1').match(/CUSA\d{5}/i);
        if (match) games.set(match[0].toUpperCase(), gameDir);
      } catch {
        // Try the next configured game.
      }
    }
  }
  return games;
}

module.exports.scan = async (dir) => {
  const data = [];
  const seen = new Set();

  try {
    const installed = await installedGames(dir);
    for (const gameData of await gameDataRoots(dir)) {
      let cusaDirs;
      try {
        cusaDirs = await glob('CUSA*', { cwd: gameData, onlyDirectories: true, absolute: false });
      } catch {
        continue;
      }

      for (const cusa of cusaDirs) {
        if (seen.has(cusa)) continue;
        try {
          const trophyFiles = path.join(gameData, cusa, 'TrophyFiles');
          const sets = await glob('trophy*', { cwd: trophyFiles, onlyDirectories: true, absolute: false });
          for (const set of sets) {
            const trophyDir = path.join(trophyFiles, set);
            const xmls = await glob('TROP*.{XML,xml}', { cwd: path.join(trophyDir, 'Xml'), onlyFiles: true });
            if (xmls.length === 0) continue;
            const gameDir = installed.get(cusa.toUpperCase());
            data.push({
              appid: cusa,
              source: 'ShadPS4 Emulator',
              data: { type: 'shadps4', path: trophyDir, gameDir, trustedInstalled: !!gameDir },
            });
            seen.add(cusa);
            break; // one trophy set per game
          }
        } catch {
          // try next game
        }
      }
    }
  } catch {
    // Do nothing
  }

  return data;
};

module.exports._internal = { configArray, installedGames };

async function listXml(xmlDir) {
  const files = await glob('TROP*.{XML,xml}', { cwd: xmlDir, onlyFiles: true });
  // Stable order so a deterministic "base" language file is chosen.
  return files.sort();
}

async function readXml(filePath) {
  const file = await ffs.readFile(filePath, 'utf-8');
  return util.promisify(xml2js.parseString)(file, {
    explicitArray: false,
    explicitRoot: false,
    ignoreAttrs: false,
    emptyTag: null,
  });
}

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

module.exports.getGameData = async (dir, lang) => {
  const xmlDir = path.join(dir, 'Xml');
  const iconsDir = path.join(dir, 'Icons');
  const files = await listXml(xmlDir);
  if (files.length === 0) throw 'No TROP*.XML found';

  // Prefer the requested language file, then the default TROP.XML, then the first available.
  const suffix = LANG_FILE[String(lang || '').toLowerCase()];
  const wanted = suffix ? `trop_${suffix}.xml` : 'trop.xml';
  const baseFile =
    files.find((f) => f.toLowerCase() === wanted) ||
    files.find((f) => f.toLowerCase() === 'trop.xml') ||
    files[0];

  const schema = await readXml(path.join(xmlDir, baseFile));
  const trophies = asArray(schema.trophy);
  const cusa = path.basename(path.dirname(path.dirname(dir))); // .../game_data/<CUSA>/TrophyFiles/<set>

  const list = trophies.map((trophy) => {
    const attr = trophy['$'] || {};
    const id = parseInt(attr.id, 10);
    const pad = String(Number.isFinite(id) ? id : attr.id).padStart(3, '0');
    const icon = 'file:///' + path.join(iconsDir, `TROP${pad}.PNG`).replace(/\\/g, '/');
    return {
      name: Number.isFinite(id) ? id : attr.id,
      hidden: String(attr.hidden).toLowerCase() === 'yes' ? 1 : 0,
      type: ttype(attr.ttype),
      displayName: trophy.name || '',
      description: trophy.detail || '',
      icon,
      icongray: icon,
    };
  });

  // Game header: ShadPS4 has no cover art on disk, so use the platinum/first trophy icon as a
  // non-broken placeholder. The advanced cover-management UI lets the user override it.
  const header = list.length > 0 ? list[0].icon : undefined;

  return {
    name: schema['title-name'] || cusa,
    appid: cusa,
    system: 'playstation',
    img: { header },
    achievement: {
      total: list.length,
      list,
    },
  };
};

module.exports.getAchievements = async (dir) => {
  // Unlock state lives in the same TROP*.XML files (attributes unlockstate / unlocked / timestamp).
  // Union across all language files so we don't miss a flag written to only one of them.
  const xmlDir = path.join(dir, 'Xml');
  const files = await listXml(xmlDir);
  const byId = new Map();

  for (const file of files) {
    let schema;
    try {
      schema = await readXml(path.join(xmlDir, file));
    } catch {
      continue;
    }
    for (const trophy of asArray(schema.trophy)) {
      const attr = trophy['$'] || {};
      if (attr.id === undefined) continue;
      const id = parseInt(attr.id, 10);
      const key = Number.isFinite(id) ? id : attr.id;
      const unlocked =
        String(attr.unlockstate).toLowerCase() === 'true' || String(attr.unlocked).toLowerCase() === 'yes';
      const time = toUnixSeconds(attr.timestamp);
      const prev = byId.get(key);
      if (!prev || (unlocked && !prev.achieved)) {
        byId.set(key, { id: key, achieved: unlocked, earned_time: time || (prev ? prev.earned_time : 0) });
      }
    }
  }

  return [...byId.values()];
};
