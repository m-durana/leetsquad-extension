// LeetSquad - Background Service Worker

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';
const LEETSQUAD_CLOUD_BASE = 'https://leetsquad.miro.build';

// Retry config for background fetches
const BG_RETRY_CONFIG = {
  maxRetries: 2,
  retryDelay: 2000,
  timeout: 15000,
};

// Initialize alarms on install
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create('checkUpdates', { periodInMinutes: 30 });
  chrome.alarms.create('dailyReset', {
    when: getNextMidnight(),
    periodInMinutes: 24 * 60
  });

  // Seed the solved-slug set immediately so first-run users see data
  // without waiting for the 30-minute alarm cycle.
  try {
    const data = await chrome.storage.local.get(['leetsquad_friends']);
    const friends = data.leetsquad_friends || [];
    if (friends.length > 0) {
      refreshSolvedSets(friends).catch(e => console.error('initial refresh:', e));
    }
  } catch (e) {}

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

// Resilient GraphQL fetch with retry and timeout.
// NOTE: This intentionally does NOT send an x-csrftoken header. The background
// service worker only issues public read-only queries (recentSubmissionList,
// matchedUser); LeetCode does not require CSRF for these. If you ever add an
// auth-gated query here, fetch the token via chrome.cookies.get and include it.
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

// Pull each friend's most recent accepted submissions and union into their
// cumulative solved-slug set. Over time this converges toward each active
// friend's full solved list, working around LeetCode's API capping
// recentAcSubmissionList at ~20 entries per query.
async function refreshSolvedSets(friends) {
  if (!friends || friends.length === 0) return;
  const query = `
    query getRecentAc($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        titleSlug
        timestamp
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
      for (const e of entries) {
        if (!e?.titleSlug) continue;
        const ts = +e.timestamp || 0;
        const prev = set.slugs[e.titleSlug] || 0;
        set.slugs[e.titleSlug] = ts > prev ? ts : prev;
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
}

// ===== Cloud sync: bio verification flow =====
// Runs in a leetcode.com tab so it has session cookies + CSRF. Reads current
// aboutMe, writes (aboutMe + nonce), calls back, restores aboutMe. The
// background orchestrates; the in-page function below is intentionally dumb.

function _lcBioFn(op, value) {
  return (async () => {
    const csrftoken = (document.cookie.split('; ').find(c => c.startsWith('csrftoken=')) || '').split('=')[1];
    if (!csrftoken) return { error: 'no_csrf' };
    const post = (query, variables) => fetch('https://leetcode.com/graphql/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'x-csrftoken': csrftoken },
      body: JSON.stringify({ query, variables }),
    }).then(r => r.json());

    if (op === 'read') {
      const me = await post('query { userStatus { isSignedIn username } }', {});
      const username = me?.data?.userStatus?.username;
      if (!me?.data?.userStatus?.isSignedIn || !username) return { error: 'not_signed_in' };
      const cur = await post(
        'query userPublicProfile($username: String!) { matchedUser(username: $username) { profile { aboutMe } } }',
        { username }
      );
      return { username, aboutMe: cur?.data?.matchedUser?.profile?.aboutMe || '' };
    }
    if (op === 'write') {
      const upd = await post(
        'mutation updateProfile($fieldName: String!, $value: String) { updateProfile(fieldName: $fieldName, value: $value) { ok error } }',
        { fieldName: 'about_me', value: value || '' }
      );
      const r = upd?.data?.updateProfile;
      if (!r?.ok) return { error: r?.error || 'update_failed' };
      return { ok: true };
    }
    return { error: 'unknown_op' };
  })();
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
    const selfSet = allSets[username] || { slugs: {} };
    const slugs = Object.keys(selfSet.slugs || {});

    // Also push everything we've accreted locally about our friends. Each
    // LeetSquad user is a sensor: they see ~20 most recent ACs per friend
    // per alarm cycle, so over time their `solved_sets[friend]` grows beyond
    // the API window. The server unions contributions from many sensors,
    // and every entry is bounded by the target's public `userProblemsSolved`
    // count so a bad-faith sensor can't inflate a target's record.
    const friendList = (data.leetsquad_friends || []).filter(
      (f) => f && f.toLowerCase() !== username.toLowerCase()
    );
    const friendSets = {};
    for (const f of friendList) {
      const fset = allSets[f];
      const fSlugs = fset?.slugs ? Object.keys(fset.slugs) : [];
      if (fSlugs.length > 0) friendSets[f] = fSlugs;
    }

    const r = await fetch(`${LEETSQUAD_CLOUD_BASE}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${data.leetsquad_cloud_sync_token}`,
      },
      body: JSON.stringify({
        slugs,
        friend_sets: friendSets,
        updated_at: Date.now(),
        schema_version: 1,
      }),
    });
    if (r.status === 401) {
      await chrome.storage.local.remove([
        'leetsquad_cloud_sync_token',
        'leetsquad_cloud_sync_token_exp',
      ]);
      return;
    }
    if (r.ok) {
      await chrome.storage.local.set({ leetsquad_cloud_sync_last_at: Date.now() });
    }
  } catch (e) {
    console.error('uploadMySolvedSetIfOptedIn:', e?.message || e);
  }
}

async function findOrOpenLeetCodeTab() {
  const existing = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  if (existing.length > 0) {
    return { tabId: existing[0].id, opened: false };
  }
  const tab = await chrome.tabs.create({ url: 'https://leetcode.com/', active: false });
  await new Promise((resolve) => {
    const listener = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 15000);
  });
  return { tabId: tab.id, opened: true };
}

async function runBioOp(tabId, op, value) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: _lcBioFn,
    args: [op, value ?? null],
    world: 'MAIN',
  });
  return result || { error: 'no_result' };
}

async function verifyBioFlow({ nonce, expectedUsername }) {
  if (!nonce) return { ok: false, error: 'missing_nonce' };
  const { tabId, opened } = await findOrOpenLeetCodeTab();
  try {
    const read = await runBioOp(tabId, 'read');
    if (read.error) return { ok: false, error: read.error };
    if (expectedUsername && read.username.toLowerCase() !== expectedUsername.toLowerCase()) {
      return { ok: false, error: 'wrong_signed_in_user', username: read.username };
    }

    const original = read.aboutMe || '';
    const withNonce = original ? `${original}\n\n${nonce}` : nonce;
    const wrote = await runBioOp(tabId, 'write', withNonce);
    if (wrote.error) return { ok: false, error: wrote.error };

    let serverResp;
    try {
      const r = await fetch(`${LEETSQUAD_CLOUD_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lc_username: read.username }),
      });
      serverResp = await r.json().catch(() => ({}));
      if (!r.ok) {
        await runBioOp(tabId, 'write', original);
        return { ok: false, error: serverResp.error || `server_${r.status}` };
      }
    } catch (e) {
      await runBioOp(tabId, 'write', original);
      return { ok: false, error: 'server_unreachable' };
    }

    await runBioOp(tabId, 'write', original);

    // Trigger an initial cloud sync upload now that the token is available.
    // Popup persists the token first; this runs on its own message.
    return {
      ok: true,
      username: read.username,
      token: serverResp.token,
      expires_at: serverResp.expires_at,
    };
  } finally {
    if (opened) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'uploadMySolvedSet') {
    uploadMySolvedSetIfOptedIn().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (request.action === 'verifyBio') {
    verifyBioFlow({ nonce: request.nonce, expectedUsername: request.expectedUsername })
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
