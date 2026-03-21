// Content script - Injects friend stats directly into LeetCode problem pages
(async function() {
  'use strict';

  // Display mode state
  let currentDisplayMode = 'floating'; // floating, compact, minimized, sidebar, hidden
  let isWidgetExpanded = false;

  // Get problem slug from URL
  function getProblemSlug() {
    const match = window.location.pathname.match(/\/problems\/([^/]+)/);
    return match ? match[1] : null;
  }

  // Use shared utilities (loaded via manifest content_scripts)
  const timeAgo = LeetSquadUtils.timeAgo;
  const formatLanguage = LeetSquadUtils.formatLanguage;
  const getAvatarGradient = LeetSquadUtils.getAvatarGradient;
  const escapeHtml = LeetSquadUtils.escapeHtml;

  // Create the squad widget
  function createSquadWidget(solvedCount = 0) {
    const widget = document.createElement('div');
    widget.id = 'leetsquad-widget';
    widget.innerHTML = `
      <div class="leetsquad-header">
        <div class="leetsquad-logo">
          <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor">
            <path d="M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1-7.37-4.89,8,8,0,0,1,0-6.22A8,8,0,0,1,192,112a24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.84,8,57,57,0,0,0-98.16,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM72,120a8,8,0,0,0-8-8A24,24,0,1,1,87.24,82a8,8,0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,1,0,12.8,9.61A51.6,51.6,0,0,1,64,128,8,8,0,0,0,72,120Z"/>
          </svg>
          <span>LeetSquad</span>
        </div>
      </div>
      ${solvedCount > 0 ? `<div class="mini-badge">${solvedCount}</div>` : ''}
      <div class="leetsquad-content">
        <div class="leetsquad-loading">
          <div class="leetsquad-spinner"></div>
        </div>
      </div>
      <button class="leetsquad-close" title="Close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    return widget;
  }

  // Render friend card (only for solved friends now)
  function renderFriendCard(friend, isMe = false, problemSlug = '') {
    const { username, submissions, profile, runtime, submissionId, runtimePercentile, memoryPercentile } = friend;
    const submission = submissions?.[0];
    const avatar = profile?.avatar ?? null;
    const gradient = getAvatarGradient(username);

    // Build the link to their specific submission (using submission ID if available)
    const subId = submissionId || submission?.id;
    const submissionLink = subId
      ? `https://leetcode.com/submissions/detail/${subId}/`
      : `https://leetcode.com/problems/${problemSlug}/submissions/?envType=recent-ac&envId=${problemSlug}`;

    // Build percentile display (show beats % if available)
    const percentileDisplay = runtimePercentile ?
      `<span class="percentile-tag" title="Beats ${runtimePercentile.toFixed(1)}% in runtime">🏆${runtimePercentile.toFixed(1)}%</span>` : '';

    return `
      <a href="${submissionLink}" target="_blank" class="leetsquad-friend solved ${isMe ? 'is-me' : ''}" title="View ${username}'s solution">
        <div class="friend-avatar">
          ${avatar ?
            `<img src="${avatar}" alt="${username}"/>` :
            `<div class="avatar-placeholder" style="background: ${gradient}">${username[0]?.toUpperCase() || 'U'}</div>`
          }
          <div class="solved-badge">✓</div>
        </div>
        <div class="friend-info">
          <div class="friend-name">
            <span class="friend-name-text">${username}</span>
            ${isMe ? '<span class="you-badge">You</span>' : ''}
            ${percentileDisplay}
          </div>
          <div class="friend-stats">
            ${submission ? `
              <span class="stat-item">${formatLanguage(submission.lang)}</span>
              <span class="stat-item">${submission.timestamp ? timeAgo(submission.timestamp) : ''}</span>
            ` : '<span class="stat-item">Solved</span>'}
          </div>
        </div>
        <div class="view-solution">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </div>
      </a>
    `;
  }

  // Render empty state
  function renderEmptyState() {
    return `
      <div class="leetsquad-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
        <p>No friends added yet</p>
        <span>Click the extension icon to add friends and start competing!</span>
      </div>
    `;
  }

  // Render "no one solved" state with manual check button
  function renderNoSolvedState(problemSlug) {
    return `
      <div class="leetsquad-empty-minimal">
        <span>No one solved yet</span>
        <button class="manual-check-btn" data-problem="${problemSlug}" title="Check again with deeper search">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          This is wrong!
        </button>
      </div>
    `;
  }

  // Update widget UI with solved users list
  function updateWidgetUI(widget, content, solvedUsers, myUsername, problemSlug) {
    // Update badge count
    const shouldShowBadge = solvedUsers.length > 1 ||
                            (solvedUsers.length === 1 && solvedUsers[0].username !== myUsername);
    const badge = widget.querySelector('.mini-badge');
    if (shouldShowBadge) {
      if (badge) {
        badge.textContent = solvedUsers.length;
        badge.style.display = '';
      } else {
        const newBadge = document.createElement('div');
        newBadge.className = 'mini-badge';
        newBadge.textContent = solvedUsers.length;
        widget.appendChild(newBadge);
      }
    } else if (badge) {
      badge.style.display = 'none';
    }

    if (solvedUsers.length === 0) {
      content.innerHTML = renderNoSolvedState(problemSlug);
      const manualCheckBtn = content.querySelector('.manual-check-btn');
      if (manualCheckBtn) {
        manualCheckBtn.addEventListener('click', () => handleManualCheck(problemSlug));
      }
    } else {
      content.innerHTML = `
        <div class="leetsquad-list">
          ${solvedUsers.map(friend =>
            renderFriendCard(friend, friend.username === myUsername, problemSlug)
          ).join('')}
        </div>
      `;
    }
  }

  // Handle manual check button click (deep search with more API calls)
  async function handleManualCheck(problemSlug) {
    const widget = document.getElementById('leetsquad-widget');
    const content = widget?.querySelector('.leetsquad-content');
    if (!content) return;

    content.innerHTML = `
      <div class="leetsquad-loading">
        <div class="leetsquad-spinner"></div>
        <span style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">Deep searching...</span>
      </div>
    `;

    try {
      // Clear memory cache to force fresh data
      LeetCodeAPI.clearMemoryCache();

      const [friends, myUsername] = await Promise.all([
        StorageManager.getFriends(),
        StorageManager.getMyUsername()
      ]);

      const allUsers = myUsername ? [myUsername, ...friends.filter(f => f !== myUsername)] : friends;

      // Batch check all users (fresh, no cache)
      const solvedMap = await LeetCodeAPI.batchCheckSolved(allUsers, problemSlug);

      // Get profiles for solved users
      const solvedUsernames = allUsers.filter(u => solvedMap[u]?.solved);
      const profiles = solvedUsernames.length > 0
        ? await LeetCodeAPI.batchGetUserProfiles(solvedUsernames)
        : {};

      const solvedUsers = solvedUsernames.map(username => {
        const sub = solvedMap[username].submission;
        return {
          username,
          profile: profiles[username] || null,
          submissions: sub ? [sub] : [],
          runtime: sub?.runtime,
          submissionId: sub?.id,
        };
      });

      updateWidgetUI(widget, content, solvedUsers, myUsername, problemSlug);

      if (solvedUsers.length === 0) {
        content.innerHTML = `
          <div class="leetsquad-empty-minimal">
            <span>Still no one found</span>
            <span style="font-size: 10px; color: var(--text-muted); margin-top: 4px;">Checked all methods</span>
          </div>
        `;
      }
    } catch (error) {
      console.error('Manual check error:', error);
      content.innerHTML = `
        <div class="leetsquad-error">
          <p>Check failed</p>
          <button class="retry-btn" onclick="window.location.reload()">Retry</button>
        </div>
      `;
    }
  }

  // Main function to load and display squad data.
  // Uses stale-while-revalidate: shows cached data immediately, then refreshes.
  async function loadSquadData() {
    const problemSlug = getProblemSlug();
    if (!problemSlug) return;

    const widget = document.getElementById('leetsquad-widget');
    const content = widget?.querySelector('.leetsquad-content');
    if (!content) return;

    try {
      if (!chrome || !chrome.storage) {
        console.error('LeetSquad: Extension context invalidated. Please reload the page.');
        content.innerHTML = `
          <div class="leetsquad-error">
            <p>Extension reloaded</p>
            <button class="retry-btn" onclick="window.location.reload()">Reload Page</button>
          </div>
        `;
        return;
      }

      const [friends, myUsername, settings] = await Promise.all([
        StorageManager.getFriends(),
        StorageManager.getMyUsername(),
        StorageManager.getSettings()
      ]);

      if (!settings.showOnProblemPage) {
        widget.style.display = 'none';
        return;
      }

      const allUsers = myUsername ? [myUsername, ...friends.filter(f => f !== myUsername)] : friends;

      if (allUsers.length === 0) {
        content.innerHTML = renderEmptyState();
        return;
      }

      // Step 1: Show stale cached results immediately (non-blocking)
      const staleShown = await showStaleResults(widget, content, allUsers, myUsername, problemSlug);

      // Step 2: Batch check all users for this problem (1 request per 5 users)
      // This is the network call — in-memory cache makes it instant after first load
      const solvedMap = await LeetCodeAPI.batchCheckSolved(allUsers, problemSlug);

      // Step 3: Get profiles for solved users (from cache or batch fetch)
      const solvedUsernames = allUsers.filter(u => solvedMap[u]?.solved);
      const profiles = solvedUsernames.length > 0
        ? await LeetCodeAPI.batchGetUserProfiles(solvedUsernames)
        : {};

      const solvedUsers = solvedUsernames.map(username => {
        const sub = solvedMap[username].submission;
        return {
          username,
          profile: profiles[username] || null,
          submissions: sub ? [sub] : [],
          runtime: sub?.runtime,
          submissionId: sub?.id,
        };
      });

      // Step 4: Update storage cache for future sessions
      for (const username of solvedUsernames) {
        if (profiles[username]) {
          const existing = await StorageManager.getCachedData(username);
          if (!existing || Date.now() - (existing.fetchedAt || 0) > 10 * 60 * 1000) {
            await StorageManager.setCachedData(username, {
              profile: profiles[username],
              fetchedAt: Date.now()
            });
          }
        }
      }

      // Step 5: Render final results
      updateWidgetUI(widget, content, solvedUsers, myUsername, problemSlug);

    } catch (error) {
      console.error('LeetSquad error:', error);
      // Don't show error if we already showed cached data
      if (!content.querySelector('.leetsquad-list')) {
        content.innerHTML = `
          <div class="leetsquad-error">
            <p>Failed to load squad data</p>
            <button class="retry-btn" onclick="window.location.reload()">Retry</button>
          </div>
        `;
      }
    }
  }

  // Show results from storage cache immediately (stale-while-revalidate)
  async function showStaleResults(widget, content, allUsers, myUsername, problemSlug) {
    try {
      const staleSolved = [];

      for (const username of allUsers) {
        const cached = await StorageManager.getCachedDataWithStale(username);
        if (!cached) continue;

        // Check if submissions in cache indicate this problem was solved
        const subs = cached.data?.submissions?.submission || [];
        const found = subs.find(s => s.titleSlug === problemSlug && s.statusDisplay === 'Accepted');

        if (found) {
          staleSolved.push({
            username,
            profile: cached.data?.profile || null,
            submissions: [found],
            submissionId: found.id,
          });
        }
      }

      if (staleSolved.length > 0) {
        updateWidgetUI(widget, content, staleSolved, myUsername, problemSlug);
        return true;
      }
    } catch (e) {
      // Stale cache check failed — no problem, fresh data will load
    }
    return false;
  }

  // Apply display mode to widget
  function applyDisplayMode(widget, mode) {
    // Remove all mode classes
    widget.classList.remove('mode-floating', 'mode-compact', 'mode-minimized', 'mode-sidebar', 'mode-hidden', 'expanded');

    // Always keep floating class for positioning
    widget.classList.add('floating');

    // Apply the specific mode class
    if (mode && mode !== 'floating') {
      widget.classList.add(`mode-${mode}`);
    }

    currentDisplayMode = mode || 'floating';
    isWidgetExpanded = false;
  }

  // Insert widget into page
  async function insertWidget() {
    // Check if widget already exists
    if (document.getElementById('leetsquad-widget')) return;

    // Check if extension context is still valid
    if (!chrome?.storage?.local) {
      console.log('LeetSquad: Extension context not available');
      return;
    }

    const widget = createSquadWidget();

    // Always use floating position at bottom-right for reliability
    widget.classList.add('floating');
    document.body.appendChild(widget);

    // Always use minimized (icon only) mode
    applyDisplayMode(widget, 'minimized');

    // Add toggle functionality
    const header = widget.querySelector('.leetsquad-header');
    const closeBtn = widget.querySelector('.leetsquad-close');

    // Close button to collapse back to icon
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      isWidgetExpanded = false;
      widget.classList.remove('expanded');
    });

    // Header/icon click to expand
    header?.addEventListener('click', (e) => {
      if (currentDisplayMode === 'minimized') {
        e.stopPropagation();
        isWidgetExpanded = !isWidgetExpanded;
        widget.classList.toggle('expanded', isWidgetExpanded);
      }
    });

    // Click outside to collapse in minimized mode
    const handleOutsideClick = (e) => {
      if (currentDisplayMode === 'minimized' && isWidgetExpanded) {
        if (!widget.contains(e.target)) {
          isWidgetExpanded = false;
          widget.classList.remove('expanded');
        }
      }
    };
    document.addEventListener('click', handleOutsideClick);

    // Load data
    loadSquadData();
  }

  // Track observers for cleanup
  let submissionObserver = null;
  let navigationObserver = null;

  // Disconnect all observers (cleanup)
  function disconnectObservers() {
    if (submissionObserver) {
      submissionObserver.disconnect();
      submissionObserver = null;
    }
    if (navigationObserver) {
      navigationObserver.disconnect();
      navigationObserver = null;
    }
  }

  // Monitor for successful submissions
  function monitorSubmissions() {
    if (submissionObserver) submissionObserver.disconnect();

    submissionObserver = new MutationObserver(() => {
      // Check if extension context is still valid
      if (!isExtensionContextValid()) {
        disconnectObservers();
        return;
      }

      // Check for success message
      const successElement = document.querySelector('[data-e2e-locator="submission-result"]');
      if (successElement && successElement.textContent.includes('Accepted')) {
        const problemSlug = getProblemSlug();
        if (problemSlug) {
          chrome.runtime.sendMessage({
            action: 'problemSolved',
            problemSlug: problemSlug,
            difficulty: 'medium'
          });
        }
      }
    });

    submissionObserver.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Check if extension context is valid
  function isExtensionContextValid() {
    try {
      return !!(chrome && chrome.storage && chrome.storage.local);
    } catch (e) {
      return false;
    }
  }

  // Initialize
  function init() {
    // Try to insert widget after a short delay to let page load
    const tryInsert = () => {
      // First check if extension context is still valid
      if (!isExtensionContextValid()) {
        console.log('LeetSquad: Extension context invalidated, skipping insert');
        return;
      }

      if (getProblemSlug()) {
        insertWidget();
      }
    };

    // Wait for DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryInsert);
    } else {
      // Small delay to ensure page has started rendering
      setTimeout(tryInsert, 100);
    }

    // Retry a few times in case page is slow (LeetCode is a heavy SPA)
    setTimeout(tryInsert, 800);
    setTimeout(tryInsert, 1500);
    setTimeout(tryInsert, 3000);

    // Start monitoring submissions
    monitorSubmissions();

    // Also watch for SPA navigation
    let lastUrl = location.href;
    if (navigationObserver) navigationObserver.disconnect();
    navigationObserver = new MutationObserver(() => {
      if (!isExtensionContextValid()) {
        disconnectObservers();
        return;
      }
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        // Remove old widget
        document.getElementById('leetsquad-widget')?.remove();
        // Reset state
        isWidgetExpanded = false;
        // Insert new widget after navigation with staggered retries
        setTimeout(tryInsert, 300);
        setTimeout(tryInsert, 800);
        setTimeout(tryInsert, 1500);
      }
    });

    // Only observe if body exists
    if (document.body) {
      navigationObserver.observe(document.body, { subtree: true, childList: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        navigationObserver.observe(document.body, { subtree: true, childList: true });
      });
    }
  }

  // Listen for storage changes to update widget in real-time
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;

    const widget = document.getElementById('leetsquad-widget');
    if (!widget) return;

    // Handle settings changes - show/hide widget
    if (changes.leetsquad_settings) {
      const newSettings = changes.leetsquad_settings.newValue;
      const oldSettings = changes.leetsquad_settings.oldValue || {};

      if (newSettings.showOnProblemPage !== oldSettings.showOnProblemPage) {
        widget.style.display = newSettings.showOnProblemPage ? '' : 'none';
      }
    }

    // Handle friends list changes - reload data
    if (changes.leetsquad_friends || changes.leetsquad_my_username) {
      // Clear memory cache so we fetch fresh data for new friend list
      LeetCodeAPI.clearMemoryCache();

      const content = widget.querySelector('.leetsquad-content');
      if (content) {
        content.innerHTML = `
          <div class="leetsquad-loading">
            <div class="leetsquad-spinner"></div>
          </div>
        `;
      }
      loadSquadData();
    }
  });

  init();
})();
