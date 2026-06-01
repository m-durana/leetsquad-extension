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

Sign-in is fully Optional. The leaderboard, activity feed, and "who solved this" widget all work using LeetCode's public data. Signing in at leetcode.com unlocks the Beats X% runtime badges and auto-detects your username.

## Cloud sync

LeetCode only exposes each user's last ~20 accepted submissions publicly, so a friend's older solves never appear on the widget by default. To close that gap, LeetSquad publishes your verified solved-problem list to `leetsquad.miro.build`. Other LeetSquad users see your published list instantly on shared problem pages.

Only your LeetCode username and the list of solved problem slugs are shared. No code, no profile data, no email, no IP retention beyond rate-limit windows (feel free to check on the `server` folder).

The same data is exposed as a public read-only API; see [docs/public-api-plan.md](docs/public-api-plan.md).

Cloud sync is on by default to make the widget useful out of the box. You can disconnect at any time from Settings, which stops the extension from uploading further data.

### Deleting your data

To request deletion of your published data, open a GitHub issue at <https://github.com/m-durana/leetsquad-extension/issues> titled "Data deletion request: <your-leetcode-handle>" with a screenshot of you being logged into LeetCode. I'll delete on receipt; usually within a day. (To prevent hijacking or compromised browsers wiping/altering your data on the server.)

## Permissions

- `storage`: friends list, settings, local cache.
- `alarms`: periodic background refresh.
- `notifications`: opt-in alerts when friends solve.
- `cookies`: read the leetcode.com session cookie when present.
- `scripting`: write the one-time verification nonce into your LeetCode bio during sign-up.

## Build from source

```bash
git clone <this repo>
cd leetsquad-extension
npm install
npm test
```

Load the folder as an unpacked extension in `chrome://extensions/` or `about:debugging`.
