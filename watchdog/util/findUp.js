'use strict';

const fs = require('fs');
const path = require('path');

async function findUp(matcher, options = {}) {
  let directory = path.resolve(options.cwd || process.cwd());
  while (true) {
    const result = await matcher(directory);
    if (result) return result;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

findUp.exists = async (filePath) => {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
};

module.exports = findUp;
