(async () => {
  const LC_GRAPHQL = 'https://leetcode.com/graphql/';

  const pageIds = { verify: 'page-verify', carry: 'page-carry', done: 'page-done' };
  function showPage(name) {
    Object.entries(pageIds).forEach(([k, id]) => document.getElementById(id).classList.toggle('on', k === name));
  }

  const verifyTitle = document.getElementById('verify-title');
  const verifyBtn = document.getElementById('verify-btn');
  const skipBtn = document.getElementById('skip-btn');
  const warning = document.getElementById('signin-warning');
  const errorEl = document.getElementById('error');

  const carryDays = document.getElementById('carry-days');
  const carryBtnDays = document.getElementById('carry-btn-days');
  const carryBtn = document.getElementById('carry-btn');
  const carrySkipBtn = document.getElementById('carry-skip-btn');
  const carryError = document.getElementById('carry-error');

  const openExtBtn = document.getElementById('open-ext-btn');

  let signedIn = false, username = null, lcStreak = 0;

  const markDone = () => browser.storage.local.set({ leetsquad_welcome_skipped: Date.now() });

  // After verify or skip on page 1: go to the carry page only if there's a streak, else straight to done.
  function advanceFromVerify() {
    if (lcStreak > 0) {
      carryDays.textContent = lcStreak;
      carryBtnDays.textContent = lcStreak;
      showPage('carry');
    } else {
      showPage('done');
    }
  }

  // openPopup needs a user gesture and is unsupported on older browsers; fall back to a toolbar hint.
  openExtBtn.addEventListener('click', async () => {
    try {
      await browser.action.openPopup();
    } catch (e) {
      openExtBtn.textContent = 'Click the LeetSquad icon in your toolbar';
      openExtBtn.disabled = true;
    }
  });

  skipBtn.addEventListener('click', () => { markDone(); advanceFromVerify(); });
  carrySkipBtn.addEventListener('click', () => showPage('done'));

  carryBtn.addEventListener('click', async () => {
    carryBtn.disabled = true;
    carrySkipBtn.disabled = true;
    carryError.classList.add('hidden');
    carryBtn.innerHTML = '<span class="spinner"></span> Carrying over…';
    const r = await browser.runtime.sendMessage({ action: 'carryOverStreak', username })
      .then((x) => x || { ok: false })
      .catch(() => ({ ok: false }));
    if (r.ok && r.streak > 0) {
      carryBtn.textContent = `Carried over ${r.streak} days ✓`;
      setTimeout(() => showPage('done'), 900);
    } else if (r.ok) {
      showPage('done');
    } else {
      carryBtn.disabled = false;
      carrySkipBtn.disabled = false;
      carryBtn.textContent = `Carry over ${lcStreak} days`;
      carryError.textContent = 'Could not read your LeetCode streak. You can skip; your streak still counts from here on.';
      carryError.classList.remove('hidden');
    }
  });

  // Detect LeetCode sign-in + username.
  try {
    const r = await fetch(LC_GRAPHQL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query { userStatus { isSignedIn username } }' }),
    });
    const j = await r.json();
    signedIn = !!j?.data?.userStatus?.isSignedIn;
    username = j?.data?.userStatus?.username || null;
  } catch (e) {
    signedIn = false;
  }

  if (!signedIn) {
    warning.classList.remove('hidden');
    verifyBtn.textContent = 'Verify (sign in first)';
    verifyBtn.disabled = true;
    return;
  }

  // Greet by name (set via textContent so a username can't inject markup).
  if (username) {
    verifyTitle.textContent = '';
    verifyTitle.append('Hi ');
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = username;
    verifyTitle.append(nm, ', one last step');
  }
  verifyBtn.textContent = `Verify as @${username}`;
  verifyBtn.disabled = false;

  // Best-effort streak read to decide whether the carry-over page appears.
  try {
    const sr = await fetch(LC_GRAPHQL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'query getStreakCounter { streakCounter { streakCount } }', operationName: 'getStreakCounter', variables: {} }),
    });
    const sj = await sr.json();
    lcStreak = sj?.data?.streakCounter?.streakCount || 0;
  } catch (e) {
    lcStreak = 0;
  }

  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = '<span class="spinner"></span> Starting…';
    errorEl.classList.add('hidden');

    let nonce;
    try {
      const base = (typeof LeetSquadUtils !== 'undefined' && LeetSquadUtils.CLOUD_BASE) || 'https://leetsquad.miro.build';
      const r = await fetch(`${base}/auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lc_username: username }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `server_${r.status}`);
      nonce = j.nonce;
    } catch (e) {
      errorEl.textContent = `Could not reach the LeetSquad server (${e.message}). Try again later.`;
      errorEl.classList.remove('hidden');
      verifyBtn.disabled = false;
      verifyBtn.textContent = `Verify as @${username}`;
      return;
    }

    verifyBtn.innerHTML = '<span class="spinner"></span> Writing skill tag…';

    const resp = await browser.runtime.sendMessage({ action: 'verifyBio', nonce, expectedUsername: username })
      .then((r) => r || { ok: false, error: 'no_response' })
      .catch(() => ({ ok: false, error: 'no_response' }));

    if (!resp.ok) {
      errorEl.textContent = `Verification failed (${resp.error || 'unknown'}). Open the popup → Cloud Sync settings and retry.`;
      errorEl.classList.remove('hidden');
      verifyBtn.disabled = false;
      verifyBtn.textContent = `Verify as @${username}`;
      return;
    }

    await browser.storage.local.set({
      leetsquad_cloud_sync_token: resp.token,
      leetsquad_cloud_sync_token_exp: resp.expires_at,
      leetsquad_cloud_sync_username: resp.username,
      leetsquad_cloud_sync_enabled: true,
      leetsquad_welcome_skipped: Date.now(),
    });
    if (resp.api_key) {
      await browser.storage.local.set({ leetsquad_cloud_sync_api_key: resp.api_key });
    }

    advanceFromVerify();
  });
})();
