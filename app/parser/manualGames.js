'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let file = '';

function normalize(record) {
  if (!record || typeof record !== 'object') return null;
  const title = String(record.title || '').trim();
  const exe = String(record.exe || '').trim();
  const platform = String(record.platform || 'PC').trim() || 'PC';
  const storeAppId = String(record.storeAppId || '').trim();
  if (!title || !exe) return null;
  const seed = `${path.normalize(exe).toLowerCase()}\0${title.toLowerCase()}`;
  const id = String(record.id || `manual-${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 12)}`);
  return { id, title, exe, platform, storeAppId, addedAt: Number(record.addedAt) || Date.now() };
}

function read() {
  if (!file) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (Array.isArray(parsed) ? parsed : []).map(normalize).filter(Boolean);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function write(records) {
  if (!file) throw new Error('manualGames user-data path is not initialized');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(records.map(normalize).filter(Boolean), null, 2), 'utf8');
}

module.exports.setUserDataPath = (userDataPath) => {
  file = path.join(userDataPath, 'cfg', 'manualGames.json');
};

module.exports.list = () => read();

module.exports.upsert = (record) => {
  const next = normalize(record);
  if (!next) throw new Error('A title and executable are required');
  const records = read();
  const index = records.findIndex((item) => item.id === next.id);
  if (index >= 0) records[index] = { ...records[index], ...next };
  else records.push(next);
  write(records);
  return next;
};

module.exports.remove = (id) => {
  const records = read();
  const next = records.filter((item) => item.id !== String(id));
  if (next.length === records.length) return false;
  write(next);
  return true;
};

module.exports._normalize = normalize;
