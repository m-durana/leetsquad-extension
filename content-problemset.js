(function () {
  'use strict';

  const BADGED_ATTR = 'data-leetsquad-badged';
  const STACK_CLASS = 'ls-ps-stack';
  const MAX_AVATARS = 3;

  const escape = (s) => (window.LeetSquadUtils?.escapeHtml || ((x) => x))(s ?? '');
  const safeAvatar = (u) => (window.LeetSquadUtils?.safeAvatarUrl || (() => ''))(u);
  const gradientFor = (u) => (window.LeetSquadUtils?.getAvatarGradient || (() => '#444'))(u);
  const timeAgo = (sec) => (window.LeetSquadUtils?.timeAgo || (() => ''))(sec);

  let solversBySlug = new Map();
  let observer = null;
  let scanScheduled = false;

  function slugFromHref(href) {
    if (!href) return null;
    const m = href.match(/\/problems\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  async function buildSolversMap() {
    const [friends, allSolved, cacheRaw] = await Promise.all([
      StorageManager.getFriends(),
      StorageManager.getAllSolvedSets(),
      StorageManager.get(StorageManager.KEYS.CACHE).then(v => v || {})
    ]);
    const map = new Map();

    for (const friend of friends || []) {
      const set = allSolved[friend];
      if (!set?.slugs) continue;

      const profileEntry = cacheRaw[`${friend}:full`] || cacheRaw[friend];
      const avatarUrl = safeAvatar(
        profileEntry?.profile?.avatar
        || profileEntry?.profile?.userAvatar
        || profileEntry?.avatar
        || null
      );

      const ids = set.submissionIds || {};
      for (const slug in set.slugs) {
        const ts = set.slugs[slug] || 0;
        let arr = map.get(slug);
        if (!arr) { arr = []; map.set(slug, arr); }
        arr.push({ username: friend, avatarUrl, solvedAt: ts, submissionId: ids[slug] || null });
      }
    }

    for (const list of map.values()) list.sort((a, b) => b.solvedAt - a.solvedAt);
    return map;
  }

  function hrefFor(s, slug) {
    return s.submissionId
      ? `https://leetcode.com/submissions/detail/${encodeURIComponent(s.submissionId)}/`
      : `https://leetcode.com/u/${encodeURIComponent(s.username)}/solutions/`;
  }

  function renderStackHtml(solvers, slug) {
    const shown = solvers.slice(0, MAX_AVATARS);
    const extra = solvers.length - shown.length;
    const avatars = shown.map((s, i) => {
      const safeName = escape(s.username);
      const initial = escape((s.username || '?')[0].toUpperCase());
      const inner = s.avatarUrl
        ? `<img src="${escape(s.avatarUrl)}" alt="${safeName}"/>`
        : `<span class="ls-ps-initial" style="background:${gradientFor(s.username)}">${initial}</span>`;
      return `<span class="ls-ps-avatar" data-ls-href="${escape(hrefFor(s, slug))}" title="View ${safeName}'s submission" style="z-index:${10 - i}">${inner}</span>`;
    }).join('');
    const plus = extra > 0 ? `<span class="ls-ps-avatar ls-ps-more">+${extra}</span>` : '';

    const popoverRows = solvers.map(s => {
      const safeName = escape(s.username);
      const initial = escape((s.username || '?')[0].toUpperCase());
      const ago = s.solvedAt ? escape(timeAgo(s.solvedAt)) : '';
      const inner = s.avatarUrl
        ? `<img src="${escape(s.avatarUrl)}" alt=""/>`
        : `<span class="ls-ps-initial" style="background:${gradientFor(s.username)}">${initial}</span>`;
      return `<div class="ls-ps-row" data-ls-href="${escape(hrefFor(s, slug))}">
        <span class="ls-ps-row-avatar">${inner}</span>
        <span class="ls-ps-row-name">${safeName}</span>
        <span class="ls-ps-row-time">${ago}</span>
      </div>`;
    }).join('');

    return `<span class="${STACK_CLASS}" tabindex="0">
      <span class="ls-ps-avatars">${avatars}${plus}</span>
      <span class="ls-ps-popover" role="tooltip">
        <span class="ls-ps-popover-title">${solvers.length} friend${solvers.length === 1 ? '' : 's'} solved</span>
        ${popoverRows}
      </span>
    </span>`;
  }

  function injectIntoRow(anchor) {
    if (anchor.getAttribute(BADGED_ATTR)) return;
    const slug = slugFromHref(anchor.getAttribute('href'));
    if (!slug) return;
    const solvers = solversBySlug.get(slug);
    if (!solvers || solvers.length === 0) {
      anchor.setAttribute(BADGED_ATTR, 'empty');
      return;
    }

    const titleText = anchor.querySelector('.ellipsis.line-clamp-1');
    const titleWrap = titleText?.closest('.text-body') || titleText?.parentElement;
    if (!titleWrap || !titleWrap.parentNode) {
      anchor.setAttribute(BADGED_ATTR, 'no-title');
      return;
    }

    const host = document.createElement('span');
    host.className = 'ls-ps-host';
    host.innerHTML = renderStackHtml(solvers, slug);
    titleWrap.parentNode.insertBefore(host, titleWrap.nextSibling);
    anchor.setAttribute(BADGED_ATTR, '1');
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const anchors = scope.querySelectorAll(`a[href^="/problems/"]:not([${BADGED_ATTR}])`);
    anchors.forEach(injectIntoRow);
  }

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scan(document);
    });
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.addedNodes && m.addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function clearAll() {
    document.querySelectorAll('.ls-ps-host').forEach(n => n.remove());
    document.querySelectorAll(`a[${BADGED_ATTR}]`).forEach(a => a.removeAttribute(BADGED_ATTR));
  }

  async function rebuildAndScan() {
    solversBySlug = await buildSolversMap();
    clearAll();
    scheduleScan();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[StorageManager.KEYS.SOLVED_SETS]
        || changes[StorageManager.KEYS.FRIENDS]
        || changes[StorageManager.KEYS.CACHE]) {
      rebuildAndScan();
    }
  });

  ['pushState', 'replaceState'].forEach((fn) => {
    const original = history[fn];
    history[fn] = function () {
      const r = original.apply(this, arguments);
      window.dispatchEvent(new Event('leetsquad:ps-nav'));
      return r;
    };
  });
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('leetsquad:ps-nav')));
  window.addEventListener('leetsquad:ps-nav', scheduleScan);

  document.addEventListener('click', (e) => {
    const target = e.target && e.target.closest && e.target.closest('[data-ls-href]');
    if (!target) return;
    const href = target.getAttribute('data-ls-href');
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    window.open(href, '_blank', 'noopener');
  }, true);

  (async function init() {
    try {
      const settings = await StorageManager.getSettings();
      if (settings.showOnProblemList === false) return;
      solversBySlug = await buildSolversMap();
      setupObserver();
      scheduleScan();
    } catch (e) {
      console.error('[LeetSquad problemset] init failed:', e);
    }
  })();
})();
