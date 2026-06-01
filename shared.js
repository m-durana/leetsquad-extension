// LeetSquad - Shared utilities used by content.js and popup.js

// Single source of truth for cache lifetimes. Previously api.js, storage.js,
// and popup.js each had their own (5min / 30min / 10min) and disagreed,
// causing storage hits to be invalidated by the popup's stricter check and
// forcing unnecessary refetches.
const LEETSQUAD_CACHE_TTL_MS = 10 * 60 * 1000;

const LEETSQUAD_CLOUD_BASE = 'https://leetsquad.miro.build';

const LeetSquadUtils = {
  CACHE_TTL_MS: LEETSQUAD_CACHE_TTL_MS,
  CLOUD_BASE: LEETSQUAD_CLOUD_BASE,

  // Arms a delayed "slow loading" hint that swaps into the given element if
  // loading hasn't completed by `delayMs`. Common cause is LeetCode rate
  // limiting on a fresh cache. Returns a cancel() function to call when the
  // real data renders so the hint never appears for fast loads.
  armSlowHint(container, delayMs) {
    if (!container) return () => {};
    const ms = typeof delayMs === 'number' ? delayMs : 2500;
    const timer = setTimeout(() => {
      const loader = container.querySelector('.loading, .leetsquad-loading');
      if (!loader) return;
      const hint = document.createElement('div');
      hint.className = 'loading-hint';
      hint.textContent = 'One moment. LeetCode is responding slowly; this often happens during rate-limit backoff.';
      // Avoid stacking if armed twice
      if (!loader.querySelector('.loading-hint')) loader.appendChild(hint);
    }, ms);
    return () => clearTimeout(timer);
  },


  // Format language identifier to display name
  formatLanguage(lang) {
    const langMap = {
      'cpp': 'C++',
      'java': 'Java',
      'python': 'Python',
      'python3': 'Python',
      'c': 'C',
      'csharp': 'C#',
      'javascript': 'JavaScript',
      'typescript': 'TypeScript',
      'php': 'PHP',
      'swift': 'Swift',
      'kotlin': 'Kotlin',
      'dart': 'Dart',
      'go': 'Go',
      'ruby': 'Ruby',
      'scala': 'Scala',
      'rust': 'Rust',
      'racket': 'Racket',
      'erlang': 'Erlang',
      'elixir': 'Elixir',
      'mysql': 'MySQL',
      'mssql': 'MS SQL',
      'oraclesql': 'Oracle SQL'
    };
    return langMap[lang?.toLowerCase()] || lang || 'N/A';
  },

  // Generate consistent gradient for avatar placeholder based on username
  getAvatarGradient(username) {
    const colors = [
      ['#e94560', '#a855f7'],
      ['#a855f7', '#3b82f6'],
      ['#3b82f6', '#06b6d4'],
      ['#06b6d4', '#10b981'],
      ['#10b981', '#f59e0b'],
      ['#f59e0b', '#e94560'],
    ];
    const hash = username.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const pair = colors[hash % colors.length];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  },

  // Format timestamp to human-readable "time ago" string
  timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp * 1000) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 604800)}w ago`;
  },

  // Format timestamp (in ms) to human-readable "time ago" string
  timeAgoMs(timestampMs) {
    const seconds = Math.floor((Date.now() - timestampMs) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 604800)}w ago`;
  },

  // Sanitize a string for safe HTML insertion in both element content AND
  // attribute values. textContent->innerHTML only escapes &, <, >, so we must
  // additionally escape quotes for the result to be safe inside attributes.
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.LeetSquadUtils = LeetSquadUtils;
}
