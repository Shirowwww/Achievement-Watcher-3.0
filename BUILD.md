# Building Achievement Watcher

## Prerequisites

- **Node.js ≥20.18** (system Node 22+ works) — required by the watchdog's koffi-based native deps, and the version family the bundled Electron 42 (Node 24) provides. Electron is downloaded automatically by `npm install`.
- No VS / Python / node-gyp needed: every native dep ships prebuilt N-API binaries — `registry-js`/`sharp` (app) and `koffi` (watchdog `wql-process-monitor`/`regodit`/`xinput-ffi`).

## Run in dev (no packaging)

```cmd
cd main-repo\app
npm install   # first time only
npm start     # runs `electron .`
```

**Gotcha:** if `ELECTRON_RUN_AS_NODE=1` is set in the environment, `electron.exe` runs as plain Node and `app` is `undefined` → `init.js` throws immediately. Remove that env var before launching.

## Install the watchdog deps (only if changed)

```cmd
cd main-repo\watchdog
npm install   # Node ≥20.18; koffi ships prebuilt — no node-gyp/Python/MSVS needed
```

The watchdog runs under Electron's own Node via `ELECTRON_RUN_AS_NODE` (no separate runtime is bundled). Its koffi-based deps (`wql-process-monitor`, `regodit`, `xinput-ffi`) are **ESM-only** and loaded from the CommonJS watchdog via dynamic `import()`. To run the monitor standalone in dev (`node watchdog.js`) use a system Node ≥20.18.

`@nodert-win10-rs4/*` WinRT modules are in `optionalDependencies` — they cannot build from source (need a removed `platform.winmd`); `powertoast` uses PowerShell as a fallback, so a failed optional build doesn't block install.

## Build the portable app (no installer)

```cmd
cd main-repo\app
npx electron-builder --dir
```

Output: `app\dist\win-unpacked\Achievement Watcher.exe` (watchdog bundled via `extraFiles`; the monitor is spawned as an `ELECTRON_RUN_AS_NODE` child of the main process — the portable node.exe and nw.exe are both gone).

## Build the full NSIS installer

```cmd
cd main-repo\app
npm run build
```

This runs `npm run prepare:watchdog` (prunes watchdog devDependencies) then `electron-builder --config electron-builder.yml --publish never`.

Output: `app\dist\Achievement.Watcher.Setup.<version>.exe` (NSIS installer, watchdog bundled; portable node.exe and nw.exe removed).

### Known build gotcha: `npmRebuild: false`

`electron-builder.yml` has `npmRebuild: false` at the top level. **Do not remove it.** Without it, electron-builder's default native-module rebuild step (`@electron/rebuild` → node-gyp) fails whenever the repo path contains a space (e.g. `Achievement Watcher 3.0`), with:

```
⨯ Attempting to build a module with a space in the path
```

Skipping the rebuild is safe here because `registry-js` and `sharp` already ship N-API prebuilt binaries — no compilation needed, and this is validated working in dev (`npm start`).

### `setup/{{app}}` is a literal folder name, not a macro

`electron-builder.yml`'s `extraFiles` has:

```yaml
- from: ../setup/{{app}}
  to: .
```

The folder on disk is literally named `{{app}}` (not resolved to the product name by electron-builder 26.x). Do not rename it — electron-builder copies it as-is.

### Code signing

electron-builder self-signs the output executables via `signtool.exe` automatically during NSIS packaging. There is no real certificate configured — this is expected and not a security/distribution signature, just electron-builder's default behavior.

## Versioning

Bump `app/package.json` `version` before each build — it drives the installer filename (`Achievement.Watcher.Setup.<version>.exe`) and the in-app updater config (`config.update` in the same file).
