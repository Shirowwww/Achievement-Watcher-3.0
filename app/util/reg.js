const { execSync } = require('child_process');

let registryJs = null;
let registryLoadError = null;

try {
  registryJs = require('registry-js');
} catch (err) {
  registryLoadError = err;
}

// `registry-js` is a compiled addon: a build that never ran its install script ships without
// `build/Release/registry.node`. That used to make every read here return null/[]/false, which is
// indistinguishable from "the key is not there" - Steam accounts (and therefore Steam games), Uplay,
// GreenLuma, playtime and the user avatar all went quiet with nothing in the log. Everything below
// falls back to reg.exe, which is present on every Windows install, so a missing binary costs speed
// instead of functionality.
let warnedAboutFallback = false;

function usingFallback() {
  if (registryJs) return false;
  if (!warnedAboutFallback) {
    warnedAboutFallback = true;
    const message = registryLoadError && registryLoadError.message ? registryLoadError.message : 'unknown error';
    console.warn(`[reg] registry-js unavailable (${message}) - falling back to reg.exe`);
  }
  return true;
}

function requireRegistry() {
  if (registryJs) return registryJs;
  const message = registryLoadError && registryLoadError.message ? registryLoadError.message : 'unknown error';
  const err = new Error(`Windows registry support is unavailable: ${message}`);
  err.cause = registryLoadError;
  throw err;
}

// ---- reg.exe fallback ---------------------------------------------------------------------------

// reg.exe accepts either spelling on input but always echoes the long one, and the output is what
// subkey lines are matched against - so use the long form throughout.
const HIVE_NAMES = {
  hkcr: 'HKEY_CLASSES_ROOT',
  hkcu: 'HKEY_CURRENT_USER',
  hklm: 'HKEY_LOCAL_MACHINE',
  hku: 'HKEY_USERS',
  hkcc: 'HKEY_CURRENT_CONFIG',
};

