# Game Health

When a game does not behave the way you expect, open its **Game Health** panel before anything else.
It is the one place that says whether AW Next can see the game, read its achievements and announce
its unlocks - and it offers only the repairs that can genuinely fix *that* game.

Open it from the **tools** button in the top-right corner of a game tile, or from the game's
right-click menu.

<div align="center">
<img src="screenshot/game-health.png" width="620" alt="Game Health panel showing a Ready state"><br>
<sub>One state, the reason for it, the checks behind it, and the repairs that apply</sub>
</div>

## The three states

| State | What it means |
|---|---|
| **Ready** | The game is detected, its achievement data is available, and AW Next is watching it for unlocks. |
| **Needs attention** | The game works, but part of its setup is incomplete. The checks show which part. |
| **Not tracking** | Something essential is missing - the game cannot be located, or it has no achievement data at all. |

The sentence under the state explains the cause in plain words. The checks under that show which
part is at fault, and any repair button acts on exactly that.

## The checks

| Check | What it answers |
|---|---|
| **Game files** | Is the install folder still there? |
| **Executable** | Which program should be watched while you play? |
| **Game identity** | Which AppID and platform was this game matched to? |
| **Achievement data** | Is there an achievement list, and is it complete? |
| **Emulator setup** | Does a game that needs a Steam emulator have one? |
| **Progress** | Has any unlock or save been found yet? |
| **Live tracking** | Is the background tracker watching this game's process? |
| **Notifications** | Which transport delivered the last notification for this game, and why? |

In **Simple** interface mode the checks state outcomes - *Achievement data found*, *Tracking active*,
*Game saves detected*. In **Advanced** they carry the exact counts, the watched process and the
notification transport. **Technical details** at the bottom holds every raw value in both modes;
copy it into a bug report.

> [!NOTE]
> **Game identity** is a diagnostic value rather than something to act on, so Simple mode leaves it
> out of the list. It is still in Technical details.

## The repairs

Only the repairs that can fix the game in front of you are shown.

| Repair | What it does |
|---|---|
| **Locate the game** | Opens a picker so you can choose the executable to watch. |
| **Open the game folder** | Opens the install folder in Explorer. |
| **Rewrite the achievement data** | Writes the achievement list, icons and emulator settings. Existing files are copied to a backup first. |
| **Restore the emulator file** | Downloads the supported emulator build and installs it into the game folder, keeping any existing file as a backup. |
| **Correct the game ID file** | Rewrites `steam_appid.txt` when the emulator announces one game and AW Next matched another. Both values are shown, and the previous file is kept. |
| **Watch this game** | Adds the game to the background tracker so playtime and live unlocks are recorded. |
| **Unmute progress notifications** | Turns progress notifications back on for a game you muted. |
| **Send a test notification** | Fires a notification carrying this game's own name and artwork, through the transport it would really use. |

Every repair says what it will change and where the previous files are kept. Nothing is rewritten
without a backup, and no repair runs without a confirmation.

> [!IMPORTANT]
> **Correct the game ID file** is a confirmed choice, never automatic. A mismatch can equally mean
> the library card is the part that is wrong - if the emulator was set up on purpose for the ID on
> disk, leave it alone.

## Common states and what to do

| The panel says | What it usually means |
|---|---|
| *No achievement list could be found* | The game has no achievements at all, or its source is switched off. Check **Settings → Sources**. |
| *This game needs a Steam emulator and none is set up* | Use **Apply emulator fix** from the game's right-click menu - see [Goldberg / GBE setup](emulator-setup.md). |
| *The emulator file that reads it is missing* | **Restore the emulator file** puts the matching runtime back. |
| *The achievement list doesn't match what the game will look for* | **Rewrite the achievement data**. This is the usual result of a repack update. |
| *No achievement progress has been found yet* | Normal for a game you have not played since setting it up. Launch it and unlock something. |
| *AW Next isn't watching this game while it runs* | **Watch this game** adds it to the tracker. |
| *The last notification could not be sent* | Send a test notification, then see [Notifications](notifications.md#if-a-test-or-unlock-does-not-appear). |
| *Working - Windows fallback active* | Not a fault. Automatic delivery chose a Windows notification for this game; see [how Automatic decides](notifications.md#how-automatic-decides). |

---

**Next:** [Troubleshooting](troubleshooting.md) - for problems Game Health does not resolve on its own.

<div align="center">

[← Documentation](README.md) · [Project home](https://github.com/Shirowwww/Achievement-Watcher-Next)

</div>