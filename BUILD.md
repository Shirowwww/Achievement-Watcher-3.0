# Building Achievement Watcher

## Prerequisites

- **Node.js 22.22.2+ or 24.15+** — required by the current build toolchain. Electron 43 bundles Node 24.18 for the installed application and is downloaded automatically by `npm install`.
- No VS / Python / node-gyp needed: every native dep ships prebuilt N-API binaries — `registry-js`/`sharp` (app) and `koffi` (watchdog `wql-process-monitor`/`regodit`/`xinput-ffi`).

## Run in dev (no packaging)

```cmd
cd app
npm install   # first time only
npm start     # runs `electron .`
```

**Gotcha:** if `ELECTRON_RUN_AS_NODE=1` is set in the environment, `electron.exe` runs as plain Node and `app` is `undefined` → `init.js` throws immediately. Remove that env var before launching.

## Build the portable app (no installer)

```cmd
cd app
npx electron-builder --dir
```

Output: `app\dist\win-unpacked\Achievement Watcher.exe` (watchdog bundled via `extraFiles`; the monitor is spawned as an `ELECTRON_RUN_AS_NODE` child of the main process — the portable node.exe and nw.exe are both gone).

## Build the full NSIS installer

```cmd
cd app
npm run build
```

This runs `npm run prepare:watchdog` (prunes watchdog devDependencies with `npm prune --omit=dev`) then `electron-builder --config electron-builder.yml --publish never`.

Output: `app\dist\Achievement.Watcher.Setup.<version>.exe` (NSIS installer, watchdog bundled; portable node.exe and nw.exe removed).

### Known build gotcha: `npmRebuild: false`

`electron-builder.yml` has `npmRebuild: false` at the top level. **Do not remove it.** Without it, electron-builder's default native-module rebuild step (`@electron/rebuild` → node-gyp) fails whenever the repo path contains a space (e.g. `Achievement Watcher 3.0`), with:

```
⨯ Attempting to build a module with a space in the path
```

Skipping the rebuild is safe here because `registry-js` and `sharp` already ship N-API prebuilt binaries — no compilation needed, and this is validated working in dev (`npm start`).

### Installer resources

The NSIS installer is configured by `app/electron-builder.yml` and `app/build/installer.nsh`.

- `app/build/icon.ico` is the app/installer icon.
- `app/build/left.bmp` is the NSIS sidebar image.

Legacy setup payloads are not copied into the installed app. The old `setup/` tree was removed because it only contained unused installer-era files (`curl.exe`, avatar/wizard bitmaps, duplicated icons, `LICENSE` and loopback-audio files).

### Code signing

electron-builder self-signs the output executables via `signtool.exe` automatically during NSIS packaging. There is no real certificate configured — this is expected and not a security/distribution signature, just electron-builder's default behavior.

## Versioning

Bump both `app/package.json` and `watchdog/package.json` before each release. The app version drives the installer filename (`Achievement.Watcher.Setup.<version>.exe`) and the in-app updater config (`config.update` in the same file).
