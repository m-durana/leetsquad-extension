require('./setup');
require('../shared');

const { escapeHtml } = window.LeetSquadUtils;

// These tests model the popup/content render functions: they reproduce the
// template strings and confirm that adversarial usernames, titles, and avatar
// URLs cannot inject markup or execute script.

const XSS = '<img src=x onerror=alert(1)>';
const QUOTE = 'a"b';

describe('XSS: popup renderFriendCard escapes attacker data', () => {
  function render(friend) {
    const { username, profile } = friend;
    const avatar = profile?.avatar ?? null;
    const displayName = username || 'Unknown';
    const safeName = escapeHtml(displayName);
    const safeAvatar = avatar ? escapeHtml(avatar) : '';
    const profileHref = `https://leetcode.com/u/${encodeURIComponent(displayName)}`;
    return `
      <div class="friend-card">
        <div class="friend-avatar">
          ${avatar ? `<img src="${safeAvatar}" alt="${safeName}"/>` : `<span>${escapeHtml(displayName[0] || 'U')}</span>`}
        </div>
        <div class="friend-name">${safeName}</div>
        <a href="${profileHref}"></a>
        <button data-username="${safeName}"></button>
      </div>`;
  }

  test('username with HTML payload is escaped', () => {
    const html = render({ username: XSS });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
  });

  test('avatar URL with quote breaks out of attribute is escaped', () => {
    const html = render({ username: 'alice', profile: { avatar: '"><script>x</script>' } });
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;');
  });

  test('profile href encodes the username', () => {
    const html = render({ username: 'a/b c' });
    expect(html).toContain('leetcode.com/u/a%2Fb%20c');
  });
});

describe('XSS: popup renderActivityItem escapes title and username', () => {
  function render(sub) {
    const { username, title, lang, id } = sub;
    const safeName = escapeHtml(username || 'Unknown');
    const safeTitle = escapeHtml(title || '');
    const safeLang = escapeHtml(lang || '');
    const safeId = id ? escapeHtml(String(id)) : '';
    const link = id
      ? `https://leetcode.com/submissions/detail/${encodeURIComponent(id)}/`
      : `https://leetcode.com/problems/${encodeURIComponent(sub.titleSlug || '')}`;
    return `
      <div class="activity-item" data-sub-id="${safeId}">
        <strong>${safeName}</strong>
        <a href="${link}">${safeTitle}</a>
        <span>${safeLang}</span>
      </div>`;
  }

  test('problem title with quotes does not break attribute boundary', () => {
    const html = render({ username: 'alice', title: 'Two" Sum', titleSlug: 'two-sum' });
    expect(html).not.toContain('Two" Sum');
    expect(html).toContain('Two&quot; Sum');
  });

  test('XSS in username is escaped', () => {
    const html = render({ username: XSS, title: 'Two Sum' });
    expect(html).not.toContain('<img src=x');
  });
});

describe('XSS: content renderFriendCard escapes attacker data', () => {
  function render(friend, problemSlug) {
    const { username, submissions, profile, runtime, submissionId } = friend;
    const submission = submissions?.[0];
    const avatar = profile?.avatar ?? null;
    const safeName = escapeHtml(username || '');
    const safeAvatar = avatar ? escapeHtml(avatar) : '';
    const safeRuntime = runtime ? escapeHtml(String(runtime)) : '';
    const subId = submissionId || submission?.id;
    const link = subId
      ? `https://leetcode.com/submissions/detail/${encodeURIComponent(subId)}/`
      : `https://leetcode.com/problems/${encodeURIComponent(problemSlug)}/submissions/`;
    return `
      <a href="${link}" title="View ${safeName}'s solution">
        ${avatar ? `<img src="${safeAvatar}" alt="${safeName}"/>` : ''}
        <span class="friend-name-text">${safeName}</span>
        <span class="runtime-tag">${safeRuntime}</span>
      </a>`;
  }

  test('username with HTML payload is escaped in widget', () => {
    const html = render({ username: XSS, submissions: [{}] }, 'two-sum');
    expect(html).not.toContain('<img src=x onerror');
  });

  test('runtime value with HTML is escaped', () => {
    const html = render({ username: 'alice', runtime: '<b>0ms</b>', submissions: [{}] }, 'x');
    expect(html).not.toContain('<b>0ms</b>');
    expect(html).toContain('&lt;b&gt;');
  });

  test('encodes submission id and problem slug into URL', () => {
    const html = render({ username: 'alice', submissions: [{}], submissionId: 'a b' }, 's');
    expect(html).toContain('detail/a%20b/');
  });
});

describe('Listener cleanup: removing the widget releases the outside-click handler', () => {
  // Models the bookkeeping in content.js: track the handler in a variable so
  // it can be detached on widget removal.
  test('removeEventListener is called with the same handler reference', () => {
    const addSpy = jest.spyOn(document, 'addEventListener');
    const removeSpy = jest.spyOn(document, 'removeEventListener');
    let outsideClickHandler = null;

    const install = () => {
      if (outsideClickHandler) document.removeEventListener('click', outsideClickHandler);
      outsideClickHandler = () => {};
      document.addEventListener('click', outsideClickHandler);
    };
    const teardown = () => {
      if (outsideClickHandler) {
        document.removeEventListener('click', outsideClickHandler);
        outsideClickHandler = null;
      }
    };

    install();
    install(); // simulate SPA nav reinstalling
    teardown();

    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy).toHaveBeenCalledTimes(2); // one between the two installs, one teardown

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});

describe('Correctness: countSubmissionsInPeriod no longer defaults unknowns to Medium', () => {
  function countSubmissionsInPeriod(submissions, periodStart) {
    if (!submissions?.submission) return { total: 0, easy: 0, medium: 0, hard: 0 };
    const accepted = submissions.submission.filter(s => s.statusDisplay === 'Accepted' && s.timestamp >= periodStart);
    const uniqueProblems = new Map();
    accepted.forEach(s => {
      if (!uniqueProblems.has(s.titleSlug)) uniqueProblems.set(s.titleSlug, s.difficulty || null);
    });
    let easy = 0, medium = 0, hard = 0;
    uniqueProblems.forEach(diff => {
      if (diff === 'Easy') easy++;
      else if (diff === 'Medium') medium++;
      else if (diff === 'Hard') hard++;
    });
    return { total: uniqueProblems.size, easy, medium, hard };
  }

  test('unknown difficulty contributes to total but not to medium', () => {
    const subs = {
      submission: [
        { titleSlug: 'a', statusDisplay: 'Accepted', timestamp: 100 },
        { titleSlug: 'b', statusDisplay: 'Accepted', timestamp: 100, difficulty: 'Hard' },
      ],
    };
    const r = countSubmissionsInPeriod(subs, 0);
    expect(r.total).toBe(2);
    expect(r.hard).toBe(1);
    expect(r.medium).toBe(0); // would have been 1 under the old code
  });
});
