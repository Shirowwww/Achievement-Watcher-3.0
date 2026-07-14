# Interface translations

Achievement Watcher loads interface text from `app/locale/lang`. English is the reference locale. When the selected language does not provide game metadata, the upstream game source may return English instead.

The Steam Web API key disclaimer remains in English by design.

## Bundled languages

The current build includes:

- Brazilian Portuguese
- Chinese (Simplified)
- Czech
- English
- French
- German
- Hungarian
- Italian
- Japanese
- Latin American Spanish
- Polish
- Portuguese
- Russian
- Slovak
- Spanish
- Thai
- Turkish
- Ukrainian

`uiLanguages.js` exposes only languages that have a matching JSON file. Other entries in `steam.json` remain available as Steam language metadata but do not appear as interface choices.

## Update a translation

1. Use `lang/english.json` as the structural reference.
2. Translate values, never keys.
3. Preserve placeholders, HTML fragments and array order.
4. Keep terminology consistent with the labels visible in the application.
5. Add every new key to every bundled locale in the same change.
6. Run the app tests from `app/`.

```powershell
Push-Location app
npm test
Pop-Location
```

The locale test compares recursive key paths and rejects missing or empty values. A top-level object count is not enough to prove parity.

## Layout overrides

Use `override.css` only when translated text genuinely needs a language-specific layout adjustment:

```css
html[lang='fr'] .selector {
  /* minimal layout adjustment */
}
```

Prefer flexible layout and wrapping in the shared styles before adding a locale override.

## Translation credits

The current translation set builds on work from the original Achievement Watcher community and later contributors.

| Language or area | Contributors recorded by the original project |
|---|---|
| English and French | Anthony Beaumont |
| Simplified Chinese | [fiyeck](https://github.com/fiyeck) |
| German | Anthony Beaumont, [Shanas377](https://github.com/Shanas377), [shakeyourbunny](https://github.com/shakeyourbunny) |
| Hungarian | [Roschach96](https://github.com/Roschach96) |
| Italian | pollolollo9001 |
| Brazilian Portuguese | [wallis6n](https://github.com/wallis6n), [Ardente07](https://github.com/Ardente07) |
| Russian | [hugmouse](https://github.com/hugmouse), [kochetov2000](https://github.com/kochetov2000) |
| Spanish and Latin American Spanish | [1024mb](https://github.com/1024mb) |
| Thai and early Japanese work | Anthony Beaumont and the original localization sources |

Corrections from fluent speakers are welcome. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the normal contribution and validation process.
