// LeetCode API wrapper: direct GraphQL with in-memory cache, dedup, concurrency control, batching.
const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';

// TTL comes from LeetSquadUtils.CACHE_TTL_MS when shared.js is loaded; fallback for tests.
const _SHARED_TTL = (typeof LeetSquadUtils !== 'undefined' && LeetSquadUtils?.CACHE_TTL_MS)
  || (typeof window !== 'undefined' && window.LeetSquadUtils?.CACHE_TTL_MS)
  || 10 * 60 * 1000;

// Under Jest, skip real backoff waits; prod keeps the 1s base delay.
const _IS_TEST_ENV = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test';

const API_CONFIG = {
  maxConcurrent: 3,         // max parallel network requests
  maxRetries: 3,            // retry count on failure
  retryDelay: _IS_TEST_ENV ? 0 : 1000, // initial retry delay (ms)
  retryMultiplier: 2,       // exponential backoff multiplier
  timeout: 15000,           // per-request timeout (ms)
  cacheTTL: _SHARED_TTL,    // unified in shared.js (LEETSQUAD_CACHE_TTL_MS)
  batchSize: 5,             // users per batched GraphQL query
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// In-memory response cache, keyed by method+args; survives page navs within a tab.
const _cache = new Map();

function _getCached(key) {
  const entry = _cache.get(key);
  if (entry && Date.now() - entry.ts < API_CONFIG.cacheTTL) return entry.data;
  if (entry) _cache.delete(key);
  return undefined; // undefined = cache miss (distinguishes from cached null)
}

function _setCache(key, data) {
  // Re-insert to move the key to the end: a free LRU on the Map's iteration order.
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, { data, ts: Date.now() });

  if (_cache.size > 500) {
    const now = Date.now();
    // Phase 1: drop anything past TTL.
    for (const [k, v] of _cache) {
      if (now - v.ts > API_CONFIG.cacheTTL) _cache.delete(k);
    }
    // Phase 2: if still over the cap, drop oldest insertions until we're under.
    while (_cache.size > 500) {
      const oldest = _cache.keys().next().value;
      if (oldest === undefined) break;
      _cache.delete(oldest);
    }
  }
}

// In-flight dedup: reuse a pending identical request instead of firing a duplicate.
const _inflight = new Map();

// Concurrency semaphore: cap parallel requests to avoid LeetCode's rate limiter.
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

