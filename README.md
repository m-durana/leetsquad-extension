# LeetSquad

Chrome extension that adds social features to LeetCode: see which friends solved the current problem, compete on leaderboards, compare head-to-head, and track a daily streak.

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

## Permissions

- `storage`: friends list, settings, local cache.
- `alarms`: periodic background refresh.
- `notifications`: opt-in alerts when friends solve.
- `cookies`: read the leetcode.com session cookie when present.

Host scope is limited to `leetcode.com`. No accounts, no telemetry, no server.

## Build from source

```bash
git clone <this repo>
cd leetsquad-extension
npm install
npm test
```

Load the folder as an unpacked extension in `chrome://extensions/` or `about:debugging`.

## License

MIT
