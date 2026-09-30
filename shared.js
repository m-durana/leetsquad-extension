// Shared utilities used by content.js and popup.js; single TTL source so caches don't disagree.
const LEETSQUAD_CACHE_TTL_MS = 10 * 60 * 1000;

const LEETSQUAD_PROD_CLOUD_BASE = 'https://leetsquad.miro.build';
const LEETSQUAD_DEV_CLOUD_BASE = 'http://localhost:8787';
let LEETSQUAD_CLOUD_BASE = LEETSQUAD_PROD_CLOUD_BASE;

const LeetSquadUtils = {
  CACHE_TTL_MS: LEETSQUAD_CACHE_TTL_MS,
  CLOUD_BASE: LEETSQUAD_CLOUD_BASE,

  // Shows a "slow loading" hint after delayMs (usually LeetCode rate-limiting on a fresh cache); returns cancel().
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
    if (seconds < 2629800) return `${Math.floor(seconds / 604800)}w ago`;
    if (seconds < 31557600) return `${Math.floor(seconds / 2629800)}mo ago`;
    return `${Math.floor(seconds / 31557600)}y ago`;
  },

  // Format timestamp (in ms) to human-readable "time ago" string
  timeAgoMs(timestampMs) {
    const seconds = Math.floor((Date.now() - timestampMs) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    if (seconds < 2629800) return `${Math.floor(seconds / 604800)}w ago`;
    if (seconds < 31557600) return `${Math.floor(seconds / 2629800)}mo ago`;
    return `${Math.floor(seconds / 31557600)}y ago`;
  },

  // Sanitize for safe HTML in content AND attributes (escapes &<> plus quotes).
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  // Only allow https avatar URLs; anything else falls back to the gradient placeholder.
  safeAvatarUrl(url) {
    if (!url) return '';
    try {
      return new URL(url).protocol === 'https:' ? url : '';
    } catch (_) {
      return '';
    }
  }
};

if (typeof window !== 'undefined') {
  window.LeetSquadUtils = LeetSquadUtils;
}
if (typeof self !== 'undefined' && typeof window === 'undefined') {
  self.LeetSquadUtils = LeetSquadUtils;
}

async function refreshCloudBaseFromSettings() {
  try {
    const data = await browser.storage.local.get('leetsquad_settings');
    const debug = data?.leetsquad_settings?.debugMode === true;
    LEETSQUAD_CLOUD_BASE = debug ? LEETSQUAD_DEV_CLOUD_BASE : LEETSQUAD_PROD_CLOUD_BASE;
    LeetSquadUtils.CLOUD_BASE = LEETSQUAD_CLOUD_BASE;
  } catch (_) {}
}
refreshCloudBaseFromSettings();
try {
  browser.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === 'local' && changes.leetsquad_settings) refreshCloudBaseFromSettings();
  });
} catch (_) {}
