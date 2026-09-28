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

  // Fetch a friend's published solved set and merge locally. Returns { ok, updated_at, count } or { ok:false, error }.
  async fetchAndMergeFriend(username) {
    try {
      const r = await fetch(`${this.BASE}/user/${encodeURIComponent(username)}`);
      if (r.status === 404) return { ok: false, error: 'not_found' };
      if (!r.ok) return { ok: false, error: `http_${r.status}` };
      const body = await r.json();
      const details = body?.solved_slug_details;
      let entries;
      if (details && typeof details === 'object') {
        entries = Object.entries(details).map(([slug, rec]) => ({
          titleSlug: slug,
          timestamp: rec?.ts || 0,
          id: rec?.id,
          lang: rec?.lang,
          rt: rec?.rt,
          mem: rec?.mem,
        }));
      } else if (Array.isArray(body?.slugs)) {
        entries = body.slugs.map((s) => ({ titleSlug: s, timestamp: 0 }));
      } else {
        return { ok: false, error: 'bad_payload' };
      }
      await StorageManager.mergeSolvedSlugs(username, entries);
      return { ok: true, updated_at: body.updated_at, count: entries.length };
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

  // Server's stored friend list, or null if sync is off/unverified/errored. Never throws.
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

  // Replace the server's friend list; returns the canonical list the server kept, or null on failure.
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

  async getServerDailyGoals() {
    const token = await this._jwtIfEnabled();
    if (!token) return null;
    try {
      const r = await fetch(`${this.BASE}/daily-goals`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!r.ok) return null;
      const body = await r.json();
      return body && typeof body.goals === 'object' ? { goals: body.goals, updated_at: body.updated_at || 0 } : null;
    } catch (e) {
      return null;
    }
  },

  async putServerDailyGoals(goals) {
    const token = await this._jwtIfEnabled();
    if (!token) return null;
    try {
      const r = await fetch(`${this.BASE}/daily-goals`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ goals }),
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  },

  // merge local and server goals; for overlapping dates, take the one with higher 'completed'
  async syncDailyGoals() {
    const status = await this.getStatus();
    if (!status.enabled || !status.verified) return null;

    const local = (await StorageManager.get(StorageManager.KEYS.DAILY_GOALS)) || {};
    const remote = await this.getServerDailyGoals();
    if (!remote) return null;

    const merged = { ...remote.goals };
    for (const day of Object.keys(local)) {
      const a = local[day];
      const b = merged[day];
      if (!b) { merged[day] = a; continue; }
      const aSet = new Set(a.problems || []);
      const bSet = new Set(b.problems || []);
      for (const p of bSet) aSet.add(p);
      const problems = Array.from(aSet);
      merged[day] = {
        target: Math.max(a.target || 0, b.target || 0),
        completed: Math.max(a.completed || 0, b.completed || 0, problems.length),
        problems
      };
    }

    await StorageManager.set(StorageManager.KEYS.DAILY_GOALS, merged);
    await this.putServerDailyGoals(merged);
    return merged;
  },

  // Fetch the global problem catalog (public), persist locally with a 24h TTL; safe to call every popup open.
  async fetchProblemCatalogIfStale() {
    const CATALOG_TTL_MS = 24 * 60 * 60_000;
    try {
      const local = await StorageManager.getProblemCatalog();
      const fresh = local?.updated_at && Date.now() - local.updated_at < CATALOG_TTL_MS;
      if (fresh) return { ok: true, cached: true };
      const r = await fetch(`${this.BASE}/api/v1/catalog`);
      if (!r.ok) return { ok: false, error: `http_${r.status}` };
      const body = await r.json();
      if (!body?.problems || typeof body.problems !== 'object') return { ok: false, error: 'bad_payload' };
      await StorageManager.setProblemCatalog({
        updated_at: body.updated_at || Date.now(),
        total_count: body.total_count || Object.keys(body.problems).length,
        problems: body.problems,
      });
      return { ok: true, cached: false, count: Object.keys(body.problems).length };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  },

  // Disconnect locally only; server data is retained by design (delete via Settings > Delete my data).
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
