# LeetSquad

Chrome extension that adds social features to LeetCode. Track friends' progress, compete on leaderboards, and see who solved each problem.

## Features

- **Problem page widget** - Shows which friends solved the current problem, with solve times and language used
- **Leaderboard** - Weekly, monthly, and all-time rankings with Easy/Medium/Hard breakdown
- **Activity feed** - Real-time feed of friend submissions with first-solve badges
- **Friend comparison** - Side-by-side stats and common problems between you and a friend
- **Daily goals** - Set a daily target and track your streak
- **Notifications** - Get notified when friends solve problems

## Install

1. Clone this repo
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select this folder

## Setup

1. Click the LeetSquad icon in your toolbar
2. Open the Friends panel and set your LeetCode username
3. Add friends by their LeetCode username

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (no frameworks)
- [alfa-leetcode-api](https://github.com/alfaarghya/alfa-leetcode-api) + LeetCode GraphQL API

## Testing

```bash
npm install
npm test
```

## Project Structure

```
├── manifest.json    # Extension config
├── api.js           # LeetCode API wrapper (REST + GraphQL)
├── storage.js       # Chrome storage abstraction
├── background.js    # Service worker (alarms, notifications)
├── content.js       # Problem page widget injection
├── popup.html       # Extension popup UI
├── popup.js         # Popup logic (leaderboard, activity, mutuals)
├── styles/
│   ├── popup.css    # Popup styles
│   └── content.css  # Widget styles
└── tests/           # Jest test suites
```

## License

MIT
