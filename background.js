// LeetSquad - Background Service Worker

try { importScripts('shared.js', 'storage.js', 'achievements.js'); } catch (e) { console.error('importScripts:', e); }

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';
function cloudBase() { return (typeof LeetSquadUtils !== 'undefined' && LeetSquadUtils.CLOUD_BASE) || 'https://leetsquad.miro.build'; }

// Retry config for background fetches
const BG_RETRY_CONFIG = {
  maxRetries: 2,
  retryDelay: 2000,
  timeout: 15000,
};

// Initialize alarms on install
chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.alarms.create('checkUpdates', { periodInMinutes: 30 });
  chrome.alarms.create('dailyReset', {
    when: getNextMidnight(),
    periodInMinutes: 24 * 60
  });

  try {
    const data = await chrome.storage.local.get(['leetsquad_friends']);
    const friends = data.leetsquad_friends || [];
    if (friends.length > 0) {
      refreshSolvedSets(friends).catch(e => console.error('initial refresh:', e));
    }
  } catch (e) {}

  if (typeof recoverPendingVerification === 'function') {
    recoverPendingVerification().catch((e) => console.error('recovery onInstalled:', e?.message || e));
  }
  if (details?.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
  }

  console.log('LeetSquad installed and alarms set');
});

// Handle alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'checkUpdates') {
    await checkForNewSubmissions();
  } else if (alarm.name === 'dailyReset') {
    // Reset daily goals handled in storage
    console.log('Daily reset triggered');
  }
});

// Get next midnight timestamp
function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

