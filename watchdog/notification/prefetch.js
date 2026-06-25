'use strict';

const path = require('path');
const urlParser = require('url');
const fs = require('fs');
const request = require('request-zero');

const debug = require('../util/log.js');

const cdnProviders = [
  'https://cdn.akamai.steamstatic.com/steam/apps/',
  'https://cdn.cloudflare.steamstatic.com/steam/apps/',
  'https://media.steampowered.com/steam/apps/',
  'https://steamcdn-a.akamaihd.net/steam/apps/',
  'https://shared.fastly.steamstatic.com/steam/apps/',
  'https://shared.fastly.steamstatic.com/community_assets/images/apps/',
  'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/',
  'https://steampipe.akamaized.net/steam/apps/',
  'https://google2.cdn.steampipe.steamcontent.com/steam/apps/',
  'https://steamcdn-a.akamaihd.net/steam/apps/',
  'https://media.steampowered.com/steam/apps/',
];
async function findWorkingLink(appid, basename) {
  for (const ext of ['.jpg', '.png']) {
    for (const cdn of cdnProviders) {
      const url = `${cdn}${appid}/${basename}${ext}`;
      try {
        const res = await request(url, { method: 'HEAD' });
        if (res.code === 200) {
          const contentType = res.headers['content-type'];
          if (contentType) return url;
        }
      } catch (e) {}
    }
  }
  return null;
}

module.exports = async (url, appID) => {
  let validUrl;
  let filePath;
  try {
    const cache = path.join(process.env['APPDATA'], `Achievement Watcher/steam_cache/icon/${appID}`);
    let filename = path.parse(url).base;
    filePath = path.join(cache, filename);
    if (fs.existsSync(filePath)) return filePath;
    let exts = ['.jpg', '.png'];
    if (!url.endsWith('.jpg') && !url.endsWith('.png'))
      for (let ext of exts) {
        filePath = path.join(cache, filename + ext);
        if (fs.existsSync(filePath)) return filePath;
      }
    //legacy url are full urls, check if they are still valid
    let isValid = false;
    validUrl = url;
    try {
      new URL(url);
      const res = await request(url, { method: 'HEAD' });
      isValid = res.code !== 200 ? false : true;
      isValid = isValid ? res.headers['content-type'] : isValid;
    } catch (e) {}

    if (!isValid)
      validUrl = await findWorkingLink(
        appID,
        url.startsWith('http')
          ? url
              .split('/')
              .pop()
              .split('?')[0]
              .replace(/\.[^.]+$/, '')
          : url.endsWith('.jpg') || url.endsWith('.png')
          ? url.slice(0, url.length - 4)
          : url
      );

    filename = path.parse(urlParser.parse(validUrl).pathname).base;

    filePath = path.join(cache, filename);

    if (fs.existsSync(filePath)) {
      return filePath;
    } else {
      return (await request.download(validUrl, cache, { validateFileSize: false })).path;
    }
  } catch (err) {
    if (err.code === 'ESIZEMISMATCH') {
      try {
        const fetch = require('node-fetch');
        const res = await fetch(validUrl);
        if (!res.ok) return validUrl;
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(filePath, buffer);
        return filePath;
      } catch (e) {
        return validUrl;
      }
    }
    return url;
  }
};
