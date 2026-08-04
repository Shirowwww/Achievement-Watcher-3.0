# Third-party notices

This project adapts components from other open-source projects. Each entry lists the upstream
project, what was taken, where it lives in this tree, and the applicable license.

## Achievements (PSerban93/Achievements)

- **Upstream:** [PSerban93/Achievements](https://github.com/PSerban93/Achievements), commit
  `97a5e3057f6befe3ecf08ee96bbaca4b219dddaa` ("Implement support for Stats.ini on Online-Fix emu;
  improve stats on Tenoke user_stats.ini; bugfix on config name when config is generated; add
  support for epic appid detection"), authored by JokerVerse.
- **License:** [MIT](https://github.com/PSerban93/Achievements/blob/main/LICENSE),
  Copyright (c) 2025 JokerVerse.
- **Adapted components:**
  - `utils/epic-identity.js` → `app/util/epicIdentity.js` (egdata.app artifact-id resolution, moved
    from axios onto the runtime's global `fetch`, used by `app/parser/epic.js` and
    `app/util/rarity.js`).
  - `utils/achievement-data.js` → the Online-Fix `Stats.ini` merge and TENOKE `[STATS]`
    cross-reference in `app/parser/steam.js`.

The MIT License text follows.

---

MIT License

Copyright (c) 2025 JokerVerse

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