// Resilient GraphQL fetch; no x-csrftoken since this worker only issues public read-only queries.
async function graphqlFetch(query, variables = {}) {
  for (let attempt = 0; attempt <= BG_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BG_RETRY_CONFIG.timeout);

      const response = await fetch(LEETCODE_GRAPHQL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://leetcode.com',
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        if (attempt < BG_RETRY_CONFIG.maxRetries) {
          const delay = BG_RETRY_CONFIG.retryDelay * Math.pow(2, attempt);
          console.log(`Rate limited in background, retrying in ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        return null;
      }

      if (!response.ok) return null;

      const data = await response.json();
      return data?.data || null;
    } catch (error) {
      if (attempt < BG_RETRY_CONFIG.maxRetries) {
        const delay = BG_RETRY_CONFIG.retryDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      console.error('Background GraphQL fetch failed:', error.message);
      return null;
    }
  }
  return null;
}

// Union friends' recent ACs into a cumulative solved-slug set; converges past LeetCode's ~20-entry cap.
async function refreshSolvedSets(friends) {
  if (!friends || friends.length === 0) return;
  const query = `
    query getRecentAc($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id
        titleSlug
        timestamp
        lang
        runtime
        memory
      }
    }
  `;

  // Load the current set once, mutate locally, write once.
  let all = {};
  try {
    const existing = await chrome.storage.local.get(['leetsquad_solved_sets']);
    all = existing.leetsquad_solved_sets || {};
  } catch (e) {
    return;
  }

  for (const username of friends) {
    try {
      const data = await graphqlFetch(query, { username, limit: 20 });
      const entries = data?.recentAcSubmissionList || [];
      if (entries.length === 0) continue;
      const set = all[username] || { slugs: {}, lastRefreshed: 0 };
      if (!set.submissionIds) set.submissionIds = {};
      if (!set.submissionMeta) set.submissionMeta = {};
      for (const e of entries) {
        if (!e?.titleSlug) continue;
        const slug = e.titleSlug;
        const ts = +e.timestamp || 0;
        const prev = set.slugs[slug] || 0;
        set.slugs[slug] = ts > prev ? ts : prev;
        if (e.id) set.submissionIds[slug] = String(e.id);
        const meta = set.submissionMeta[slug] || {};
        if (e.lang) meta.lang = String(e.lang);
        if (e.runtime) meta.rt = String(e.runtime);
        if (e.memory) meta.mem = String(e.memory);
        if (meta.lang || meta.rt || meta.mem) set.submissionMeta[slug] = meta;
      }
      set.lastRefreshed = Date.now();
      all[username] = set;
    } catch (e) {
      // Skip this friend; the next alarm will retry
    }
  }

  try {
    await chrome.storage.local.set({ leetsquad_solved_sets: all });
  } catch (e) {
    console.error('refreshSolvedSets write failed:', e);
  }
}

// Fetch recent submissions via GraphQL
async function fetchRecentSubmissions(username, limit = 5) {
  const query = `
    query getRecentSubmissions($username: String!, $limit: Int) {
      recentSubmissionList(username: $username, limit: $limit) {
        title
        titleSlug
        timestamp
        statusDisplay
        lang
      }
    }
  `;

  const data = await graphqlFetch(query, { username, limit });
  return data?.recentSubmissionList || [];
}

// Fetch user profile via GraphQL
async function fetchUserProfile(username) {
  const query = `
    query getUserProfile($username: String!) {
      matchedUser(username: $username) {
        username
        profile {
          realName
          userAvatar
          ranking
        }
        submitStats {
          acSubmissionNum {
            difficulty
            count
          }
        }
      }
    }
  `;

  const data = await graphqlFetch(query, { username });
  const user = data?.matchedUser;
  if (!user) return null;

  const acStats = user.submitStats?.acSubmissionNum || [];
  return {
    username: user.username,
    avatar: user.profile?.userAvatar || null,
    ranking: user.profile?.ranking,
    easySolved: acStats.find(s => s.difficulty === 'Easy')?.count || 0,
    mediumSolved: acStats.find(s => s.difficulty === 'Medium')?.count || 0,
    hardSolved: acStats.find(s => s.difficulty === 'Hard')?.count || 0,
    totalSolved: acStats.find(s => s.difficulty === 'All')?.count || 0,
  };
}

// Warm the storage cache with fresh profiles for every friend in one
// batched GraphQL request. The popup reads from this cache on open, so a
// periodic warm-up makes the first paint feel instant.
async function warmProfileCache(friends) {
  if (!friends || friends.length === 0) return;

  // Build a single query with up to 10 aliases per request
  const BATCH = 5;
  const allCache = {};
  try {
    const existing = await chrome.storage.local.get(['leetsquad_cache']);
    Object.assign(allCache, existing.leetsquad_cache || {});
  } catch (e) {
    return;
  }

  for (let i = 0; i < friends.length; i += BATCH) {
    const batch = friends.slice(i, i + BATCH);
    const varDefs = batch.map((_, j) => `$u${j}: String!`).join(', ');
    const fields = batch.map((_, j) => `
      user_${j}: matchedUser(username: $u${j}) {
        username
        profile { realName userAvatar ranking reputation }
        submitStats { acSubmissionNum { difficulty count } }
      }
    `).join('\n');
    const query = `query BatchProfiles(${varDefs}) {\n${fields}\n}`;
    const variables = {};
    batch.forEach((u, j) => { variables[`u${j}`] = u; });

    const data = await graphqlFetch(query, variables);
    if (!data) continue;

    batch.forEach((u, j) => {
      const user = data[`user_${j}`];
      if (!user) return;
      const acStats = user.submitStats?.acSubmissionNum || [];
      const profile = {
        username: user.username,
        avatar: user.profile?.userAvatar || null,
        ranking: user.profile?.ranking,
        realName: user.profile?.realName,
        reputation: user.profile?.reputation,
        easySolved: acStats.find(s => s.difficulty === 'Easy')?.count || 0,
        mediumSolved: acStats.find(s => s.difficulty === 'Medium')?.count || 0,
        hardSolved: acStats.find(s => s.difficulty === 'Hard')?.count || 0,
        totalSolved: acStats.find(s => s.difficulty === 'All')?.count || 0,
      };
      allCache[`${u}:full`] = {
        username: u,
        profile,
        solved: {
          easySolved: profile.easySolved,
          mediumSolved: profile.mediumSolved,
          hardSolved: profile.hardSolved,
          solvedProblem: profile.totalSolved,
        },
        submissions: null,
        fetchedAt: Date.now(),
      };
    });
  }

  try {
    await chrome.storage.local.set({ leetsquad_cache: allCache });
  } catch (e) {
    console.error('Warm cache write failed:', e);
  }
}

// Check for new submissions from friends
async function checkForNewSubmissions() {
  try {
    const data = await chrome.storage.local.get(['leetsquad_friends', 'leetsquad_settings', 'leetsquad_last_check']);
    const friends = data.leetsquad_friends || [];
    const settings = data.leetsquad_settings || {};
    const lastCheck = data.leetsquad_last_check || 0;

    // Warm the cache on every periodic check, even when notifications are off.
    // This is what makes popup-open feel instant for users.
    warmProfileCache(friends).catch(e => console.error('warmProfileCache:', e));

    // Grow the persistent solved-slug set so the widget can answer "did X
    // solve Y" for older problems beyond LeetCode's ~20-recent API cap.
    refreshSolvedSets(friends)
      .then(() => uploadMySolvedSetIfOptedIn())
      .catch(e => console.error('refreshSolvedSets:', e));
    syncFriendsIfOptedIn().catch(e => console.error('syncFriends:', e));
    syncDailyGoalsIfOptedIn().catch(e => console.error('syncDailyGoals:', e));

    if (!settings.notifications || friends.length === 0) return;

    const newSubmissions = [];

    for (const username of friends) {
      try {
        const submissions = await fetchRecentSubmissions(username, 5);

        // Find submissions after last check
        const recent = submissions.filter(s =>
          s.statusDisplay === 'Accepted' &&
          s.timestamp * 1000 > lastCheck
        );

        newSubmissions.push(...recent.map(s => ({ ...s, username })));
      } catch (e) {
        console.error(`Error checking ${username}:`, e);
      }
    }

    // Update last check time
    await chrome.storage.local.set({ leetsquad_last_check: Date.now() });

    // Send notifications for new submissions
    if (newSubmissions.length > 0) {
      // Group by user
      const byUser = {};
      newSubmissions.forEach(s => {
        if (!byUser[s.username]) byUser[s.username] = [];
        byUser[s.username].push(s);
      });

      // Create notifications
      for (const [username, subs] of Object.entries(byUser)) {
        const count = subs.length;
        const firstProblem = subs[0].title;

        chrome.notifications.create(`leetsquad-${Date.now()}`, {
          type: 'basic',
          iconUrl: 'icons/icon128.png',
          title: 'LeetSquad Update',
          message: count === 1
            ? `${username} solved "${firstProblem}"!`
            : `${username} solved ${count} problems!`,
          priority: 1
        });
      }
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
  }

  try { await runAchievementsPass(); } catch (e) { console.error('achievements pass:', e); }
}

async function runAchievementsPass() {
  if (typeof Achievements === 'undefined') return;
  const result = await Achievements.runPass();
  if (!result?.unlockedNow?.length) return;

  const settings = (await chrome.storage.local.get(['leetsquad_settings']))?.leetsquad_settings || {};
  if (!settings.notifications) return;

  for (const id of result.unlockedNow) {
    const a = Achievements.getById(id);
    if (!a) continue;
    chrome.notifications.create(`leetsquad-ach-${id}-${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `Achievement unlocked: ${a.name}`,
      message: a.description,
      priority: 1
    });
  }
}

