# Test suite

Run the complete desktop-app suite from `app/` with `npm test`. The recursive runner discovers
every `*.test.js` file in these folders:

- `core`: shared utilities, data stores, locales and documentation checks;
- `parsers`: game sources, discovery, schemas and install detection;
- `ui`: renderer behavior, settings, help, controllers, notifications and themes;
- `browser`: real-DOM checks driven in a Chromium-family browser;
- `integration`: behavior spanning the desktop app and Watchdog;
- `updates-security`: updater boundaries and security/privacy checks.

Reusable browser cleanup code belongs in `helpers`; binary and HTML samples belong in `fixtures`.
Watchdog's standalone unit suite remains in `watchdog/test` and is run separately from `watchdog/`
with `npm test`. Both npm commands run their test files serially (`--test-concurrency=1`) so that
Chromium and native Windows registry integrations cannot race each other.

To run one family or one file directly from `app/`:

```powershell
node --test "../test/core/*.test.js"
node --test "../test/parsers/steamOfficial.test.js"
```
