'use strict';

/*
  Portable notification presets: read and write the `.awpreset` package.

  A package is a plain zip holding a manifest and the preset's own files:

    manifest.json           format metadata + the builder options that produced the preset
    preset/index.html       required entry point
    preset/**               style.css, images, fonts (relative paths only)
    sounds/**               optional audio, installed into <userData>/sounds

  Everything here is deliberately declarative: nothing inside a package is ever executed, required
  or evaluated during import. The preset's HTML only runs later, in the same sandboxed notification
  window that renders a bundled preset (contextIsolation, no node integration).

  A future preset gallery can serve exactly these files: the manifest carries the listing metadata
  and the compatibility floor, so a package validates identically whether it came from a friend or
  from a server. Unknown manifest fields are ignored, which leaves room to add some.
*/

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const semver = require('semver');
const { customPresetNumbers, sanitizePresetName, PRESET_OPTIONS_FILE, PRESET_PACKAGE_FILE } = require('./customPreset.js');
const { SOUND_EXT_RE } = require('./notificationSounds.js');

const PRESET_PACKAGE_EXTENSION = '.awpreset';
const PRESET_PACKAGE_FORMAT = 'aw-preset';

// Bumped only when a package written today would be misread by this code. A reader refuses a
// higher number outright rather than guessing at a layout it does not know.
const PRESET_PACKAGE_FORMAT_VERSION = 1;

const MANIFEST_NAME = 'manifest.json';
const PRESET_DIR = 'preset';
const SOUNDS_DIR = 'sounds';
const PRESET_ENTRY = 'index.html';

/*
  The installed manifest, kept beside the preset's files (the name lives in util/customPreset.js, so
  the two modules that read it cannot disagree). It is what marks a preset as one the app installed —
  and may therefore delete — which the builder's own options file cannot do: a preset written by hand
  has no options, so without this marker an imported preset was installed but could never be listed
  or removed again. It also carries the metadata through a re-export.
*/

// What a preset is allowed to consist of. No .js: a preset's behaviour belongs in the inline script
// of its index.html, which is all a bundled preset has ever used, and this keeps a package from
// carrying loose code.
const PRESET_ASSET_RE = /\.(?:html|css|png|jpe?g|gif|webp|bmp|svg|ttf|otf|woff2?)$/i;

// Windows refuses these as filenames whatever the extension, so a package containing one could only
// ever fail halfway through an extraction.
const RESERVED_BASENAME_RE = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

// Junk Windows and macOS leave in folders; never worth shipping to someone else.
const JUNK_FILE_RE = /^(?:desktop\.ini|thumbs\.db|\.ds_store)$/i;

const LIMITS = {
  packageBytes: 128 * 1024 * 1024,
  fileBytes: 32 * 1024 * 1024,
  totalBytes: 96 * 1024 * 1024,
  entries: 300,
  depth: 8,
  pathLength: 180,
  textLength: 400,
  tags: 12,
};

// --- paths ------------------------------------------------------------------------------------

/*
  The only place a path from a package is trusted. Returns a clean forward-slash relative path, or
  '' for anything that could escape the destination: absolute paths, drive letters, `..`, NUL bytes,
  reserved device names, or names Windows silently rewrites (trailing space or dot).
*/
function safePackagePath(raw) {
  const value = String(raw == null ? '' : raw);
  if (!value || value.includes('\0')) return '';
  if (value.length > LIMITS.pathLength) return '';

  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return '';

  const segments = normalized.split('/');
  if (segments.length > LIMITS.depth) return '';
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return '';
    if (/[<>:"|?*\x00-\x1f]/.test(segment)) return '';
    if (/[ .]$/.test(segment)) return '';
    if (RESERVED_BASENAME_RE.test(segment)) return '';
  }
  return segments.join('/');
}

/*
  True when `target` resolves strictly below `root`. Used on every write destination, so a preset
  name can never reach outside the preset storage even if it survived sanitizing. The `..` test is
  on whole segments: a folder legitimately named "..neon" starts with two dots without escaping
  anything.
*/
function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (!rel || path.isAbsolute(rel)) return false;
  return !rel.split(/[\\/]/).includes('..');
}