// Runs inside the leetcode.com page (Origin matches), so mutations are accepted.
function _lcSkillsFn(op, value) {
  return (async () => {
    const csrftoken = (document.cookie.split('; ').find((c) => c.startsWith('csrftoken=')) || '').split('=')[1];
    if (!csrftoken) return { error: 'no_csrf' };
    const post = (query, variables, opName) =>
      fetch('https://leetcode.com/graphql/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-csrftoken': csrftoken,
          'x-operation-name': opName,
        },
        body: JSON.stringify({ query, variables, operationName: opName }),
      }).then(async (r) => {
        const text = await r.text();
        try { return JSON.parse(text); }
        catch (_) { return { _httpStatus: r.status, _nonJson: text.slice(0, 200) }; }
      });

    if (op === 'read') {
      const me = await post('query userStatus { userStatus { isSignedIn username } }', {}, 'userStatus');
      const username = me?.data?.userStatus?.username;
      if (!me?.data?.userStatus?.isSignedIn || !username) return { error: 'not_signed_in' };
      const cur = await post(
        'query userPublicProfile($username: String!) { matchedUser(username: $username) { profile { skillTags } } }',
        { username }, 'userPublicProfile'
      );
      const tags = cur?.data?.matchedUser?.profile?.skillTags;
      return { username, skillTags: Array.isArray(tags) ? tags : [] };
    }
    if (op === 'write') {
      const arr = Array.isArray(value) ? value : [];
      const upd = await post(
        'mutation updateProfile($fieldName: String!, $value: String) { updateProfile(fieldName: $fieldName, value: $value) { ok error } }',
        { fieldName: 'skills', value: JSON.stringify(arr) }, 'updateProfile'
      );
      if (upd?._nonJson !== undefined) return { error: `lc_write_non_json_${upd._httpStatus}` };
      const r = upd?.data?.updateProfile;
      if (!r?.ok) return { error: r?.error || 'update_failed' };
      return { ok: true };
    }
    return { error: 'unknown_op' };
  })();
}

