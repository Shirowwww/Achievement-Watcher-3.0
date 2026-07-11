'use strict';

const fs = require('fs');

async function exists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  exists,
  readFile: fs.promises.readFile.bind(fs.promises),
  writeFile: fs.promises.writeFile.bind(fs.promises),
};