// --- manifest ---------------------------------------------------------------------------------

function cleanText(value, max = LIMITS.textLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
}

function cleanTags(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const tag of value) {
    const clean = cleanText(tag, 24).toLowerCase();
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= LIMITS.tags) break;
  }
  return out;
}

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

/*
  The designer options a manifest carries, re-clamped.

  The one subtlety is the sound. A package written before presets could name their own sound recorded
  it in  alone, and that was the author's intent — so it becomes the preset's sound.
  A package that DOES carry the field is respected exactly, including an empty value: that means "use
  whatever the Notifications tab is set to", and inheriting the exporter's sound over it would pin a
  sound onto a preset that deliberately had no opinion.
*/
function manifestOptions(raw, manifestSound) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const options = customPresetNumbers(raw);
  if (!Object.prototype.hasOwnProperty.call(raw, 'sound') && manifestSound) options.sound = manifestSound;
  return options;
}

/*
  Validate the manifest on its own, before a single byte is written. `appVersion` is the running
  app's version; an omitted or unparsable one skips only the compatibility floor, never the
  structural checks.
*/
function validateManifest(raw, { appVersion = '' } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid-manifest');
  if (raw.format !== PRESET_PACKAGE_FORMAT) return fail('not-a-preset-package');

  const formatVersion = Number(raw.formatVersion);
  if (!Number.isInteger(formatVersion) || formatVersion < 1) return fail('invalid-manifest');
  if (formatVersion > PRESET_PACKAGE_FORMAT_VERSION) {
    return fail('format-too-new', { formatVersion, supported: PRESET_PACKAGE_FORMAT_VERSION });
  }

  const name = sanitizePresetName(raw.name);
  if (!name) return fail('invalid-name');

  const minVersion = cleanText(raw.app && raw.app.minVersion, 32);
  if (minVersion) {
    if (!semver.valid(minVersion)) return fail('invalid-manifest');
    const current = semver.valid(semver.coerce(appVersion));
    if (current && semver.lt(current, minVersion)) return fail('app-too-old', { requires: minVersion });
  }

  const sound = cleanText(raw.sound, 120);
  if (sound && (safePackagePath(sound) !== sound || sound.includes('/') || !SOUND_EXT_RE.test(sound))) {
    return fail('invalid-manifest');
  }

  return {
    ok: true,
    manifest: {
      format: PRESET_PACKAGE_FORMAT,
      formatVersion,
      name,
      description: cleanText(raw.description),
      author: cleanText(raw.author, 80),
      version: cleanText(raw.version, 32),
      tags: cleanTags(raw.tags),
      createdAt: cleanText(raw.createdAt, 40),
      app: {
        createdWith: cleanText(raw.app && raw.app.createdWith, 32),
        minVersion,
      },
      // Re-clamped through the builder's own ranges, so a hand-edited manifest cannot widen them.
      options: manifestOptions(raw.options, sound),
      sound,
    },
  };
}

// --- export -----------------------------------------------------------------------------------

// Every shippable file in a preset folder, as relative forward-slash paths. Throws on an asset the
// format does not carry, rather than dropping it and exporting a preset that renders wrong.
function collectPresetFiles(presetDir) {
  const files = [];
  let total = 0;

  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.') || JUNK_FILE_RE.test(entry.name)) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (safePackagePath(relative) !== relative) throw new Error(`unsupported-path: ${relative}`);
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
        continue;
      }
      if (!entry.isFile()) continue;
      // Both bookkeeping files travel in the manifest instead, so they are validated on import.
      if (relative === PRESET_OPTIONS_FILE || relative === PRESET_PACKAGE_FILE) continue;
      if (!PRESET_ASSET_RE.test(entry.name)) throw new Error(`unsupported-asset: ${relative}`);
      const size = fs.statSync(path.join(dir, entry.name)).size;
      if (size > LIMITS.fileBytes) throw new Error(`asset-too-large: ${relative}`);
      total += size;
      if (total > LIMITS.totalBytes) throw new Error('package-too-large');
      files.push(relative);
    }
  };

  walk(presetDir, '');
  if (!files.includes(PRESET_ENTRY)) throw new Error('missing-entry');
  if (files.length + 1 > LIMITS.entries) throw new Error('too-many-files');
  return files;
}

