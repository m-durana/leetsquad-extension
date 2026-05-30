# LeetSquad

Chrome extension that adds social features to LeetCode: see which friends solved the current problem, compete on leaderboards, compare head-to-head, and track a daily streak.

## Install

1. Clone this repo.
2. Open `chrome://extensions/`, enable **Developer mode**, click **Load unpacked**, select this folder.
3. Click the icon → Settings → set your LeetCode username, then add friends in the Friends panel.

## Develop

```bash
npm install
npm test
```

After editing, hit refresh on the LeetSquad card in `chrome://extensions`. Reload any open LeetCode tab if you changed `content.js`.

## Layout

```
api.js          GraphQL wrapper (cache, dedup, retry, batch)
storage.js      chrome.storage wrapper (friends, settings, profile cache)
shared.js       escapeHtml, timeAgo, CACHE_TTL_MS
background.js   service worker: periodic refresh + notifications
content.js      injected widget on /problems/*
popup.{html,js} popup UI
tests/          Jest (200+ tests)
```

## Permissions

`storage` (cache + friends), `alarms` (periodic refresh), `notifications` (optional), `cookies` (CSRF token for authenticated GraphQL). Host scope: `leetcode.com` only.

## Notes

- LeetCode's `recentSubmissionList` doesn't expose per-submission difficulty, so the period-leaderboard breakdown is approximate; the totals are exact.
- Runtime percentile badges require being logged in to leetcode.com and are fetched lazily.

## License

MIT
