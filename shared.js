// LeetSquad - Shared utilities used by content.js and popup.js

const LeetSquadUtils = {
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

  // Sanitize a string for safe HTML insertion
  escapeHtml(str) {
    if (!str) return '';
    const div = typeof document !== 'undefined' ? document.createElement('div') : null;
    if (div) {
      div.textContent = str;
      return div.innerHTML;
    }
    // Fallback for non-DOM contexts
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