// Cached method wrapper: in-memory cache + in-flight dedup (graphqlQuery handles concurrency/retry).
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

  // Get CSRF token using browser.cookies API (popup/background context)
  async getCsrfTokenAsync() {
    const syncToken = this.getCsrfToken();
    if (syncToken) return syncToken;

    if (typeof browser !== 'undefined' && browser.cookies) {
      try {
        const cookie = await browser.cookies.get({
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

  // Raw network layer: GraphQL with concurrency + retry (caching/dedup live at the method level).
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

  // ============= Full Self-Import (auth-only) =============

  // Full AC list for the signed-in user via problemsetQuestionList. Paginated.
  async getMySolvedSlugs(opts = {}) {
    const query = `
      query problemsetQuestionList($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
        problemsetQuestionList: questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
          total: totalNum
          questions: data {
            titleSlug
          }
        }
      }
    `;
    const LIMIT = opts.limit || 100;
    const MAX_PAGES = opts.maxPages || 40;
    const slugs = [];
    let skip = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await this.graphqlQuery(query, {
        categorySlug: 'all-code-essentials',
        skip,
        limit: LIMIT,
        filters: { status: 'AC' },
      });
      const result = data?.problemsetQuestionList;
      if (!result || !Array.isArray(result.questions)) break;
      for (const q of result.questions) {
        if (q?.titleSlug) slugs.push(q.titleSlug);
      }
      skip += LIMIT;
      if (typeof result.total === 'number' && skip >= result.total) break;
      if (result.questions.length === 0) break;
    }

    return slugs;
  },

  // Owner-only paginated list of interacted questions: [{ titleSlug, lastSubmittedAt(sec), numSubmitted, questionStatus }].
  async getMyProgressQuestionList(opts = {}) {
    const query = `
      query userProgressQuestionList($filters: UserProgressQuestionListInput) {
        userProgressQuestionList(filters: $filters) {
          totalNum
          questions {
            titleSlug
            lastSubmittedAt
            numSubmitted
            questionStatus
            lastResult
          }
        }
      }
    `;
    const LIMIT = opts.limit || 50;
    const MAX_PAGES = opts.maxPages || 80;
    const out = [];
    let skip = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      let data;
      try {
        data = await this.graphqlQuery(query, { filters: { skip, limit: LIMIT } });
      } catch (e) {
        break;
      }
      const result = data?.userProgressQuestionList;
      if (!result || !Array.isArray(result.questions) || result.questions.length === 0) break;
      for (const q of result.questions) {
        if (!q?.titleSlug) continue;
        out.push({
          titleSlug: q.titleSlug,
          lastSubmittedAt: +q.lastSubmittedAt || 0,
          numSubmitted: q.numSubmitted || 0,
          questionStatus: q.questionStatus || null,
        });
      }
      skip += LIMIT;
      if (typeof result.totalNum === 'number' && skip >= result.totalNum) break;
    }
    return out;
  },

  // Owner-only submissions for one question with full metadata; backfills {id,lang,rt,mem}. AC = status 10.
  async getMyAcSubmissionsForSlug(questionSlug, opts = {}) {
    const query = `
      query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!) {
        questionSubmissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug) {
          lastKey
          hasNext
          submissions {
            id
            titleSlug
            status
            statusDisplay
            lang
            runtime
            memory
            timestamp
          }
        }
      }
    `;
    const LIMIT = opts.limit || 20;
    const out = [];
    let offset = 0;
    let lastKey = null;
    for (let page = 0; page < (opts.maxPages || 5); page++) {
      let data;
      try {
        data = await this.graphqlQuery(query, { offset, limit: LIMIT, lastKey, questionSlug });
      } catch (e) {
        break;
      }
      const result = data?.questionSubmissionList;
      if (!result || !Array.isArray(result.submissions)) break;
      for (const s of result.submissions) {
        if (s?.statusDisplay === 'Accepted' || s?.status === 10) {
          out.push({
            id: String(s.id),
            titleSlug: s.titleSlug,
            lang: s.lang,
            runtime: s.runtime,
            memory: s.memory,
            timestamp: +s.timestamp || 0,
          });
        }
      }
      if (!result.hasNext) break;
      lastKey = result.lastKey || null;
      offset += LIMIT;
    }
    return out;
  },

  // ============= Solutions-Feed Scrape (public, arbitrary user) =============

  // Public solution articles per user. Lower-bound proof-of-solved.
  async getUserSolutionArticles(username, opts = {}) {
    const query = `
      query ugcArticleUserSolutionArticles($username: String!, $skip: Int, $first: Int) {
        ugcArticleUserSolutionArticles(username: $username, skip: $skip, first: $first) {
          totalNum
          pageInfo { hasNextPage }
          edges {
            node {
              questionSlug
              createdAt
            }
          }
        }
      }
    `;
    const FIRST = opts.first || 1000;
    const MAX_PAGES = opts.maxPages || 5;
    const out = new Map();
    let skip = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      let data;
      try {
        data = await this.graphqlQuery(query, { username, skip, first: FIRST });
      } catch (e) {
        break;
      }
      const result = data?.ugcArticleUserSolutionArticles;
      if (!result) break;
      const edges = Array.isArray(result.edges) ? result.edges : [];
      for (const e of edges) {
        const slug = e?.node?.questionSlug;
        if (!slug) continue;
        const ts = +(e.node.createdAt) || 0;
        const prev = out.get(slug);
        if (prev === undefined || ts < prev) out.set(slug, ts);
      }
      if (!result.pageInfo?.hasNextPage) break;
      skip += FIRST;
    }

    return Array.from(out.entries()).map(([titleSlug, timestamp]) => ({ titleSlug, timestamp }));
  },

  // Returns { username, isSignedIn } via the anonymous-friendly globalData query (no CSRF needed).
  async getCurrentUser() {
    const query = `
      query globalData {
        userStatus {
          username
          isSignedIn
        }
      }
    `;
    try {
      const data = await this.graphqlQuery(query, {});
      const status = data?.userStatus;
      if (!status || !status.isSignedIn) return { isSignedIn: false };
      return { username: status.username, isSignedIn: true };
    } catch (e) {
      return { isSignedIn: false };
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

  // LeetCode's daily coding challenge problem.
  async getDailyChallenge() {
    const query = `
      query questionOfToday {
        activeDailyCodingChallengeQuestion {
          link
          question { titleSlug title }
        }
      }
    `;
    try {
      const data = await LeetCodeAPI.graphqlQuery(query, {});
      const q = data?.activeDailyCodingChallengeQuestion;
      if (!q) return null;
      return { link: q.link || null, slug: q.question?.titleSlug || null, title: q.question?.title || null };
    } catch (error) {
      console.error('Error fetching daily challenge:', error);
      return null;
    }
  },

  // ============= Composite Data Methods =============

  async getFullUserData(username) {
    const [profile, solved, submissions] = await Promise.all([
      this.getUserProfile(username),
      this.getUserSolvedProblems(username),
      this.getRecentSubmissions(username),
    ]);

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
    const [profile, solved] = await Promise.all([
      this.getUserProfile(username),
      this.getUserSolvedProblems(username),
    ]);

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

  // Batch methods: GraphQL aliases fetch many users in one request; fall back to individual on failure.

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

  // Check if multiple users solved a problem in one shot. Returns { username: { solved, submission } }.
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
