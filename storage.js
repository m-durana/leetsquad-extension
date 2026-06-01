// Chrome storage management for LeetSquad
const StorageManager = {
  // Keys
  KEYS: {
    FRIENDS: 'leetsquad_friends',
    MY_USERNAME: 'leetsquad_my_username',
    CACHE: 'leetsquad_cache',
    SETTINGS: 'leetsquad_settings',
    DAILY_GOALS: 'leetsquad_daily_goals',
    CHALLENGES: 'leetsquad_challenges',
    ACTIVITY_LOG: 'leetsquad_activity',
    SOLVED_SETS: 'leetsquad_solved_sets',
    CLOUD_SYNC_ENABLED: 'leetsquad_cloud_sync_enabled',
    CLOUD_SYNC_TOKEN: 'leetsquad_cloud_sync_token',
    CLOUD_SYNC_TOKEN_EXP: 'leetsquad_cloud_sync_token_exp',
    CLOUD_SYNC_USERNAME: 'leetsquad_cloud_sync_username',
    CLOUD_SYNC_LAST_AT: 'leetsquad_cloud_sync_last_at'
  },

  // Cache expiry time. Unified with the in-memory cache via LeetSquadUtils
  // so a storage hit is no longer invalidated by a stricter caller check.
  CACHE_EXPIRY: (typeof LeetSquadUtils !== 'undefined' && LeetSquadUtils?.CACHE_TTL_MS)
    || (typeof window !== 'undefined' && window.LeetSquadUtils?.CACHE_TTL_MS)
    || 10 * 60 * 1000,

  // Get data from storage. Returns null only when the key is genuinely unset;
  // falsy values like `false` or `0` round-trip intact.
  async get(key) {
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] !== undefined ? result[key] : null);
      });
    });
  },

  // Set data to storage
  async set(key, value) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: value }, resolve);
    });
  },

  // Remove data from storage
  async remove(key) {
    return new Promise((resolve) => {
      chrome.storage.local.remove([key], resolve);
    });
  },

  // Friends management
  async getFriends() {
    return (await this.get(this.KEYS.FRIENDS)) || [];
  },

  async addFriend(username) {
    const friends = await this.getFriends();
    if (!friends.includes(username)) {
      friends.push(username);
      await this.set(this.KEYS.FRIENDS, friends);
    }
    return friends;
  },

  async removeFriend(username) {
    const friends = await this.getFriends();
    const filtered = friends.filter(f => f !== username);
    await this.set(this.KEYS.FRIENDS, filtered);
    return filtered;
  },

  // My username
  async getMyUsername() {
    return await this.get(this.KEYS.MY_USERNAME);
  },

  async setMyUsername(username) {
    await this.set(this.KEYS.MY_USERNAME, username);
  },

  // Cache management - keyed by "username:type" to avoid collisions
  async getCachedData(username, type = 'full') {
    const cache = (await this.get(this.KEYS.CACHE)) || {};
    const key = `${username}:${type}`;
    const cached = cache[key];
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_EXPIRY) {
      return cached;
    }
    // Backwards compatibility: try old key format (just username)
    if (type === 'full' && cache[username] && Date.now() - cache[username].fetchedAt < this.CACHE_EXPIRY) {
      return cache[username];
    }
    return null;
  },

  async setCachedData(username, data, type = 'full') {
    const cache = (await this.get(this.KEYS.CACHE)) || {};
    const key = `${username}:${type}`;
    cache[key] = { ...data, fetchedAt: Date.now() };
    // Clean up old format key if it exists
    if (cache[username]) delete cache[username];
    await this.set(this.KEYS.CACHE, cache);
  },

  // Get cached data even if expired (for stale-while-revalidate pattern).
  // Returns { data, stale: boolean } or null if no cache entry exists.
  async getCachedDataWithStale(username, type = 'full') {
    const cache = (await this.get(this.KEYS.CACHE)) || {};
    const key = `${username}:${type}`;
    const cached = cache[key] || (type === 'full' ? cache[username] : null);
    if (!cached) return null;

    const fresh = cached.fetchedAt && Date.now() - cached.fetchedAt < this.CACHE_EXPIRY;
    return { data: cached, stale: !fresh };
  },

  async clearCache() {
    await this.remove(this.KEYS.CACHE);
  },

  // Invalidate cache for a specific user or type
  async invalidateCache(username, type = null) {
    const cache = (await this.get(this.KEYS.CACHE)) || {};
    if (type) {
      delete cache[`${username}:${type}`];
    } else {
      // Remove all entries for this user
      for (const key of Object.keys(cache)) {
        if (key === username || key.startsWith(`${username}:`)) {
          delete cache[key];
        }
      }
    }
    await this.set(this.KEYS.CACHE, cache);
  },

  // Settings
  async getSettings() {
    return (await this.get(this.KEYS.SETTINGS)) || {
      showOnProblemPage: true,
      showSolveTime: true,
      showAttempts: true,
      notifications: true,
      dailyReminder: false,
      reminderTime: '09:00',
      theme: 'dark',
      widgetDisplayMode: 'minimized', // floating, compact, minimized, sidebar, hidden
      debugMode: false // Enable debug logging
    };
  },

  async updateSettings(updates) {
    const settings = await this.getSettings();
    const newSettings = { ...settings, ...updates };
    await this.set(this.KEYS.SETTINGS, newSettings);
    return newSettings;
  },

  // Daily goals
  async getDailyGoals() {
    const goals = (await this.get(this.KEYS.DAILY_GOALS)) || {};
    const today = new Date().toISOString().split('T')[0];
    const todayGoal = goals[today] || { target: 3, completed: 0, problems: [] };

    // Calculate streak
    const streak = this.calculateStreak(goals, today);

    return { ...todayGoal, streak };
  },

  // Calculate current streak
  calculateStreak(goals, todayStr) {
    const today = new Date(todayStr);
    let streak = 0;
    let currentDate = new Date(today);

    // Check backwards from today
    while (true) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayGoal = goals[dateStr];

      // If this day has completions, increment streak
      if (dayGoal && dayGoal.completed > 0) {
        streak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        break;
      }
    }

    return streak;
  },

  async updateDailyGoal(problemSlug, difficulty) {
    const goals = (await this.get(this.KEYS.DAILY_GOALS)) || {};
    const today = new Date().toISOString().split('T')[0];
    
    if (!goals[today]) {
      goals[today] = { target: 3, completed: 0, problems: [] };
    }
    
    if (!goals[today].problems.includes(problemSlug)) {
      goals[today].problems.push(problemSlug);
      goals[today].completed++;
    }
    
    await this.set(this.KEYS.DAILY_GOALS, goals);
    return goals[today];
  },

  async setDailyTarget(target) {
    const goals = (await this.get(this.KEYS.DAILY_GOALS)) || {};
    const today = new Date().toISOString().split('T')[0];
    
    if (!goals[today]) {
      goals[today] = { target, completed: 0, problems: [] };
    } else {
      goals[today].target = target;
    }
    
    await this.set(this.KEYS.DAILY_GOALS, goals);
    return goals[today];
  },

  // Group challenges
  async getChallenges() {
    return (await this.get(this.KEYS.CHALLENGES)) || [];
  },

  async addChallenge(challenge) {
    const challenges = await this.getChallenges();
    challenges.push({
      id: Date.now(),
      ...challenge,
      createdAt: Date.now()
    });
    await this.set(this.KEYS.CHALLENGES, challenges);
    return challenges;
  },

  async removeChallenge(id) {
    const challenges = await this.getChallenges();
    const filtered = challenges.filter(c => c.id !== id);
    await this.set(this.KEYS.CHALLENGES, filtered);
    return filtered;
  },

  ACTIVITY_MAX_AGE: 30 * 24 * 60 * 60 * 1000,

  async getActivityLog(limit = 50) {
    const log = (await this.get(this.KEYS.ACTIVITY_LOG)) || [];
    return log.slice(0, limit);
  },

  async addActivity(activity) {
    let log = (await this.get(this.KEYS.ACTIVITY_LOG)) || [];

    log.unshift({
      ...activity,
      timestamp: Date.now()
    });

    // Prune old entries (older than 30 days) and cap at 200
    const cutoff = Date.now() - this.ACTIVITY_MAX_AGE;
    log = log.filter(entry => entry.timestamp > cutoff).slice(0, 200);

    await this.set(this.KEYS.ACTIVITY_LOG, log);
  },

  // ===== Solved-slug set =====
  // Shape: { [username]: { slugs: { [titleSlug]: timestampSec }, lastRefreshed: ms } }

  async getAllSolvedSets() {
    return (await this.get(this.KEYS.SOLVED_SETS)) || {};
  },

  async getSolvedSet(username) {
    const all = await this.getAllSolvedSets();
    return all[username] || { slugs: {}, lastRefreshed: 0 };
  },

  // Returns true if `username` has `titleSlug` in their accreted set.
  async hasSolvedSlug(username, titleSlug) {
    const set = await this.getSolvedSet(username);
    return !!set.slugs[titleSlug];
  },

  // Returns the timestamp (sec) we have on file for this username/slug, or
  // null. Used so the widget can render "solved Xd ago" even from cached data.
  async getSolvedSlugTimestamp(username, titleSlug) {
    const set = await this.getSolvedSet(username);
    return set.slugs[titleSlug] || null;
  },

  async getSolvedCount(username) {
    const set = await this.getSolvedSet(username);
    return Object.keys(set.slugs).length;
  },

  // Merge a batch of {titleSlug, timestamp} entries into a user's set, keeping
  // the latest timestamp per slug. Persists in one storage write.
  async mergeSolvedSlugs(username, entries) {
    if (!username || !Array.isArray(entries) || entries.length === 0) return;
    const all = await this.getAllSolvedSets();
    const set = all[username] || { slugs: {}, lastRefreshed: 0 };
    for (const e of entries) {
      if (!e?.titleSlug) continue;
      const ts = +e.timestamp || 0;
      const prev = set.slugs[e.titleSlug] || 0;
      set.slugs[e.titleSlug] = ts > prev ? ts : prev;
    }
    set.lastRefreshed = Date.now();
    all[username] = set;
    await this.set(this.KEYS.SOLVED_SETS, all);
  },

  // Drop a user's solved set entirely (e.g. when they're removed as a friend).
  async clearSolvedSet(username) {
    const all = await this.getAllSolvedSets();
    if (!all[username]) return;
    delete all[username];
    await this.set(this.KEYS.SOLVED_SETS, all);
  },

  async pruneActivityLog() {
    let log = (await this.get(this.KEYS.ACTIVITY_LOG)) || [];
    const cutoff = Date.now() - this.ACTIVITY_MAX_AGE;
    const pruned = log.filter(entry => entry.timestamp > cutoff).slice(0, 200);
    if (pruned.length !== log.length) {
      await this.set(this.KEYS.ACTIVITY_LOG, pruned);
    }
    return pruned;
  }
};

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
}
