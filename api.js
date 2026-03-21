// LeetCode API wrapper - Direct GraphQL queries (no third-party dependency)
// Features: in-memory cache, request deduplication, concurrency control, batch queries
const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';

const API_CONFIG = {
  maxConcurrent: 3,         // max parallel network requests
  maxRetries: 3,            // retry count on failure
  retryDelay: 1000,         // initial retry delay (ms)
  retryMultiplier: 2,       // exponential backoff multiplier
  timeout: 15000,           // per-request timeout (ms)
  cacheTTL: 5 * 60 * 1000, // in-memory cache TTL (5 min)
  batchSize: 5,             // users per batched GraphQL query
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ===== In-Memory Response Cache =====
// Keyed by method+args, survives across page navigations within the same tab session.
const _cache = new Map();

function _getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < API_CONFIG.cacheTTL) return entry.data;
  if (entry) _cache.delete(key);
  return undefined; // undefined = cache miss (distinguishes from cached null)
}

function _setCache(key, data) {
  _cache.set(key, { data, ts: Date.now() });
  // Evict stale entries when cache grows large
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of _cache) {
      if (now - v.ts > API_CONFIG.cacheTTL) _cache.delete(k);
    }
  }
}

// ===== In-Flight Request Deduplication =====
// If identical request is already pending, return same promise instead of firing duplicate.
const _inflight = new Map();

// ===== Concurrency Control (Semaphore) =====
// Limits parallel network requests to avoid overwhelming LeetCode's rate limiter.
let _activeRequests = 0;
const _waitQueue = [];

async function _acquireSlot() {
  if (_activeRequests < API_CONFIG.maxConcurrent) {
    _activeRequests++;
    return;
  }
  await new Promise(resolve => _waitQueue.push(resolve));
  _activeRequests++;
}

function _releaseSlot() {
  _activeRequests--;
  if (_waitQueue.length > 0) _waitQueue.shift()();
}

// ===== Cached Method Wrapper =====
// Wraps an async method with: (1) in-memory cache lookup, (2) in-flight dedup.
// The underlying graphqlQuery handles concurrency + retry.
function _cached(prefix, fn) {
  return async function(...args) {
    const key = `${prefix}:${JSON.stringify(args)}`;

    const cached = _getCached(key);
    if (cached !== undefined) return cached;

    if (_inflight.has(key)) return _inflight.get(key);

    const promise = fn.apply(this, args).then(result => {
      _setCache(key, result);
      _inflight.delete(key);
      return result;
    }, error => {
      _inflight.delete(key);
      throw error;
    });

    _inflight.set(key, promise);
    return promise;
  };
}


