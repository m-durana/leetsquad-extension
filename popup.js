// LeetSquad - Popup Script
document.addEventListener('DOMContentLoaded', async () => {
  // Fire-and-forget nudge on popup-open; the worker re-checks opt-in + token and never blocks rendering.
  try { browser.runtime?.sendMessage?.({ action: 'uploadMySolvedSet' }); } catch (e) {}
  try { browser.runtime?.sendMessage?.({ action: 'syncFriends' }); } catch (e) {}
  try { browser.runtime?.sendMessage?.({ action: 'syncDailyGoals' }); } catch (e) {}
  if (typeof CloudSync !== 'undefined') {
    CloudSync.fetchProblemCatalogIfStale().catch(() => {});
  }

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
  // Achievements panel elements
  const achievementsBtn = document.getElementById('achievements-btn');
  const achievementsPanel = document.getElementById('achievements-panel');
  const achievementsBackBtn = document.getElementById('achievements-back-btn');
  const achievementsGrid = document.getElementById('achievements-grid');
  const achievementsCount = document.getElementById('achievements-count');
  const cloudSyncPanel = document.getElementById('cloud-sync-panel');
  const cloudSyncBackBtn = document.getElementById('cloud-sync-back-btn');
  const openCloudSyncPanelBtn = document.getElementById('open-cloud-sync-panel');
  const cloudSyncNavStatus = document.getElementById('cloud-sync-nav-status');
  const verifyBanner = document.getElementById('verify-banner');
  const verifyBannerBtn = document.getElementById('verify-banner-btn');
  const verifyBannerDisable = document.getElementById('verify-banner-disable');

  async function renderVerifyBanner() {
    if (!verifyBanner) return;
    try {
      const status = await CloudSync.getStatus();
      verifyBanner.classList.toggle('hidden', !status.enabled || status.verified);
    } catch (e) {
      verifyBanner.classList.add('hidden');
    }
  }

  verifyBannerDisable?.addEventListener('click', () => {
    settingsPanel?.classList.remove('hidden');
    cloudSyncPanel?.classList.remove('hidden');
    loadSettings();
    renderCloudSyncStatus();
  });

  let verifyInflight = false;
  async function inlineVerifyFromBanner() {
    if (!verifyBannerBtn || verifyInflight) return;
    verifyInflight = true;
    const restore = () => {
      verifyBannerBtn.disabled = false;
      verifyBannerBtn.textContent = 'Verify';
      verifyInflight = false;
    };
    verifyBannerBtn.disabled = true;
    verifyBannerBtn.textContent = '…';

    let username = await StorageManager.getMyUsername();
    if (!username) {
      try {
        const me = await LeetCodeAPI.getCurrentUser();
        if (me?.isSignedIn && me.username) username = me.username;
      } catch (e) {}
    }
    if (!username) {
      restore();
      settingsPanel?.classList.remove('hidden');
      cloudSyncPanel?.classList.remove('hidden');
      renderCloudSyncStatus();
      beginCloudVerify();
      return;
    }

    let nonce;
    try {
      const r = await CloudSync.startAuth(username);
      nonce = r.nonce;
    } catch (e) {
      restore();
      showToast('Could not reach LeetSquad server', true);
      return;
    }

    const resp = await browser.runtime.sendMessage(
      { action: 'verifyBio', nonce, expectedUsername: username }
    )
      .then((r) => r || { ok: false, error: 'no_response' })
      .catch(() => ({ ok: false, error: 'no_response' }));

    if (!resp.ok) {
      restore();
      const code = resp.error || 'unknown';
      showFailureToast(`Verify failed (${code}).`, code, { kind: 'verify', username });
      return;
    }

    await CloudSync.storeToken({
      token: resp.token,
      expires_at: resp.expires_at,
      username: resp.username,
      api_key: resp.api_key,
    });
    await CloudSync.setEnabled(true);
    await renderCloudSyncStatus();
    await updateCloudSyncNavStatus();

    verifyBannerBtn.textContent = '✓ Verified';
    browser.runtime.sendMessage({ action: 'uploadMySolvedSet', force: true });
    reconcileFriendsAfterVerify().catch((e) => console.error('friend reconcile:', e));
    setTimeout(() => {
      verifyBanner?.classList.add('hidden');
      restore();
    }, 1200);
  }

  verifyBannerBtn?.addEventListener('click', () => {
    inlineVerifyFromBanner().catch((e) => {
      console.error('inline verify:', e);
      if (verifyBannerBtn) {
        verifyBannerBtn.disabled = false;
        verifyBannerBtn.textContent = 'Verify';
      }
    });
  });
  
  // Friends tab elements
  const myUsernameInput = document.getElementById('my-username');
  const saveMyUsernameBtn = document.getElementById('save-my-username');
  const friendUsernameInput = document.getElementById('friend-username');
  const addFriendBtn = document.getElementById('add-friend-btn');
  const friendsList = document.getElementById('friends-list');
  const friendsCount = document.getElementById('friends-count');
  
  // Leaderboard elements
  const leaderboardList = document.getElementById('leaderboard-list');

  // Activity elements
  const activityFeed = document.getElementById('activity-feed');
  const activityFilterToggle = document.getElementById('activity-filter-toggle');
  const filterLabel = document.getElementById('filter-label');

  // Activity state. Filter cycles: 'all' -> 'first' -> 'repeat' -> 'all'.
  const ACTIVITY_FILTERS = ['all', 'first', 'repeat'];
  let activityFilter = 'all';
  const ACTIVITY_FILTER_LABEL = { all: 'All Activity', first: 'First Solves', repeat: 'Repeat Solves' };
  const ACTIVITY_FILTER_TITLE = {
    all: 'Showing all activity',
    first: 'Showing first-time solves only',
    repeat: 'Showing repeat solves only',
  };
  const ACTIVITY_EMPTY = {
    all: { head: 'No recent activity', sub: 'Solve some problems!' },
    first: { head: 'No first-time solves', sub: 'Try showing all activity' },
    repeat: { head: 'No repeat solves', sub: 'Try showing all activity' },
  };

  // Daily goal elements
  const goalStreak = document.getElementById('goal-streak');
  const goalFlame = document.getElementById('goal-flame');
  const goalRing = document.getElementById('goal-ring');
  const goalRingFill = document.getElementById('goal-ring-fill');
  const goalRingLabel = document.getElementById('goal-ring-label');
  const openProblemBtn = document.getElementById('open-problem-btn');
  
  // Settings elements
  const settingShowWidget = document.getElementById('setting-show-widget');
  const settingShowProblemList = document.getElementById('setting-show-problem-list');
  const settingNotifications = document.getElementById('setting-notifications');
  const settingDebugMode = document.getElementById('setting-debug-mode');
  const settingDailyGoal = document.getElementById('setting-daily-goal');
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  const detectMyUsernameBtn = document.getElementById('detect-my-username');

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
  const escapeHtml = LeetSquadUtils.escapeHtml;

  // Fluent Color flame (Microsoft Fluent Emoji, MIT), inlined so we control size + placement.
  const FLUENT_FLAME_INNER = '<path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p0)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p1)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p2)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p3)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p4)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p5)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p6)"/><path d="M12.5554 8.93525C14.0921 6.53779 15.0016 4.32368 15.4762 2.75834C15.6581 2.1584 16.4264 1.91265 16.8824 2.34277C23.7549 8.82401 26.0011 13.7722 26.4493 19.4908C26.7774 25.0221 24.0587 29.944 16.7618 29.944C9.91109 29.944 4.85547 25.1627 5.54294 17.5846C5.95379 13.0556 7.7145 9.60538 9.12218 7.55149C9.56028 6.91229 10.473 6.90302 10.9779 7.49092L12.237 8.95719C12.3238 9.05822 12.4835 9.04736 12.5554 8.93525Z" fill="url(#p7)"/><g filter="url(#fi)"><path d="M10.1782 19.8769C11.4805 16.7776 14.1528 13.348 15.9574 11.4875C16.4673 10.9618 17.2915 10.9524 17.8301 11.4487C21.2913 14.6377 22.3332 17.5207 23.2174 20.8769C24.1372 24.3686 23.2174 29.9946 16.2958 29.9946C10.3351 29.9946 8.27019 24.4174 10.1782 19.8769Z" fill="url(#p8)"/><path d="M10.1782 19.8769C11.4805 16.7776 14.1528 13.348 15.9574 11.4875C16.4673 10.9618 17.2915 10.9524 17.8301 11.4487C21.2913 14.6377 22.3332 17.5207 23.2174 20.8769C24.1372 24.3686 23.2174 29.9946 16.2958 29.9946C10.3351 29.9946 8.27019 24.4174 10.1782 19.8769Z" fill="url(#p9)"/><path d="M10.1782 19.8769C11.4805 16.7776 14.1528 13.348 15.9574 11.4875C16.4673 10.9618 17.2915 10.9524 17.8301 11.4487C21.2913 14.6377 22.3332 17.5207 23.2174 20.8769C24.1372 24.3686 23.2174 29.9946 16.2958 29.9946C10.3351 29.9946 8.27019 24.4174 10.1782 19.8769Z" fill="url(#p10)"/></g><path d="M10.1782 19.8769C11.4805 16.7776 14.1528 13.348 15.9574 11.4875C16.4673 10.9618 17.2915 10.9524 17.8301 11.4487C21.2913 14.6377 22.3332 17.5207 23.2174 20.8769C24.1372 24.3686 23.2174 29.9946 16.2958 29.9946C10.3351 29.9946 8.27019 24.4174 10.1782 19.8769Z" fill="url(#p11)"/><path d="M10.1782 19.8769C11.4805 16.7776 14.1528 13.348 15.9574 11.4875C16.4673 10.9618 17.2915 10.9524 17.8301 11.4487C21.2913 14.6377 22.3332 17.5207 23.2174 20.8769C24.1372 24.3686 23.2174 29.9946 16.2958 29.9946C10.3351 29.9946 8.27019 24.4174 10.1782 19.8769Z" fill="url(#p12)"/><g filter="url(#ff1)"><path d="M11.8137 11.5385C14.1291 8.14851 15.4831 4.48144 15.8966 3.57653C15.2936 8.21133 13.5364 11.6047 10.2287 15.9746C7.58254 19.4706 7.10476 22.4634 7.12774 23.1917C6.30081 17.63 8.91941 15.776 11.8137 11.5385Z" fill="url(#p13)"/></g><g filter="url(#ff2)"><path d="M9.81366 7.87422C8.5136 9.4879 5.9295 13.9638 5.99348 18.9582C7.27492 13.8358 10.2692 12.2215 9.81366 7.87422Z" fill="url(#p14)"/></g><defs><filter id="fi" x="9.48987" y="11.0846" width="14.5255" height="18.9099" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/><feOffset dx="0.5"/><feGaussianBlur stdDeviation="0.25"/><feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/><feColorMatrix type="matrix" values="0 0 0 0 0.952941 0 0 0 0 0.615686 0 0 0 0 0.364706 0 0 0 1 0"/><feBlend mode="normal" in2="shape" result="effect1_innerShadow"/></filter><filter id="ff1" x="5.7229" y="2.32654" width="11.4237" height="22.1152" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="0.625" result="effect1_foregroundBlur"/></filter><filter id="ff2" x="4.49231" y="6.37427" width="6.86804" height="14.0839" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/><feGaussianBlur stdDeviation="0.75" result="effect1_foregroundBlur"/></filter><radialGradient id="p0" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(24.0023 19.72) rotate(-179.474) scale(17.0988 25.7861)"><stop stop-color="#FF953D"/><stop offset="1" stop-color="#FF5141"/></radialGradient><radialGradient id="p1" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(10.3724 15.6549) rotate(-157.937) scale(10.3441 17.8495)"><stop stop-color="#CE5327"/><stop offset="1" stop-color="#CE5327" stop-opacity="0"/></radialGradient><linearGradient id="p2" x1="18.3364" y1="29.944" x2="18.3364" y2="24.8455" gradientUnits="userSpaceOnUse"><stop stop-color="#FF7583"/><stop offset="1" stop-color="#FF7583" stop-opacity="0"/></linearGradient><radialGradient id="p3" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(4.95718 14.3914) rotate(24.0149) scale(3.10465 25.6991)"><stop stop-color="#FFAA7B"/><stop offset="1" stop-color="#FFAA7B" stop-opacity="0"/></radialGradient><radialGradient id="p4" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(9.31032 6.25095) rotate(77.3196) scale(3.84035 4.79187)"><stop stop-color="#FF5E47"/><stop offset="1" stop-color="#FF5E47" stop-opacity="0"/></radialGradient><radialGradient id="p5" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(16.429 1.36584) rotate(87.8819) scale(10.1374 9.38321)"><stop stop-color="#FF2F3C"/><stop offset="1" stop-color="#FF2F3C" stop-opacity="0"/></radialGradient><radialGradient id="p6" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(13.9 4.79911) rotate(25.3285) scale(2.29895 4.61352)"><stop stop-color="#FF846C"/><stop offset="1" stop-color="#FF846C" stop-opacity="0"/></radialGradient><radialGradient id="p7" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(12.4577 8.20959) rotate(113.224) scale(2.27837 0.522116)"><stop stop-color="#FFA682"/><stop offset="1" stop-color="#FFA682" stop-opacity="0"/></radialGradient><radialGradient id="p8" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(21.2046 24.3762) rotate(-168.558) scale(10.0291 12.4891)"><stop stop-color="#FFDA2F"/><stop offset="1" stop-color="#FF8E41"/></radialGradient><radialGradient id="p9" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(12.4013 8.59263) rotate(69.0442) scale(14.1425 12.2879)"><stop stop-color="#FD5639"/><stop offset="1" stop-color="#FE5533" stop-opacity="0"/></radialGradient><radialGradient id="p10" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(19.239 20.6289) rotate(174.239) scale(9.79866 23.9914)"><stop offset="0.627719" stop-color="#D7812D" stop-opacity="0"/><stop offset="1" stop-color="#D7812D"/></radialGradient><linearGradient id="p11" x1="16.5026" y1="10.6122" x2="16.5026" y2="14.2595" gradientUnits="userSpaceOnUse"><stop stop-color="#F95131"/><stop offset="1" stop-color="#F95131" stop-opacity="0"/></linearGradient><radialGradient id="p12" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(22.9857 18.8023) rotate(143.063) scale(16.0546 11.6174)"><stop offset="0.772305" stop-color="#F18A52" stop-opacity="0"/><stop offset="1" stop-color="#F18A52"/></radialGradient><linearGradient id="p13" x1="14.9957" y1="4.2552" x2="7.65549" y2="22.7319" gradientUnits="userSpaceOnUse"><stop stop-color="#FF7558"/><stop offset="1" stop-color="#F38758"/></linearGradient><linearGradient id="p14" x1="9.54097" y1="8.14373" x2="5.58208" y2="19.4793" gradientUnits="userSpaceOnUse"><stop stop-color="#FF815B"/><stop offset="1" stop-color="#FF9C6D"/></linearGradient></defs>';
  let __flameUid = 0;
  // Fresh gradient/filter IDs per copy so multiple flames on the page don't collide.
  function makeFlame() {
    const s = '_f' + (__flameUid++);
    const inner = FLUENT_FLAME_INNER
      .replace(/id="([^"]+)"/g, (_, g) => `id="${g}${s}"`)
      .replace(/url\(#([^)]+)\)/g, (_, g) => `url(#${g}${s})`);
    return `<svg class="flame-ico" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">${inner}</svg>`;
  }
  if (goalFlame) goalFlame.innerHTML = makeFlame();

  // Header overflow menu (Friends / Achievements / Settings)
  const kebabBtn = document.getElementById('kebab-btn');
  const kebabDropdown = document.getElementById('kebab-dropdown');
  if (kebabBtn && kebabDropdown) {
    kebabBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = kebabDropdown.classList.toggle('open');
      kebabBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', () => {
      if (!kebabDropdown.classList.contains('open')) return;
      kebabDropdown.classList.remove('open');
      kebabBtn.setAttribute('aria-expanded', 'false');
    });
  }

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

  // Achievements panel toggle
  achievementsBtn?.addEventListener('click', () => {
    achievementsPanel.classList.remove('hidden');
    loadAchievements();
  });

  achievementsBackBtn?.addEventListener('click', () => {
    achievementsPanel.classList.add('hidden');
  });

  async function loadAchievements() {
    if (!achievementsGrid) return;
    try {
      const result = await Achievements.runPass();
      const stored = await Achievements.getStored();
      const total = Achievements.REGISTRY.length;
      const unlockedCount = Object.keys(stored).length;
      if (achievementsCount) achievementsCount.textContent = `${unlockedCount}/${total}`;

      const cards = Achievements.REGISTRY.map(a => {
        const entry = stored[a.id];
        const unlocked = !!entry;
        const when = unlocked && entry.unlockedAt ? Achievements.formatDate(entry.unlockedAt) : '';
        return `
          <div class="ach-card ${unlocked ? 'unlocked' : 'locked'}" title="${escAttr(a.description)}">
            <div class="ach-icon">${unlocked ? a.icon : '🔒'}</div>
            <div class="ach-name">${escText(a.name)}</div>
            <div class="ach-desc">${escText(a.description)}</div>
            ${unlocked && when ? `<div class="ach-unlocked-at">Unlocked ${escText(when)}</div>` : ''}
          </div>
        `;
      }).join('');

      achievementsGrid.innerHTML = cards || '<div class="ach-empty">No achievements yet</div>';
      // No toast on panel open; the background pass notifies genuinely new unlocks.
    } catch (e) {
      achievementsGrid.innerHTML = '<div class="ach-empty">Could not load achievements</div>';
    }
  }

  function escText(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escAttr(s) { return escText(s); }

  openCloudSyncPanelBtn?.addEventListener('click', () => {
    cloudSyncPanel?.classList.remove('hidden');
    renderCloudSyncStatus();
  });

  cloudSyncBackBtn?.addEventListener('click', () => {
    cloudSyncPanel?.classList.add('hidden');
    updateCloudSyncNavStatus();
  });

  const displayPanel = document.getElementById('display-panel');
  document.getElementById('open-display-panel')?.addEventListener('click', () => {
    displayPanel?.classList.remove('hidden');
  });
  document.getElementById('display-back-btn')?.addEventListener('click', () => {
    displayPanel?.classList.add('hidden');
  });

  const advancedPanel = document.getElementById('advanced-panel');
  document.getElementById('open-advanced-panel')?.addEventListener('click', () => {
    advancedPanel?.classList.remove('hidden');
  });
  document.getElementById('advanced-back-btn')?.addEventListener('click', () => {
    advancedPanel?.classList.add('hidden');
  });

  async function updateCloudSyncNavStatus() {
    if (!cloudSyncNavStatus) return;
    try {
      const status = await CloudSync.getStatus();
      if (status.enabled && status.verified) {
        cloudSyncNavStatus.textContent = `Connected as @${status.username || ''}`;
        cloudSyncNavStatus.className = 'cloud-sync-nav-status connected';
      } else if (status.enabled && status.tokenExpired) {
        cloudSyncNavStatus.textContent = 'Token expired';
        cloudSyncNavStatus.className = 'cloud-sync-nav-status expired';
      } else if (status.enabled) {
        cloudSyncNavStatus.textContent = '● Not verified';
        cloudSyncNavStatus.className = 'cloud-sync-nav-status pending';
      } else {
        cloudSyncNavStatus.textContent = 'Off';
        cloudSyncNavStatus.className = 'cloud-sync-nav-status off';
      }
    } catch (e) {
      cloudSyncNavStatus.textContent = '';
    }
  }

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

  // Detect the logged-in leetcode.com user (globalData query); toasts either way.
  async function detectMyUsername({ silent = false } = {}) {
    try {
      const status = await LeetCodeAPI.getCurrentUser();
      if (status?.isSignedIn && status.username) {
        myUsernameInput.value = status.username;
        await StorageManager.setMyUsername(status.username);
        if (!silent) showToast(`Detected: ${status.username}`);
        maybeSelfImport(status.username).catch(() => {});
        loadLeaderboard();
        return true;
      }
      if (!silent) showToast('Not signed in to leetcode.com', 'error');
    } catch (e) {
      if (!silent) showToast('Could not detect. Sign in to leetcode.com first', 'error');
    }
    return false;
  }

  // One-time per friend: union their public solution-article slugs.
  const BOOTSTRAPPED_KEY = 'leetsquad_solutions_bootstrapped';
  async function bootstrapFromSolutions(username) {
    if (!username) return;
    const done = (await StorageManager.get(BOOTSTRAPPED_KEY)) || {};
    if (done[username]) return;
    try {
      const entries = await LeetCodeAPI.getUserSolutionArticles(username);
      if (entries.length > 0) {
        await StorageManager.mergeSolvedSlugs(username, entries);
      }
      done[username] = Date.now();
      await StorageManager.set(BOOTSTRAPPED_KEY, done);
    } catch (e) {}
  }

  // Backfill existing friends, one per popup open.
  async function backfillExistingFriends() {
    const friends = await StorageManager.getFriends();
    const done = (await StorageManager.get(BOOTSTRAPPED_KEY)) || {};
    const myUsername = await StorageManager.getMyUsername();
    const candidates = friends.filter(f => !done[f] && f !== myUsername);
    if (candidates.length === 0) return;
    bootstrapFromSolutions(candidates[0]).catch(() => {});
  }

  // Daily full self-import (auth-only): progress list for all slugs, then ~1 req/sec backfill of missing {id,lang,rt,mem}.
  const SELF_IMPORT_KEY = 'leetsquad_self_import_at';
  const SELF_BACKFILL_KEY = 'leetsquad_self_backfill_cursor';
  const RICH_BACKFILL_BATCH = 20;

  async function maybeSelfImport(myUsername) {
    if (!myUsername) return;
    const last = (await StorageManager.get(SELF_IMPORT_KEY)) || 0;
    const stale = Date.now() - last >= 24 * 60 * 60 * 1000;
    if (stale) {
      try {
        const progress = await LeetCodeAPI.getMyProgressQuestionList();
        const acRows = progress.filter(p => p.questionStatus === 'SOLVED' || p.lastSubmittedAt > 0);
        if (acRows.length > 0) {
          await StorageManager.mergeSolvedSlugs(
            myUsername,
            acRows.map(p => ({ titleSlug: p.titleSlug, timestamp: p.lastSubmittedAt || 0 }))
          );
        }
        await StorageManager.set(SELF_IMPORT_KEY, Date.now());
      } catch (e) {}
    }
    backfillSelfRichMetadata(myUsername).catch(() => {});
  }

  // Once per popup open: fetch a bounded batch of slugs missing rich metadata; the rest accretes later.
  async function backfillSelfRichMetadata(myUsername) {
    const set = await StorageManager.getSolvedSet(myUsername);
    const slugs = Object.keys(set.slugs || {});
    if (slugs.length === 0) return;
    const meta = set.submissionMeta || {};
    const ids = set.submissionIds || {};
    const cursor = (await StorageManager.get(SELF_BACKFILL_KEY)) || 0;
    const ordered = slugs.slice(cursor).concat(slugs.slice(0, cursor));
    const todo = ordered.filter(s => !ids[s] || !meta[s]);
    const batch = todo.slice(0, RICH_BACKFILL_BATCH);
    for (const slug of batch) {
      try {
        const subs = await LeetCodeAPI.getMyAcSubmissionsForSlug(slug, { limit: 5, maxPages: 1 });
        if (subs.length === 0) continue;
        subs.sort((a, b) => b.timestamp - a.timestamp);
        const best = subs[0];
        await StorageManager.mergeSolvedSlugs(myUsername, [{
          titleSlug: slug,
          timestamp: best.timestamp,
          id: best.id,
          lang: best.lang,
          rt: best.runtime,
          mem: best.memory,
        }]);
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1000));
    }
    const lastSlug = batch[batch.length - 1];
    const newCursor = lastSlug ? (slugs.indexOf(lastSlug) + 1) % slugs.length : cursor;
    await StorageManager.set(SELF_BACKFILL_KEY, newCursor);
  }

  detectMyUsernameBtn?.addEventListener('click', () => detectMyUsername());

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
      bootstrapFromSolutions(username).catch(() => {});
      // Persist the new friend list to the cloud (no-op if cloud sync is off).
      try { browser.runtime?.sendMessage?.({ action: 'syncFriends' }); } catch (e) {}
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
  const memberIconUrl = browser.runtime.getURL('icons/icon128.png');

  function presenceOf(username, presence) {
    if (!presence) return null;
    const p = presence[String(username || '').toLowerCase()];
    return (p && p.member) ? p : null;
  }

  // Friends list: inline "uses LeetSquad" badge + shared streak (flame + count).
  function presenceHtml(username, presence) {
    const p = presenceOf(username, presence);
    if (!p) return '';
    const streak = p.streak > 0
      ? ` <span class="ls-streak" title="LeetSquad streak"><span class="flame">${makeFlame()}</span>${p.streak}</span>`
      : '';
    return ` <img class="ls-member-badge" src="${memberIconUrl}" alt="LeetSquad member" title="Uses LeetSquad">${streak}`;
  }

  // Leaderboard: the streak sits on the avatar corner...
  function avatarStreakHtml(username, presence) {
    const p = presenceOf(username, presence);
    if (!p || !(p.streak > 0)) return '';
    return `<span class="lb-streak-badge" title="LeetSquad streak"><span class="flame">${makeFlame()}</span>${p.streak}</span>`;
  }

  // ...and the member icon only shows on the name line when there's no streak to carry it.
  function memberBadgeHtml(username, presence) {
    const p = presenceOf(username, presence);
    if (!p || p.streak > 0) return '';
    return ` <img class="ls-member-badge" src="${memberIconUrl}" alt="LeetSquad member" title="Uses LeetSquad">`;
  }

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
    LeetSquadUtils.armSlowHint(friendsList);

    // Use valid storage cache; batch-fetch the rest in one GraphQL request.
    const friendsData = await Promise.all(friends.map(async (username) => {
      const cached = await StorageManager.getCachedData(username);
      const cacheValid = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt < LeetSquadUtils.CACHE_TTL_MS);
      if (cacheValid) return cached;
      return null; // mark as needing a fetch
    }));

    const missing = friends.filter((_, i) => friendsData[i] === null);
    if (missing.length > 0) {
      const profiles = await LeetCodeAPI.batchGetUserProfiles(missing);
      await Promise.all(friends.map(async (username, i) => {
        if (friendsData[i] !== null) return;
        const profile = profiles[username];
        if (!profile) return;
        const data = {
          username,
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
        friendsData[i] = data;
        await StorageManager.setCachedData(username, data);
      }));
    }

    const presence = await CloudSync.getPresence(friends).catch(() => null);

    friendsList.innerHTML = friendsData
      .filter(f => f)
      .map(friend => renderFriendCard(friend, presence))
      .join('');

    // Add remove handlers
    document.querySelectorAll('.remove-friend').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const username = e.currentTarget.dataset.username;
        await StorageManager.removeFriend(username);
        try { browser.runtime?.sendMessage?.({ action: 'syncFriends' }); } catch (err) {}
        loadFriends();
        loadLeaderboard();
        showToast(`Removed ${username}`);
      });
    });
  }

  function renderFriendCard(friend, presence) {
    const { username, profile, solved } = friend;
    const easy = solved?.easySolved ?? profile?.easySolved ?? 0;
    const medium = solved?.mediumSolved ?? profile?.mediumSolved ?? 0;
    const hard = solved?.hardSolved ?? profile?.hardSolved ?? 0;
    const avatar = profile?.avatar ?? null;
    const displayName = username || 'Unknown';
    const safeName = escapeHtml(displayName);
    const initial = (displayName && displayName[0]) ? displayName[0].toUpperCase() : 'U';
    const safeAvatar = escapeHtml(LeetSquadUtils.safeAvatarUrl(avatar));
    const profileHref = `https://leetcode.com/u/${encodeURIComponent(displayName)}`;

    return `
      <div class="friend-card">
        <div class="friend-avatar">
          ${safeAvatar ?
            `<img src="${safeAvatar}" alt="${safeName}"/>` :
            `<span>${escapeHtml(initial)}</span>`
          }
        </div>
        <div class="friend-details">
          <div class="friend-name">${safeName}${presenceHtml(username, presence)}</div>
          <div class="friend-stats-mini">
            <span class="stat-easy">E: ${easy}</span>
            <span class="stat-medium">M: ${medium}</span>
            <span class="stat-hard">H: ${hard}</span>
          </div>
        </div>
        <div class="friend-actions">
          <a href="${profileHref}" target="_blank" class="icon-btn" title="View profile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>
          <button class="icon-btn remove-friend" data-username="${safeName}" title="Remove friend">
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
  // Last-known presence (member badge + streak), reused across renders while the popup is open.
  let cachedPresence = null;

  // Cached processed users from the last loadLeaderboard, so the sort animation can re-sort without refetching.
  let lastLeaderboardUsersData = null;
  let lastLeaderboardMyUsername = null;
  let lastLeaderboardCatalog = null;

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

  // recentSubmissionList omits difficulty; join the cached catalog to bucket by E/M/H.
  function countSubmissionsInPeriod(submissions, periodStart, catalog) {
    if (!submissions?.submission) return { total: 0, easy: 0, medium: 0, hard: 0 };

    const accepted = submissions.submission.filter(s =>
      s.statusDisplay === 'Accepted' && s.timestamp >= periodStart
    );

    const uniqueProblems = new Map();
    accepted.forEach(s => {
      if (!uniqueProblems.has(s.titleSlug)) {
        const fromSub = s.difficulty || null;
        const fromCatalog = catalog?.[s.titleSlug]?.difficulty || null;
        uniqueProblems.set(s.titleSlug, fromSub || fromCatalog);
      }
    });

    let easy = 0, medium = 0, hard = 0;
    uniqueProblems.forEach(diff => {
      if (diff === 'Easy') easy++;
      else if (diff === 'Medium') medium++;
      else if (diff === 'Hard') hard++;
    });

    return { total: uniqueProblems.size, easy, medium, hard };
  }

  // Load leaderboard stale-while-revalidate: paint cache immediately, then fetch fresh and re-render.
  async function loadLeaderboard(period = currentPeriod) {
    currentPeriod = period;

    const [friends, myUsername, cachedCatalog] = await Promise.all([
      StorageManager.getFriends(),
      StorageManager.getMyUsername(),
      StorageManager.getProblemCatalog().catch(() => null),
    ]);
    const catalog = cachedCatalog?.problems || null;
    lastLeaderboardCatalog = catalog;

    const allUsers = myUsername ? [myUsername, ...friends.filter(f => f !== myUsername)] : friends;

    const presencePromise = CloudSync.getPresence(allUsers)
      .then((p) => { if (p) cachedPresence = p; return p; })
      .catch(() => null);

    if (allUsers.length === 0) {
      leaderboardList.innerHTML = `
        <div class="empty-state">
          <p>No one in your squad yet</p>
          <span>Add friends to see the leaderboard!</span>
        </div>
      `;
      return;
    }

    // stale-paint to avoid the "Loading..." flash on popup reopen
    const stalePromises = await Promise.all(allUsers.map(async (u) => {
      const entry = await StorageManager.getCachedDataWithStale(u);
      return entry ? { username: u, data: entry.data } : null;
    }));
    const staleUsers = stalePromises.filter(Boolean);
    let stalePainted = false;
    if (staleUsers.length > 0) {
      const stalePeriodStart = getPeriodStartTimestamp(period);
      const renderable = staleUsers
        .map(u => {
          if (period === 'all') {
            return {
              username: u.username,
              data: u.data,
              total: u.data.solved?.solvedProblem ?? 0,
              easy: u.data.solved?.easySolved ?? 0,
              medium: u.data.solved?.mediumSolved ?? 0,
              hard: u.data.solved?.hardSolved ?? 0,
            };
          }
          const subs = u.data.submissions?.submission;
          if (!subs) return null;
          const stats = countSubmissionsInPeriod(u.data.submissions, stalePeriodStart, catalog);
          return { username: u.username, data: u.data, ...stats };
        })
        .filter(Boolean)
        .sort((a, b) => b.total - a.total);
      if (renderable.length > 0) {
        leaderboardList.innerHTML = renderable
          .map((user, index) => renderLeaderboardItem(user, index, myUsername))
          .join('');
        stalePainted = true;
      }
    }
    if (!stalePainted) {
      leaderboardList.innerHTML = '<div class="loading">Loading leaderboard...</div>';
      LeetSquadUtils.armSlowHint(leaderboardList);
    }

    // Pull cache up front, then batch-fetch what's missing in one round trip (two if profiles + submissions).
    const needsSubmissions = period !== 'all';
    const usersData = await Promise.all(allUsers.map(async (username) => {
      const cached = await StorageManager.getCachedData(username);
      const cacheValid = cached && cached.fetchedAt && (Date.now() - cached.fetchedAt < LeetSquadUtils.CACHE_TTL_MS);
      const hasSubs = !!cached?.submissions?.submission;
      const usable = cacheValid && (!needsSubmissions || hasSubs);
      return { username, data: usable ? cached : null };
    }));

    const missingUsers = usersData.filter(u => u.data === null).map(u => u.username);
    if (missingUsers.length > 0) {
      try {
        const [profiles, subs] = await Promise.all([
          LeetCodeAPI.batchGetUserProfiles(missingUsers),
          needsSubmissions ? Promise.resolve(null) : Promise.resolve(null),
        ]);

        // submissions need a per-user fetch (statusDisplay shape); do it concurrently.
        const subsByUser = needsSubmissions
          ? Object.fromEntries(await Promise.all(missingUsers.map(async (u) => {
              try { return [u, await LeetCodeAPI.getRecentSubmissions(u)]; }
              catch { return [u, null]; }
            })))
          : {};

        const solvedByUser = Object.fromEntries(await Promise.all(missingUsers.map(async (u) => {
          try { return [u, await LeetCodeAPI.getUserSolvedProblems(u)]; }
          catch { return [u, null]; }
        })));

        await Promise.all(usersData.map(async (entry) => {
          if (entry.data !== null) return;
          const profile = profiles[entry.username];
          const solved = solvedByUser[entry.username];
          const subRec = subsByUser[entry.username];
          if (!profile && !solved) return;
          const merged = {
            username: entry.username,
            profile,
            solved,
            submissions: subRec,
            fetchedAt: Date.now(),
          };
          entry.data = merged;
          await StorageManager.setCachedData(entry.username, merged);
        }));
      } catch (error) {
        console.error('Batch fetch failed:', error);
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
          const stats = countSubmissionsInPeriod(u.data.submissions, periodStart, catalog);
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

    await presencePromise;
    leaderboardList.innerHTML = sorted
      .map((user, index) => renderLeaderboardItem(user, index, myUsername))
      .join('');

    // Sync re-sort keeps FLIP jitter-free: no await means no paint of new natural positions before invert.
    lastLeaderboardUsersData = usersData;
    lastLeaderboardMyUsername = myUsername;
  }

  // Synchronous re-sort from already-loaded data; returns true if the DOM was rewritten, false to reload.
  function rerenderLeaderboardForPeriod(period) {
    if (!lastLeaderboardUsersData || lastLeaderboardUsersData.length === 0) return false;
    currentPeriod = period;
    const periodStart = getPeriodStartTimestamp(period);
    const processed = lastLeaderboardUsersData
      .filter(u => u.data)
      .map(u => {
        if (period === 'all') {
          return {
            username: u.username,
            data: u.data,
            total: u.data.solved?.solvedProblem ?? 0,
            easy: u.data.solved?.easySolved ?? 0,
            medium: u.data.solved?.mediumSolved ?? 0,
            hard: u.data.solved?.hardSolved ?? 0,
          };
        }
        const stats = countSubmissionsInPeriod(u.data.submissions, periodStart, lastLeaderboardCatalog);
        return { username: u.username, data: u.data, ...stats };
      })
      .sort((a, b) => b.total - a.total);

    if (processed.length === 0) return false;

    // For submission-based periods, fall back to async reload if any cached user lacks submissions.
    if (period !== 'all') {
      const anyMissingSubs = lastLeaderboardUsersData.some(u => u.data && !u.data.submissions?.submission);
      if (anyMissingSubs) return false;
    }

    leaderboardList.innerHTML = processed
      .map((user, index) => renderLeaderboardItem(user, index, lastLeaderboardMyUsername))
      .join('');
    return true;
  }

  // Period selector handlers
  const periodButtons = document.querySelectorAll('.period-btn');
  periodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;

      periodButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      animateLeaderboardSort(period);
    });
  });

  // Store current leaderboard data for animations
  let currentLeaderboardData = [];

  // FLIP reorder: measure/replace/invert/play must stay fully synchronous (no await between measure and invert), or you get a one-frame snap-back.
  function animateLeaderboardSort(period) {
    const items = leaderboardList.querySelectorAll('.leaderboard-item');
    if (items.length === 0) {
      loadLeaderboard(period);
      return;
    }

    // MEASURE
    const oldPositions = new Map();
    items.forEach((item) => {
      const rect = item.getBoundingClientRect();
      oldPositions.set(item.dataset.username, rect.top);
    });

    // Mutate synchronously from cache; if it can't satisfy, fall through to an async reload without animation.
    const rewrote = rerenderLeaderboardForPeriod(period);
    if (!rewrote) {
      loadLeaderboard(period);
      return;
    }

    const newItems = Array.from(leaderboardList.querySelectorAll('.leaderboard-item'));

    // INVERT: pin each new item at its old visual position with transitions OFF
    const animations = [];
    newItems.forEach((newItem) => {
      const username = newItem.dataset.username;
      const oldTop = oldPositions.get(username);
      if (oldTop === undefined) return;

      const newRect = newItem.getBoundingClientRect();
      const deltaY = oldTop - newRect.top;
      if (deltaY === 0) return;

      newItem.style.transition = 'none';
      newItem.style.transform = `translateY(${deltaY}px)`;
      newItem.style.opacity = '0.7';
      animations.push(newItem);
    });

    // Force a single reflow so the browser commits the pinned positions
    if (animations.length > 0) void leaderboardList.offsetHeight;

    // PLAY: re-enable transitions and animate to the natural position
    leaderboardList.classList.add('animating');
    requestAnimationFrame(() => {
      animations.forEach((item) => {
        item.style.transition = '';
        item.style.transform = '';
        item.style.opacity = '';
      });
    });

    // Remove the animating class after the transition (transitionend, with a setTimeout safety net).
    const cleanup = () => {
      leaderboardList.classList.remove('animating');
      animations.forEach((item) => {
        item.removeEventListener('transitionend', cleanup);
      });
    };
    if (animations.length > 0) {
      animations[0].addEventListener('transitionend', cleanup, { once: true });
    }
    setTimeout(cleanup, 1000);
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
    const safeName = escapeHtml(username);
    const safeAvatar = escapeHtml(LeetSquadUtils.safeAvatarUrl(avatar));
    const initial = (username && username[0]) ? escapeHtml(username[0].toUpperCase()) : 'U';
    const profileHref = `https://leetcode.com/u/${encodeURIComponent(username)}`;

    let rankClass = '';
    let rankDisplay = index + 1;
    if (index === 0) { rankClass = 'gold'; rankDisplay = '🥇'; }
    else if (index === 1) { rankClass = 'silver'; rankDisplay = '🥈'; }
    else if (index === 2) { rankClass = 'bronze'; rankDisplay = '🥉'; }

    return `
      <div class="leaderboard-item ${index < 3 ? `top-${index + 1}` : ''} ${isMe ? 'is-me' : ''}" data-username="${safeName}">
        <div class="rank ${rankClass}">${rankDisplay}</div>
        <div class="lb-avatar">
          ${safeAvatar ?
            `<img src="${safeAvatar}" alt="${safeName}" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/>` :
            `<span style="background:${gradient};width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:6px;color:white;font-weight:700;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${initial}</span>`
          }${avatarStreakHtml(username, cachedPresence)}
        </div>
        <div class="lb-info">
          <div class="lb-name">
            <a href="${profileHref}" target="_blank" class="lb-name-link">${safeName}</a>${isMe ? ' <span class="you-tag">(You)</span>' : ''}${memberBadgeHtml(username, cachedPresence)}
            ${globalRank ? `<span class="global-rank" title="Global LeetCode Rank">#${escapeHtml(globalRank)}</span>` : ''}
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

  // Persistent per-submission percentile cache (immutable), so it shows instantly on later opens.
  const PERCENTILE_CACHE_KEY = 'leetsquad_percentile_cache';
  let percentileCache = {};
  let percentileCacheLoaded = false;
  async function ensurePercentileCache() {
    if (percentileCacheLoaded) return;
    percentileCache = (await StorageManager.get(PERCENTILE_CACHE_KEY)) || {};
    percentileCacheLoaded = true;
  }

  // Load activity: fetches data once, then renders pages from the cached list
  async function fetchActivityFromNetwork() {
    const [friends, myUsername] = await Promise.all([
      StorageManager.getFriends(),
      StorageManager.getMyUsername()
    ]);
    const allUsers = myUsername ? [myUsername, ...friends] : friends;
    if (allUsers.length === 0) return [];

    const allSubmissions = [];
    const cachedPerUser = Object.fromEntries(await Promise.all(
      allUsers.map(async u => {
        const entry = await StorageManager.getCachedDataWithStale(u);
        return [u, entry?.data || null];
      })
    ));

    let acByUser = {};
    try {
      acByUser = await LeetCodeAPI.batchGetRecentAcSubmissions(allUsers, 50);
    } catch (e) {
      console.log('Batch AC fetch failed, falling back to per-user:', e);
    }

    for (const username of allUsers) {
      const avatar = cachedPerUser[username]?.profile?.avatar;
      const graphqlSubs = acByUser[username] || [];
      if (graphqlSubs.length > 0) {
        allSubmissions.push(...graphqlSubs.map(s => ({ ...s, username, avatar, statusDisplay: 'Accepted' })));
      } else {
        const cachedSubs = cachedPerUser[username]?.submissions;
        let subs = cachedSubs;
        if (!subs?.submission) {
          try { subs = await LeetCodeAPI.getRecentSubmissions(username, 50); } catch { subs = null; }
        }
        const userSubs = (subs?.submission || []).filter(s => s.statusDisplay === 'Accepted')
          .map(s => ({ ...s, username, avatar }));
        allSubmissions.push(...userSubs);
      }
    }

    const submissions = allSubmissions
      .filter(s => s.statusDisplay === 'Accepted')
      .sort((a, b) => b.timestamp - a.timestamp);

    const seen = new Map();
    submissions.forEach(sub => {
      const key = `${sub.username}:${sub.titleSlug}`;
      if (!seen.has(key) || sub.timestamp < seen.get(key)) seen.set(key, sub.timestamp);
    });
    submissions.forEach(sub => {
      sub.isFirstSolve = sub.timestamp === seen.get(`${sub.username}:${sub.titleSlug}`);
    });

    return submissions;
  }

  function renderActivityList() {
    const filtered = activityFilter === 'first'
      ? allActivitySubmissions.filter(s => s.isFirstSolve)
      : activityFilter === 'repeat'
      ? allActivitySubmissions.filter(s => !s.isFirstSolve)
      : allActivitySubmissions;

    const visible = filtered.slice(0, activityDisplayCount);

    if (visible.length === 0) {
      const empty = ACTIVITY_EMPTY[activityFilter];
      activityFeed.innerHTML = `<div class="empty-state"><p>${empty.head}</p><span>${empty.sub}</span></div>`;
      return;
    }

    activityFeed.innerHTML = visible.map(s => renderActivityItem(s)).join('');

    const remaining = filtered.length - activityDisplayCount;
    if (remaining > 0) {
      activityFeed.innerHTML += `<button class="load-more-btn" id="load-more-activity">Show ${Math.min(remaining, ACTIVITY_PAGE_SIZE)} more</button>`;
      document.getElementById('load-more-activity').addEventListener('click', () => loadActivity(true));
    }

    fetchPercentilesForVisible(visible);
  }

  async function refreshActivityInBackground() {
    const fresh = await fetchActivityFromNetwork();
    if (!fresh.length) return;
    allActivitySubmissions = fresh;
    await StorageManager.set(StorageManager.KEYS.ACTIVITY_FEED_CACHE, { submissions: fresh, savedAt: Date.now() });
    renderActivityList();
  }

  async function loadActivity(showMore = false) {
    if (activityLoading) return;
    activityLoading = true;

    await ensurePercentileCache();
    activityDisplayCount = showMore ? activityDisplayCount + ACTIVITY_PAGE_SIZE : ACTIVITY_PAGE_SIZE;

    if (!activityDataLoaded) {
      const cached = await StorageManager.get(StorageManager.KEYS.ACTIVITY_FEED_CACHE);
      if (cached?.submissions?.length) {
        allActivitySubmissions = cached.submissions;
        activityDataLoaded = true;
        renderActivityList();
        activityLoading = false;
        refreshActivityInBackground();
        return;
      }

      activityFeed.innerHTML = '<div class="loading">Loading activity...</div>';
      LeetSquadUtils.armSlowHint(activityFeed);

      const fresh = await fetchActivityFromNetwork();
      if (fresh.length === 0) {
        activityFeed.innerHTML = `<div class="empty-state"><p>No activity yet</p><span>Add friends to see their activity!</span></div>`;
        activityLoading = false;
        return;
      }
      allActivitySubmissions = fresh;
      activityDataLoaded = true;
      await StorageManager.set(StorageManager.KEYS.ACTIVITY_FEED_CACHE, { submissions: fresh, savedAt: Date.now() });
    }

    renderActivityList();
    activityLoading = false;
  }

  // Hydrate percentiles from cache, then fetch only what's missing in small parallel batches.
  async function fetchPercentilesForVisible(items) {
    for (const sub of items) {
      if (sub.runtimePercentile == null && sub.id && percentileCache[sub.id]) {
        sub.runtimePercentile = percentileCache[sub.id].rt;
        sub.memoryPercentile = percentileCache[sub.id].mem;
      }
    }
    const missing = items.filter(s => s.id && s.runtimePercentile == null && !percentileCache[s.id]);
    if (missing.length === 0) return;

    let dirty = false;
    const CHUNK = 4;
    for (let i = 0; i < missing.length; i += CHUNK) {
      await Promise.all(missing.slice(i, i + CHUNK).map(async (sub) => {
        try {
          const details = await LeetCodeAPI.getSubmissionDetails(sub.id);
          if (!details) return;
          sub.runtimePercentile = details.runtimePercentile;
          sub.memoryPercentile = details.memoryPercentile;
          percentileCache[sub.id] = { rt: details.runtimePercentile, mem: details.memoryPercentile };
          dirty = true;
          const el = activityFeed.querySelector(`.activity-item[data-sub-id="${sub.id}"] .percentile-slot`);
          if (el && details.runtimePercentile) {
            const pct = details.runtimePercentile.toFixed(1);
            el.innerHTML = `<span class="percentile-badge" title="Beats ${pct}% in runtime">🏆${pct}%</span>`;
          }
        } catch (e) { /* non-critical */ }
      }));
    }

    if (dirty) {
      const keys = Object.keys(percentileCache);
      if (keys.length > 1000) for (const k of keys.slice(0, keys.length - 800)) delete percentileCache[k];
      try { await StorageManager.set(PERCENTILE_CACHE_KEY, percentileCache); } catch (e) {}
    }
  }

  // Activity filter toggle handler. Cycles: All -> First Solves -> Repeat Solves -> All
  activityFilterToggle.addEventListener('click', () => {
    const idx = ACTIVITY_FILTERS.indexOf(activityFilter);
    activityFilter = ACTIVITY_FILTERS[(idx + 1) % ACTIVITY_FILTERS.length];
    activityFilterToggle.classList.toggle('active', activityFilter !== 'all');
    filterLabel.textContent = ACTIVITY_FILTER_LABEL[activityFilter];
    activityFilterToggle.title = ACTIVITY_FILTER_TITLE[activityFilter];
    activityDisplayCount = ACTIVITY_PAGE_SIZE;
    loadActivity(false);
  });

  function renderActivityItem(submission) {
    const { username, title, titleSlug, lang, timestamp, runtime, avatar, isFirstSolve, runtimePercentile, id } = submission;
    const timeAgo = formatTimeAgo(timestamp * 1000);
    const displayName = username || 'Unknown';
    const initial = (displayName && displayName[0]) ? escapeHtml(displayName[0].toUpperCase()) : 'U';
    const gradient = getAvatarGradient(displayName);
    const safeName = escapeHtml(displayName);
    const safeAvatar = escapeHtml(LeetSquadUtils.safeAvatarUrl(avatar));
    const safeTitle = escapeHtml(title || '');
    const safeLang = escapeHtml(formatLanguage(lang));
    const safeRuntime = runtime ? escapeHtml(String(runtime)) : '';
    const safeSubId = id ? escapeHtml(String(id)) : '';

    const actionText = isFirstSolve ? 'solved' : 'submitted another solution for';

    const rp = runtimePercentile != null ? runtimePercentile : (id && percentileCache[id] ? percentileCache[id].rt : null);
    const percentileDisplay = rp != null
      ? (() => { const pct = rp.toFixed(1); return `<span class="percentile-badge" title="Beats ${pct}% in runtime">🏆${pct}%</span>`; })()
      : '';

    const submissionLink = id
      ? `https://leetcode.com/submissions/detail/${encodeURIComponent(id)}/`
      : `https://leetcode.com/problems/${encodeURIComponent(titleSlug || '')}`;

    return `
      <div class="activity-item ${isFirstSolve ? 'first-solve' : 'additional-solve'}" data-sub-id="${safeSubId}">
        <div class="activity-avatar">
          ${safeAvatar ?
            `<img src="${safeAvatar}" alt="${safeName}"/>` :
            `<span style="background:${gradient}">${initial}</span>`
          }
        </div>
        <div class="activity-content">
          <div class="activity-text">
            <strong>${safeName}</strong> ${actionText}
            <a href="${submissionLink}" target="_blank" class="problem-link">${safeTitle}</a>
            ${isFirstSolve ? `<span class="first-solve-badge">🎉<i class="confetti c1"></i><i class="confetti c2"></i><i class="confetti c3"></i><i class="confetti c4"></i><i class="confetti c5"></i><i class="confetti c6"></i></span>` : ''}
            <span class="percentile-slot">${percentileDisplay}</span>
            <span class="activity-meta">in ${safeLang}</span>
          </div>
          <div class="activity-time">${timeAgo}${safeRuntime ? ` · ${safeRuntime}` : ''}</div>
        </div>
      </div>
    `;
  }

  const formatTimeAgo = LeetSquadUtils.timeAgoMs;
  const formatLanguage = LeetSquadUtils.formatLanguage;

  // Load settings
  async function loadSettings() {
    const settings = await StorageManager.getSettings();
    if (settingShowWidget) settingShowWidget.checked = settings.showOnProblemPage;
    if (settingShowProblemList) settingShowProblemList.checked = settings.showOnProblemList !== false;
    if (settingNotifications) settingNotifications.checked = settings.notifications;
    if (settingDebugMode) settingDebugMode.checked = settings.debugMode || false;
    if (settingDailyGoal) settingDailyGoal.value = settings.dailyTarget || 1;

    const username = await StorageManager.getMyUsername();
    if (username) {
      myUsernameInput.value = username;
    }

    await renderSignInState();
    await renderShortcuts();
    await renderCloudSyncStatus();
    await updateCloudSyncNavStatus();
  }

  // ===== Cloud Sync (Phase B1: verify only) =====

  const settingCloudSync = document.getElementById('setting-cloud-sync');
  const cloudSyncStatusEl = document.getElementById('cloud-sync-status');
  const cloudVerifyModal = document.getElementById('cloud-verify-modal');
  const cloudVerifyNonceEl = document.getElementById('cloud-verify-nonce');
  const cloudVerifyCopyBtn = document.getElementById('cloud-verify-copy');
  const cloudVerifyGoBtn = document.getElementById('cloud-verify-go');
  const cloudVerifyCancelBtn = document.getElementById('cloud-verify-cancel');
  const cloudVerifyErrorEl = document.getElementById('cloud-verify-error');

  const shareProfileRow = document.getElementById('share-profile-row');
  const settingShareProfile = document.getElementById('setting-share-profile');
  const apiKeyRow = document.getElementById('cloud-sync-api-key');
  const apiKeyInput = document.getElementById('api-key-input');
  const apiKeyCopyBtn = document.getElementById('api-key-copy');
  const apiKeyRotateBtn = document.getElementById('api-key-rotate');
  const deleteMyDataBtn = document.getElementById('cloud-sync-delete-data');

  let pendingCloudUsername = null;

  async function renderShareProfileRow(verified) {
    if (!shareProfileRow) return;
    if (!verified) {
      shareProfileRow.classList.add('hidden');
      return;
    }
    shareProfileRow.classList.remove('hidden');
    const current = await CloudSync.getShareProfile();
    if (settingShareProfile && current !== null) settingShareProfile.checked = current;
  }

  settingShareProfile?.addEventListener('change', async (e) => {
    const resp = await CloudSync.setShareProfile(e.target.checked);
    if (!resp) {
      e.target.checked = !e.target.checked;
      showToast('Could not update sharing. Try again.', true);
    }
  });

  async function renderApiKeyRow(verified) {
    await renderShareProfileRow(verified);
    if (!apiKeyRow) return;
    if (!verified) {
      apiKeyRow.classList.add('hidden');
      if (apiKeyInput) apiKeyInput.value = '';
      return;
    }
    apiKeyRow.classList.remove('hidden');
    const key = await CloudSync.getApiKey();
    if (apiKeyInput) {
      apiKeyInput.value = key || '';
      apiKeyInput.placeholder = key ? '' : '(none locally; click ↻ to regenerate)';
    }
  }

  async function renderCloudSyncStatus() {
    if (!settingCloudSync || !cloudSyncStatusEl) return;
    const status = await CloudSync.getStatus();
    settingCloudSync.checked = !!status.enabled;
    cloudSyncStatusEl.classList.remove('connected', 'expired', 'error');
    if (status.enabled && status.verified) {
      cloudSyncStatusEl.classList.remove('hidden');
      cloudSyncStatusEl.classList.add('connected');
      const safe = LeetSquadUtils.escapeHtml(status.username || '');
      const last = status.lastSync ? LeetSquadUtils.timeAgoMs(status.lastSync) : 'pending';
      cloudSyncStatusEl.textContent = `Connected as @${safe} · synced ${last}.`;
      await renderApiKeyRow(true);
    } else if (status.enabled && status.tokenExpired) {
      cloudSyncStatusEl.classList.remove('hidden');
      cloudSyncStatusEl.classList.add('expired');
      cloudSyncStatusEl.innerHTML = `Token expired. <a href="#" id="cloud-sync-reverify">Re-verify</a>`;
      document.getElementById('cloud-sync-reverify')?.addEventListener('click', (e) => {
        e.preventDefault();
        beginCloudVerify();
      });
      await renderApiKeyRow(false);
    } else if (status.enabled) {
      cloudSyncStatusEl.classList.remove('hidden');
      cloudSyncStatusEl.classList.add('expired');
      cloudSyncStatusEl.innerHTML = `
        <div class="cloud-sync-cta">
          <span class="cloud-sync-cta-text">On but not verified. Friends won't see your historical solves.</span>
          <button type="button" class="btn btn-primary cloud-sync-cta-btn" id="cloud-sync-verify-now">Verify now</button>
        </div>
      `;
      document.getElementById('cloud-sync-verify-now')?.addEventListener('click', () => beginCloudVerify());
      await renderApiKeyRow(false);
    } else {
      cloudSyncStatusEl.classList.add('hidden');
      cloudSyncStatusEl.textContent = '';
      await renderApiKeyRow(false);
    }
  }

  settingCloudSync?.addEventListener('change', async (e) => {
    if (e.target.checked) {
      await CloudSync.setEnabled(true);
      await renderCloudSyncStatus();
      await updateCloudSyncNavStatus();
      await renderVerifyBanner();
      await beginCloudVerify();
    } else {
      const status = await CloudSync.getStatus();
      if (status.verified) {
        const ok = await customConfirm(
          'This signs you out on this device and stops publishing your solves to friends. Your cloud data stays on the server until you delete it.',
          { title: 'Turn off Cloud Sync?', confirmLabel: 'Turn off', danger: true }
        );
        if (!ok) {
          e.target.checked = true;
          return;
        }
      }
      await CloudSync.disconnect();
      await renderCloudSyncStatus();
      await updateCloudSyncNavStatus();
      await renderVerifyBanner();
    }
  });

  async function beginCloudVerify() {
    let username = await StorageManager.getMyUsername();
    if (!username) {
      try {
        const me = await LeetCodeAPI.getCurrentUser();
        if (me?.isSignedIn && me.username) username = me.username;
      } catch (e) {}
    }
    if (!username) {
      showToast('Set your LeetCode username first', true);
      return;
    }
    pendingCloudUsername = username;

    cloudVerifyErrorEl.classList.add('hidden');
    cloudVerifyErrorEl.textContent = '';
    cloudVerifyGoBtn.disabled = false;
    cloudVerifyGoBtn.textContent = 'Verify';

    try {
      const { nonce } = await CloudSync.startAuth(username);
      cloudVerifyNonceEl.textContent = nonce;
      cloudVerifyModal.classList.remove('hidden');
    } catch (e) {
      showToast('Could not reach LeetSquad server', true);
    }
  }

  cloudVerifyCancelBtn?.addEventListener('click', () => {
    cloudVerifyModal.classList.add('hidden');
  });

  cloudVerifyGoBtn?.addEventListener('click', async () => {
    if (!pendingCloudUsername) return;
    cloudVerifyGoBtn.disabled = true;
    cloudVerifyGoBtn.innerHTML = '<span class="spinner"></span> Verifying...';
    cloudVerifyErrorEl.classList.add('hidden');

    try {
      const resp = await browser.runtime.sendMessage(
        { action: 'verifyBio', nonce: cloudVerifyNonceEl.textContent, expectedUsername: pendingCloudUsername }
      )
        .then((r) => r || { ok: false, error: 'no_response' })
        .catch(() => ({ ok: false, error: 'no_response' }));

      if (!resp.ok) {
        cloudVerifyErrorEl.textContent = humanizeVerifyError(resp.error, resp.username);
        cloudVerifyErrorEl.classList.remove('hidden');
        cloudVerifyGoBtn.disabled = false;
        cloudVerifyGoBtn.textContent = 'Retry';
        return;
      }

      await CloudSync.storeToken({
        token: resp.token,
        expires_at: resp.expires_at,
        username: resp.username,
        api_key: resp.api_key,
      });
      await CloudSync.setEnabled(true);
      cloudVerifyModal.classList.add('hidden');
      await renderCloudSyncStatus();
      await updateCloudSyncNavStatus();
      await renderVerifyBanner();
      showToast(`Connected as @${resp.username}`);
      // Upload runs in the worker; the popup just nudges it so the first sync isn't delayed to the next alarm.
      browser.runtime.sendMessage({ action: 'uploadMySolvedSet', force: true });

      // Reconcile the friend list with the server (prompt on conflict); runs after verify so the JWT is set.
      reconcileFriendsAfterVerify().catch((e) => console.error('friend reconcile:', e));
    } catch (e) {
      cloudVerifyErrorEl.textContent = 'Verification failed. Try again.';
      cloudVerifyErrorEl.classList.remove('hidden');
      cloudVerifyGoBtn.disabled = false;
      cloudVerifyGoBtn.textContent = 'Retry';
    }
  });

  apiKeyCopyBtn?.addEventListener('click', async () => {
    const key = await CloudSync.getApiKey();
    if (!key) {
      showToast('No key to copy. Click ↻ to regenerate.', true);
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      const original = apiKeyCopyBtn.getAttribute('title');
      apiKeyCopyBtn.setAttribute('title', 'Copied');
      setTimeout(() => apiKeyCopyBtn.setAttribute('title', original || 'Copy API key'), 1500);
    } catch (e) {
      showToast('Clipboard copy blocked by browser', true);
    }
  });

  deleteMyDataBtn?.addEventListener('click', async () => {
    const ok = await customConfirm(
      'Wipes your solved-slug row, friend list, and API key on the server. ' +
      'Crowdsourced contributions about you are removed too. ' +
      'Other users who follow you keep your handle in their list (it\'s public anyway). ' +
      'Cloud Sync will be turned off locally. Cannot be undone.',
      { title: 'Delete all your cloud data?', confirmLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    deleteMyDataBtn.disabled = true;
    try {
      const resp = await browser.runtime.sendMessage({ action: 'deleteMyData' })
        .then((r) => r || { ok: false, error: 'no_response' })
        .catch(() => ({ ok: false, error: 'no_response' }));
      if (!resp.ok) {
        if (resp.error === 'jwt_expired' || resp.error === 'jwt_invalid' || resp.error === 'jwt_missing') {
          showToast('Cannot reach your account. Re-verify Cloud Sync and try again.', true);
        } else {
          showToast(`Could not delete data (${resp.error || 'unknown'}).`, true);
        }
        return;
      }
      await CloudSync.disconnect();
      if (settingCloudSync) settingCloudSync.checked = false;
      await renderCloudSyncStatus();
      await updateCloudSyncNavStatus();
      await renderVerifyBanner();
      showToast('Your data was deleted.');
    } finally {
      deleteMyDataBtn.disabled = false;
    }
  });

  apiKeyRotateBtn?.addEventListener('click', async () => {
    const ok = await customConfirm(
      'A new key will be issued and the old one will stop working immediately.',
      { title: 'Regenerate API key?', confirmLabel: 'Regenerate' }
    );
    if (!ok) return;
    apiKeyRotateBtn.classList.add('rotating');
    apiKeyRotateBtn.disabled = true;
    try {
      const resp = await browser.runtime.sendMessage({ action: 'rotateApiKey' })
        .then((r) => r || { ok: false, error: 'no_response' })
        .catch(() => ({ ok: false, error: 'no_response' }));
      if (!resp.ok) {
        if (resp.error === 'jwt_expired' || resp.error === 'jwt_invalid') {
          showToast('Re-verify Cloud Sync to issue a new key.', true);
        } else {
          showToast(`Could not rotate key (${resp.error || 'unknown'}).`, true);
        }
        return;
      }
      await CloudSync.setApiKey(resp.api_key);
      await renderApiKeyRow(true);
      showToast('New API key issued. Old key revoked.');
    } finally {
      apiKeyRotateBtn.classList.remove('rotating');
      apiKeyRotateBtn.disabled = false;
    }
  });

  function humanizeVerifyError(code, otherUser) {
    switch (code) {
      case 'not_signed_in':
        return 'You are not signed in to leetcode.com. Sign in and try again.';
      case 'wrong_signed_in_user':
        return `Your leetcode.com tab is signed in as @${otherUser || '?'}, not @${pendingCloudUsername}. Switch accounts and try again.`;
      case 'no_csrf':
        return 'Could not read your LeetCode session. Reload leetcode.com and try again.';
      case 'nonce_not_found_in_skills':
      case 'nonce_not_found_in_bio':
        return 'The verification tag did not reach your public profile yet. LeetCode caches may be lagging; wait a moment and click Retry.';
      case 'update_failed':
        return 'LeetCode rejected the bio update. Try the manual paste path below.';
      case 'leetcode_unreachable':
      case 'server_unreachable':
        return 'Network error. Check your connection and retry.';
      default:
        return code ? `Verification failed (${code}).` : 'Verification failed.';
    }
  }

  // ===== Friend-list reconcile (after verify) =====

  const friendsMergeModal = document.getElementById('friends-merge-modal');
  const friendsMergeLocalCountEl = document.getElementById('friends-merge-local-count');
  const friendsMergeServerCountEl = document.getElementById('friends-merge-server-count');
  const friendsMergeUnionBtn = document.getElementById('friends-merge-union');
  const friendsMergeServerBtn = document.getElementById('friends-merge-use-server');
  const friendsMergeLocalBtn = document.getElementById('friends-merge-use-local');

  function arraysSetEqual(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(a);
    for (const x of b) if (!s.has(x)) return false;
    return true;
  }

  async function applyMergedFriendList(merged) {
    await StorageManager.set(StorageManager.KEYS.FRIENDS, merged);
    try { browser.runtime?.sendMessage?.({ action: 'syncFriends' }); } catch (e) {}
    loadFriends();
    loadLeaderboard();
  }

  function showMergeModal(local, server) {
    return new Promise((resolve) => {
      friendsMergeLocalCountEl.textContent = String(local.length);
      friendsMergeServerCountEl.textContent = String(server.length);
      friendsMergeModal.classList.remove('hidden');

      const cleanup = () => {
        friendsMergeModal.classList.add('hidden');
        friendsMergeUnionBtn.removeEventListener('click', onUnion);
        friendsMergeServerBtn.removeEventListener('click', onServer);
        friendsMergeLocalBtn.removeEventListener('click', onLocal);
      };
      const onUnion = () => { cleanup(); resolve('union'); };
      const onServer = () => { cleanup(); resolve('server'); };
      const onLocal = () => { cleanup(); resolve('local'); };

      friendsMergeUnionBtn.addEventListener('click', onUnion);
      friendsMergeServerBtn.addEventListener('click', onServer);
      friendsMergeLocalBtn.addEventListener('click', onLocal);
    });
  }

  async function reconcileFriendsAfterVerify() {
    const localRaw = await StorageManager.getFriends();
    const local = Array.isArray(localRaw) ? localRaw : [];
    const server = await CloudSync.getServerFriends();

    if (server === null) {
      // Server unreachable or sync disabled; nothing to reconcile.
      return;
    }

    // Identical sets: no action needed.
    if (arraysSetEqual(local, server)) return;

    if (local.length === 0 && server.length > 0) {
      // Pure restore: take server's list silently.
      await applyMergedFriendList(server);
      showToast(`Restored ${server.length} friend(s) from cloud`);
      return;
    }

    if (server.length === 0 && local.length > 0) {
      // First push: send local up silently.
      try { browser.runtime?.sendMessage?.({ action: 'syncFriends' }); } catch (e) {}
      return;
    }

    // Both non-empty and differ: ask the user.
    const choice = await showMergeModal(local, server);
    let merged;
    if (choice === 'server') merged = server;
    else if (choice === 'local') merged = local;
    else merged = Array.from(new Set([...local, ...server]));
    await applyMergedFriendList(merged);
  }

  // The login card is a <details>; only its summary label changes by auth state. Cache the last username so the label renders before getCurrentUser returns.
  const SIGNED_IN_CACHE_KEY = 'cachedSignedInUser';
  const SIGNED_OUT_LABEL = 'Sign in (optional)';

  function setLoginLabel(username) {
    const label = document.getElementById('login-summary-label');
    if (!label) return;
    label.textContent = username
      ? `Signed in as @${username}`
      : SIGNED_OUT_LABEL;
  }

  async function renderSignInState() {
    const cached = await StorageManager.get(SIGNED_IN_CACHE_KEY);
    if (cached) setLoginLabel(cached);

    try {
      const status = await LeetCodeAPI.getCurrentUser();
      if (status?.isSignedIn && status.username) {
        if (status.username !== cached) {
          setLoginLabel(status.username);
          await StorageManager.set(SIGNED_IN_CACHE_KEY, status.username);
        }
      } else if (cached) {
        setLoginLabel(null);
        await StorageManager.set(SIGNED_IN_CACHE_KEY, null);
      }
    } catch (e) {
      // network/API failure: leave whatever we rendered (cached or default)
    }
  }

  // Show current bindings and link out to the browser's shortcuts page (extensions can't rewrite them).
  async function renderShortcuts() {
    if (!browser?.commands?.getAll) return;
    try {
      const commands = await browser.commands.getAll();
      const popupCmd = commands.find(c => c.name === '_execute_action');
      const widgetCmd = commands.find(c => c.name === 'toggle-widget');
      const popupEl = document.getElementById('shortcut-popup');
      const widgetEl = document.getElementById('shortcut-widget');
      if (popupEl) popupEl.textContent = popupCmd?.shortcut || 'unset';
      if (widgetEl) widgetEl.textContent = widgetCmd?.shortcut || 'unset';
    } catch (e) {}
  }

  document.getElementById('edit-shortcuts-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    // Firefox has no shortcuts deep link; about:addons is closest. Chrome deep-links.
    const isFirefox = browser.runtime.getURL('').startsWith('moz-extension://');
    browser.tabs.create({ url: isFirefox ? 'about:addons' : 'chrome://extensions/shortcuts' });
  });

  // Settings change handlers
  settingShowWidget?.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ showOnProblemPage: e.target.checked });
  });

  settingShowProblemList?.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ showOnProblemList: e.target.checked });
  });

  settingNotifications?.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ notifications: e.target.checked });
  });

  settingDebugMode?.addEventListener('change', async (e) => {
    await StorageManager.updateSettings({ debugMode: e.target.checked });
    if (e.target.checked) {
      showToast('Debug mode enabled - check browser console');
    } else {
      showToast('Debug mode disabled');
    }
  });

  settingDailyGoal?.addEventListener('change', async (e) => {
    const raw = parseInt(e.target.value, 10);
    const clamped = Math.min(99, Math.max(1, Number.isNaN(raw) ? 3 : raw));
    e.target.value = clamped;
    await StorageManager.setDailyTarget(clamped);
    updateDailyGoal();
  });

  const carryStreakBtn = document.getElementById('carry-streak-btn');
  carryStreakBtn?.addEventListener('click', async () => {
    carryStreakBtn.disabled = true;
    const original = carryStreakBtn.textContent;
    carryStreakBtn.innerHTML = '<span class="spinner"></span>';
    try {
      const username = await StorageManager.getMyUsername();
      const resp = await browser.runtime.sendMessage({ action: 'carryOverStreak', username })
        .then((r) => r || { ok: false })
        .catch(() => ({ ok: false }));
      if (resp.ok) {
        if (resp.streak > 0) {
          // Report the resulting streak, not LeetCode's number, so a smaller carry never looks like a downgrade.
          const goal = await StorageManager.getDailyGoals();
          const now = goal.streak || 0;
          showToast(resp.applied > 0 ? `Carried over, you're on a ${now}-day streak` : `You're already on a ${now}-day streak`);
        } else {
          showToast('No LeetCode streak found');
        }
        updateDailyGoal();
        browser.runtime.sendMessage({ action: 'syncDailyGoals' });
      } else {
        showToast('Could not read your LeetCode streak', true);
      }
    } finally {
      carryStreakBtn.textContent = original;
      carryStreakBtn.disabled = false;
    }
  });

  clearCacheBtn.addEventListener('click', async () => {
    await StorageManager.clearCache();
    showToast('Cache cleared!');
    loadLeaderboard();
    loadFriends();
  });

  const exportDataBtn = document.getElementById('export-data-btn');
  exportDataBtn?.addEventListener('click', async () => {
    try {
      const K = StorageManager.KEYS;
      const keys = [
        K.FRIENDS, K.MY_USERNAME, K.CACHE, K.SETTINGS, K.DAILY_GOALS,
        K.CHALLENGES, K.ACTIVITY_LOG, K.SOLVED_SETS,
        'leetsquad_achievements'
      ];
      const raw = await new Promise(resolve =>
        browser.storage.local.get(keys, resolve)
      );
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: raw
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leetsquad-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('Backup downloaded');
    } catch (e) {
      console.error('export failed:', e);
      showToast('Export failed', 'error');
    }
  });

  // Paint the footer from local storage (instant, no network).
  async function renderGoalFooter() {
    const goal = await StorageManager.getDailyGoals();
    const settings = await StorageManager.getSettings();
    // Target follows the current setting, not the value frozen into each day's entry.
    const target = settings.dailyTarget || 1;
    const completed = goal.completed || 0;
    const met = completed >= target;

    if (goalStreak) goalStreak.innerHTML = `<span class="num">${goal.streak || 0}</span> day streak`;
    if (goalFlame) goalFlame.classList.toggle('off', !met);

    // Ring only appears when the goal is set above 1; otherwise the flame is the whole story.
    if (goalRing) {
      if (target > 1) {
        goalRing.style.display = '';
        if (goalRingLabel) goalRingLabel.textContent = `${Math.min(completed, target)}/${target}`;
        if (goalRingFill) {
          const C = 69.1; // 2*pi*r for r=11
          goalRingFill.style.strokeDashoffset = String(C * (1 - Math.min(completed / target, 1)));
        }
      } else {
        goalRing.style.display = 'none';
      }
    }
    updateOpenProblemButton(completed);
  }

  // Daily goal - paint cached state instantly, then reconcile today's count from LeetCode.
  async function updateDailyGoal() {
    await renderGoalFooter();

    const myUsername = await StorageManager.getMyUsername();
    if (!myUsername) return;

    const submissions = await LeetCodeAPI.getRecentSubmissions(myUsername, 100);
    const today = new Date().toISOString().split('T')[0];
    const todayStart = new Date(today).getTime() / 1000;

    if (submissions && submissions.submission) {
      const todayAccepted = submissions.submission.filter(s =>
        s.statusDisplay === 'Accepted' && s.timestamp >= todayStart
      );
      const mySet = await StorageManager.getSolvedSet(myUsername);
      const prior = mySet?.slugs || {};
      // First-time solves only: re-solving a problem you'd already solved doesn't count.
      const uniqueProblems = [...new Set(todayAccepted.map(s => s.titleSlug))]
        .filter(slug => !(prior[slug] && prior[slug] < todayStart));

      const goals = await StorageManager.get('leetsquad_daily_goals') || {};
      if (!goals[today]) {
        const s = await StorageManager.getSettings();
        goals[today] = { target: s.dailyTarget || 1, completed: 0, problems: [] };
      }
      goals[today].completed = uniqueProblems.length;
      goals[today].problems = uniqueProblems;
      await StorageManager.set('leetsquad_daily_goals', goals);

      await renderGoalFooter();
    }
  }

  const OPEN_ICONS = {
    // calendar (today's question)
    daily: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    // shuffle (random unsolved)
    random: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
  };

  // Before the first solve of the day: open LeetCode's daily question. After: open an unsolved one.
  function updateOpenProblemButton(completedToday) {
    if (!openProblemBtn) return;
    if (completedToday === 0) {
      openProblemBtn.dataset.mode = 'daily';
      openProblemBtn.title = "Open today's LeetCode question";
      openProblemBtn.innerHTML = `${OPEN_ICONS.daily}<span>Daily</span>`;
    } else {
      openProblemBtn.dataset.mode = 'random';
      openProblemBtn.title = 'Open a random unsolved problem';
      openProblemBtn.innerHTML = `${OPEN_ICONS.random}<span>Random</span>`;
    }
  }

  // Prefer a problem one of your friends has already solved (so you can compare); otherwise truly random.
  async function pickUnsolvedSlug() {
    const catalog = await StorageManager.getProblemCatalog();
    const problems = catalog?.problems || {};
    const allSlugs = Object.keys(problems);
    if (allSlugs.length === 0) return null;

    const myUsername = await StorageManager.getMyUsername();
    const mySet = myUsername ? await StorageManager.getSolvedSet(myUsername) : { slugs: {} };
    const mySolved = mySet?.slugs || {};

    const unsolved = allSlugs.filter((s) => !mySolved[s] && !problems[s].paid);
    if (unsolved.length === 0) return null;

    const allSets = await StorageManager.getAllSolvedSets();
    const friendSolved = new Set();
    for (const [user, set] of Object.entries(allSets)) {
      if (user === myUsername) continue;
      for (const slug of Object.keys(set?.slugs || {})) friendSolved.add(slug);
    }
    const friendUnsolved = unsolved.filter((s) => friendSolved.has(s));
    const pool = friendUnsolved.length > 0 ? friendUnsolved : unsolved;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  openProblemBtn?.addEventListener('click', async () => {
    openProblemBtn.disabled = true;
    try {
      if (openProblemBtn.dataset.mode === 'daily') {
        const daily = await LeetCodeAPI.getDailyChallenge();
        const url = daily?.link
          ? `https://leetcode.com${daily.link}`
          : (daily?.slug ? `https://leetcode.com/problems/${daily.slug}/` : 'https://leetcode.com/problemset/');
        browser.tabs.create({ url });
      } else {
        const slug = await pickUnsolvedSlug();
        const url = slug ? `https://leetcode.com/problems/${slug}/` : 'https://leetcode.com/problemset/';
        if (!slug) showToast('No cached problem list yet. Opening the problemset.', true);
        browser.tabs.create({ url });
      }
    } catch (e) {
      showToast('Could not open a problem', true);
    } finally {
      openProblemBtn.disabled = false;
    }
  });

  // Toast banner above the daily-goal footer; red on error, green on success. Guards against a stray truthy value rendering as success.
  function customConfirm(body, opts = {}) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const bodyEl = document.getElementById('confirm-body');
      const okBtn = document.getElementById('confirm-ok');
      const cancelBtn = document.getElementById('confirm-cancel');
      if (!modal || !okBtn || !cancelBtn) return resolve(window.confirm(body));

      titleEl.textContent = opts.title || 'Are you sure?';
      bodyEl.textContent = body;
      okBtn.textContent = opts.confirmLabel || 'Confirm';
      cancelBtn.textContent = opts.cancelLabel || 'Cancel';
      if (opts.danger) okBtn.classList.add('btn-danger');
      else okBtn.classList.remove('btn-danger');

      const cleanup = (val) => {
        modal.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(val);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.classList.remove('hidden');
    });
  }

  function reportIssueUrl(code, ctx = {}) {
    const lines = [
      `Error code: ${code}`,
      ctx.kind ? `Where: ${ctx.kind}` : null,
      `Username: ${ctx.username || 'unknown'}`,
      `Extension version: ${browser.runtime.getManifest().version}`,
      `User agent: ${navigator.userAgent}`,
      '',
      'What I was trying to do:',
    ].filter(Boolean).join('\n');
    return (
      'https://github.com/m-durana/leetsquad-extension/issues/new?title=' +
      encodeURIComponent(`Sync failed: ${code}`) +
      '&body=' +
      encodeURIComponent(lines)
    );
  }

  function showFailureToast(message, code, ctx) {
    const url = reportIssueUrl(code, ctx);
    showToast(
      `${message} <a href="${url}" target="_blank" rel="noopener">Report this issue</a>`,
      true,
      { html: true, durationMs: 8000 }
    );
  }

  async function surfaceSyncErrorIfRecent() {
    try {
      const data = await new Promise((res) => browser.storage.local.get(['leetsquad_last_sync_error'], res));
      const err = data.leetsquad_last_sync_error;
      if (!err) return;
      if (Date.now() - (err.at || 0) > 24 * 60 * 60 * 1000) return;
      const dismissedKey = `leetsquad_sync_error_dismissed_${err.at}`;
      const d = await new Promise((res) => browser.storage.local.get([dismissedKey], res));
      if (d[dismissedKey]) return;
      const kindLabel = err.kind === 'upload' ? 'Cloud sync upload' : 'Friend list sync';
      const username = await StorageManager.getMyUsername();
      if (err.code === 'rate_limited') {
        showToast('Syncing too often. It will resume automatically in a minute.', 'error');
      } else {
        showFailureToast(`${kindLabel} failed (${err.code}).`, err.code, { kind: err.kind, username });
      }
      await browser.storage.local.set({ [dismissedKey]: Date.now() });
    } catch (e) {}
  }

  function showToast(message, type = 'success', opts = {}) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const isError = type === true || type === 'error' || type === 'err';
    const toast = document.createElement('div');
    toast.className = isError ? 'toast toast-error' : 'toast';
    if (opts.html) toast.innerHTML = message;
    else toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), opts.durationMs || 3000);
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
    LeetSquadUtils.armSlowHint(mutualsCommonList);

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
    const entry = await StorageManager.getCachedDataWithStale(username);
    if (entry && !entry.stale) return entry.data;

    const fresh = await LeetCodeAPI.getFullUserData(username);
    if (fresh) {
      await StorageManager.setCachedData(username, fresh);
      return fresh;
    }
    return entry?.data || null;
  }

  // Render user avatar and name in mutuals
  function renderMutualsUser(avatarEl, nameEl, username, data, displayOverride = null) {
    const safeAvatar = escapeHtml(LeetSquadUtils.safeAvatarUrl(data?.profile?.avatar));
    const gradient = getAvatarGradient(username);

    const safeName = escapeHtml(username);
    if (safeAvatar) {
      avatarEl.innerHTML = `<img src="${safeAvatar}" alt="${safeName}"/>`;
    } else {
      const initial = escapeHtml(username[0]?.toUpperCase() || 'U');
      avatarEl.innerHTML = `<span style="background:${gradient};width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:12px">${initial}</span>`;
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

    // /solved only returns recent ~50; merge in the cumulative local set
    const [myExtraSet, friendExtraSet] = await Promise.all([
      StorageManager.getSolvedSet(myUsername),
      StorageManager.getSolvedSet(friendUsername)
    ]);
    function humanizeSlug(slug) {
      return slug.split('-').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
    }
    function mergeIn(list, set) {
      const seen = new Set(list.map(p => p.titleSlug));
      for (const slug of Object.keys(set?.slugs || {})) {
        if (!seen.has(slug)) {
          list.push({ titleSlug: slug, title: humanizeSlug(slug), difficulty: null });
          seen.add(slug);
        }
      }
      return list;
    }
    mySolved = mergeIn(mySolved, myExtraSet);
    friendSolved = mergeIn(friendSolved, friendExtraSet);

    if (settings.debugMode) {
      console.log('[LeetSquad Debug] Processed solved arrays:', {
        mySolvedCount: mySolved.length,
        friendSolvedCount: friendSolved.length,
        mySolvedSample: mySolved.slice(0, 3),
        friendSolvedSample: friendSolved.slice(0, 3)
      });
    }

    // Fallback to GraphQL submissions if the solved endpoint returns no arrays; recentAcSubmissionList is capped at ~20-50 recent.
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

        // LeetCode's recentAcSubmissionList doesn't expose difficulty; leave null.
        if (mySubmissions && mySolved.length === 0) {
          mySolved = mySubmissions.map(s => ({
            titleSlug: s.titleSlug,
            title: s.title,
            difficulty: null
          }));
        }

        if (friendSubmissions && friendSolved.length === 0) {
          friendSolved = friendSubmissions.map(s => ({
            titleSlug: s.titleSlug,
            title: s.title,
            difficulty: null
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
          difficulty: myProblem.difficulty || friendProblem.difficulty || null,
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
      const aOrder = a.difficulty in diffOrder ? diffOrder[a.difficulty] : 3;
      const bOrder = b.difficulty in diffOrder ? diffOrder[b.difficulty] : 3;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return (a.title || '').localeCompare(b.title || '');
    });

    const [mySolvedSet, friendSolvedSet] = await Promise.all([
      StorageManager.getSolvedSet(myUsername),
      StorageManager.getSolvedSet(friendUsername),
    ]);
    const mySlugTs = mySolvedSet?.slugs || {};
    const friendSlugTs = friendSolvedSet?.slugs || {};

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

      const safeTitle = escapeHtml(problem.title || problem.titleSlug || '');
      const safeDiff = escapeHtml(problem.difficulty || '');
      const diffClass = (problem.difficulty || '').toLowerCase();
      const myTs = mySlugTs[problem.titleSlug];
      const friendTs = friendSlugTs[problem.titleSlug];
      const myRt = escapeHtml(myData?.runtime || (myTs ? LeetSquadUtils.timeAgo(myTs) : '-'));
      const friendRt = escapeHtml(friendData?.runtime || (friendTs ? LeetSquadUtils.timeAgo(friendTs) : '-'));
      const slugHref = `https://leetcode.com/problems/${encodeURIComponent(problem.titleSlug || '')}`;
      return `
        <a class="mutuals-problem" href="${slugHref}" target="_blank">
          <div class="mutuals-problem-info">
            <div class="mutuals-problem-title">${safeTitle}</div>
            <div class="mutuals-problem-meta">
              <span class="mutuals-problem-difficulty ${diffClass}">${safeDiff}</span>
            </div>
          </div>
          <div class="mutuals-problem-compare">
            <div class="mutuals-problem-stat ${myWinner}">
              <span class="mutuals-problem-stat-label">You</span>
              <span class="mutuals-problem-stat-value ${myData?.runtime ? 'runtime' : ''}">${myRt}</span>
            </div>
            <div class="mutuals-problem-stat ${friendWinner}">
              <span class="mutuals-problem-stat-label">Them</span>
              <span class="mutuals-problem-stat-value ${friendData?.runtime ? 'runtime' : ''}">${friendRt}</span>
            </div>
          </div>
        </a>
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

  // pre-set toggle state before paint to suppress the off->on slide animation
  document.body.classList.add('preload');
  await loadSettings();
  requestAnimationFrame(() => document.body.classList.remove('preload'));

  await loadMyUsername();
  renderVerifyBanner().catch(() => {});
  updateCloudSyncNavStatus().catch(() => {});
  surfaceSyncErrorIfRecent().catch(() => {});

  // First-run: if no username set but signed in to leetcode.com, fill it silently so the empty-state isn't a hard prerequisite.
  if (!myUsernameInput.value) {
    detectMyUsername({ silent: true }).catch(() => {});
  } else {
    // Returning user: try the daily self-import in the background.
    maybeSelfImport(myUsernameInput.value).catch(() => {});
  }
  backfillExistingFriends().catch(() => {});

  await loadLeaderboard();
  await updateDailyGoal();
});
