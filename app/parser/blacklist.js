'use strict';

const path = require('path');
const request = require('request-zero');
const fs = require('fs');

let debug;
let exclusionFile;
const builtinExclude = [
  480, //Space War
  753, //Steam Config
  250820, //SteamVR
  228980, //Steamworks Common Redistributables
  431960, //Wallpaper Engine (background utility; subprocesses should never count as game time)
];
module.exports.initDebug = ({ isDev, userDataPath }) => {
  exclusionFile = path.join(userDataPath, 'cfg/exclusion.db');
  debug = new (require('@xan105/log'))({
    console: isDev || false,
    file: path.join(userDataPath, 'logs/blacklist.log'),
  });
};

module.exports.get = async () => {
  const url = 'https://api.xan105.com/steam/getBogusList';
  //TODO: replace this url with the full apilist of dlc/music/demo/etc

  let exclude = [
    ...builtinExclude,
  ];

  try {
    let srvExclusion = (await request.getJson(url)).data;
    debug.log('blacklist from srv:');
    debug.log(srvExclusion);
    exclude = [...new Set([...exclude, ...srvExclusion])];
  } catch (err) {
    //Do nothing
  }

  try {
    let userExclusion = JSON.parse(fs.readFileSync(exclusionFile, 'utf8'));
    exclude = [...new Set([...exclude, ...userExclusion])];
  } catch (err) {
    //Do nothing
  }

  return exclude;
};

module.exports.reset = async () => {
  fs.mkdirSync(path.dirname(exclusionFile), { recursive: true });
  fs.writeFileSync(exclusionFile, JSON.stringify([], null, 2), 'utf8');
};

module.exports.add = async (appid) => {
  try {
    debug.log(`Blacklisting ${appid} ...`);

    let userExclusion;

    try {
      userExclusion = JSON.parse(fs.readFileSync(exclusionFile, 'utf8'));
    } catch (e) {
      userExclusion = [];
    }

    if (!userExclusion.includes(appid)) {
      userExclusion.push(appid);
      fs.mkdirSync(path.dirname(exclusionFile), { recursive: true });
      fs.writeFileSync(exclusionFile, JSON.stringify(userExclusion, null, 2), 'utf8');
      debug.log('Done.');
    } else {
      debug.log('Already blacklisted.');
    }
    try {
      const gameIndex = require(path.join(__dirname, 'gameIndex.js'));
      const removed = gameIndex.remove(appid);
      if (removed > 0) debug.log(`Removed ${removed} tracking entr${removed === 1 ? 'y' : 'ies'} from gameIndex.`);
    } catch (err) {
      debug.log(err);
    }
  } catch (err) {
    throw err;
  }
};

module.exports.builtin = builtinExclude.slice();