async function findOrOpenLeetCodeTab() {
  const existing = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  if (existing.length > 0) return { tabId: existing[0].id, opened: false };
  const tab = await chrome.tabs.create({ url: 'https://leetcode.com/', active: false, pinned: true });
  await new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15000);
  });
  return { tabId: tab.id, opened: true };
}

async function lcSkillsOp(op, value, tabId) {
  if (!tabId) {
    const t = await findOrOpenLeetCodeTab();
    tabId = t.tabId;
  }
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: _lcSkillsFn,
    args: [op, value ?? null],
    world: 'MAIN',
  });
  return result || { error: 'no_result' };
}

// Upload my full solved-slug set if I'm opted in and have a live token.
// Runs from the periodic alarm and after explicit verify/refresh. No-op otherwise.
async function uploadMySolvedSetIfOptedIn() {
  try {
    const data = await chrome.storage.local.get([
      'leetsquad_cloud_sync_enabled',
      'leetsquad_cloud_sync_token',
      'leetsquad_cloud_sync_token_exp',
      'leetsquad_cloud_sync_username',
      'leetsquad_solved_sets',
      'leetsquad_friends',
    ]);
    const enabled = data.leetsquad_cloud_sync_enabled !== false; // default-on
    if (!enabled || !data.leetsquad_cloud_sync_token) return;
    if (Date.now() >= (data.leetsquad_cloud_sync_token_exp || 0)) return;
    const username = data.leetsquad_cloud_sync_username;
    if (!username) return;

    const allSets = data.leetsquad_solved_sets || {};
    const buildRichMap = (set) => {
      if (!set || !set.slugs) return {};
      const out = {};
      const ids = set.submissionIds || {};
      const meta = set.submissionMeta || {};
      for (const slug of Object.keys(set.slugs)) {
        const rec = {};
        const ts = +set.slugs[slug] || 0;
        if (ts > 0) rec.ts = ts;
        if (ids[slug]) rec.id = String(ids[slug]);
        const m = meta[slug];
        if (m) {
          if (m.lang) rec.lang = m.lang;
          if (m.rt) rec.rt = m.rt;
          if (m.mem) rec.mem = m.mem;
        }
        out[slug] = rec;
      }
      return out;
    };

    const selfSet = allSets[username] || { slugs: {} };
    const slugs = buildRichMap(selfSet);

    // Push accreted friend observations; server unions contributions from many sensors,
    // and every entry is bounded by the target's public `userProblemsSolved`
    // count so a bad-faith sensor can't inflate a target's record.
    const friendList = (data.leetsquad_friends || []).filter(
      (f) => f && f.toLowerCase() !== username.toLowerCase()
    );
    const friendSets = {};
    for (const f of friendList) {
      const fmap = buildRichMap(allSets[f]);
      if (Object.keys(fmap).length > 0) friendSets[f] = fmap;
    }

    const r = await fetch(`${cloudBase()}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.leetsquad_cloud_sync_token}`,
      },
      body: JSON.stringify({
        slugs,
        friend_sets: friendSets,
        updated_at: Date.now(),
        schema_version: 2,
      }),
    });
    if (r.status === 401) {
      await chrome.storage.local.remove([
        'leetsquad_cloud_sync_token',
        'leetsquad_cloud_sync_token_exp',
      ]);
      await recordSyncError('upload', 'jwt_invalid');
      return { ok: false, error: 'jwt_invalid' };
    }
    if (r.ok) {
      await chrome.storage.local.set({ leetsquad_cloud_sync_last_at: Date.now() });
      await clearSyncError();
      return { ok: true };
    }
    let errBody = {};
    try { errBody = await r.json(); } catch (_) {}
    const code = errBody.error || `http_${r.status}`;
    await recordSyncError('upload', code);
    return { ok: false, error: code };
  } catch (e) {
    console.error('uploadMySolvedSetIfOptedIn:', e?.message || e);
    await recordSyncError('upload', 'network');
    return { ok: false, error: 'network' };
  }
}

