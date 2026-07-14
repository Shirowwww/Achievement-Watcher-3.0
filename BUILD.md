# Build Achievement Watcher

This guide covers local development and Windows packaging. Use [docs/RELEASE_WORKFLOW.md](docs/RELEASE_WORKFLOW.md) for versioning, publishing, CI and auto-update validation.

## Requirements

- Windows 10 or Windows 11.
- Node.js `22.22.2+` or `24.15+`, matching the `engines` field in both package manifests.
- npm, included with Node.js.

Electron is installed with the app dependencies. The supported native packages ship prebuilt binaries, so a normal setup does not require Visual Studio, Python or a manual `node-gyp` build.

## Install dependencies

The desktop app and background Watchdog are separate npm workspaces. Install both from the repository root:

```powershell
Push-Location watchdog
npm ci
Pop-Location

Push-Location app
npm ci
Pop-Location
```

Use `npm install` instead of `npm ci` only when intentionally updating a dependency or lockfile.

## Run in development

```powershell
Push-Location app
npm start
Pop-Location
```

The command starts Electron directly from `app/`. The background Watchdog is launched by the main process.

If `ELECTRON_RUN_AS_NODE` is present in the parent environment, remove it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

That variable is used only for the Watchdog child process. Setting it globally makes Electron start as plain Node and prevents the desktop app from loading.

## Run tests

```powershell
Push-Location app
npm test
Pop-Location

Push-Location watchdog
npm test
Pop-Location
```

The app suite includes parser, discovery, install-state and locale-completeness checks. The Watchdog suite covers monitoring, notifications and related helpers.

Before handing off a change, also run:

```powershell
git diff --check
```

## Build an unpacked app

```powershell
Push-Location app
npx electron-builder --dir --config electron-builder.yml
Pop-Location
```

The executable is written to:

```text
app\dist\win-unpacked\Achievement Watcher.exe
```

Use the unpacked build for packaging smoke tests. It is not the installed release used to prove automatic updates.

## Build the installer

Make sure Watchdog dependencies are installed, then run:

```powershell
Push-Location app
npm run build
Pop-Location
```

Expected output:

```text
app\dist\Achievement.Watcher.Setup.<version>.exe
app\dist\Achievement.Watcher.Setup.<version>.exe.blockmap
app\dist\latest.yml
```

The installer uses NSIS. `latest.yml` and the blockmap are required by the automatic updater.

### Watchdog dependencies after a build

`npm run build` calls `npm run prepare:watchdog`, which prunes Watchdog development dependencies before packaging. Restore the development tree before running more Watchdog tests:

```powershell
Push-Location watchdog
npm install
Pop-Location
```

The prune can also update `watchdog/package-lock.json`; inspect the worktree after every build and keep only intentional changes.

## Packaging configuration

The main packaging files are:

| Path | Purpose |
|---|---|
| `app/electron-builder.yml` | Product metadata, files, NSIS target and update provider |
| `app/build/installer.nsh` | Installer shutdown and upgrade behavior |
| `app/build/afterPack.js` | Ensures the packaged Watchdog dependency tree is copied correctly |
| `app/build/icon.ico` | Application and installer icon |
| `app/build/left.bmp` | NSIS installer sidebar |

The Watchdog runs under Electron's bundled Node runtime through `ELECTRON_RUN_AS_NODE`. No separate portable Node or NW.js runtime is packaged.

### Why `npmRebuild` is disabled

`app/electron-builder.yml` sets `npmRebuild: false`. Keep it unless the native-dependency strategy changes. The current dependencies ship compatible prebuilt binaries, while Electron Builder's rebuild path can fail when the repository path contains spaces.

### Signing

No trusted code-signing certificate is configured. Installers built from the repository are unsigned and may trigger SmartScreen. A release must not be described as signed unless a real certificate and signature verification have been added.

## Versioning

The app and Watchdog versions must stay synchronized across both `package.json` files and both lockfiles. The app version controls the installer name and update feed.

Do not edit `app/dist/latest.yml` by hand. It is generated from the package version during the build. Follow the [release workflow](docs/RELEASE_WORKFLOW.md) for the complete checklist.
