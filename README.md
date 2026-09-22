# LeetSquad

Browser extension that adds social features to LeetCode: see which friends solved the current problem, compete on leaderboards, compare head-to-head, and track a daily streak.

## Install

[Chrome Web Store](#) · [Firefox Add-ons](#) · [Edge Add-ons](#)

## Features

- Squad widget on every problem page showing which friends solved it, in what language, and how fast.
- Leaderboard with Week / Month / All-Time views and Easy / Medium / Hard breakdowns.
- Activity feed with first-solve badges and runtime percentile.
- Head-to-head stats and shared-problems list versus any friend.
- Daily goal and streak, with optional notifications when friends solve.
- Keyboard shortcuts to open the popup and toggle the widget.

## Sign-in

There is no LeetSquad-only sign-in function. LeetSquad uses LeetCode's signed in account as your account. However sign-in is fully optional. The leaderboard, activity feed, and "who solved this" widget all work using LeetCode's public data. Signing in at leetcode.com unlocks the Beats X% runtime badges and auto-detects your username.

## Cloud sync

LeetCode only exposes each user's last ~20 accepted submissions publicly, so a friend's older solves never appear on the widget by default. To close that gap, LeetSquad publishes your verified solved-problem list to `leetsquad.miro.build`. Other LeetSquad users see your published list instantly on shared problem pages.

Only your LeetCode username and the list of solved problem slugs are shared. No code, no profile data, no email, no IP retention beyond rate-limit windows (feel free to check the `server` folder). The same data is exposed as a public read-only API; see [API.md](API.md).

Cloud sync is on by default to make the widget useful out of the box. You can disconnect at any time from Settings, which stops the extension from uploading further data.

### Deleting your data

The fastest path is the extension: open Settings, scroll to Cloud Sync, click Delete my data. That will wipe and and all data about you from the server, including your API keys. It's a hard delete with no tombstones but re-enabling Cloud Sync rebuilds the row from scratch.

If you've lost your JWT (extension uninstalled, browser wiped), open a [GitHub issue](https://github.com/m-durana/leetsquad-extension/issues) titled `Data deletion request: <your-leetcode-handle>` with a screenshot of you signed into that LeetCode account or alternatively contact me [here](https://miro.build/contact).

## Permissions

- `storage`: friends list, settings, local cache, and (when Cloud Sync is on) your verification JWT and personal API key.
- `alarms`: periodic background refresh and Cloud Sync push.
- `notifications`: opt-in alerts when friends solve.
- `cookies`: read the leetcode.com session cookie when present, so signed-in users get private-data features (runtime percentile, auto-detected username).
- `scripting`: write the one-time verification nonce into your LeetCode bio during sign-up, then remove it.
- Host access:
  - `https://leetcode.com/*`: read your public profile and friends' public solved lists; write the verification nonce during sign-up.
  - `https://leetsquad.miro.build/*`: the Cloud Sync server and public read-only API.

## Build from source

```bash
git clone <this repo>
cd leetsquad-extension
npm install
npm test
```

Load the folder as an unpacked extension in `chrome://extensions/` or `about:debugging`.
