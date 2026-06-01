// Cloud sync client (Phase B1: verify only).
// Talks to the LeetSquad server to prove ownership of a LeetCode account by
// briefly writing a server-issued nonce into the user's profile bio, then
// reading it back from the public profile via the server.

const CloudSync = {
  get BASE() {
    return (typeof LeetSquadUtils !== 'undefined' && LeetSquadUtils?.CLOUD_BASE)
      || (typeof window !== 'undefined' && window.LeetSquadUtils?.CLOUD_BASE)
      || 'https://leetsquad.miro.build';
  },

  async startAuth(username) {
    const r = await fetch(`${this.BASE}/auth/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lc_username: username }),
    });
    if (!r.ok) throw new Error(`auth/start failed: ${r.status}`);
    return r.json();
  },

  async verifyAuth(username) {
    const r = await fetch(`${this.BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lc_username: username }),
    });
    if (r.status === 403) {
      const body = await r.json().catch(() => ({}));
      const err = new Error(body.error || 'verify_failed');
      err.code = body.error;
      throw err;
    }
    if (!r.ok) throw new Error(`auth/verify failed: ${r.status}`);
    return r.json();
  },

  async getStatus() {
    if (typeof StorageManager === 'undefined') return { enabled: true, verified: false };
    const raw = await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_ENABLED);
    // Default ON: only explicit `false` opts out.
    const enabled = raw === null || raw === undefined ? true : !!raw;
    const token = await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_TOKEN);
    const exp = await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_TOKEN_EXP);
    const username = await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_USERNAME);
    const lastSync = await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_LAST_AT);
    const expired = !exp || Date.now() >= exp;
    return {
      enabled,
      verified: !!token && !expired,
      tokenExpired: !!token && expired,
      username,
      lastSync,
    };
  },

  async storeToken({ token, expires_at, username }) {
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_TOKEN, token);
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_TOKEN_EXP, expires_at);
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_USERNAME, username);
  },

  async clearToken() {
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_TOKEN);
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_TOKEN_EXP);
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_USERNAME);
  },

  async setEnabled(on) {
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_ENABLED, !!on);
  },

  // Fetch a friend's cloud-published solved set and merge it into local
  // storage. Returns { ok, updated_at, count } or { ok: false, error }.
  async fetchAndMergeFriend(username) {
    try {
      const r = await fetch(`${this.BASE}/user/${encodeURIComponent(username)}`);
      if (r.status === 404) return { ok: false, error: 'not_found' };
      if (!r.ok) return { ok: false, error: `http_${r.status}` };
      const { slugs, updated_at } = await r.json();
      if (!Array.isArray(slugs)) return { ok: false, error: 'bad_payload' };
      const entries = slugs.map((s) => ({ titleSlug: s, timestamp: 0 }));
      await StorageManager.mergeSolvedSlugs(username, entries);
      return { ok: true, updated_at, count: slugs.length };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  },

  // Disconnect locally: stop syncing. Server data is retained by design;
  // users request data deletion via a GitHub issue.
  async disconnect() {
    await this.clearToken();
    await this.setEnabled(false);
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_LAST_AT);
  },
};

if (typeof window !== 'undefined') {
  window.CloudSync = CloudSync;
}
if (typeof module !== 'undefined') {
  module.exports = CloudSync;
}
