(async () => {
  const verifyBtn = document.getElementById('verify-btn');
  const skipBtn = document.getElementById('skip-btn');
  const warning = document.getElementById('signin-warning');
  const errorEl = document.getElementById('error');

  skipBtn.addEventListener('click', () => {
    chrome.storage.local.set({ leetsquad_welcome_skipped: Date.now() });
    window.close();
  });

  let signedIn = null;
  let username = null;
  try {
    const r = await fetch('https://leetcode.com/graphql/', {
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

  verifyBtn.textContent = `Verify as @${username}`;
  verifyBtn.disabled = false;

  verifyBtn.addEventListener('click', async () => {
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Starting…';
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

    verifyBtn.textContent = 'Writing skill tag…';

    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: 'verifyBio', nonce, expectedUsername: username },
        (r) => resolve(r || { ok: false, error: 'no_response' })
      );
    });

    if (!resp.ok) {
      errorEl.textContent = `Verification failed (${resp.error || 'unknown'}). Open the popup → Cloud Sync settings and retry.`;
      errorEl.classList.remove('hidden');
      verifyBtn.disabled = false;
      verifyBtn.textContent = `Verify as @${username}`;
      return;
    }

    await chrome.storage.local.set({
      leetsquad_cloud_sync_token: resp.token,
      leetsquad_cloud_sync_token_exp: resp.expires_at,
      leetsquad_cloud_sync_username: resp.username,
      leetsquad_cloud_sync_enabled: true,
      leetsquad_welcome_skipped: Date.now(),
    });
    if (resp.api_key) {
      await chrome.storage.local.set({ leetsquad_cloud_sync_api_key: resp.api_key });
    }

    verifyBtn.textContent = 'Verified ✓ closing…';
    setTimeout(() => window.close(), 1200);
  });
})();
