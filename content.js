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
    const iconUrl = browser.runtime.getURL('icons/logo.png');
    widget.innerHTML = `
      <div class="leetsquad-header">
        <div class="leetsquad-logo">
          <img src="${iconUrl}" alt="LeetSquad" class="logo-img">
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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

    const subId = submissionId || submission?.id;
    const submissionLink = subId
      ? `https://leetcode.com/submissions/detail/${encodeURIComponent(subId)}/`
      : `https://leetcode.com/problems/${encodeURIComponent(problemSlug)}/submissions/?envType=recent-ac&envId=${encodeURIComponent(problemSlug)}`;

    const safeName = escapeHtml(username || '');
    const safeAvatar = escapeHtml(LeetSquadUtils.safeAvatarUrl(avatar));
    const initial = escapeHtml(username?.[0]?.toUpperCase() || 'U');
    const safeLang = submission ? escapeHtml(formatLanguage(submission.lang)) : '';
    const safeRuntime = runtime ? escapeHtml(String(runtime)) : '';

    const percentileDisplay = runtimePercentile
      ? (() => { const pct = runtimePercentile.toFixed(1); return `<span class="percentile-tag" title="Beats ${pct}% in runtime">🏆${pct}%</span>`; })()
      : '';

    return `
      <a href="${submissionLink}" target="_blank" class="leetsquad-friend solved ${isMe ? 'is-me' : ''}" title="View ${safeName}'s solution">
        <div class="friend-avatar">
          ${safeAvatar ?
            `<img src="${safeAvatar}" alt="${safeName}"/>` :
            `<div class="avatar-placeholder" style="background: ${gradient}">${initial}</div>`
          }
          <div class="solved-badge">✓</div>
        </div>
        <div class="friend-info">
          <div class="friend-name">
            <span class="friend-name-text">${safeName}</span>
            ${isMe ? '<span class="you-badge">You</span>' : ''}
            ${percentileDisplay}
          </div>
          <div class="friend-stats">
            ${submission ? `
              <span class="stat-item">${safeLang}</span>
              <span class="stat-item">${submission.timestamp ? timeAgo(submission.timestamp) : ''}</span>
              ${runtime ? `<span class="runtime-tag">${safeRuntime}</span>` : ''}
            ` : '<span class="stat-item">Solved</span>'}
          </div>
        </div>
        <div class="view-solution">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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

  // LeetCode caps recent ACs at ~20 per friend; older solves only appear after the alarm accretes them.
  function renderNoSolvedState(problemSlug) {
    return `
      <div class="leetsquad-empty-minimal">
        <span>No recent solves from your squad</span>
        <span class="leetsquad-empty-hint">
          We only see each friend's last ~20 LeetCode submissions.
          Older solves appear as the cache grows in the background.
        </span>
        <button class="manual-check-btn" data-problem="${escapeHtml(problemSlug)}" title="Pull fresh data from LeetCode now">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh now
        </button>
      </div>
    `;
  }

  // Update widget UI with solved users list
  async function updateWidgetUI(widget, content, solvedUsers, myUsername, problemSlug) {
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
      await renderCacheFreshness(content, solvedUsers);
      const manualCheckBtn = content.querySelector('.manual-check-btn');
      if (manualCheckBtn) {
        manualCheckBtn.addEventListener('click', (e) => {
          // stopPropagation: handleManualCheck rewrites innerHTML synchronously, detaching this button before the outside-click handler could collapse the widget.
          e.preventDefault();
          e.stopPropagation();
          handleManualCheck(problemSlug);
        });
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

    syncExpandedHeight(widget);
  }

  // Appends a "N known solves across your squad, refreshed Xm ago" line so the growing cache is visible.
  async function renderCacheFreshness(content) {
    try {
      const friends = await StorageManager.getFriends();
      const myUsername = await StorageManager.getMyUsername();
      const allUsers = myUsername ? [myUsername, ...friends.filter(f => f !== myUsername)] : friends;
      if (allUsers.length === 0) return;

      let totalSlugs = 0;
      let mostRecent = 0;
      for (const u of allUsers) {
        const set = await StorageManager.getSolvedSet(u);
        totalSlugs += Object.keys(set.slugs).length;
        if (set.lastRefreshed > mostRecent) mostRecent = set.lastRefreshed;
      }
      if (totalSlugs === 0) return;

      const minutes = mostRecent ? Math.floor((Date.now() - mostRecent) / 60000) : null;
      const freshness = minutes === null ? 'never refreshed'
        : minutes < 1 ? 'just now'
        : minutes < 60 ? `${minutes}m ago`
        : `${Math.floor(minutes / 60)}h ago`;

      const note = document.createElement('div');
      note.className = 'leetsquad-cache-freshness';
      note.textContent = `${totalSlugs} known solves across your squad · refreshed ${freshness}`;
      content.appendChild(note);
    } catch (e) {}
  }

  async function handleManualCheck(problemSlug) {
    const widget = document.getElementById('leetsquad-widget');
    const content = widget?.querySelector('.leetsquad-content');
    if (!content) return;

    content.innerHTML = `
      <div class="leetsquad-loading">
        <div class="leetsquad-spinner"></div>
        <span style="margin-top: 8px; font-size: 11px; color: var(--text-muted);">Refreshing...</span>
      </div>
    `;
    syncExpandedHeight(widget);
    LeetSquadUtils.armSlowHint(content);

    try {
      LeetCodeAPI.clearMemoryCache();

      const [friends, myUsername] = await Promise.all([
        StorageManager.getFriends(),
        StorageManager.getMyUsername()
      ]);

      const allUsers = myUsername ? [myUsername, ...friends.filter(f => f !== myUsername)] : friends;

      // Fresh batch of recent ACs for everyone; merge each into their slug set.
      const acByUser = await LeetCodeAPI.batchGetRecentAcSubmissions(allUsers, 20);
      await Promise.all(allUsers.map(async (u) => {
        const subs = acByUser[u] || [];
        if (subs.length === 0) return;
        await StorageManager.mergeSolvedSlugs(
          u,
          subs.map(s => ({
            titleSlug: s.titleSlug,
            timestamp: s.timestamp,
            id: s.id,
            lang: s.lang,
            rt: s.runtime,
            mem: s.memory,
          }))
        );
      }));

      // Combine: anyone with this slug in their (now-refreshed) set is solved.
      const solvedFromSet = await Promise.all(allUsers.map(async (u) => {
        const ts = await StorageManager.getSolvedSlugTimestamp(u, problemSlug);
        return ts ? u : null;
      }));
      const solvedUsernames = solvedFromSet.filter(Boolean);

      const profiles = solvedUsernames.length > 0
        ? await LeetCodeAPI.batchGetUserProfiles(solvedUsernames)
        : {};

      const solvedUsers = solvedUsernames.map((username) => {
        const sub = (acByUser[username] || []).find(s => s.titleSlug === problemSlug);
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
            <span>Still no recent solves</span>
            <span class="leetsquad-empty-hint">The cache will keep growing in the background. Older solves appear here as friends continue using LeetCode.</span>
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

  // Load and display squad data; stale-while-revalidate (show cache, then refresh).
  async function loadSquadData() {
    const problemSlug = getProblemSlug();
    if (!problemSlug) return;

    const widget = document.getElementById('leetsquad-widget');
    const content = widget?.querySelector('.leetsquad-content');
    if (!content) return;

    try {
      if (!browser || !browser.storage) {
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

      // Merge cloud-published solved sets so old solves appear instantly; best-effort, silent on failure.
      if (typeof CloudSync !== 'undefined') {
        await Promise.all(allUsers.map(u => CloudSync.fetchAndMergeFriend(u).catch(() => null)));
      }

      // Cached slug-set is an instant yes; presence counts, ts may be 0 for cloud-synced slugs.
      const slugSetResults = await Promise.all(allUsers.map(async (u) => {
        const inSet = await StorageManager.hasSolvedSlug(u, problemSlug);
        const ts = await StorageManager.getSolvedSlugTimestamp(u, problemSlug);
        const id = await StorageManager.getSubmissionId(u, problemSlug);
        return { username: u, inSet, cachedTimestamp: ts, cachedSubmissionId: id };
      }));
      const cachedSolvedMap = new Map(
        slugSetResults.filter(r => r.inSet).map(r => [r.username, r])
      );

      const [solvedMap, profiles] = await Promise.all([
        LeetCodeAPI.batchCheckSolved(allUsers, problemSlug),
        LeetCodeAPI.batchGetUserProfiles(allUsers).catch(() => ({})),
      ]);

      // Merge API discoveries into the slug set so future loads are instant (the accretion loop).
      await Promise.all(allUsers.map(async (u) => {
        const sub = solvedMap[u]?.submission;
        if (sub?.titleSlug && sub?.timestamp) {
          await StorageManager.mergeSolvedSlugs(u, [{
            titleSlug: sub.titleSlug,
            timestamp: sub.timestamp,
            id: sub.id,
            lang: sub.lang,
            rt: sub.runtime,
            mem: sub.memory,
          }]);
        }
      }));

      const solvedUsernames = allUsers.filter(u => solvedMap[u]?.solved || cachedSolvedMap.has(u));

      const solvedUsers = await Promise.all(solvedUsernames.map(async (username) => {
        const sub = solvedMap[username]?.submission;
        const cached = cachedSolvedMap.get(username);
        const fallbackSub = !sub && cached
          ? { titleSlug: problemSlug, timestamp: cached.cachedTimestamp, id: cached.cachedSubmissionId || undefined }
          : null;
        const effective = sub || fallbackSub;
        const result = {
          username,
          profile: profiles[username] || null,
          submissions: effective ? [effective] : [],
          runtime: sub?.runtime || null,
          submissionId: sub?.id || cached?.cachedSubmissionId || undefined,
          runtimePercentile: null,
        };

        // Fetch percentile details if we have a submission ID
        if (sub?.id) {
          try {
            const details = await LeetCodeAPI.getSubmissionDetails(sub.id);
            if (details) {
              result.runtimePercentile = details.runtimePercentile;
              result.runtime = details.runtimeDisplay || sub.runtime;
            }
          } catch (e) {
            // Continue without percentile (non-critical)
          }
        }

        return result;
      }));

      // Persist cache for every fetched profile, not just solvers, so the popup stays warm.
      for (const username of allUsers) {
        if (profiles[username]) {
          const existing = await StorageManager.getCachedData(username)
            || (await StorageManager.getCachedDataWithStale(username))?.data;
          if (!existing || Date.now() - (existing.fetchedAt || 0) > LeetSquadUtils.CACHE_TTL_MS) {
            await StorageManager.setCachedData(username, {
              ...(existing || {}),
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
      const seen = new Set();

      for (const username of allUsers) {
        const cached = await StorageManager.getCachedDataWithStale(username);
        const subs = cached?.data?.submissions?.submission || [];
        const found = subs.find(s => s.titleSlug === problemSlug && s.statusDisplay === 'Accepted');

        if (found) {
          staleSolved.push({
            username,
            profile: cached.data?.profile || null,
            submissions: [found],
            submissionId: found.id,
          });
          seen.add(username);
          continue;
        }

        const ts = await StorageManager.getSolvedSlugTimestamp(username, problemSlug);
        if (ts) {
          const id = await StorageManager.getSubmissionId(username, problemSlug);
          staleSolved.push({
            username,
            profile: cached?.data?.profile || null,
            submissions: [{ titleSlug: problemSlug, timestamp: ts, id: id || undefined }],
            submissionId: id || undefined,
          });
          seen.add(username);
        }
      }

      if (staleSolved.length > 0) {
        updateWidgetUI(widget, content, staleSolved, myUsername, problemSlug);
        return true;
      }
    } catch (e) {}
    return false;
  }

  // Read LeetCode's current theme; prefer explicit signals, fall back to background luminance.
  function detectPageTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) return 'dark';
    if (html.classList.contains('light')) return 'light';
    const dt = html.getAttribute('data-theme') || html.getAttribute('data-color-mode');
    if (dt === 'dark') return 'dark';
    if (dt === 'light') return 'light';
    try {
      const bg = getComputedStyle(document.body).backgroundColor;
      const m = bg.match(/\d+/g);
      if (m && m.length >= 3) {
        const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
        return lum < 128 ? 'dark' : 'light';
      }
    } catch (e) {}
    return 'dark';
  }

  let themeObserver = null;
  function watchPageTheme(widget) {
    const apply = () => widget.setAttribute('data-ls-theme', detectPageTheme());
    apply();
    try {
      themeObserver = new MutationObserver(apply);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-color-mode'],
      });
    } catch (e) {}
  }

  // Apply display mode to widget
  function applyDisplayMode(widget, mode) {
    // Remove all mode classes
    widget.classList.remove('mode-minimized', 'expanded');

    // Always keep floating class for positioning
    widget.classList.add('floating');

    // Apply the specific mode class
    if (mode && mode !== 'floating') {
      widget.classList.add(`mode-${mode}`);
    }

    currentDisplayMode = mode || 'floating';
    isWidgetExpanded = false;
  }

  // CSS can't animate height:auto, so measure header + clamped content and pin px.
  const EXPANDED_CONTENT_MAX = 440;
  function naturalExpandedHeight(widget) {
    const header = widget.querySelector('.leetsquad-header');
    const content = widget.querySelector('.leetsquad-content');
    const headerH = header ? header.offsetHeight : 0;
    const contentH = content ? Math.min(content.scrollHeight, EXPANDED_CONTENT_MAX) : 0;
    return headerH + contentH;
  }

  function onHeightSettled(widget, cb) {
    widget.addEventListener('transitionend', function done(e) {
      if (e.propertyName !== 'height') return;
      widget.removeEventListener('transitionend', done);
      cb();
    });
  }

  function expandWidget(widget) {
    isWidgetExpanded = true;
    widget.classList.add('expanded', 'ls-animating');
    const target = naturalExpandedHeight(widget);
    widget.style.height = '48px';
    void widget.offsetHeight; // commit start height before animating
    widget.style.height = target + 'px';
    onHeightSettled(widget, () => {
      if (isWidgetExpanded) widget.classList.remove('ls-animating');
    });
  }

  function collapseWidget(widget) {
    isWidgetExpanded = false;
    widget.classList.add('ls-animating');
    widget.style.height = widget.getBoundingClientRect().height + 'px';
    void widget.offsetHeight;
    widget.classList.remove('expanded');
    widget.style.height = '48px';
    onHeightSettled(widget, () => {
      if (!isWidgetExpanded) {
        widget.style.height = '';
        widget.classList.remove('ls-animating');
      }
    });
  }

  function syncExpandedHeight(widget) {
    if (!isWidgetExpanded) return;
    widget.style.height = naturalExpandedHeight(widget) + 'px';
  }

  // Insert widget into page
  async function insertWidget() {
    // Check if widget already exists
    if (document.getElementById('leetsquad-widget')) return;

    // Check if extension context is still valid
    if (!browser?.storage?.local) {
      console.log('LeetSquad: Extension context not available');
      return;
    }

    const widget = createSquadWidget();

    // Always use floating position at bottom-right for reliability
    widget.classList.add('floating');
    document.body.appendChild(widget);

    // Always use minimized (icon only) mode
    applyDisplayMode(widget, 'minimized');

    // Mirror LeetCode's light/dark theme onto the widget.
    watchPageTheme(widget);

    // Keep the open card fitted as content swaps in asynchronously.
    const contentEl = widget.querySelector('.leetsquad-content');
    if (contentEl && 'ResizeObserver' in window) {
      contentResizeObserver = new ResizeObserver(() => {
        if (isWidgetExpanded) widget.style.height = naturalExpandedHeight(widget) + 'px';
      });
      contentResizeObserver.observe(contentEl);
    }

    // Add toggle functionality
    const header = widget.querySelector('.leetsquad-header');
    const closeBtn = widget.querySelector('.leetsquad-close');

    // Close button to collapse back to icon
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      collapseWidget(widget);
    });

    // Header/icon click to expand
    header?.addEventListener('click', (e) => {
      if (currentDisplayMode === 'minimized') {
        e.stopPropagation();
        if (isWidgetExpanded) collapseWidget(widget);
        else expandWidget(widget);
      }
    });

    // Click-outside to collapse (minimized mode); remove any prior handler so SPA navs don't stack listeners.
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
    }
    outsideClickHandler = (e) => {
      if (currentDisplayMode === 'minimized' && isWidgetExpanded) {
        if (!widget.contains(e.target)) {
          collapseWidget(widget);
        }
      }
    };
    document.addEventListener('click', outsideClickHandler);

    // If loading takes more than ~2.5s, drop a hint about rate-limit backoff.
    const widgetContent = widget.querySelector('.leetsquad-content');
    if (widgetContent) LeetSquadUtils.armSlowHint(widgetContent);

    loadSquadData();
  }

  // Track observers + handlers for cleanup
  let submissionObserver = null;
  let navigationObserver = null;
  let contentResizeObserver = null;
  let outsideClickHandler = null;

  // Disconnect all observers and handlers (cleanup)
  function disconnectObservers() {
    if (submissionObserver) {
      submissionObserver.disconnect();
      submissionObserver = null;
    }
    if (navigationObserver) {
      navigationObserver.disconnect();
      navigationObserver = null;
    }
    if (contentResizeObserver) {
      contentResizeObserver.disconnect();
      contentResizeObserver = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = null;
    }
    if (themeObserver) {
      themeObserver.disconnect();
      themeObserver = null;
    }
  }

  // Watch for successful submissions; scope the observer narrower than <body>, falling back to body if layout changes.
  let lastReportedSlug = null;

  // Single report path for both signals (MAIN-world interceptor + DOM fallback); debounced per slug per page load, own submissions only.
  async function reportSolved(problemSlug, rich) {
    if (!problemSlug) return;
    const key = `${problemSlug}:${location.href}`;
    if (lastReportedSlug === key) return;
    lastReportedSlug = key;

    browser.runtime.sendMessage({
      action: 'problemSolved',
      problemSlug: problemSlug,
      difficulty: detectProblemDifficulty()
    });

    // Merge our own submission's {id,lang,rt,mem,ts} into our solved set immediately, before the next alarm.
    if (rich && (rich.id || rich.lang || rich.runtime || rich.memory)) {
      try {
        const myUsername = await StorageManager.getMyUsername();
        if (myUsername) {
          await StorageManager.mergeSolvedSlugs(myUsername, [{
            titleSlug: problemSlug,
            timestamp: rich.timestamp || Math.floor(Date.now() / 1000),
            id: rich.id || undefined,
            lang: rich.lang || undefined,
            rt: rich.runtime || undefined,
            mem: rich.memory || undefined,
          }]);
        }
      } catch (e) { /* non-fatal: daily-goal report already sent */ }
    }
  }

  // MAIN-world interceptor relays accepted submissions here; trust only same-window messages with our tag.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== 'leetsquad-interceptor' || d.type !== 'submissionAccepted') return;
    if (!isExtensionContextValid()) { disconnectObservers(); return; }
    const p = d.payload || {};
    reportSolved(p.slug || getProblemSlug(), p);
  });

  function monitorSubmissions() {
    if (submissionObserver) submissionObserver.disconnect();

    const handleMutation = () => {
      if (!isExtensionContextValid()) {
        disconnectObservers();
        return;
      }
      const successElement = document.querySelector('[data-e2e-locator="submission-result"]');
      if (!successElement || !successElement.textContent.includes('Accepted')) return;

      // Fallback only; reportSolved dedups by slug+href, so this no-ops when interception worked.
      reportSolved(getProblemSlug(), null);
    };

    submissionObserver = new MutationObserver(handleMutation);

    // Prefer a scoped target; fall back to body if the layout root isn't found
    const scoped = document.querySelector('#qd-content, #app, main') || document.body;
    if (scoped) {
      submissionObserver.observe(scoped, { childList: true, subtree: true });
    }
  }

  // Read the difficulty badge (Easy/Medium/Hard) from the page; returns lowercase or null.
  function detectProblemDifficulty() {
    const candidates = document.querySelectorAll('[class*="difficulty"], [class*="Difficulty"], div[diff], span');
    for (const el of candidates) {
      const t = (el.textContent || '').trim();
      if (t === 'Easy' || t === 'Medium' || t === 'Hard') return t.toLowerCase();
    }
    return null;
  }

  // Check if extension context is valid
  function isExtensionContextValid() {
    try {
      return !!(browser && browser.storage && browser.storage.local);
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

    // Watch SPA navigation via history patching + popstate; far cheaper than a full <body> observer.
    const handleNavigation = () => {
      if (!isExtensionContextValid()) {
        disconnectObservers();
        return;
      }
      document.getElementById('leetsquad-widget')?.remove();
      if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler);
        outsideClickHandler = null;
      }
      isWidgetExpanded = false;
      lastReportedSlug = null;
      setTimeout(tryInsert, 300);
      setTimeout(tryInsert, 1500);
    };

    if (!window.__leetsquadHistoryPatched) {
      const origPush = history.pushState;
      const origReplace = history.replaceState;
      history.pushState = function(...args) {
        const r = origPush.apply(this, args);
        window.dispatchEvent(new Event('leetsquad:navigation'));
        return r;
      };
      history.replaceState = function(...args) {
        const r = origReplace.apply(this, args);
        window.dispatchEvent(new Event('leetsquad:navigation'));
        return r;
      };
      window.__leetsquadHistoryPatched = true;
    }
    window.addEventListener('leetsquad:navigation', handleNavigation);
    window.addEventListener('popstate', handleNavigation);
  }

  // Background relays the keyboard-shortcut command here.
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.action !== 'toggleWidget') return;
    const widget = document.getElementById('leetsquad-widget');
    if (!widget) return;
    if (isWidgetExpanded) collapseWidget(widget);
    else expandWidget(widget);
  });

  // Listen for storage changes to update widget in real-time
  browser.storage.onChanged.addListener((changes, namespace) => {
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
