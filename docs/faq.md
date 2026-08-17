# FAQ

Short answers to the questions that come up most. Each one links to the guide that covers it
properly.

## Getting set up

**Do I need a Steam Web API key, or to sign in to Steam?**
No. Achievement lists are fetched with a keyless chain of public endpoints, and no Steam account is
connected. For your *own* Steam unlocks, Steam requires your profile and **Game details** to be
public - see [Compatible sources](sources.md#official-platform-libraries).

**Which platforms does it run on?**
Windows 10 and Windows 11 only. Packaged releases include their own runtime; Node.js is needed only
to build from source.

**Do I have to connect any account?**
No. Epic and Xbox PC can *optionally* be connected to import achievement state their local files do
not carry; the token is encrypted before it is stored on this PC. Everything else works without an
account.

**Does it work offline?**
Yes, for local sources and anything already cached. Achievement names, descriptions and artwork are
fetched online the first time and then reused from
`%APPDATA%\Achievement Watcher Next\steam_cache`.

**Simple or Advanced - do I lose anything by choosing Simple?**
No. Simple hides controls, it never turns a feature off. No parser, watcher, scan or stored value
changes with it, and switching back restores every control with the value it already had. See
[Getting started](getting-started.md#simple-and-advanced).

## The library

**A game is missing.**
Check that its source is enabled in **Settings → Sources**, run **Smart Find** under
**Settings → Folders**, and turn off **Installed games only** to see whether it is known but no
longer considered installed. Full checklist:
[Troubleshooting](troubleshooting.md#a-game-is-missing).

**A game shows "No achievements".**
That game has no achievement set at all. It stays launchable and keeps tracking playtime, and it is
left out of completion statistics rather than dragging the average down as a 0%.

**A game shows 0% even though I have unlocked achievements.**
There is a schema but no runtime unlock file. Open the game's
**[Game Health](game-health.md)** panel - it names the missing piece and offers only the repairs that
apply.

**Why does the same game appear twice?**
It was found through two sources. **Merge Duplicates** in Settings → General combines them; if one
entry is a stale save folder for a game you now own elsewhere, blacklist it.

**A game update added achievements and I do not see them.**
A cached list re-checks itself every 3 days. To pick them up now, use **Settings → Advanced →
Recheck achievement lists**. Nothing already cached is removed by that check.

## Notifications

**Nothing appears when I unlock something.**
Start with the Notifications row of that game's [Game Health](game-health.md) panel: it names the
transport that last delivered and why. Then work through
[If a test or unlock does not appear](notifications.md#if-a-test-or-unlock-does-not-appear).

**The overlay popup does not show in one particular game.**
That game is very likely in exclusive fullscreen, where an always-on-top popup is not drawn at all.
On **Automatic** this is handled for you: that unlock arrives as a Windows notification instead. See
[how Automatic decides](notifications.md#how-automatic-decides).

**Notifications are hidden while I play.**
That is Windows' Do Not Disturb. Turn on **Priority notifications** and approve Windows' one-time
request - see [Priority Windows notifications](notifications.md#priority-windows-notifications).

**Can I change how the popup looks, or share a design?**
Yes - nine presets ship with the app, the **Preset Designer** builds your own with ordinary controls,
and any preset exports to a single `.awpreset` file. See
[Presets and the Preset Designer](presets.md).

**Is the in-game overlay the same thing as the popup?**
No. The popup is a one-shot notification styled by a preset. The **overlay** is the full achievement
list you open with `Ctrl+Shift+K` while a game runs - see the [Overlay guide](overlay.md).

## Safety and data

**Does AW Next modify my games?**
Only when you ask it to. Reading achievements is read-only. The emulator repair tools under
**Emulator & tools** do write to a game folder, always after a confirmation and always with a backup.
Use them only with games you own.

**Windows SmartScreen warns about the installer.**
Releases are signed with the project's own self-signed certificate rather than a commercial one, so
SmartScreen may still ask for confirmation. You never need to install that certificate. Download only
from the [official releases page](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases) and
check the installer against the SHA-512 value in the matching `latest.yml`.

**Where is my data, and does updating lose it?**
Everything lives in `%APPDATA%\Achievement Watcher Next`, and installing a newer build over an older
one preserves it. The first launch after upgrading imports an older Achievement Watcher folder
without ever modifying or deleting it - see
[Updates and existing data](getting-started.md#updates-and-existing-data).

**How do I quit completely?**
Closing the window keeps AW Next in the system tray so tracking continues. Use the tray menu to exit
fully.

## The project

**How does this differ from Achievement Watcher 2.x?**
AW Next is a continuation with a modern runtime and a large compatibility, reliability and feature
pass. Side-by-side table: [Comparison](comparison.md).

**Can it get me games, keys or accounts?**
No, and the issue tracker cannot help with that either. AW Next contains no game files and does not
bypass online ownership checks.

**I found a bug / I have an idea.**
[Open an issue](https://github.com/Shirowwww/Achievement-Watcher-3.0/issues) with the app version,
your Windows version, the source involved and the relevant logs. For a suspected vulnerability, use
the private process in the [security policy](https://github.com/Shirowwww/Achievement-Watcher-3.0/blob/main/SECURITY.md) instead.

---

**Still stuck?** [Troubleshooting](troubleshooting.md) goes through each symptom in order.

<div align="center">

[← Documentation](README.md) · [Project home](https://github.com/Shirowwww/Achievement-Watcher-3.0)

</div>