const LeetCodeAPI = {
  // ============= Core GraphQL Engine =============

  // Get CSRF token from cookies (content script context)
  getCsrfToken() {
    if (typeof document !== 'undefined' && document.cookie) {
      const match = document.cookie.match(/csrftoken=([^;]+)/);
      if (match) return match[1];
    }
    return null;
  },

  // Get CSRF token using chrome.cookies API (popup/background context)
  async getCsrfTokenAsync() {
    const syncToken = this.getCsrfToken();
    if (syncToken) return syncToken;

    if (typeof chrome !== 'undefined' && chrome.cookies) {
      try {
        const cookie = await chrome.cookies.get({
          url: 'https://leetcode.com',
          name: 'csrftoken'
        });
        return cookie?.value || null;
      } catch (e) {
        // Not available in this context
      }
    }
    return null;
  },

  // Execute a GraphQL query with concurrency control and retry.
  // This is the raw network layer — caching/dedup happens at the method level via _cached.
  async graphqlQuery(query, variables = {}, retries = API_CONFIG.maxRetries) {
    await _acquireSlot();

    try {
      const csrfToken = await this.getCsrfTokenAsync();

      const headers = {
        'Content-Type': 'application/json',
        'Referer': 'https://leetcode.com',
      };
      if (csrfToken) {
        headers['x-csrftoken'] = csrfToken;
      }

      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const response = await Promise.race([
            fetch(LEETCODE_GRAPHQL, {
              method: 'POST',
              headers,
              credentials: 'include',
              body: JSON.stringify({ query, variables })
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Request timeout')), API_CONFIG.timeout)
            )
          ]);

          if (response.status === 429) {
            if (attempt < retries) {
              const retryDelay = API_CONFIG.retryDelay * Math.pow(API_CONFIG.retryMultiplier, attempt);
              console.log(`Rate limited, retrying in ${retryDelay}ms...`);
              await delay(retryDelay);
              continue;
            }
            throw new Error('Rate limited');
          }

          if (!response.ok) {
            throw new Error(`GraphQL request failed: ${response.status}`);
          }

          const data = await response.json();
          if (data.errors) {
            console.error('GraphQL errors:', data.errors);
            throw new Error(data.errors[0]?.message || 'GraphQL error');
          }

          return data.data;
        } catch (error) {
          if (attempt === retries) {
            console.error('GraphQL query failed:', error.message);
            throw error;
          }
          const retryDelay = API_CONFIG.retryDelay * Math.pow(API_CONFIG.retryMultiplier, attempt);
          await delay(retryDelay);
        }
      }
    } finally {
      _releaseSlot();
    }
  },

  // ============= User Profile =============

  getUserProfile: _cached('profile', async function(username) {
    const query = `
      query getUserProfile($username: String!) {
        allQuestionsCount {
          difficulty
          count
        }
        matchedUser(username: $username) {
          username
          githubUrl
          twitterUrl
          linkedinUrl
          contributions {
            points
            questionCount
            testcaseCount
          }
          profile {
            realName
            userAvatar
            birthday
            ranking
            reputation
            websites
            countryName
            company
            school
            skillTags
            aboutMe
            starRating
          }
          badges {
            id
            displayName
            icon
            creationDate
          }
          activeBadge {
            id
            displayName
            icon
            creationDate
          }
          submitStats {
            totalSubmissionNum {
              difficulty
              count
              submissions
            }
            acSubmissionNum {
              difficulty
              count
              submissions
            }
          }
          submissionCalendar
        }
      }
    `;

    try {
      const data = await LeetCodeAPI.graphqlQuery(query, { username });
      if (!data?.matchedUser) return null;

      const user = data.matchedUser;
      const profile = user.profile || {};
      const acStats = user.submitStats?.acSubmissionNum || [];

      // Normalize to match the shape the rest of the extension expects
      return {
        username: user.username,
        avatar: profile.userAvatar || null,
        ranking: profile.ranking,
        realName: profile.realName,
        reputation: profile.reputation,
        company: profile.company,
        school: profile.school,
        country: profile.countryName,
        contributions: user.contributions,
        badges: user.badges,
        activeBadge: user.activeBadge,
        submissionCalendar: user.submissionCalendar,
        submitStats: user.submitStats,
        // Flatten solved counts for easy access
        easySolved: acStats.find(s => s.difficulty === 'Easy')?.count || 0,
        mediumSolved: acStats.find(s => s.difficulty === 'Medium')?.count || 0,
        hardSolved: acStats.find(s => s.difficulty === 'Hard')?.count || 0,
        totalSolved: acStats.find(s => s.difficulty === 'All')?.count || 0,
        allQuestionsCount: data.allQuestionsCount
      };
    } catch (error) {
      console.error(`Error fetching profile for ${username}:`, error);
      return null;
    }
  }),

  // ============= Solved Problems =============

  getUserSolvedProblems: _cached('solved', async function(username) {
    const query = `
      query userProfileUserQuestionProgressV2($userSlug: String!) {
        userProfileUserQuestionProgressV2(userSlug: $userSlug) {
          numAcceptedQuestions {
            count
            difficulty
          }
          numFailedQuestions {
            count
            difficulty
          }
          numUntouchedQuestions {
            count
            difficulty
          }
          userSessionBeatsPercentage {
            difficulty
            percentage
          }
        }
      }
    `;

    try {
      const data = await LeetCodeAPI.graphqlQuery(query, { userSlug: username });
      const progress = data?.userProfileUserQuestionProgressV2;
      if (!progress) return null;

      const accepted = progress.numAcceptedQuestions || [];
      return {
        easySolved: accepted.find(q => q.difficulty === 'EASY')?.count || 0,
        mediumSolved: accepted.find(q => q.difficulty === 'MEDIUM')?.count || 0,
        hardSolved: accepted.find(q => q.difficulty === 'HARD')?.count || 0,
        solvedProblem: accepted.reduce((sum, q) => sum + q.count, 0),
        beatsPercentage: progress.userSessionBeatsPercentage,
        questionProgress: progress
      };
    } catch (error) {
      console.error(`Error fetching solved problems for ${username}:`, error);
      return null;
    }
  }),

  // ============= Submissions =============

  getRecentSubmissions: _cached('recentSubs', async function(username, limit = 20) {
    const query = `
      query getRecentSubmissions($username: String!, $limit: Int) {
        recentSubmissionList(username: $username, limit: $limit) {
          title
          titleSlug
          timestamp
          statusDisplay
          lang
        }
      }
    `;

    try {
      const data = await LeetCodeAPI.graphqlQuery(query, { username, limit });
      // Wrap in { submission: [...] } to match existing code expectations
      return { submission: data?.recentSubmissionList || [] };
    } catch (error) {
      console.error(`Error fetching submissions for ${username}:`, error);
      return null;
    }
  }),

  getRecentAcSubmissions: _cached('acSubs', async function(username, limit = 20) {
    const query = `
      query getACSubmissions($username: String!, $limit: Int!) {
        recentAcSubmissionList(username: $username, limit: $limit) {
          id
          title
          titleSlug
          timestamp
          lang
          runtime
          memory
        }
      }
    `;

    try {
      const data = await LeetCodeAPI.graphqlQuery(query, { username, limit });
      return data?.recentAcSubmissionList || [];
    } catch (error) {
      console.error(`Error fetching AC submissions for ${username}:`, error);
      return [];
    }
  }),

  // ============= Contest =============

  getContestHistory: _cached('contest', async function(username) {
    const query = `
      query getUserContestRanking($username: String!) {
        userContestRanking(username: $username) {
          attendedContestsCount
          rating
          globalRanking
          totalParticipants
          topPercentage
          badge { name }
        }
        userContestRankingHistory(username: $username) {
          attended
          rating
          ranking
          trendDirection
          problemsSolved
          totalProblems
          finishTimeInSeconds
          contest {
            title
            startTime
          }
        }
      }
    `;

    try {
      const data = await LeetCodeAPI.graphqlQuery(query, { username });
      return data || null;
    } catch (error) {
      console.error(`Error fetching contest history for ${username}:`, error);
      return null;
    }
  }),

  // ============= Calendar =============

  getUserCalendar: _cached('calendar', async function(username, year = null) {
    const query = `
      query userProfileCalendar($username: String!, $year: Int) {
        matchedUser(username: $username) {
          userCalendar(year: $year) {
            activeYears
            streak
            totalActiveDays
            submissionCalendar
          }
        }
      }
    `;

    try {
      const data = await LeetCodeAPI.graphqlQuery(query, { username, year });
      return data?.matchedUser?.userCalendar || null;
    } catch (error) {
      console.error(`Error fetching calendar for ${username}:`, error);
      return null;
    }
  }),

  // ============= Composite Data Methods =============

  async getFullUserData(username) {
    const profile = await this.getUserProfile(username);
    const solved = await this.getUserSolvedProblems(username);
    const submissions = await this.getRecentSubmissions(username);

    return {
      username,
      profile,
      solved,
      submissions,
      contest: null,
      calendar: null,
      fetchedAt: Date.now()
    };
  },

  async getEssentialUserData(username) {
    const profile = await this.getUserProfile(username);
    const solved = await this.getUserSolvedProblems(username);

    return {
      username,
      profile,
      solved,
      submissions: null,
      contest: null,
      calendar: null,
      fetchedAt: Date.now()
    };
  },

  // ============= Batch Methods =============
  // These use GraphQL aliases to fetch data for multiple users in a single request.
  // Falls back to individual requests if the batch query fails.

  async batchGetRecentAcSubmissions(usernames, limit = 50) {
    if (usernames.length === 0) return {};
    if (usernames.length === 1) {
      const subs = await this.getRecentAcSubmissions(usernames[0], limit);
      return { [usernames[0]]: subs };
    }

    const results = {};
    const needed = [];

    // Check in-memory cache first
    for (const u of usernames) {
      const key = `acSubs:${JSON.stringify([u, limit])}`;
      const cached = _getCached(key);
      if (cached !== undefined) {
        results[u] = cached;
      } else {
        needed.push(u);
      }
    }

    if (needed.length === 0) return results;

    // Batch in groups to avoid overly large queries
    for (let i = 0; i < needed.length; i += API_CONFIG.batchSize) {
      const batch = needed.slice(i, i + API_CONFIG.batchSize);

      try {
        const varDefs = batch.map((_, j) => `$u${j}: String!`).join(', ');
        const fields = batch.map((_, j) =>
          `user_${j}: recentAcSubmissionList(username: $u${j}, limit: $limit) {
            id title titleSlug timestamp lang runtime memory
          }`
        ).join('\n');

        const query = `query BatchAcSubs(${varDefs}, $limit: Int!) {\n${fields}\n}`;
        const variables = { limit };
        batch.forEach((u, j) => { variables[`u${j}`] = u; });

        const data = await this.graphqlQuery(query, variables);

        batch.forEach((u, j) => {
          const subs = data?.[`user_${j}`] || [];
          results[u] = subs;
          // Populate individual cache so getRecentAcSubmissions() hits cache too
          _setCache(`acSubs:${JSON.stringify([u, limit])}`, subs);
        });
      } catch (e) {
        console.warn('Batch AC submissions failed, falling back to individual requests:', e.message);
        for (const u of batch) {
          try {
            results[u] = await this.getRecentAcSubmissions(u, limit);
          } catch (err) {
            results[u] = [];
          }
        }
      }
    }

    return results;
  },

  async batchGetUserProfiles(usernames) {
    if (usernames.length === 0) return {};
    if (usernames.length === 1) {
      const profile = await this.getUserProfile(usernames[0]);
      return { [usernames[0]]: profile };
    }

    const results = {};
    const needed = [];

    // Check cache first
    for (const u of usernames) {
      const key = `profile:${JSON.stringify([u])}`;
      const cached = _getCached(key);
      if (cached !== undefined) {
        results[u] = cached;
      } else {
        needed.push(u);
      }
    }

    if (needed.length === 0) return results;

    for (let i = 0; i < needed.length; i += API_CONFIG.batchSize) {
      const batch = needed.slice(i, i + API_CONFIG.batchSize);

      try {
        const varDefs = batch.map((_, j) => `$u${j}: String!`).join(', ');
        const fields = batch.map((_, j) =>
          `user_${j}: matchedUser(username: $u${j}) {
            username
            profile {
              realName
              userAvatar
              ranking
              reputation
            }
            submitStats {
              acSubmissionNum {
                difficulty
                count
              }
            }
          }`
        ).join('\n');

        const query = `query BatchProfiles(${varDefs}) {\n${fields}\n}`;
        const variables = {};
        batch.forEach((u, j) => { variables[`u${j}`] = u; });

        const data = await this.graphqlQuery(query, variables);

        batch.forEach((u, j) => {
          const user = data?.[`user_${j}`];
          if (user) {
            const profile = user.profile || {};
            const acStats = user.submitStats?.acSubmissionNum || [];
            const normalized = {
              username: user.username,
              avatar: profile.userAvatar || null,
              ranking: profile.ranking,
              realName: profile.realName,
              reputation: profile.reputation,
              submitStats: user.submitStats,
              easySolved: acStats.find(s => s.difficulty === 'Easy')?.count || 0,
              mediumSolved: acStats.find(s => s.difficulty === 'Medium')?.count || 0,
              hardSolved: acStats.find(s => s.difficulty === 'Hard')?.count || 0,
              totalSolved: acStats.find(s => s.difficulty === 'All')?.count || 0,
            };
            results[u] = normalized;
            _setCache(`profile:${JSON.stringify([u])}`, normalized);
          } else {
            results[u] = null;
            _setCache(`profile:${JSON.stringify([u])}`, null);
          }
        });
      } catch (e) {
        console.warn('Batch profiles failed, falling back to individual requests:', e.message);
        for (const u of batch) {
          try {
            results[u] = await this.getUserProfile(u);
          } catch (err) {
            results[u] = null;
          }
        }
      }
    }

    return results;
  },

  // High-level: check if multiple users solved a specific problem in one shot.
  // Returns { username: { solved, submission } }
  async batchCheckSolved(usernames, problemSlug, limit = 50) {
    const acByUser = await this.batchGetRecentAcSubmissions(usernames, limit);

    const results = {};
    for (const username of usernames) {
      const subs = acByUser[username] || [];
      const found = subs.find(s => s.titleSlug === problemSlug);
      results[username] = found
        ? { solved: true, submission: found }
        : { solved: false };
    }
    return results;
  },

  // ============= Problem-Specific Checks =============

  // Check if a user has solved a specific problem
  async hasUserSolvedProblem(username, problemSlug) {
    // Use recent AC submissions to check (up to 50)
    const submissions = await this.getRecentAcSubmissions(username, 50);
    if (!submissions || submissions.length === 0) return { solved: false };

    const found = submissions.find(s => s.titleSlug === problemSlug);
    if (found) {
      return {
        solved: true,
        problem: found,
        submission: found
      };
    }

    return { solved: false };
  },

  // Get submission details for a specific problem from recent submissions
  async getProblemSubmissions(username, problemSlug) {
    const subs = await this.getRecentSubmissions(username, 100);
    if (!subs?.submission) return [];

    return subs.submission.filter(s => s.titleSlug === problemSlug);
  },

  // Get submission details by ID (requires authentication)
  async getSubmissionDetails(submissionId) {
    const query = `
      query submissionDetails($submissionId: Int!) {
        submissionDetails(submissionId: $submissionId) {
          runtime
          runtimeDisplay
          runtimePercentile
          memory
          memoryDisplay
          memoryPercentile
          code
          timestamp
          statusCode
          lang {
            name
            verboseName
          }
          question {
            questionId
            titleSlug
            title
            difficulty
          }
        }
      }
    `;

    try {
      const data = await this.graphqlQuery(query, { submissionId: parseInt(submissionId) });
      return data?.submissionDetails || null;
    } catch (error) {
      console.error('Error fetching submission details:', error);
      return null;
    }
  },

  // Check if a user has solved a specific problem via recent AC submissions + optional percentile
  async hasUserSolvedProblemGraphQL(username, titleSlug) {
    const submissions = await this.getRecentAcSubmissions(username, 50);
    if (!submissions || submissions.length === 0) {
      return { solved: false };
    }

    const found = submissions.find(s => s.titleSlug === titleSlug);
    if (found) {
      const result = {
        solved: true,
        submission: found,
        runtime: found.runtime || null
      };

      // Try to fetch detailed submission info including percentile
      if (found.id) {
        try {
          const details = await this.getSubmissionDetails(found.id);
          if (details) {
            result.runtimePercentile = details.runtimePercentile;
            result.memoryPercentile = details.memoryPercentile;
            result.runtimeDisplay = details.runtimeDisplay;
            result.memoryDisplay = details.memoryDisplay;
          }
        } catch (e) {
          // Continue without percentile data
        }
      }

      return result;
    }

    return { solved: false };
  },

  // Get user's solved count by difficulty
  async getUserSolvedCount(username) {
    const solved = await this.getUserSolvedProblems(username);
    if (!solved) return null;

    return {
      total: solved.solvedProblem || 0,
      easy: solved.easySolved || 0,
      medium: solved.mediumSolved || 0,
      hard: solved.hardSolved || 0
    };
  },

  // Get enhanced data (profile + question progress + recent submissions)
  async getEnhancedUserData(username) {
    const basicData = await this.getEssentialUserData(username);

    try {
      const recentAc = await this.getRecentAcSubmissions(username, 50);
      return {
        ...basicData,
        graphql: {
          questionProgress: basicData.solved?.questionProgress || null,
          recentWithBeats: recentAc
        }
      };
    } catch (error) {
      console.log('Enhanced data fetch failed, using basic data:', error);
      return basicData;
    }
  },

  // Backwards compatibility alias
  async getRecentAcSubmissionsWithBeats(username, limit = 20) {
    return this.getRecentAcSubmissions(username, limit);
  },

  // Clear in-memory cache (useful for manual refresh)
  clearMemoryCache() {
    _cache.clear();
    _inflight.clear();
  }
};

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.LeetCodeAPI = LeetCodeAPI;
}
