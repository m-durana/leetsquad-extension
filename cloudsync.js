// Cloud sync client: bio-nonce verify, JWT/api-key storage, friends sync.

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

  async storeToken({ token, expires_at, username, api_key }) {
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_TOKEN, token);
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_TOKEN_EXP, expires_at);
    await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_USERNAME, username);
    if (api_key) {
      await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_API_KEY, api_key);
    }
  },

  async clearToken() {
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_TOKEN);
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_TOKEN_EXP);
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_USERNAME);
  },

  async getApiKey() {
    if (typeof StorageManager === 'undefined') return null;
    return await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_API_KEY);
  },

  async setApiKey(key) {
    if (!key) {
      await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_API_KEY);
    } else {
      await StorageManager.set(StorageManager.KEYS.CLOUD_SYNC_API_KEY, key);
    }
  },

  async clearApiKey() {
    await StorageManager.remove(StorageManager.KEYS.CLOUD_SYNC_API_KEY);
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

  // === Friend list sync (internal, JWT-auth, gated by cloud sync enabled) ===

  async _jwtIfEnabled() {
    const status = await this.getStatus();
    if (!status.enabled || !status.verified) return null;
    return await StorageManager.get(StorageManager.KEYS.CLOUD_SYNC_TOKEN);
  },

  // Returns the server's stored friend list, or null if cloud sync is off /
  // unverified / a fetch error happens. Never throws.
  async getServerFriends() {
    const token = await this._jwtIfEnabled();
    if (!token) return null;
    try {
      const r = await fetch(`${this.BASE}/friends`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const body = await r.json();
      return Array.isArray(body.friends) ? body.friends : null;
    } catch (e) {
      return null;
    }
  },

  // Replaces the server's friend list with the given array. Returns the
  // canonical list the server kept (deduped, validated), or null on failure.
  async putServerFriends(friends) {
    const token = await this._jwtIfEnabled();
    if (!token) return null;
    try {
      const r = await fetch(`${this.BASE}/friends`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ friends }),
      });
      if (!r.ok) return null;
      const body = await r.json();
      return Array.isArray(body.friends) ? body.friends : null;
    } catch (e) {
      return null;
    }
  },

  // Disconnect locally: stop syncing. Server data is retained by design;
  // users request data deletion via a GitHub issue.
  async disconnect() {
    await this.clearToken();
    await this.clearApiKey();
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