// The command is handed to cmd.exe as a string (execSync) so `chcp` and `reg` share one console.
// Quoting is ours to get right, so refuse anything that could break out of the quoted argument.
function quoteRegArg(value) {
  const text = String(value);
  if (/["\r\n%|&<>^]/.test(text)) return null;
  return `"${text}"`;
}

function regExePath(hive, key) {
  const hiveName = HIVE_NAMES[String(hive).toLowerCase()];
  if (!hiveName) return null;
  const normalized = String(key || '').replace(/\//g, '\\').replace(/^\\+|\\+$/g, '');
  return normalized ? `${hiveName}\\${normalized}` : hiveName;
}

// reg.exe writes in the console's OEM codepage, so a path like C:\Users\pipié comes back mangled
// when it is decoded as UTF-8. `chcp 65001` in the same cmd invocation makes the output real UTF-8.
function runRegExe(args) {
  try {
    return execSync(`chcp 65001>nul & reg ${args}`, {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    // A missing key exits non-zero; so does a denied one. Both mean "nothing to read".
    return null;
  }
}

function parseRegExeValue(type, raw) {
  if (type === 'REG_DWORD' || type === 'REG_QWORD') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (type === 'REG_MULTI_SZ') return raw.split('\\0');
  return raw;
}

// `reg query <key>` prints the key itself, then one indented line per value, then one full path per
// immediate subkey.
function queryRegExe(hive, key) {
  const target = regExePath(hive, key);
  if (target === null) return null;
  const quoted = quoteRegArg(target);
  if (!quoted) return null;

  const output = runRegExe(`query ${quoted}`);
  if (output === null) return null;

  const values = [];
  const subkeys = [];
  const prefix = `${target.toLowerCase()}\\`;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const value = line.match(/^\s{4}(.*?)\s{4}(REG_[A-Z_]+)\s{4}?(.*)$/);
    if (value) {
      // registry-js reports the unnamed default value as '', reg.exe prints "(Default)".
      const name = value[1] === '(Default)' ? '' : value[1];
      values.push({ name, type: value[2], data: parseRegExeValue(value[2], value[3]) });
      continue;
    }

    const path = line.trim();
    // Only immediate children: reg query without /s never recurses, but the key's own header line
    // shares the prefix test and must not be counted as its own subkey.
    if (path.toLowerCase().startsWith(prefix)) {
      const child = path.slice(target.length + 1);
      if (child && !child.includes('\\')) subkeys.push(child);
    }
  }

  return { values, subkeys };
}

// Both compat helpers return the shape registry-js uses, so the readers below stay identical
// whichever backend answered.
function enumerateValuesCompat(hive, key) {
  if (usingFallback()) {
    const result = queryRegExe(hive, key);
    return result ? result.values : [];
  }
  const { enumerateValues } = registryJs;
  const hiveEnum = hkeyFromString(hive);
  if (!hiveEnum) throw new Error(`Unsupported hive: ${hive}`);
  return enumerateValues(hiveEnum, key.replace(/\//g, '\\'));
}

function enumerateKeysCompat(hive, key) {
  if (usingFallback()) {
    const result = queryRegExe(hive, key);
    return result ? result.subkeys : [];
  }
  const { enumerateKeys } = registryJs;
  const hiveEnum = hkeyFromString(hive);
  if (!hiveEnum) throw new Error(`Unsupported hive: ${hive}`);
  return enumerateKeys(hiveEnum, key.replace(/\//g, '\\'));
}

function hkeyFromString(hive) {
  const { HKEY } = requireRegistry();
  const map = {
    hkcr: HKEY.HKEY_CLASSES_ROOT,
    hkcu: HKEY.HKEY_CURRENT_USER,
    hklm: HKEY.HKEY_LOCAL_MACHINE,
    hku: HKEY.HKEY_USERS,
    hkcc: HKEY.HKEY_CURRENT_CONFIG,
  };
  return map[hive.toLowerCase()];
}

function writeRegistryFallback(hive, keyPath, valueName, type, value) {
  const target = quoteRegArg(regExePath(hive, keyPath));
  const name = quoteRegArg(valueName || '');
  const data = quoteRegArg(value);
  if (!target || name === null || data === null) {
    throw new Error(`Failed to set registry value ${hive}\\${keyPath}\\${valueName || ''}`);
  }
  // /ve writes the unnamed default value; /v takes a named one. /f overwrites without prompting.
  const nameArg = valueName ? `/v ${name}` : '/ve';
  if (runRegExe(`add ${target} ${nameArg} /t ${type} /d ${data} /f`) === null) {
    throw new Error(`Failed to set registry value ${hive}\\${keyPath}\\${valueName || ''}`);
  }
}

function writeRegistryString(hive, keyPath, valueName, value) {
  if (usingFallback()) return writeRegistryFallback(hive, keyPath, valueName, 'REG_SZ', String(value));

  const { setValue, createKey } = requireRegistry();
  const hiveEnum = hkeyFromString(hive);
  if (!hiveEnum) throw new Error(`Unsupported hive: ${hive}`);

  const normalizedKey = keyPath.replace(/\//g, '\\');

  // Default value is represented by "" (empty string) not "(default)"
  const name = valueName || '';
  createKey(hiveEnum, normalizedKey);

  const ok = setValue(hiveEnum, normalizedKey, name, 'REG_SZ', String(value));
  if (!ok) throw new Error(`Failed to set registry value ${hive}\\${keyPath}\\${name}`);
}

function writeRegistryDword(hive, keyPath, valueName, value) {
  if (usingFallback()) return writeRegistryFallback(hive, keyPath, valueName, 'REG_DWORD', String(value));

  const { setValue, createKey } = requireRegistry();
  const hiveEnum = hkeyFromString(hive);
  if (!hiveEnum) throw new Error(`Unsupported hive: ${hive}`);

  const normalizedKey = keyPath.replace(/\//g, '\\');

  const name = valueName || ''; // "" = (Default) value
  createKey(hiveEnum, normalizedKey);

  // REG_DWORD expects a string, even though it’s numeric
  const ok = setValue(hiveEnum, normalizedKey, name, 'REG_DWORD', String(value));
  if (!ok) {
    throw new Error(`Failed to set DWORD value ${hive}\\${keyPath}\\${name} = ${value}`);
  }
}

function ListRegistryAllValues(hive, key) {
  // enumerateValues returns an array of objects: { name, type, data }
  return enumerateValuesCompat(hive, key).map((v) => v.name);
}

function listRegistryAllSubkeys(hive, key) {
  // enumerateKeys returns an array of strings
  return enumerateKeysCompat(hive, key);
}

function readRegistryInteger(hive, key, valueName) {
  const val = enumerateValuesCompat(hive, key).find((v) => v.name === valueName);

  if (!val || (val.type !== 'REG_DWORD' && val.type !== 'REG_QWORD')) {
    return null;
  }

  return Number(val.data);
}

function readRegistryString(hive, key, valueName) {
  // Default value in registry-js is ''
  const name = valueName || '';

  const val = enumerateValuesCompat(hive, key).find((v) => v.name === name);

  if (!val || (val.type !== 'REG_SZ' && val.type !== 'REG_EXPAND_SZ')) return null;
  if (val.type === 'REG_EXPAND_SZ') {
    return val.data.replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`);
  }
  return val.data;
}

function readRegistryStringAndExpand(hive, key, valueName) {
  const name = valueName || ''; // default value is empty string

  const val = enumerateValuesCompat(hive, key).find((v) => v.name === name);

  if (!val || (val.type !== 'REG_EXPAND_SZ' && val.type !== 'REG_SZ')) return null;

  // Expand environment variables if REG_EXPAND_SZ
  if (val.type === 'REG_EXPAND_SZ') {
    return expandEnvVariables(val.data);
  } else {
    return val.data;
  }
}

function regKeyExists(hive, key) {
  // If the key doesn't exist, both enumerations come back empty
  let subkeys = [];
  let values = [];
  try {
    subkeys = enumerateKeysCompat(hive, key);
  } catch {
    subkeys = [];
  }
  try {
    values = enumerateValuesCompat(hive, key);
  } catch {
    values = [];
  }
  return subkeys.length > 0 || values.length > 0;
}

// Helper to expand %VAR% env vars in a string (Windows style)
function expandEnvVariables(str) {
  return str.replace(/%([^%]+)%/g, (_, n) => process.env[n] || `%${n}%`);
}

module.exports = {
  writeRegistryDword,
  writeRegistryString,
  readRegistryString,
  readRegistryStringAndExpand,
  readRegistryInteger,
  listRegistryAllSubkeys,
  ListRegistryAllValues,
  regKeyExists,
};
