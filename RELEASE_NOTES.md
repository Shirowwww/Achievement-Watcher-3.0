# Achievement Watcher 3.5.1

Quick follow-up fixing the Microsoft / Xbox Network account connection window: after you accept the
consent page, the login window now closes by itself and the connection actually completes.

## Fixed

- **Xbox login window no longer stays open.** The OAuth redirect to the localhost callback is now
  captured from the navigation itself — the authorization code was previously invisible because the
  navigation was cancelled before the URL ever committed — the callback path tolerates a trailing
  slash, and popups the consent flow opens are watched like the main window instead of being denied
  by the default popup blocker. The account connects and the window closes automatically.

See the [changelog](CHANGELOG.md#351---2026-08-04) for the full list of changes.

## Install

Download `Achievement.Watcher.Setup.3.5.1.exe` from the
[v3.5.1 release](https://github.com/Shirowwww/Achievement-Watcher-3.0/releases/tag/v3.5.1).

The `.blockmap` and `latest.yml` assets are used by automatic updates. Existing settings and tracked
data under `%APPDATA%\Achievement Watcher` are preserved when upgrading.