async function recordSyncError(kind, code) {
  await chrome.storage.local.set({
    leetsquad_last_sync_error: { kind, code, at: Date.now() },
  });
}
async function clearSyncError() {
  await chrome.storage.local.remove('leetsquad_last_sync_error');
}

async function syncFriendsIfOptedIn() {
  try {
    const data = await chrome.storage.local.get([
      'leetsquad_cloud_sync_enabled',
      'leetsquad_cloud_sync_token',
      'leetsquad_cloud_sync_token_exp',
      'leetsquad_friends',
    ]);
    const enabled = data.leetsquad_cloud_sync_enabled !== false;
    if (!enabled || !data.leetsquad_cloud_sync_token) return { ok: true, skipped: true };
    if (Date.now() >= (data.leetsquad_cloud_sync_token_exp || 0)) return { ok: true, skipped: true };
    const friends = data.leetsquad_friends || [];

    const r = await fetch(`${cloudBase()}/friends`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.leetsquad_cloud_sync_token}`,
      },
      body: JSON.stringify({ friends }),
    });
    if (!r.ok) {
      let body = {};
      try { body = await r.json(); } catch (_) {}
      const code = body.error || `http_${r.status}`;
      await recordSyncError('friends', code);
      return { ok: false, error: code };
    }
    return { ok: true };
  } catch (e) {
    console.error('syncFriendsIfOptedIn:', e?.message || e);
    await recordSyncError('friends', 'network');
    return { ok: false, error: 'network' };
  }
}

async function syncDailyGoalsIfOptedIn() {
  try {
    const data = await chrome.storage.local.get([
      'leetsquad_cloud_sync_enabled',
      'leetsquad_cloud_sync_token',
      'leetsquad_cloud_sync_token_exp',
      'leetsquad_daily_goals',
    ]);
    const enabled = data.leetsquad_cloud_sync_enabled !== false;
    if (!enabled || !data.leetsquad_cloud_sync_token) return { ok: true, skipped: true };
    if (Date.now() >= (data.leetsquad_cloud_sync_token_exp || 0)) return { ok: true, skipped: true };

    const token = data.leetsquad_cloud_sync_token;
    const local = data.leetsquad_daily_goals || {};

    let remote = {};
    try {
      const r = await fetch(`${cloudBase()}/daily-goals`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (r.ok) {
        const body = await r.json();
        if (body && typeof body.goals === 'object') remote = body.goals;
      }
    } catch (_) {}

    const merged = { ...remote };
    for (const day of Object.keys(local)) {
      const a = local[day];
      const b = merged[day];
      if (!b) { merged[day] = a; continue; }
      const set = new Set([...(b.problems || []), ...(a.problems || [])]);
      const problems = Array.from(set);
      merged[day] = {
        target: Math.max(a.target || 0, b.target || 0),
        completed: Math.max(a.completed || 0, b.completed || 0, problems.length),
        problems
      };
    }

    await chrome.storage.local.set({ leetsquad_daily_goals: merged });

    const r2 = await fetch(`${cloudBase()}/daily-goals`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ goals: merged }),
    });
    if (!r2.ok) {
      let body = {};
      try { body = await r2.json(); } catch (_) {}
      const code = body.error || `http_${r2.status}`;
      await recordSyncError('daily_goals', code);
      return { ok: false, error: code };
    }
    return { ok: true };
  } catch (e) {
    console.error('syncDailyGoalsIfOptedIn:', e?.message || e);
    await recordSyncError('daily_goals', 'network');
    return { ok: false, error: 'network' };
  }
}

// Self-serve account + data deletion. JWT-authorized.
async function deleteMyData() {
  const data = await chrome.storage.local.get([
    'leetsquad_cloud_sync_token',
    'leetsquad_cloud_sync_token_exp',
  ]);
  const token = data.leetsquad_cloud_sync_token;
  const exp = data.leetsquad_cloud_sync_token_exp || 0;
  if (!token) return { ok: false, error: 'jwt_missing' };
  if (Date.now() >= exp) return { ok: false, error: 'jwt_expired' };

  let resp;
  try {
    resp = await fetch(`${cloudBase()}/api/v1/users/me`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
  } catch (e) {
    return { ok: false, error: 'network' };
  }
  if (resp.status === 401) {
    await chrome.storage.local.remove([
      'leetsquad_cloud_sync_token',
      'leetsquad_cloud_sync_token_exp',
    ]);
    return { ok: false, error: 'jwt_invalid' };
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    return { ok: false, error: body.error || `http_${resp.status}` };
  }
  return { ok: true };
}

// Rotate the user's /api/v1 API key. JWT-authorized.
async function rotateApiKey() {
  const data = await chrome.storage.local.get([
    'leetsquad_cloud_sync_token',
    'leetsquad_cloud_sync_token_exp',
  ]);
  const token = data.leetsquad_cloud_sync_token;
  const exp = data.leetsquad_cloud_sync_token_exp || 0;
  if (!token) return { ok: false, error: 'jwt_missing' };
  if (Date.now() >= exp) return { ok: false, error: 'jwt_expired' };

  let resp;
  try {
    resp = await fetch(`${cloudBase()}/api/v1/key/rotate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: '{}',
    });
  } catch (e) {
    return { ok: false, error: 'network' };
  }
  if (resp.status === 401) {
    await chrome.storage.local.remove([
      'leetsquad_cloud_sync_token',
      'leetsquad_cloud_sync_token_exp',
    ]);
    return { ok: false, error: 'jwt_invalid' };
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    return { ok: false, error: body.error || `http_${resp.status}` };
  }
  const body = await resp.json().catch(() => ({}));
  if (!body.api_key) return { ok: false, error: 'bad_response' };
  await chrome.storage.local.set({ leetsquad_cloud_sync_api_key: body.api_key });
  return { ok: true, api_key: body.api_key };
}


