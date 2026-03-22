// LeetSquad - Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const backBtn = document.getElementById('back-btn');

  // Friends panel elements
  const friendsBtn = document.getElementById('friends-btn');
  const friendsPanel = document.getElementById('friends-panel');
  const friendsBackBtn = document.getElementById('friends-back-btn');
  
  // Friends tab elements
  const myUsernameInput = document.getElementById('my-username');
  const saveMyUsernameBtn = document.getElementById('save-my-username');
  const friendUsernameInput = document.getElementById('friend-username');
  const addFriendBtn = document.getElementById('add-friend-btn');
  const friendsList = document.getElementById('friends-list');
  const friendsCount = document.getElementById('friends-count');
  
  // Leaderboard elements
  const leaderboardList = document.getElementById('leaderboard-list');
  const leaderboardTitle = document.getElementById('leaderboard-title');

  // Activity elements
  const activityFeed = document.getElementById('activity-feed');
  const activityFilterToggle = document.getElementById('activity-filter-toggle');
  const filterLabel = document.getElementById('filter-label');

  // Activity state
  let showFirstSolveOnly = false;

  // Daily goal elements
  const goalFill = document.getElementById('goal-fill');
  const goalText = document.getElementById('goal-text');
  const goalStreak = document.getElementById('goal-streak');
  
  // Settings elements
  const settingShowWidget = document.getElementById('setting-show-widget');
  const settingNotifications = document.getElementById('setting-notifications');
  const settingDebugMode = document.getElementById('setting-debug-mode');
  const settingDailyGoal = document.getElementById('setting-daily-goal');
  const clearCacheBtn = document.getElementById('clear-cache-btn');

  // Mutuals tab elements
  const mutualsFriendSelect = document.getElementById('mutuals-friend-select');
  const mutualsComparison = document.getElementById('mutuals-comparison');
  const mutualsEmpty = document.getElementById('mutuals-empty');
  const mutualsMeAvatar = document.getElementById('mutuals-me-avatar');
  const mutualsMeName = document.getElementById('mutuals-me-name');
  const mutualsMeStats = document.getElementById('mutuals-me-stats');
  const mutualsFriendAvatar = document.getElementById('mutuals-friend-avatar');
  const mutualsFriendName = document.getElementById('mutuals-friend-name');
  const mutualsFriendStats = document.getElementById('mutuals-friend-stats');
  const mutualsCommonCount = document.getElementById('mutuals-common-count');
  const mutualsCommonList = document.getElementById('mutuals-common-list');

  // Use shared utilities (loaded via popup.html script tag)
  const getAvatarGradient = LeetSquadUtils.getAvatarGradient;

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(tc => tc.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(`${tabId}-tab`).classList.add('active');
      
      // Load data for the tab
      if (tabId === 'leaderboard') loadLeaderboard();
      if (tabId === 'activity') loadActivity();
      if (tabId === 'mutuals') loadMutualsTab();
    });
  });

  // Settings panel toggle
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    loadSettings();
  });

  backBtn.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  // Friends panel toggle
  friendsBtn.addEventListener('click', () => {
    friendsPanel.classList.remove('hidden');
    loadFriends();
  });

  friendsBackBtn.addEventListener('click', () => {
    friendsPanel.classList.add('hidden');
  });

  // My username
  async function loadMyUsername() {
    const username = await StorageManager.getMyUsername();
    if (username) {
      myUsernameInput.value = username;
    }
  }

  saveMyUsernameBtn.addEventListener('click', async () => {
    const username = myUsernameInput.value.trim();
    if (username) {
      await StorageManager.setMyUsername(username);
      showToast('Username saved!');
      loadLeaderboard();
    }
  });

  // Add friend
  addFriendBtn.addEventListener('click', async () => {
    const username = friendUsernameInput.value.trim();
    if (!username) return;
    
    addFriendBtn.disabled = true;
    addFriendBtn.innerHTML = '<span class="spinner"></span>';
    
    try {
      // Verify user exists
      const profile = await LeetCodeAPI.getUserProfile(username);
      if (!profile || profile.errors) {
        showToast('User not found!', 'error');
        return;
      }
      
      await StorageManager.addFriend(username);
      friendUsernameInput.value = '';
      showToast(`Added ${username}!`);
      loadFriends();
      loadLeaderboard();
    } catch (error) {
      showToast('Error adding friend', 'error');
    } finally {
      addFriendBtn.disabled = false;
      addFriendBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      `;
    }
  });

  // Load friends list
  async function loadFriends() {
    const friends = await StorageManager.getFriends();
    friendsCount.textContent = friends.length;

    if (friends.length === 0) {
      friendsList.innerHTML = `
        <div class="empty-state">
          <p>No friends added yet</p>
          <span>Add friends to start competing!</span>
        </div>
      `;
      return;
    }

    friendsList.innerHTML = '<div class="loading">Loading friends...</div>';

    // Load sequentially to avoid rate limits
    const friendsData = [];
    for (const username of friends) {
      let cached = await StorageManager.getCachedData(username);
      const cacheValid = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt < 10 * 60 * 1000);

      if (!cacheValid) {
        cached = await LeetCodeAPI.getEssentialUserData(username);
        if (cached) await StorageManager.setCachedData(username, cached);
      }
      friendsData.push(cached);
    }

    friendsList.innerHTML = friendsData
      .filter(f => f)
      .map(friend => renderFriendCard(friend))
      .join('');

    // Add remove handlers
    document.querySelectorAll('.remove-friend').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const username = e.currentTarget.dataset.username;
        await StorageManager.removeFriend(username);
        loadFriends();
        loadLeaderboard();
        showToast(`Removed ${username}`);
      });
    });
  }

  function renderFriendCard(friend) {
    const { username, profile, solved } = friend;
    // Use solved endpoint data, fallback to profile
    const easy = solved?.easySolved ?? profile?.easySolved ?? 0;
    const medium = solved?.mediumSolved ?? profile?.mediumSolved ?? 0;
    const hard = solved?.hardSolved ?? profile?.hardSolved ?? 0;
    const avatar = profile?.avatar ?? null;
    const displayName = username || 'Unknown';
    const initial = (displayName && displayName[0]) ? displayName[0].toUpperCase() : 'U';

    return `
      <div class="friend-card">
        <div class="friend-avatar">
          ${avatar ?
            `<img src="${avatar}" alt="${displayName}"/>` :
            `<span>${initial}</span>`
          }
        </div>
        <div class="friend-details">
          <div class="friend-name">${displayName}</div>
          <div class="friend-stats-mini">
            <span class="stat-easy">E: ${easy}</span>
            <span class="stat-medium">M: ${medium}</span>
            <span class="stat-hard">H: ${hard}</span>
          </div>
        </div>
        <div class="friend-actions">
          <a href="https://leetcode.com/u/${displayName}" target="_blank" class="icon-btn" title="View profile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
          <button class="icon-btn remove-friend" data-username="${displayName}" title="Remove friend">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    `;
  }

  // Current period for leaderboard
  let currentPeriod = 'all';

  // Get timestamp for period start
  function getPeriodStartTimestamp(period) {
    const now = new Date();
    if (period === 'week') {
      return Math.floor((now.getTime() - 7 * 24 * 60 * 60 * 1000) / 1000);
    } else if (period === 'month') {
      return Math.floor((now.getTime() - 30 * 24 * 60 * 60 * 1000) / 1000);
    }
    return 0; // all time
  }

  // Count submissions in a time period
  function countSubmissionsInPeriod(submissions, periodStart) {
    if (!submissions?.submission) return { total: 0, easy: 0, medium: 0, hard: 0 };

    const accepted = submissions.submission.filter(s =>
      s.statusDisplay === 'Accepted' && s.timestamp >= periodStart
    );

    // Get unique problems solved in period
    const uniqueProblems = new Map();
    accepted.forEach(s => {
      if (!uniqueProblems.has(s.titleSlug)) {
        uniqueProblems.set(s.titleSlug, s.difficulty || 'Medium');
      }
    });

    let easy = 0, medium = 0, hard = 0;
    uniqueProblems.forEach(diff => {
      if (diff === 'Easy') easy++;
      else if (diff === 'Hard') hard++;
      else medium++;
    });

    return { total: uniqueProblems.size, easy, medium, hard };
  }

  // Load leaderboard
  async function loadLeaderboard(period = currentPeriod) {
    currentPeriod = period;
    leaderboardList.innerHTML = '<div class="loading">Loading leaderboard...</div>';

    const [friends, myUsername] = await Promise.all([
      StorageManager.getFriends(),
      StorageManager.getMyUsername()
    ]);

    const allUsers = myUsername ? [myUsername, ...friends.filter(f => f !== myUsername)] : friends;

    if (allUsers.length === 0) {
      leaderboardList.innerHTML = `
        <div class="empty-state">
          <p>No one in your squad yet</p>
          <span>Add friends to see the leaderboard!</span>
        </div>
      `;
      return;
    }

    // Load users sequentially to avoid rate limits
    const usersData = [];
    for (const username of allUsers) {
      try {
        let cached = await StorageManager.getCachedData(username);

        // Check if cache is still valid (less than 10 minutes old)
        const cacheValid = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt < 10 * 60 * 1000);

        // For period filtering, we need submissions data - check if we have it
        const needsSubmissions = period !== 'all';
        const hasSubmissions = cached?.submissions?.submission;

        if (!cacheValid || (needsSubmissions && !hasSubmissions)) {
          // Always get full data if we need submissions or cache is invalid
          cached = await LeetCodeAPI.getFullUserData(username);
          if (cached) await StorageManager.setCachedData(username, cached);
        }

        usersData.push({ username, data: cached });
      } catch (error) {
        console.error(`Error loading data for ${username}:`, error);
        usersData.push({ username, data: null });
      }
    }

    const periodStart = getPeriodStartTimestamp(period);

    // Calculate stats based on period
    const processedUsers = usersData
      .filter(u => u.data)
      .map(u => {
        if (period === 'all') {
          // Use all-time stats from /solved endpoint
          return {
            username: u.username,
            data: u.data,
            total: u.data.solved?.solvedProblem ?? 0,
            easy: u.data.solved?.easySolved ?? 0,
            medium: u.data.solved?.mediumSolved ?? 0,
            hard: u.data.solved?.hardSolved ?? 0
          };
        } else {
          // Calculate stats from submissions in period
          const stats = countSubmissionsInPeriod(u.data.submissions, periodStart);
          return {
            username: u.username,
            data: u.data,
            ...stats
          };
        }
      });

    // Sort by total solved (descending)
    const sorted = processedUsers.sort((a, b) => b.total - a.total);

    if (sorted.length === 0) {
      leaderboardList.innerHTML = `
        <div class="empty-state">
          <p>Failed to load user data</p>
          <span>Try clearing cache in settings</span>
        </div>
      `;
      return;
    }

    leaderboardList.innerHTML = sorted
      .map((user, index) => renderLeaderboardItem(user, index, myUsername))
      .join('');
  }

  // Period selector handlers
  const periodButtons = document.querySelectorAll('.period-btn');
  periodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      const headerTitle = document.querySelector('.leaderboard-header h2');

      // Update active state
      periodButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Update header text
      if (period === 'week') {
        headerTitle.textContent = 'Weekly Rankings';
      } else if (period === 'month') {
        headerTitle.textContent = 'Monthly Rankings';
      } else {
        headerTitle.textContent = 'All Time Rankings';
      }

      // Animate and reload with the period filter
      animateLeaderboardSort(period);
    });
  });

  // Store current leaderboard data for animations
  let currentLeaderboardData = [];

  // Animate leaderboard reordering
  async function animateLeaderboardSort(period) {
    const items = leaderboardList.querySelectorAll('.leaderboard-item');
    if (items.length === 0) {
      loadLeaderboard(period);
      return;
    }

    // Get current positions
    const oldPositions = new Map();
    items.forEach((item, index) => {
      const rect = item.getBoundingClientRect();
      oldPositions.set(item.dataset.username, { element: item, top: rect.top, index });
    });

    // Reload the data
    await loadLeaderboard(period);

    // Get new items and their positions
    const newItems = leaderboardList.querySelectorAll('.leaderboard-item');

    // Add animating class for transitions
    leaderboardList.classList.add('animating');

    newItems.forEach((newItem, newIndex) => {
      const username = newItem.dataset.username;
      const oldData = oldPositions.get(username);

      if (oldData) {
        const newRect = newItem.getBoundingClientRect();
        const deltaY = oldData.top - newRect.top;

        if (deltaY !== 0) {
          // Apply initial transform to start from old position
          newItem.style.transform = `translateY(${deltaY}px)`;
          newItem.style.opacity = '0.7';

          // Force reflow
          newItem.offsetHeight;

          // Animate to new position
          requestAnimationFrame(() => {
            newItem.style.transform = 'translateY(0)';
            newItem.style.opacity = '1';
          });
        }
      }
    });

    // Remove animating class after animation completes
    setTimeout(() => {
      leaderboardList.classList.remove('animating');
      newItems.forEach(item => {
        item.style.transform = '';
        item.style.opacity = '';
      });
    }, 900);
  }

  // Reset activity data when friends list changes
  function resetActivityData() {
    activityDataLoaded = false;
    allActivitySubmissions = [];
    activityDisplayCount = ACTIVITY_PAGE_SIZE;
  }

  function renderLeaderboardItem(user, index, myUsername) {
    const { username, data, total, easy, medium, hard } = user;
    const profile = data?.profile;
    const avatar = profile?.avatar ?? null;
    const globalRank = profile?.ranking ? parseInt(profile.ranking).toLocaleString() : null;
    const gradient = getAvatarGradient(username);
    const isMe = username === myUsername;

    let rankClass = '';
    let rankDisplay = index + 1;
    if (index === 0) { rankClass = 'gold'; rankDisplay = '🥇'; }
    else if (index === 1) { rankClass = 'silver'; rankDisplay = '🥈'; }
    else if (index === 2) { rankClass = 'bronze'; rankDisplay = '🥉'; }

    return `
      <div class="leaderboard-item ${index < 3 ? `top-${index + 1}` : ''} ${isMe ? 'is-me' : ''}" data-username="${username}">
        <div class="rank ${rankClass}">${rankDisplay}</div>
        <div class="lb-avatar">
          ${avatar ?
            `<img src="${avatar}" alt="${username}" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/>` :
            `<span style="background:${gradient};width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:6px;color:white;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${(username && username[0]) ? username[0].toUpperCase() : 'U'}</span>`
          }
        </div>
        <div class="lb-info">
          <div class="lb-name">
            <a href="https://leetcode.com/u/${username}" target="_blank" class="lb-name-link">${username}</a>${isMe ? ' <span class="you-tag">(You)</span>' : ''}
            ${globalRank ? `<span class="global-rank" title="Global LeetCode Rank">#${globalRank}</span>` : ''}
          </div>
          <div class="lb-breakdown">
            <span class="stat-easy">E: ${easy}</span>
            <span class="stat-medium">M: ${medium}</span>
            <span class="stat-hard">H: ${hard}</span>
          </div>
        </div>
        <div class="lb-total">
          <div class="lb-count">${total}</div>
          <div class="lb-label">Solved</div>
        </div>
      </div>
    `;
  }

  // Activity state
  const ACTIVITY_PAGE_SIZE = 10;
  let activityDisplayCount = ACTIVITY_PAGE_SIZE;
  let activityLoading = false;
  let allActivitySubmissions = [];
  let activityDataLoaded = false;

  // Load activity — fetches data once, then renders pages from the cached list
  async function loadActivity(showMore = false) {
    if (activityLoading) return;
    activityLoading = true;

    if (showMore) {
      activityDisplayCount += ACTIVITY_PAGE_SIZE;
    } else {
      activityDisplayCount = ACTIVITY_PAGE_SIZE;
    }

    // Only fetch from API on first load (not on "show more" or filter toggle)
    if (!activityDataLoaded) {
      activityFeed.innerHTML = '<div class="loading">Loading activity...</div>';

      const [friends, myUsername] = await Promise.all([
        StorageManager.getFriends(),
        StorageManager.getMyUsername()
      ]);

      const allUsers = myUsername ? [myUsername, ...friends] : friends;

      if (allUsers.length === 0) {
        activityFeed.innerHTML = `
          <div class="empty-state">
            <p>No activity yet</p>
            <span>Add friends to see their activity!</span>
          </div>
        `;
        activityLoading = false;
        return;
      }

      // Fetch submissions for all users (no percentile yet — fetched on demand)
      const allSubmissions = [];
      for (const username of allUsers) {
        let cached = await StorageManager.getCachedData(username);
        const avatar = cached?.profile?.avatar;

        let graphqlSubs = null;
        try {
          graphqlSubs = await LeetCodeAPI.getRecentAcSubmissionsWithBeats(username, 50);
        } catch (e) {
          console.log('GraphQL failed for', username, 'using fallback');
        }

        if (graphqlSubs && graphqlSubs.length > 0) {
          allSubmissions.push(...graphqlSubs.map(s => ({
            ...s,
            username,
            avatar,
            statusDisplay: 'Accepted'
          })));
        } else {
          let subs;
          if (cached?.submissions?.submission) {
            subs = cached.submissions;
          } else {
            subs = await LeetCodeAPI.getRecentSubmissions(username, 50);
          }
          const userSubs = (subs?.submission || []).filter(s => s.statusDisplay === 'Accepted')
            .map(s => ({ ...s, username, avatar }));
          allSubmissions.push(...userSubs);
        }
      }

      // Sort by time and mark first-time solves
      allActivitySubmissions = allSubmissions
        .filter(s => s.statusDisplay === 'Accepted')
        .sort((a, b) => b.timestamp - a.timestamp);

      const seenProblems = new Map();
      allActivitySubmissions.forEach(sub => {
        const key = `${sub.username}:${sub.titleSlug}`;
        if (!seenProblems.has(key) || sub.timestamp < seenProblems.get(key)) {
          seenProblems.set(key, sub.timestamp);
        }
      });

      allActivitySubmissions.forEach(sub => {
        const key = `${sub.username}:${sub.titleSlug}`;
        sub.isFirstSolve = sub.timestamp === seenProblems.get(key);
      });

      activityDataLoaded = true;
    }

    // Apply filter
    const filteredSubmissions = showFirstSolveOnly
      ? allActivitySubmissions.filter(s => s.isFirstSolve)
      : allActivitySubmissions;

    const visible = filteredSubmissions.slice(0, activityDisplayCount);

    if (visible.length === 0) {
      activityFeed.innerHTML = `
        <div class="empty-state">
          <p>${showFirstSolveOnly ? 'No first-time solves' : 'No recent activity'}</p>
          <span>${showFirstSolveOnly ? 'Try showing all activity' : 'Solve some problems!'}</span>
        </div>
      `;
      activityLoading = false;
      return;
    }

    activityFeed.innerHTML = visible
      .map(s => renderActivityItem(s))
      .join('');

    // Show "Load More" button if there are more items
    const remaining = filteredSubmissions.length - activityDisplayCount;
    if (remaining > 0) {
      activityFeed.innerHTML += `
        <button class="load-more-btn" id="load-more-activity">
          Show ${Math.min(remaining, ACTIVITY_PAGE_SIZE)} more
        </button>
      `;
      document.getElementById('load-more-activity').addEventListener('click', () => {
        loadActivity(true);
      });
    }

    // Fetch percentile on-demand for visible items that don't have it yet
    fetchPercentilesForVisible(visible);

    activityLoading = false;
  }

  // Fetch percentile data lazily for visible items (non-blocking)
  async function fetchPercentilesForVisible(items) {
    for (const sub of items) {
      if (sub.runtimePercentile != null || !sub.id) continue;
      try {
        const details = await LeetCodeAPI.getSubmissionDetails(sub.id);
        if (details) {
          sub.runtimePercentile = details.runtimePercentile;
          sub.memoryPercentile = details.memoryPercentile;
          // Update the badge in-place without re-rendering the whole list
          const el = activityFeed.querySelector(`.activity-item[data-sub-id="${sub.id}"] .percentile-slot`);
          if (el && details.runtimePercentile) {
            el.innerHTML = `<span class="percentile-badge" title="Beats ${details.runtimePercentile.toFixed(1)}% in runtime">🏆${details.runtimePercentile.toFixed(1)}%</span>`;
          }
        }
      } catch (e) {
        // Non-critical, skip
      }
    }
  }

  // Activity filter toggle handler — cycles: All → First Solves → All
  activityFilterToggle.addEventListener('click', () => {
    showFirstSolveOnly = !showFirstSolveOnly;
    activityFilterToggle.classList.toggle('active', showFirstSolveOnly);
    filterLabel.textContent = showFirstSolveOnly ? 'First Solves' : 'All Activity';
    activityFilterToggle.title = showFirstSolveOnly ? 'Showing first-time solves only' : 'Showing all activity';
    activityDisplayCount = ACTIVITY_PAGE_SIZE; // Reset to first page on filter change
    loadActivity(false);
  });

  function renderActivityItem(submission) {
    const { username, title, titleSlug, lang, timestamp, runtime, avatar, isFirstSolve, runtimePercentile, id } = submission;
    const timeAgo = formatTimeAgo(timestamp * 1000);
    const displayName = username || 'Unknown';
    const initial = (displayName && displayName[0]) ? displayName[0].toUpperCase() : 'U';
    const gradient = getAvatarGradient(displayName);

    const actionText = isFirstSolve ? 'solved' : 'submitted another solution for';

    // Show percentile if already fetched, otherwise leave a slot for lazy loading
    const percentileDisplay = runtimePercentile
      ? `<span class="percentile-badge" title="Beats ${runtimePercentile.toFixed(1)}% in runtime">🏆${runtimePercentile.toFixed(1)}%</span>`
      : '';

    const submissionLink = id
      ? `https://leetcode.com/submissions/detail/${id}/`
      : `https://leetcode.com/problems/${titleSlug}`;

    return `
      <div class="activity-item ${isFirstSolve ? 'first-solve' : 'additional-solve'}" data-sub-id="${id || ''}">
        <div class="activity-avatar">
          ${avatar ?
            `<img src="${avatar}" alt="${displayName}"/>` :
            `<span style="background:${gradient}">${initial}</span>`
          }
        </div>
        <div class="activity-content">
          <div class="activity-text">
            <strong>${displayName}</strong> ${actionText}
            <a href="${submissionLink}" target="_blank" class="problem-link">${title}</a>
            ${isFirstSolve ? '<span class="first-solve-badge">🎉</span>' : ''}
            <span class="percentile-slot">${percentileDisplay}</span>
            <span class="activity-meta">in ${formatLanguage(lang)}</span>
          </div>
          <div class="activity-time">${timeAgo}${runtime ? ` · ${runtime}` : ''}</div>
        </div>
      </div>
    `;
  }

  const formatTimeAgo = LeetSquadUtils.timeAgoMs;
  const formatLanguage = LeetSquadUtils.formatLanguage;

  // Load settings
  async function loadSettings() {
    const settings = await StorageManager.getSettings();
    settingShowWidget.checked = settings.showOnProblemPage;
    settingNotifications.checked = settings.notifications;
    settingDebugMode.checked = settings.debugMode || false;
    settingDailyGoal.value = settings.dailyTarget || 3;

    // Load username
    const username = await StorageManager.getMyUsername();
    if (username) {
      myUsernameInput.value = username;
    }
  }

  // Settings change handlers
  settingShowWidget.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ showOnProblemPage: e.target.checked });
  });

  settingNotifications.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ notifications: e.target.checked });
  });

  settingDebugMode.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ debugMode: e.target.checked });
    if (e.target.checked) {
      showToast('Debug mode enabled - check browser console');
    } else {
      showToast('Debug mode disabled');
    }
  });

  settingDailyGoal.addEventListener('change', async (e) => {
    await StorageManager.setDailyTarget(parseInt(e.target.value));
    updateDailyGoal();
  });

  clearCacheBtn.addEventListener('click', async () => {
    await StorageManager.clearCache();
    showToast('Cache cleared!');
    loadLeaderboard();
    loadFriends();
  });

  // Daily goal - fetch from LeetCode API in retrospect
  async function updateDailyGoal() {
    const myUsername = await StorageManager.getMyUsername();

    if (myUsername) {
      // Fetch today's submissions from LeetCode
      const submissions = await LeetCodeAPI.getRecentSubmissions(myUsername, 100);
      const today = new Date().toISOString().split('T')[0];
      const todayStart = new Date(today).getTime() / 1000;

      if (submissions && submissions.submission) {
        // Find accepted submissions from today
        const todayAccepted = submissions.submission.filter(s =>
          s.statusDisplay === 'Accepted' && s.timestamp >= todayStart
        );

        // Get unique problems solved today
        const uniqueProblems = [...new Set(todayAccepted.map(s => s.titleSlug))];

        // Update storage with actual count
        const goals = await StorageManager.get('leetsquad_daily_goals') || {};
        if (!goals[today]) {
          goals[today] = { target: 3, completed: 0, problems: [] };
        }
        goals[today].completed = uniqueProblems.length;
        goals[today].problems = uniqueProblems;
        await StorageManager.set('leetsquad_daily_goals', goals);
      }
    }

    const goal = await StorageManager.getDailyGoals();
    const percentage = Math.min((goal.completed / goal.target) * 100, 100);
    goalFill.style.width = `${percentage}%`;
    goalText.textContent = `${goal.completed}/${goal.target} today`;
    goalStreak.textContent = `🔥 ${goal.streak || 0} day streak`;
  }

  // Toast notification
  function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      background: ${type === 'error' ? '#e94560' : '#00b894'};
      color: white;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      z-index: 1000;
      animation: slideUp 0.3s ease;
    `;
    
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ===== MUTUALS TAB =====

  // Load mutuals tab (populate friend selector)
  async function loadMutualsTab() {
    const friends = await StorageManager.getFriends();
    const myUsername = await StorageManager.getMyUsername();

    // Clear and populate the select
    mutualsFriendSelect.innerHTML = '<option value="">Select a friend...</option>';

    if (friends.length === 0) {
      mutualsFriendSelect.innerHTML = '<option value="">No friends added yet</option>';
      mutualsFriendSelect.disabled = true;
      return;
    }

    mutualsFriendSelect.disabled = false;
    friends.forEach(friend => {
      const option = document.createElement('option');
      option.value = friend;
      option.textContent = friend;
      mutualsFriendSelect.appendChild(option);
    });

    // If no username set, show a message
    if (!myUsername) {
      mutualsEmpty.innerHTML = `
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
        <p>Set your username first</p>
        <span>Go to Settings to add your LeetCode username</span>
      `;
    }
  }

  // Friend select change handler
  mutualsFriendSelect.addEventListener('change', async () => {
    const selectedFriend = mutualsFriendSelect.value;
    if (!selectedFriend) {
      mutualsComparison.classList.add('hidden');
      mutualsEmpty.classList.remove('hidden');
      return;
    }

    await loadMutualsComparison(selectedFriend);
  });

  // Load comparison data
  async function loadMutualsComparison(friendUsername) {
    const myUsername = await StorageManager.getMyUsername();
    if (!myUsername) {
      showToast('Set your username in Settings first', 'error');
      return;
    }

    // Show comparison view, hide empty state
    mutualsComparison.classList.remove('hidden');
    mutualsEmpty.classList.add('hidden');

    // Show loading state in stats
    mutualsMeStats.innerHTML = '<div class="loading">Loading...</div>';
    mutualsFriendStats.innerHTML = '<div class="loading">Loading...</div>';
    mutualsCommonList.innerHTML = '<div class="loading">Finding common problems...</div>';

    // Load data for both users
    const [myData, friendData] = await Promise.all([
      loadUserData(myUsername),
      loadUserData(friendUsername)
    ]);

    // Render avatars and names
    renderMutualsUser(mutualsMeAvatar, mutualsMeName, myUsername, myData, 'You');
    renderMutualsUser(mutualsFriendAvatar, mutualsFriendName, friendUsername, friendData);

    // Render stats comparison
    renderMutualsStats(mutualsMeStats, myData, friendData);
    renderMutualsStats(mutualsFriendStats, friendData, myData);

    // Find and render common problems
    await loadCommonProblems(myUsername, friendUsername, myData, friendData);
  }

  // Load user data helper
  async function loadUserData(username) {
    let cached = await StorageManager.getCachedData(username);
    const cacheValid = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt < 10 * 60 * 1000);

    if (!cacheValid) {
      cached = await LeetCodeAPI.getFullUserData(username);
      if (cached) await StorageManager.setCachedData(username, cached);
    }

    return cached;
  }

  // Render user avatar and name in mutuals
  function renderMutualsUser(avatarEl, nameEl, username, data, displayOverride = null) {
    const avatar = data?.profile?.avatar;
    const gradient = getAvatarGradient(username);

    if (avatar) {
      avatarEl.innerHTML = `<img src="${avatar}" alt="${username}"/>`;
    } else {
      avatarEl.innerHTML = `<span style="background:${gradient};width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:12px">${username[0]?.toUpperCase() || 'U'}</span>`;
    }

    nameEl.textContent = displayOverride || username;
  }

  // Render stats grid for a user
  function renderMutualsStats(statsEl, userData, otherUserData) {
    const solved = userData?.solved || {};
    const otherSolved = otherUserData?.solved || {};
    const profile = userData?.profile || {};

    const total = solved.solvedProblem ?? 0;
    const easy = solved.easySolved ?? 0;
    const medium = solved.mediumSolved ?? 0;
    const hard = solved.hardSolved ?? 0;
    const ranking = profile.ranking ? parseInt(profile.ranking).toLocaleString() : 'N/A';

    const otherTotal = otherSolved.solvedProblem ?? 0;
    const otherEasy = otherSolved.easySolved ?? 0;
    const otherMedium = otherSolved.mediumSolved ?? 0;
    const otherHard = otherSolved.hardSolved ?? 0;

    // Determine winners for each category
    const totalClass = total > otherTotal ? 'win' : total < otherTotal ? 'loss' : '';
    const easyClass = easy > otherEasy ? 'win' : easy < otherEasy ? 'loss' : '';
    const mediumClass = medium > otherMedium ? 'win' : medium < otherMedium ? 'loss' : '';
    const hardClass = hard > otherHard ? 'win' : hard < otherHard ? 'loss' : '';

    statsEl.innerHTML = `
      <div class="mutuals-stat-row">
        <span class="mutuals-stat-label">Total</span>
        <span class="mutuals-stat-value ${totalClass}">${total}</span>
      </div>
      <div class="mutuals-stat-row">
        <span class="mutuals-stat-label">Easy</span>
        <span class="mutuals-stat-value easy ${easyClass}">${easy}</span>
      </div>
      <div class="mutuals-stat-row">
        <span class="mutuals-stat-label">Medium</span>
        <span class="mutuals-stat-value medium ${mediumClass}">${medium}</span>
      </div>
      <div class="mutuals-stat-row">
        <span class="mutuals-stat-label">Hard</span>
        <span class="mutuals-stat-value hard ${hardClass}">${hard}</span>
      </div>
      <div class="mutuals-stat-row">
        <span class="mutuals-stat-label">Rank</span>
        <span class="mutuals-stat-value">#${ranking}</span>
      </div>
    `;
  }

  // Load common problems between two users
  async function loadCommonProblems(myUsername, friendUsername, myData, friendData) {
    // Debug logging
    const settings = await StorageManager.getSettings();
    if (settings.debugMode) {
      console.log('[LeetSquad Debug] Mutuals comparison:', {
        myUsername,
        friendUsername,
        myDataKeys: myData ? Object.keys(myData) : null,
        friendDataKeys: friendData ? Object.keys(friendData) : null,
        mySolvedData: myData?.solved,
        friendSolvedData: friendData?.solved
      });
    }

    // Get solved problems lists - ensure they are arrays
    const mySolvedRaw = myData?.solved?.solvedProblem;
    const friendSolvedRaw = friendData?.solved?.solvedProblem;

    let mySolved = Array.isArray(mySolvedRaw) ? mySolvedRaw : [];
    let friendSolved = Array.isArray(friendSolvedRaw) ? friendSolvedRaw : [];

    if (settings.debugMode) {
      console.log('[LeetSquad Debug] Processed solved arrays:', {
        mySolvedCount: mySolved.length,
        friendSolvedCount: friendSolved.length,
        mySolvedSample: mySolved.slice(0, 3),
        friendSolvedSample: friendSolved.slice(0, 3)
      });
    }

    // Fallback: If solved endpoint doesn't return arrays, try using GraphQL submissions
    // NOTE: LeetCode's GraphQL API limits recentAcSubmissionList to ~20-50 problems max
    // So this will only show recent problems, not full history
    if (mySolved.length === 0 || friendSolved.length === 0) {
      if (settings.debugMode) {
        console.log('[LeetSquad Debug] Falling back to GraphQL submissions for solved problems');
        console.log('[LeetSquad Debug] Note: GraphQL only returns recent submissions (~20-50 max)');
      }
      try {
        const [mySubmissions, friendSubmissions] = await Promise.all([
          mySolved.length === 0 ? LeetCodeAPI.getRecentAcSubmissions(myUsername, 50) : Promise.resolve(null),
          friendSolved.length === 0 ? LeetCodeAPI.getRecentAcSubmissions(friendUsername, 50) : Promise.resolve(null)
        ]);

        if (mySubmissions && mySolved.length === 0) {
          mySolved = mySubmissions.map(s => ({
            titleSlug: s.titleSlug,
            title: s.title,
            difficulty: 'Medium' // GraphQL doesn't provide difficulty in this endpoint
          }));
        }

        if (friendSubmissions && friendSolved.length === 0) {
          friendSolved = friendSubmissions.map(s => ({
            titleSlug: s.titleSlug,
            title: s.title,
            difficulty: 'Medium'
          }));
        }

        if (settings.debugMode) {
          console.log('[LeetSquad Debug] After GraphQL fallback:', {
            mySolvedCount: mySolved.length,
            friendSolvedCount: friendSolved.length,
            note: 'Only recent submissions shown (LeetCode API limitation)'
          });
        }
      } catch (e) {
        if (settings.debugMode) {
          console.log('[LeetSquad Debug] GraphQL fallback failed:', e);
        }
      }
    }

    // Create a map of friend's solved problems
    const friendSolvedMap = new Map();
    friendSolved.forEach(p => {
      if (p && p.titleSlug) {
        friendSolvedMap.set(p.titleSlug, p);
      }
    });

    // Find common problems
    const commonProblems = [];
    mySolved.forEach(myProblem => {
      if (!myProblem || !myProblem.titleSlug) return;
      const friendProblem = friendSolvedMap.get(myProblem.titleSlug);
      if (friendProblem) {
        commonProblems.push({
          titleSlug: myProblem.titleSlug,
          title: myProblem.title || friendProblem.title,
          difficulty: myProblem.difficulty || friendProblem.difficulty || 'Medium',
          myData: myProblem,
          friendData: friendProblem
        });
      }
    });

    // Update count
    mutualsCommonCount.textContent = commonProblems.length;

    if (commonProblems.length === 0) {
      mutualsCommonList.innerHTML = `
        <div class="mutuals-no-common">
          <p>No common problems found</p>
          <span>Keep solving to find matches!</span>
        </div>
      `;
      return;
    }

    // Try to get runtime data for common problems via GraphQL
    let myRuntimeMap = new Map();
    let friendRuntimeMap = new Map();

    // Helper to parse runtime string to ms number (e.g., "99 ms" -> 99)
    const parseRuntime = (runtimeStr) => {
      if (!runtimeStr) return null;
      const match = runtimeStr.match(/(\d+)\s*ms/i);
      return match ? parseInt(match[1]) : null;
    };

    try {
      const [mySubmissions, friendSubmissions] = await Promise.all([
        LeetCodeAPI.getRecentAcSubmissions(myUsername, 200),
        LeetCodeAPI.getRecentAcSubmissions(friendUsername, 200)
      ]);

      if (mySubmissions) {
        mySubmissions.forEach(s => {
          if (!myRuntimeMap.has(s.titleSlug)) {
            myRuntimeMap.set(s.titleSlug, {
              runtime: s.runtime,
              runtimeMs: parseRuntime(s.runtime),
              lang: s.lang
            });
          }
        });
      }

      if (friendSubmissions) {
        friendSubmissions.forEach(s => {
          if (!friendRuntimeMap.has(s.titleSlug)) {
            friendRuntimeMap.set(s.titleSlug, {
              runtime: s.runtime,
              runtimeMs: parseRuntime(s.runtime),
              lang: s.lang
            });
          }
        });
      }
    } catch (e) {
      console.log('Could not fetch runtime data:', e);
    }

    // Sort by difficulty (Hard first), then alphabetically
    const diffOrder = { 'Hard': 0, 'Medium': 1, 'Easy': 2 };
    commonProblems.sort((a, b) => {
      const diffDiff = diffOrder[a.difficulty] - diffOrder[b.difficulty];
      if (diffDiff !== 0) return diffDiff;
      return (a.title || '').localeCompare(b.title || '');
    });

    // Render common problems (limit to first 50 for performance)
    const displayProblems = commonProblems.slice(0, 50);

    mutualsCommonList.innerHTML = displayProblems.map(problem => {
      const myData = myRuntimeMap.get(problem.titleSlug);
      const friendData = friendRuntimeMap.get(problem.titleSlug);

      const myRuntimeMs = myData?.runtimeMs;
      const friendRuntimeMs = friendData?.runtimeMs;

      // Determine winner (lower runtime = better)
      let myWinner = '', friendWinner = '';
      if (myRuntimeMs !== null && friendRuntimeMs !== null) {
        if (myRuntimeMs < friendRuntimeMs) {
          myWinner = 'winner';
        } else if (friendRuntimeMs < myRuntimeMs) {
          friendWinner = 'winner';
        }
      }

      return `
        <div class="mutuals-problem">
          <div class="mutuals-problem-info">
            <div class="mutuals-problem-title">
              <a href="https://leetcode.com/problems/${problem.titleSlug}" target="_blank">${problem.title || problem.titleSlug}</a>
            </div>
            <div class="mutuals-problem-meta">
              <span class="mutuals-problem-difficulty ${problem.difficulty?.toLowerCase()}">${problem.difficulty}</span>
            </div>
          </div>
          <div class="mutuals-problem-compare">
            <div class="mutuals-problem-stat ${myWinner}">
              <span class="mutuals-problem-stat-label">You</span>
              <span class="mutuals-problem-stat-value ${myData?.runtime ? 'runtime' : ''}">${myData?.runtime || '-'}</span>
            </div>
            <div class="mutuals-problem-stat ${friendWinner}">
              <span class="mutuals-problem-stat-label">Them</span>
              <span class="mutuals-problem-stat-value ${friendData?.runtime ? 'runtime' : ''}">${friendData?.runtime || '-'}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Add note if there are more
    if (commonProblems.length > 50) {
      mutualsCommonList.innerHTML += `
        <div class="mutuals-no-common">
          <span>+${commonProblems.length - 50} more common problems</span>
        </div>
      `;
    }
  }

  // Initialize
  await loadMyUsername();
  await loadLeaderboard();
  await updateDailyGoal();
});
