// LeetSquad - Background Service Worker

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';

// Retry config for background fetches
const BG_RETRY_CONFIG = {
  maxRetries: 2,
  retryDelay: 2000,
  timeout: 15000,
};

// Initialize alarms on install
chrome.runtime.onInstalled.addListener(() => {
  // Set up periodic checking (every 30 minutes)
  chrome.alarms.create('checkUpdates', { periodInMinutes: 30 });

  // Set up daily reset at midnight
  chrome.alarms.create('dailyReset', {
    when: getNextMidnight(),
    periodInMinutes: 24 * 60
  });

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

// Resilient GraphQL fetch with retry and timeout
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

// Check for new submissions from friends
async function checkForNewSubmissions() {
  try {
    const data = await chrome.storage.local.get(['leetsquad_friends', 'leetsquad_settings', 'leetsquad_last_check']);
    const friends = data.leetsquad_friends || [];
    const settings = data.leetsquad_settings || {};
    const lastCheck = data.leetsquad_last_check || 0;

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

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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

// Handle notification clicks
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('leetsquad-')) {
    chrome.tabs.create({ url: 'https://leetcode.com/problemset/' });
  }
});