/*
  Write `presetDir` out as a package. `sound` is optional and only carries a file when the sound
  travels with the preset; naming a sound without a file records what it was designed with, which is
  what a bundled sound needs (the recipient already has it).
*/
function exportPreset({ presetDir, name, destination, options = null, meta = {}, sound = null, appVersion = '' }) {
  const presetName = sanitizePresetName(name);
  if (!presetName) return fail('invalid-name');
  if (!presetDir || !fs.existsSync(path.join(presetDir, PRESET_ENTRY))) return fail('preset-not-found');

  let files;
  try {
    files = collectPresetFiles(presetDir);
  } catch (err) {
    return fail(String(err.message || err));
  }

  const soundName = sound && sound.name ? cleanText(sound.name, 120) : '';
  if (soundName && (soundName.includes('/') || soundName.includes('\\') || !SOUND_EXT_RE.test(soundName))) {
    return fail('invalid-sound');
  }

  const manifest = {
    format: PRESET_PACKAGE_FORMAT,
    formatVersion: PRESET_PACKAGE_FORMAT_VERSION,
    name: presetName,
    description: cleanText(meta.description),
    author: cleanText(meta.author, 80),
    version: cleanText(meta.version, 32) || '1.0.0',
    tags: cleanTags(meta.tags),
    createdAt: new Date().toISOString(),
    app: {
      createdWith: cleanText(appVersion, 32),
      // Only stated when a package actually needs a newer app; an absent floor means "any build
      // that understands this format version".
      minVersion: cleanText(meta.minAppVersion, 32),
    },
    options: options ? customPresetNumbers(options) : null,
    sound: soundName,
  };

  const check = validateManifest(manifest, { appVersion });
  if (!check.ok) return check;

  try {
    const zip = new AdmZip();
    zip.addFile(MANIFEST_NAME, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    for (const relative of files) {
      zip.addFile(`${PRESET_DIR}/${relative}`, fs.readFileSync(path.join(presetDir, relative)));
    }
    if (sound && sound.file && soundName) {
      const size = fs.statSync(sound.file).size;
      if (size > LIMITS.fileBytes) return fail('asset-too-large');
      zip.addFile(`${SOUNDS_DIR}/${soundName}`, fs.readFileSync(sound.file));
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    zip.writeZip(destination);
  } catch (err) {
    return fail(String(err.message || err));
  }

  return { ok: true, name: presetName, file: destination, files: files.length, sound: soundName };
}

// --- read -------------------------------------------------------------------------------------

/*
  Parse and fully validate a package without touching the preset storage. Returns the manifest plus
  the entries that would be installed, so the caller can decide about duplicates before any write.
*/
function readPackage(file, { appVersion = '' } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return fail('unreadable-package');
  }
  if (!stat.isFile()) return fail('unreadable-package');
  if (stat.size > LIMITS.packageBytes) return fail('package-too-large');

  let entries;
  try {
    entries = new AdmZip(file).getEntries();
  } catch {
    return fail('unreadable-package');
  }
  if (entries.length > LIMITS.entries) return fail('too-many-files');

  const seen = new Set();
  const presetFiles = [];
  const soundFiles = [];
  let manifestEntry = null;
  let total = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const raw = String(entry.entryName || '').replace(/\\/g, '/');
    if (seen.has(raw)) return fail('duplicate-entry');
    seen.add(raw);

    if (entry.header.size > LIMITS.fileBytes) return fail('asset-too-large');
    total += entry.header.size;
    if (total > LIMITS.totalBytes) return fail('package-too-large');

    if (raw === MANIFEST_NAME) {
      manifestEntry = entry;
      continue;
    }

    const slash = raw.indexOf('/');
    if (slash === -1) return fail('unexpected-file', { path: raw });
    const root = raw.slice(0, slash);
    const rest = raw.slice(slash + 1);
    const relative = safePackagePath(rest);
    // A path that does not clean up to exactly what the package claimed is a traversal attempt.
    if (!relative || relative !== rest) return fail('unsafe-path', { path: raw });

    if (root === PRESET_DIR) {
      if (!PRESET_ASSET_RE.test(relative)) return fail('unsupported-asset', { path: raw });
      presetFiles.push({ path: relative, entry });
    } else if (root === SOUNDS_DIR) {
      if (relative.includes('/') || !SOUND_EXT_RE.test(relative)) return fail('unsupported-asset', { path: raw });
      soundFiles.push({ path: relative, entry });
    } else {
      return fail('unexpected-file', { path: raw });
    }
  }

  if (!manifestEntry) return fail('missing-manifest');

  let parsed;
  try {
    parsed = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch {
    return fail('invalid-manifest');
  }

  const check = validateManifest(parsed, { appVersion });
  if (!check.ok) return check;

  if (!presetFiles.some((f) => f.path === PRESET_ENTRY)) return fail('missing-entry');

  // `manifest.sound` may name a sound the package does not carry: that is how a bundled sound the
  // recipient already has is recorded, so it is not an error.
  return { ok: true, manifest: check.manifest, presetFiles, soundFiles };
}

// --- install ----------------------------------------------------------------------------------

// "Name", then "Name (2)", "Name (3)"… — the same shape the sound and theme-image importers use.
function nextFreeName(presetsDir, name, taken) {
  for (let i = 2; i < 100; i += 1) {
    const candidate = sanitizePresetName(`${name} (${i})`);
    if (candidate && !taken.has(candidate.toLowerCase()) && !fs.existsSync(path.join(presetsDir, candidate))) return candidate;
  }
  return '';
}

// Copy a sound in without ever clobbering one the user already has: an identical file is reused,
// a different file of the same name lands beside it.
function installSound(soundsDir, name, data) {
  fs.mkdirSync(soundsDir, { recursive: true });
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let base = name;
  for (let i = 2; i < 100; i += 1) {
    const dest = path.join(soundsDir, base);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, data);
      return { name: base, created: true };
    }
    try {
      if (fs.readFileSync(dest).equals(data)) return { name: base, created: false };
    } catch {}
    base = `${stem} (${i})${ext}`;
  }
  throw new Error('sound-name-taken');
}

