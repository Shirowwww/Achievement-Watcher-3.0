# Build AW Next

This guide covers local development and Windows packaging. Use [docs/RELEASE_WORKFLOW.md](docs/RELEASE_WORKFLOW.md) for versioning, publishing, CI and auto-update validation.

<p align="center"><a href="README.md">← Project home</a> · <a href="docs/README.md">Documentation</a> · <a href="CONTRIBUTING.md">Contributing</a></p>

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

DevTools stays available but is closed by default so a hidden dev instance matches the tray footprint more closely. Open it explicitly when needed:

```powershell
$env:AW_OPEN_DEVTOOLS = '1'
npm start
Remove-Item Env:AW_OPEN_DEVTOOLS -ErrorAction SilentlyContinue
```

If `ELECTRON_RUN_AS_NODE` is present in the parent environment, remove it first:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

That variable is used only for the Watchdog child process. Setting it globally makes Electron start as plain Node and prevents the desktop app from loading.

It is not installed as a user or machine environment variable. The packaged desktop app never sets it for itself; only its private Watchdog child receives it.

### Driving the running app

The main window, the in-game overlay and the notification windows are all BrowserWindows inside the one tray-daemon process, so there is no separate process or debug port to attach to. `tools/aw-probe.ps1` drives a running dev build from the command line:

```powershell
.\tools\aw-probe.ps1 Start                                     # launch and wait for the main window
.\tools\aw-probe.ps1 Windows                                   # what is actually on screen
.\tools\aw-probe.ps1 Send -Arguments '--wintype=overlay --appid=480 --description=open'
.\tools\aw-probe.ps1 Shot -Match 'Achievements Overlay' -Out overlay.png
.\tools\aw-probe.ps1 Key  -Keys ESC -FocusMatch 'Achievements Overlay'
.\tools\aw-probe.ps1 Key  -Keys CTRL+SHIFT+K                   # the global overlay hotkey
.\tools\aw-probe.ps1 Wait -Match 'Achievements Overlay' -Absent # exit code 0/1, for scripting
.\tools\aw-probe.ps1 Stop
```

To navigate the interface itself, `Click` and `Scroll` take coordinates relative to a window, so a position read off a screenshot can be replayed wherever the window sits:

```powershell
.\tools\aw-probe.ps1 Click  -Match 'AW Next' -X 1137 -Y 15      # the settings gear
.\tools\aw-probe.ps1 Scroll -Match 'AW Next' -X 760 -Y 450 -Notches -6
.\tools\aw-probe.ps1 Click  -Match 'AW Next' -X 221 -Y 273 -RightClick
.\tools\aw-probe.ps1 Shot   -Screen -Out desktop.png                        # native menus need this
```

Take a screenshot after every step rather than chaining clicks blindly: several panels re-layout as settings change (the Notifications tab grows overlay-only sections when the transport is set to the in-game overlay), so a coordinate read a moment ago can land somewhere else entirely. Native context menus are not part of the Electron window, so capture them with `-Screen`.

`Send` works because the single-instance lock forwards argv to the running instance - the same channel the Watchdog uses. Window enumeration, not the log files, is the reliable answer to "is the overlay on screen?": the main process logs an incoming overlay *request* before deciding what to do with it.

Dev and the installed app share `%APPDATA%\Achievement Watcher Next`. Back up `cfg\options.ini` before a test that changes settings, and restore it afterwards.

## Run tests

```powershell
Push-Location app
npm test
Pop-Location

Push-Location watchdog
npm test
Pop-Location
```

The app suite includes parser, discovery, install-state, locale-completeness and local Markdown
link/anchor checks. Its categories and focused-run commands are documented in
[test/README.md](test/README.md). The Watchdog suite covers monitoring, notifications and related
helpers.

The app suite includes real-DOM checks for the game list, rarity display, settings filter and sorting. They need a Chromium-family browser, try each installed candidate in turn (an installed browser is not always a launchable one), and skip - printing why - only when none will start. Point them at a specific binary with `PUPPETEER_EXECUTABLE_PATH`.

Before handing off a change, also run:

```powershell
git diff --check
```

The repository is LF-only except for Windows command files (`.cmd` and `.bat`), which stay CRLF. Confirm that an editor has not silently restyled a file:

