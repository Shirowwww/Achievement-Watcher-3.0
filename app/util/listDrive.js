'use strict';

const { execFile } = require('child_process');
const fs = require('fs');

/*
  List local fixed drive letters. WMIC is gone on Windows 11 24H2+, so query CIM via PowerShell and
  fall back to a drive-letter probe; the "C:" output format is unchanged.
*/
module.exports = (option = {}) => {
  const ignoreSystemDrive = option.ignoreSystemDrive || false;
  const systemDrive = (process.env['SystemDrive'] || 'C:').toUpperCase();

  const probeLetters = () => {
    const drives = [];
    for (let c = 'C'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
      const letter = String.fromCharCode(c) + ':';
      try {
        if (fs.existsSync(letter + '\\')) drives.push(letter);
      } catch {
        /* drive not ready / inaccessible -> skip */
      }
    }
    return drives;
  };

  const finalize = (drives) => {
    let list = drives.filter((d) => /^[A-Za-z]:$/.test(d));
    if (ignoreSystemDrive) list = list.filter((d) => d.toUpperCase() !== systemDrive);
    return list;
  };

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object -ExpandProperty DeviceID",
      ],
      { windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        let drives = [];
        if (!err && stdout) {
          drives = String(stdout)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s !== '');
        }
        if (drives.length === 0) drives = probeLetters(); //PowerShell missing/blocked -> native fallback
        resolve(finalize(drives));
      }
    );
  });
};