/*
  Install a package into the user's preset storage.

  `duplicate` decides what an existing preset of the same name means: 'fail' (report it and change
  nothing, so the caller can ask), 'rename' (install beside it) or 'replace'.

  `takenNames` are names already in use outside this folder — the presets bundled with the app. A
  preset installed here wins over a bundled one of the same name, so without them an import would
  silently hide a bundled preset instead of asking.

  The preset is built in a staging folder next to its destination and moved in one rename at the
  end, so a failure anywhere leaves the storage exactly as it was — including the preset being
  replaced, which is only deleted once its replacement is in place.
*/
function installPackage({ file, presetsDir, soundsDir, appVersion = '', duplicate = 'fail', reservedNames = [], takenNames = [] }) {
  const read = readPackage(file, { appVersion });
  if (!read.ok) return read;

  const { manifest, presetFiles, soundFiles } = read;
  if (reservedNames.includes(manifest.name)) return fail('reserved-name', { name: manifest.name });

  fs.mkdirSync(presetsDir, { recursive: true });

  const taken = new Set(takenNames.map((n) => String(n).toLowerCase()));
  let name = manifest.name;
  const installedHere = fs.existsSync(path.join(presetsDir, name));
  const existed = installedHere || taken.has(name.toLowerCase());
  if (existed) {
    if (duplicate === 'fail') return fail('duplicate', { name, bundled: !installedHere });
    if (duplicate === 'rename') {
      name = nextFreeName(presetsDir, manifest.name, taken);
      if (!name) return fail('duplicate', { name: manifest.name });
    } else if (duplicate !== 'replace') {
      return fail('invalid-duplicate-policy');
    }
  }

  const destination = path.join(presetsDir, name);
  if (!isInside(presetsDir, destination)) return fail('outside-preset-storage');

  const staging = fs.mkdtempSync(path.join(presetsDir, '.awimport-'));
  const stagedPreset = path.join(staging, PRESET_DIR);
  const backup = `${destination}.awimport-old`;
  const createdSounds = [];
  let backedUp = false;

  try {
    fs.mkdirSync(stagedPreset, { recursive: true });
    for (const { path: relative, entry } of presetFiles) {
      const target = path.join(stagedPreset, relative);
      if (!isInside(stagedPreset, target)) throw new Error('unsafe-path');
      const data = entry.getData();
      // The header can lie about the size; the data itself cannot.
      if (data.length > LIMITS.fileBytes) throw new Error('asset-too-large');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    /*
      Sounds first: they are separate files in a shared folder, so a failure here must still leave
      the preset uninstalled rather than half-installed. A sound whose name was already taken by a
      different file is installed beside it, so remember what each one ended up being called.
    */
    const sounds = [];
    const installedAs = new Map();
    for (const { path: relative, entry } of soundFiles) {
      const installed = installSound(soundsDir, relative, entry.getData());
      if (installed.created) createdSounds.push(path.join(soundsDir, installed.name));
      installedAs.set(relative, installed.name);
      sounds.push(installed.name);
    }

    /*
      A sound has to follow the name it was actually installed under, or importing beside an existing
      sound of the same name leaves the preset pointing at a file that is not the one in the package
      — silently playing someone else's sound.
    */
    const installedSound = (name) => (name && installedAs.has(name) ? installedAs.get(name) : name);

    // The marker that makes this preset manageable, and what a re-export reads its metadata from.
    const stamped = { ...manifest, name, sound: installedSound(manifest.sound) };
    fs.writeFileSync(path.join(stagedPreset, PRESET_PACKAGE_FILE), JSON.stringify(stamped, null, 2), 'utf8');

    if (manifest.options) {
      // Credit survives an import, so re-exporting a preset someone shared keeps their name on it.
      const stored = { name, ...manifest.options };
      if (manifest.author) stored.author = manifest.author;
      // Whatever the manifest resolved to (see manifestOptions), under the name it was installed as.
      stored.sound = installedSound(stored.sound);
      fs.writeFileSync(path.join(stagedPreset, PRESET_OPTIONS_FILE), JSON.stringify(stored, null, 2), 'utf8');
    }

    if (fs.existsSync(destination)) {
      fs.renameSync(destination, backup);
      backedUp = true;
    }
    try {
      fs.renameSync(stagedPreset, destination);
    } catch (err) {
      if (backedUp) {
        fs.renameSync(backup, destination);
        backedUp = false;
      }
      throw err;
    }
    if (backedUp) {
      fs.rmSync(backup, { recursive: true, force: true });
      backedUp = false;
    }

    return { ok: true, name, replaced: existed && duplicate === 'replace', manifest, sounds };
  } catch (err) {
    for (const created of createdSounds) fs.rmSync(created, { force: true });
    if (backedUp) {
      try {
        fs.rmSync(destination, { recursive: true, force: true });
        fs.renameSync(backup, destination);
      } catch {}
    }
    return fail(String(err.message || err));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = {
  PRESET_PACKAGE_EXTENSION,
  PRESET_PACKAGE_FILE,
  PRESET_PACKAGE_FORMAT,
  PRESET_PACKAGE_FORMAT_VERSION,
  LIMITS,
  safePackagePath,
  exportPreset,
  readPackage,
  installPackage,
};