const RECOVERY_KEY = 'leetsquad_verify_recovery';

async function saveRecoverySnapshot(snapshot) {
  await chrome.storage.local.set({ [RECOVERY_KEY]: snapshot });
}
async function clearRecoverySnapshot() {
  await chrome.storage.local.remove(RECOVERY_KEY);
}
async function readRecoverySnapshot() {
  const d = await chrome.storage.local.get([RECOVERY_KEY]);
  return d[RECOVERY_KEY] || null;
}

async function stripNonceAndRestore(tabId, nonce, fallbackOriginal) {
  const recheck = await lcSkillsOp('read', null, tabId);
  if (recheck.error) {
    if (fallbackOriginal) await lcSkillsOp('write', fallbackOriginal, tabId);
    return { ok: false, error: recheck.error };
  }
  const stripped = (recheck.skillTags || []).filter((t) => t !== nonce);
  const wrote = await lcSkillsOp('write', stripped, tabId);
  if (wrote.error) return { ok: false, error: wrote.error };
  return { ok: true };
}

async function verifySkillsFlow({ nonce, expectedUsername }) {
  if (!nonce) return { ok: false, error: 'missing_nonce' };
  const { tabId, opened } = await findOrOpenLeetCodeTab();
  try {
    const read = await lcSkillsOp('read', null, tabId);
    if (read.error) return { ok: false, error: read.error };
    if (expectedUsername && read.username.toLowerCase() !== expectedUsername.toLowerCase()) {
      return { ok: false, error: 'wrong_signed_in_user', username: read.username };
    }

    const original = Array.isArray(read.skillTags) ? read.skillTags.slice() : [];
    await saveRecoverySnapshot({ original, nonce, username: read.username, savedAt: Date.now() });

    const withNonce = original.includes(nonce) ? original : [...original, nonce];
    const wrote = await lcSkillsOp('write', withNonce, tabId);
    if (wrote.error) {
      await clearRecoverySnapshot();
      return { ok: false, error: wrote.error };
    }

    let serverResp;
    try {
      const r = await fetch(`${cloudBase()}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lc_username: read.username }),
      });
      serverResp = await r.json().catch(() => ({}));
      if (!r.ok) {
        const restore = await stripNonceAndRestore(tabId, nonce, original);
        if (restore.ok) await clearRecoverySnapshot();
        return { ok: false, error: serverResp.error || `server_${r.status}` };
      }
    } catch (e) {
      const restore = await stripNonceAndRestore(tabId, nonce, original);
      if (restore.ok) await clearRecoverySnapshot();
      return { ok: false, error: 'server_unreachable' };
    }

    const restore = await stripNonceAndRestore(tabId, nonce, original);
    if (restore.ok) await clearRecoverySnapshot();

    return {
      ok: true,
      username: read.username,
      token: serverResp.token,
      expires_at: serverResp.expires_at,
      api_key: serverResp.api_key,
      api_key_prefix: serverResp.api_key_prefix,
      api_key_tier: serverResp.api_key_tier,
    };
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function recoverPendingVerification() {
  const snap = await readRecoverySnapshot();
  if (!snap || !snap.nonce) return { ok: true, recovered: false };
  const { tabId, opened } = await findOrOpenLeetCodeTab();
  try {
  const cur = await lcSkillsOp('read', null, tabId);
  if (cur.error) return { ok: false, error: cur.error };
  if (snap.username && cur.username.toLowerCase() !== snap.username.toLowerCase()) {
    return { ok: false, error: 'wrong_signed_in_user', username: cur.username };
  }
  if (!(cur.skillTags || []).includes(snap.nonce)) {
    await clearRecoverySnapshot();
    return { ok: true, recovered: false };
  }
  const stripped = cur.skillTags.filter((t) => t !== snap.nonce);
  const wrote = await lcSkillsOp('write', stripped, tabId);
  if (wrote.error) return { ok: false, error: wrote.error };
  await clearRecoverySnapshot();
  return { ok: true, recovered: true };
  } finally {
    if (opened) chrome.tabs.remove(tabId).catch(() => {});
  }
}

chrome.runtime.onStartup?.addListener(() => {
  recoverPendingVerification().catch((e) => console.error('recovery onStartup:', e?.message || e));
});

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'uploadMySolvedSet') {
    uploadMySolvedSetIfOptedIn().then((r) => sendResponse(r || { ok: true }));
    return true;
  }

  if (request.action === 'syncFriends') {
    syncFriendsIfOptedIn().then((r) => sendResponse(r || { ok: true }));
    return true;
  }

  if (request.action === 'syncDailyGoals') {
    syncDailyGoalsIfOptedIn().then((r) => sendResponse(r || { ok: true }));
    return true;
  }

  if (request.action === 'rotateApiKey') {
    rotateApiKey().then(sendResponse).catch((e) =>
      sendResponse({ ok: false, error: e?.message || 'flow_failed' })
    );
    return true;
  }

  if (request.action === 'deleteMyData') {
    deleteMyData().then(sendResponse).catch((e) =>
      sendResponse({ ok: false, error: e?.message || 'flow_failed' })
    );
    return true;
  }

  if (request.action === 'verifyBio') {
    verifySkillsFlow({ nonce: request.nonce, expectedUsername: request.expectedUsername })
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'flow_failed' }));
    return true;
  }

  if (request.action === 'recoverPendingVerification') {
    recoverPendingVerification()
      .then(r => sendResponse(r))
      .catch(e => sendResponse({ ok: false, error: e?.message || 'flow_failed' }));
    return true;
  }

  if (request.action === 'checkUpdates') {
    checkForNewSubmissions().then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.action === 'getUserData') {
    fetchUserProfile(request.username).then(data => sendResponse(data));
    return true;
  }

  if (request.action === 'problemSolved') {
    updateDailyGoal(request.problemSlug, request.difficulty).then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
});

// Update daily goal when problem is solved
async function updateDailyGoal(problemSlug, difficulty) {
  try {
    const data = await chrome.storage.local.get(['leetsquad_daily_goals']);
    const goals = data.leetsquad_daily_goals || {};
    const today = new Date().toISOString().split('T')[0];

    if (!goals[today]) {
      goals[today] = { target: 3, completed: 0, problems: [] };
    }

    if (!goals[today].problems.includes(problemSlug)) {
      goals[today].problems.push(problemSlug);
      goals[today].completed++;
      await chrome.storage.local.set({ leetsquad_daily_goals: goals });
    }
  } catch (error) {
    console.error('Error updating daily goal:', error);
  }
}

// Keyboard shortcut: toggle the widget on the active LeetCode tab.
// _execute_action is handled by Chrome automatically (opens the popup).
chrome.commands?.onCommand.addListener(async (command) => {
  if (command !== 'toggle-widget') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.includes('leetcode.com/problems/')) return;
    chrome.tabs.sendMessage(tab.id, { action: 'toggleWidget' });
  } catch (e) {
    console.error('toggle-widget shortcut failed:', e);
  }
});

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('leetsquad-')) {
    chrome.tabs.create({ url: 'https://leetcode.com/problemset/' });
  }
});
