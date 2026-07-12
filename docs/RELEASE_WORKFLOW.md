# Commit and release workflow

This is the canonical checklist for `Shirowwww/Achievement-Watcher-3.0`. It is
shared by every contributor. Project instruction files point here so the process
stays identical across sessions.

## Commit rules

1. Start with `git status --short --branch` and preserve unrelated changes.
2. Split work by concern. Code, tests and the matching `CHANGELOG.md` entry may
   stay together; unrelated docs, dependency refreshes and CI fixes get separate
   commits.
3. Stage explicit paths, inspect `git diff --cached`, then commit.
4. Use short English Conventional Commit subjects, for example:
   - `fix: sync dependency lockfile`
   - `feat: add controller UI navigation`
   - `docs: refine feature comparison`
   - `chore: update runtime and dependencies`
5. Do not add generated-by, assistant, tool or co-authoring attribution to commits
   or any public-facing text.
6. Never rewrite already-pushed history unless the user explicitly requests it.

## Release preparation

Use a new SemVer version. A published version is immutable: never replace its
installer to force an update, because clients only update to a higher version.

Update the same version in all of these places:

- `app/package.json`
- `app/package-lock.json` (root package entries)
- `watchdog/package.json`
- `watchdog/package-lock.json` (root package entries)
- the README version badge, “What's new” heading and installer filename
- `CHANGELOG.md`: move relevant `Unreleased` entries under the dated version
- `RELEASE_NOTES.md`: title, highlights and installer filename

Keep dependency/runtime badges and build requirements truthful. Do not hand-edit
generated `app/dist/latest.yml`; the build creates it.

## Clean validation

From the repository root in PowerShell:

```powershell
git diff --check

Push-Location app
npm ci
npm test
npm audit
Pop-Location

Push-Location watchdog
npm ci
npm test
npm audit
Pop-Location
```

The app suite includes locale completeness. If a native optional dependency is
unavailable on the current machine, record the exact limitation; do not silently
skip a failed check.

Before release, confirm the four package and lockfile root versions match:

```powershell
node -e "for (const p of ['app/package.json','app/package-lock.json','watchdog/package.json','watchdog/package-lock.json']) console.log(p, require('./' + p).version)"
```

## Build and artifact checks

Build on Windows from `app/`:

```powershell
Push-Location app
npm run build
Pop-Location
```

Expected files:

- `app/dist/Achievement.Watcher.Setup.<version>.exe`
- `app/dist/Achievement.Watcher.Setup.<version>.exe.blockmap`
- `app/dist/latest.yml`

Check that `latest.yml` names the exact installer and version. Verify its SHA-512
against the built installer:

```powershell
$version = (Get-Content app/package.json | ConvertFrom-Json).version
$installer = "app/dist/Achievement.Watcher.Setup.$version.exe"
$expected = [Convert]::ToBase64String(
  [Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($installer))
)
Get-Content app/dist/latest.yml
$expected
```

Also smoke-test the packaged runtime and the affected feature path. For runtime
inspection, temporarily use Electron as Node and always remove the variable:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& 'app/dist/win-unpacked/Achievement Watcher.exe' -e "console.log(process.versions)"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

The build runs `npm prune --omit=dev` in `watchdog/`. Restore its development
dependencies afterward with `npm install` from `watchdog/`.

## Push, CI and GitHub release

1. Ensure commits are atomic and the worktree contains no accidental files.
2. Push `main` to `origin` and wait for `.github/workflows/test.yml` to pass.
3. Create the GitHub release only after CI succeeds, uploading all three updater
   assets:

```powershell
$version = (Get-Content app/package.json | ConvertFrom-Json).version
gh release create "v$version" `
  "app/dist/Achievement.Watcher.Setup.$version.exe" `
  "app/dist/Achievement.Watcher.Setup.$version.exe.blockmap" `
  "app/dist/latest.yml" `
  --repo Shirowwww/Achievement-Watcher-3.0 `
  --target main `
  --title "Achievement Watcher $version" `
  --notes-file RELEASE_NOTES.md
```

4. Verify the release page exposes the installer, blockmap and `latest.yml`, and
   that the public manifest is downloadable.

## Auto-update proof

An updater check is only meaningful from an installed lower version to the newly
published higher version.

1. Keep the previous stable installer available and install/run that version.
2. Publish the new higher version and its matching `latest.yml`, installer and
   blockmap.
3. Launch the previous installed version normally (not `npm start`).
4. Confirm logs show the GitHub feed check, the new version download and the
   restart prompt.
5. Accept restart, then confirm the running app reports the new version.

Do not claim auto-update success from source mode, an unpacked build, or a
same-version asset replacement.

## Final handoff

- Confirm `git status --short --branch` is clean and synchronized.
- Report tests, build output, CI result, release URL and updater result separately.
- If the user asked to relaunch the application, relaunch the installed build only
  after validation is complete.
