# Contributing

Bug fixes, documentation improvements, translations and focused new features are welcome.

## Before opening an issue

- Read the [documentation](docs/README.md) and [troubleshooting guide](docs/troubleshooting.md).
- Search existing issues for the same symptom.
- Reproduce the problem on the latest release when possible.
- Gather the app version, Windows version, source involved and relevant logs.

Use the repository templates for bug reports, feature requests and support questions. Keep reports focused on Achievement Watcher itself; the issue tracker cannot provide games, account access or piracy support.

## Development setup

Achievement Watcher is developed and packaged on Windows. Follow [BUILD.md](BUILD.md) to install both npm workspaces, run the app and build the installer.

Create a focused branch and inspect the worktree before making changes:

```powershell
git status --short --branch
git switch -c fix/short-description
```

## Change guidelines

- Keep each change focused on one behavior or documentation concern.
- Preserve existing user data and settings compatibility unless a migration is included.
- Add or update tests for parser, discovery, notification and configuration behavior.
- Put user-visible changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md).
- Keep public claims grounded in behavior that exists in the current code.
- Never commit credentials, tokens, personal paths, game files, build output or local logs.

## Translations

English is the reference locale. When a new UI key is added, add a meaningful translation to every bundled locale in the same change. Do not leave blank values or duplicate the English sentence as a placeholder in unrelated languages.

Run the app test suite after locale changes; it verifies key parity and non-empty values. More details are in [app/locale/README.md](app/locale/README.md).

## Tests

Run the smallest relevant test while developing, followed by both suites before opening a pull request:

```powershell
Push-Location app
npm test
Pop-Location

Push-Location watchdog
npm test
Pop-Location

git diff --check
```

For UI or integration work, describe the manual path you tested and include screenshots when they help reviewers verify the result.

## Commits and pull requests

Use short Conventional Commit subjects such as:

- `fix: preserve custom save paths`
- `feat: add source diagnostics`
- `docs: clarify notification setup`
- `test: cover Ubisoft install discovery`

Stage explicit paths and inspect the staged diff before committing. A pull request should explain the problem, the chosen behavior, validation performed and any remaining limitation.

Releases are maintained separately through [docs/RELEASE_WORKFLOW.md](docs/RELEASE_WORKFLOW.md).

## License

By contributing, you agree that your contribution may be distributed under the project's [LGPL-3.0 license](LICENSE). Preserve upstream copyright and license headers when adapting code from another project, and update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) when attribution is required.
