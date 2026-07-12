# Project instructions

These rules apply to the whole repository and are the shared source of truth for
all contributors and automated coding tools.

## Repository

- Work from this repository root, not the retired `main-repo` checkout.
- The active branch is `main`; `origin` points to
  `Shirowwww/Achievement-Watcher-3.0` and is the public push target.
- Inspect `git status --short --branch` before editing. Preserve unrelated local
  changes and never discard user work.
- Read the actual code and current package files before trusting old notes.

## Changes and commits

- Keep behavior-compatible fixes narrow and validate the affected path.
- User-facing changes belong in `CHANGELOG.md` under `Unreleased`.
- Any locale key added to English must be added with a real translation to all
  bundled locales; `test/locales.test.js` enforces parity and non-empty values.
- Make atomic commits: one coherent concern per commit, with explicit path staging.
- Use short English Conventional Commit messages such as `fix: ...`, `feat: ...`,
  `docs: ...`, `test: ...`, `build: ...`, or `chore: ...`.
- Never add generated-by, assistant, or tool attribution to commit messages, tags,
  changelogs, release notes, PR text, or public documentation.
- Do not amend published commits or force-push unless the user explicitly asks.

## Validation and releases

- Run the smallest relevant tests during development, then both app and Watchdog
  suites before publishing.
- Follow [docs/RELEASE_WORKFLOW.md](docs/RELEASE_WORKFLOW.md) for every version
  bump, build, auto-update check and GitHub release. Do not improvise a second
  release procedure in another file.
- A request to push/build/release means completing and verifying the whole safe
  workflow, including CI and release assets. Do not publish without authorization.
- `npm run build` prunes Watchdog dev dependencies. Run `npm install` in
  `watchdog/` after a release build before further development or tests.