```powershell
$a = git diff --numstat; $b = git diff --numstat --ignore-cr-at-eol
if (Compare-Object $a $b) { 'line endings were rewritten - fix before committing' } else { 'ok' }
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
| `app/build/installer.nsh` | Installer language mapping, shutdown and upgrade behavior |
| `app/build/afterPack.js` | Ensures the packaged Watchdog dependency tree is copied correctly |
| `app/build/icon.ico` | Application and installer icon |
| `app/build/installerSidebar.bmp` | NSIS installer welcome/finish sidebar (164 × 314) |
| `app/build/installerHeader.bmp` | NSIS installer header image (150 × 57) |
| `app/build/generate-installer-images.ps1` | Regenerates both installer BMPs in the Steam Blue palette |

The Watchdog runs under Electron's bundled Node runtime through `ELECTRON_RUN_AS_NODE`. No separate portable Node or NW.js runtime is packaged.

### Why `npmRebuild` is disabled

`app/electron-builder.yml` sets `npmRebuild: false`. Keep it unless the native-dependency strategy changes. The current dependencies ship compatible prebuilt binaries, while Electron Builder's rebuild path can fail when the repository path contains spaces.

### Signing

No *publicly trusted* code-signing certificate is configured, so official releases may still
trigger SmartScreen. Release installers use the project's self-signed `CN=Shirow` certificate;
the in-app updater accepts that exact identity without requiring users to install the certificate,
then independently verifies the release SHA-512. Local builds support the same signing setup:

```powershell
Push-Location app
powershell -ExecutionPolicy Bypass -File build/signing/create-self-signed-cert.ps1
Pop-Location
```

The script creates `CN=Shirow` and exports `app/build/signing/Shirow.pfx`
plus a local `.password` file (both git-ignored). It does not touch the
Windows trust stores by default, so it never shows a certificate-install
prompt. Once the PFX exists, `npm run build` signs the app and installer
automatically; without it the build stays unsigned (see `app/build/build.js`).
The packager explicitly excludes the PFX, certificate and password: downloaders
never receive them and the installer never asks to install a certificate.

To also suppress SmartScreen on a machine you control, run the script again
with `-InstallTrust` (accepting the one-time Windows confirmation):

```powershell
Push-Location app
powershell -ExecutionPolicy Bypass -File build/signing/create-self-signed-cert.ps1 -InstallTrust
Pop-Location
```

That confirmation only ever appears on the machine where the script is run -
people who download or run the app are never asked to install a certificate.

Important: a self-signed certificate removes the SmartScreen
"Windows protected your PC" warning only on machines that trust the
certificate (this script trusts it for the current Windows user). Other
machines still need either this certificate installed or a certificate issued
by a public CA. A release must never be described as signed by a trusted
publisher unless a real certificate and signature verification have been added.

The Windows Firewall prompt shows the publisher name from the executable
metadata and the signing certificate subject; both are set to `Shirow`
(CompanyName comes from `author` in `app/package.json`).

### Why self-signed cannot silence SmartScreen for users

Microsoft's official SmartScreen documentation is explicit: a self-signed
certificate has the same first-download behavior as no signature at all -
Windows still shows "Windows protected your PC". There is no registry key,
flag, or build option that changes this for machines that do not trust the
certificate. The only real paths to a warning-free install for end users are:

1. **Publish through the Microsoft Store.** Store apps are re-signed by
   Microsoft and never show a SmartScreen download warning. This is the only
   option with a guaranteed absence of warnings.
2. **Sign with a public code-signing certificate (OV/EV) or Microsoft
   Artifact Signing** (formerly Trusted Signing, roughly $10/month). Even
   then, a brand-new file is flagged as "unrecognized" until reputation
   accumulates (typically weeks and hundreds of downloads). EV certificates
   no longer bypass SmartScreen; they only make the verified publisher name
   visible instead of "unknown publisher".
3. **Enterprise-only:** distribute from a trusted intranet location, or let
   an IT administrator submit files through the Microsoft Security
   Intelligence portal.

For one machine you control, installing the self-signed certificate into that
machine's trusted stores (`-InstallTrust`) is the only local way to avoid the
warning - it never applies to other users.

References:

- [SmartScreen reputation for Windows app developers (Microsoft Learn)](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [What is Artifact Signing? (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/trusted-signing/overview)
- [electron-builder Code Signing documentation](https://www.electron.build/docs/features/code-signing)

## Versioning

The app and Watchdog versions must stay synchronized across both `package.json` files and both lockfiles. The app version controls the installer name and update feed.

Do not edit `app/dist/latest.yml` by hand. It is generated from the package version during the build. Follow the [release workflow](docs/RELEASE_WORKFLOW.md) for the complete checklist.
