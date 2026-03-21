require('./setup');

// Load the module (assigns to window.LeetCodeAPI)
require('../api');

const LeetCodeAPI = window.LeetCodeAPI;

beforeEach(() => {
  jest.clearAllMocks();
  fetch.mockReset();
  // Clear in-memory cache between tests to ensure isolation
  LeetCodeAPI.clearMemoryCache();
});

// Helper: mock a successful GraphQL response
function mockGraphQL(data) {
  return {
    ok: true,
    json: () => Promise.resolve({ data }),
  };
}

// Helper: mock a GraphQL error response
function mockGraphQLError(message = 'Bad query') {
  return {
    ok: true,
    json: () => Promise.resolve({ errors: [{ message }] }),
  };
}

// ============================================================
// graphqlQuery - core engine, concurrency control, retries
// ============================================================
describe('LeetCodeAPI.graphqlQuery', () => {
  test('sends POST request to LeetCode GraphQL endpoint', async () => {
    Object.defineProperty(document, 'cookie', {
      value: 'csrftoken=testtoken',
      writable: true,
    });

    fetch.mockResolvedValueOnce(mockGraphQL({ user: 'test' }));

    const result = await LeetCodeAPI.graphqlQuery('query { test }', { var: 1 });
    expect(result).toEqual({ user: 'test' });
    expect(fetch).toHaveBeenCalledWith(
      'https://leetcode.com/graphql',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      })
    );
  });

  test('includes Referer header', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({ ok: true }));

    await LeetCodeAPI.graphqlQuery('query { test }');
    const callArgs = fetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['Referer']).toBe('https://leetcode.com');
  });

  test('includes CSRF token when available', async () => {
    Object.defineProperty(document, 'cookie', {
      value: 'csrftoken=abc123',
      writable: true,
    });

    fetch.mockResolvedValueOnce(mockGraphQL({ ok: true }));
    await LeetCodeAPI.graphqlQuery('query { test }');

    const callArgs = fetch.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers['x-csrftoken']).toBe('abc123');
  });

  test('retries on HTTP 429 (rate limited)', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce(mockGraphQL({ success: true }));

    const result = await LeetCodeAPI.graphqlQuery('query { test429 }', {}, 2);
    expect(result).toEqual({ success: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('throws after exhausting retries on 429', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429 });

    await expect(
      LeetCodeAPI.graphqlQuery('query { test429fail }', {}, 1)
    ).rejects.toThrow('Rate limited');
  });

  test('throws on GraphQL errors in response', async () => {
    fetch.mockResolvedValueOnce(mockGraphQLError('Bad query'));

    await expect(
      LeetCodeAPI.graphqlQuery('bad query unique1', {}, 0)
    ).rejects.toThrow('Bad query');
  });

  test('retries on network errors', async () => {
    fetch
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(mockGraphQL({ recovered: true }));

    const result = await LeetCodeAPI.graphqlQuery('query { testRetry }', {}, 1);
    expect(result).toEqual({ recovered: true });
  });

  test('throws after all retries exhausted on network error', async () => {
    fetch.mockRejectedValue(new Error('Network failure'));

    await expect(
      LeetCodeAPI.graphqlQuery('query { testExhaust }', {}, 1)
    ).rejects.toThrow('Network failure');
  });
});

// ============================================================
// getCsrfToken
// ============================================================
describe('LeetCodeAPI.getCsrfToken', () => {
  test('extracts CSRF token from document.cookie', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'csrftoken=abc123; other=val',
      writable: true,
    });
    expect(LeetCodeAPI.getCsrfToken()).toBe('abc123');
  });

  test('returns null when no csrftoken cookie', () => {
    Object.defineProperty(document, 'cookie', {
      value: 'othercookie=val',
      writable: true,
    });
    expect(LeetCodeAPI.getCsrfToken()).toBeNull();
  });
});

// ============================================================
// In-memory caching
// ============================================================
describe('LeetCodeAPI caching', () => {
  test('caches getUserProfile results and avoids duplicate fetch', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      allQuestionsCount: [],
      matchedUser: {
        username: 'cached_user',
        profile: { userAvatar: null, ranking: 100 },
        submitStats: { acSubmissionNum: [], totalSubmissionNum: [] },
        submissionCalendar: '{}',
      },
    }));

    const result1 = await LeetCodeAPI.getUserProfile('cached_user');
    const result2 = await LeetCodeAPI.getUserProfile('cached_user');

    expect(result1.username).toBe('cached_user');
    expect(result2.username).toBe('cached_user');
    // Only one fetch call — second was served from cache
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('caches getRecentAcSubmissions results', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [
        { id: '1', titleSlug: 'two-sum', title: 'Two Sum', lang: 'python3' },
      ],
    }));

    const result1 = await LeetCodeAPI.getRecentAcSubmissions('cache_user2', 50);
    const result2 = await LeetCodeAPI.getRecentAcSubmissions('cache_user2', 50);

    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('clearMemoryCache forces re-fetch', async () => {
    fetch
      .mockResolvedValueOnce(mockGraphQL({
        recentAcSubmissionList: [{ id: '1', titleSlug: 'a' }],
      }))
      .mockResolvedValueOnce(mockGraphQL({
        recentAcSubmissionList: [{ id: '2', titleSlug: 'b' }],
      }));

    await LeetCodeAPI.getRecentAcSubmissions('clear_user', 20);
    expect(fetch).toHaveBeenCalledTimes(1);

    LeetCodeAPI.clearMemoryCache();

    const result = await LeetCodeAPI.getRecentAcSubmissions('clear_user', 20);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0].titleSlug).toBe('b');
  });
});

// ============================================================
// In-flight deduplication
// ============================================================
describe('LeetCodeAPI deduplication', () => {
  test('deduplicates concurrent identical requests', async () => {
    let resolvePromise;
    const fetchPromise = new Promise(resolve => { resolvePromise = resolve; });

    fetch.mockImplementationOnce(() => {
      return fetchPromise;
    });

    // Fire two identical requests concurrently
    const p1 = LeetCodeAPI.getRecentAcSubmissions('dedup_user', 50);
    const p2 = LeetCodeAPI.getRecentAcSubmissions('dedup_user', 50);

    // Resolve the single fetch
    resolvePromise(mockGraphQL({
      recentAcSubmissionList: [{ id: '1', titleSlug: 'two-sum' }],
    }));

    const [r1, r2] = await Promise.all([p1, p2]);

    // Both should get the same result
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(1);
    // Only one actual fetch was made
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// getUserProfile
// ============================================================
describe('LeetCodeAPI.getUserProfile', () => {
  test('fetches and normalizes user profile', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      allQuestionsCount: [
        { difficulty: 'Easy', count: 800 },
        { difficulty: 'Medium', count: 1700 },
        { difficulty: 'Hard', count: 700 },
      ],
      matchedUser: {
        username: 'testuser',
        profile: {
          userAvatar: 'https://example.com/avatar.png',
          ranking: 50000,
          realName: 'Test User',
          reputation: 100,
          countryName: 'US',
          company: 'ACME',
          school: null,
        },
        contributions: { points: 50 },
        badges: [],
        activeBadge: null,
        submitStats: {
          acSubmissionNum: [
            { difficulty: 'All', count: 100, submissions: 200 },
            { difficulty: 'Easy', count: 40, submissions: 50 },
            { difficulty: 'Medium', count: 45, submissions: 100 },
            { difficulty: 'Hard', count: 15, submissions: 50 },
          ],
          totalSubmissionNum: [],
        },
        submissionCalendar: '{}',
      },
    }));

    const result = await LeetCodeAPI.getUserProfile('testuser');
    expect(result.username).toBe('testuser');
    expect(result.avatar).toBe('https://example.com/avatar.png');
    expect(result.ranking).toBe(50000);
    expect(result.easySolved).toBe(40);
    expect(result.mediumSolved).toBe(45);
    expect(result.hardSolved).toBe(15);
    expect(result.totalSolved).toBe(100);
  });

  test('returns null when user not found', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({ matchedUser: null }));
    const result = await LeetCodeAPI.getUserProfile('nonexistent');
    expect(result).toBeNull();
  });

  test('returns null on error', async () => {
    fetch.mockRejectedValue(new Error('fail'));
    const result = await LeetCodeAPI.getUserProfile('baduser');
    expect(result).toBeNull();
  }, 30000);
});

// ============================================================
// getUserSolvedProblems
// ============================================================
describe('LeetCodeAPI.getUserSolvedProblems', () => {
  test('fetches solved counts by difficulty', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      userProfileUserQuestionProgressV2: {
        numAcceptedQuestions: [
          { count: 50, difficulty: 'EASY' },
          { count: 70, difficulty: 'MEDIUM' },
          { count: 30, difficulty: 'HARD' },
        ],
        numFailedQuestions: [],
        numUntouchedQuestions: [],
        userSessionBeatsPercentage: [],
      },
    }));

    const result = await LeetCodeAPI.getUserSolvedProblems('testuser_solved');
    expect(result.easySolved).toBe(50);
    expect(result.mediumSolved).toBe(70);
    expect(result.hardSolved).toBe(30);
    expect(result.solvedProblem).toBe(150);
  });

  test('returns null on failure', async () => {
    fetch.mockRejectedValue(new Error('fail'));
    const result = await LeetCodeAPI.getUserSolvedProblems('baduser_solved');
    expect(result).toBeNull();
  }, 30000);
});

// ============================================================
// getRecentSubmissions
// ============================================================
describe('LeetCodeAPI.getRecentSubmissions', () => {
  test('fetches and wraps submissions in expected format', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentSubmissionList: [
        { title: 'Two Sum', titleSlug: 'two-sum', timestamp: '1234', statusDisplay: 'Accepted', lang: 'python3' },
      ],
    }));

    const result = await LeetCodeAPI.getRecentSubmissions('testuser_subs');
    expect(result.submission).toHaveLength(1);
    expect(result.submission[0].titleSlug).toBe('two-sum');
  });

  test('returns null on error', async () => {
    fetch.mockRejectedValue(new Error('fail'));
    const result = await LeetCodeAPI.getRecentSubmissions('baduser_subs');
    expect(result).toBeNull();
  }, 30000);
});

// ============================================================
// getRecentAcSubmissions
// ============================================================
describe('LeetCodeAPI.getRecentAcSubmissions', () => {
  test('returns list of recent accepted submissions', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [
        { id: '1', title: 'Two Sum', titleSlug: 'two-sum', lang: 'python3', runtime: '4 ms' },
      ],
    }));

    const result = await LeetCodeAPI.getRecentAcSubmissions('testuser_ac', 20);
    expect(result).toHaveLength(1);
    expect(result[0].titleSlug).toBe('two-sum');
  });

  test('returns empty array on failure', async () => {
    fetch.mockRejectedValue(new Error('fail'));
    const result = await LeetCodeAPI.getRecentAcSubmissions('baduser_ac');
    expect(result).toEqual([]);
  }, 30000);
});

// ============================================================
// Batch methods
// ============================================================
describe('LeetCodeAPI.batchGetRecentAcSubmissions', () => {
  test('fetches AC submissions for multiple users in one query', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      user_0: [
        { id: '1', titleSlug: 'two-sum', title: 'Two Sum', lang: 'python3' },
      ],
      user_1: [
        { id: '2', titleSlug: 'add-two-numbers', title: 'Add Two Numbers', lang: 'java' },
      ],
    }));

    const result = await LeetCodeAPI.batchGetRecentAcSubmissions(['alice', 'bob'], 50);
    expect(result.alice).toHaveLength(1);
    expect(result.alice[0].titleSlug).toBe('two-sum');
    expect(result.bob).toHaveLength(1);
    expect(result.bob[0].titleSlug).toBe('add-two-numbers');
    // Single batch request
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('returns cached results without network call', async () => {
    // First call populates cache
    fetch.mockResolvedValueOnce(mockGraphQL({
      user_0: [{ id: '1', titleSlug: 'two-sum' }],
      user_1: [{ id: '2', titleSlug: 'three-sum' }],
    }));

    await LeetCodeAPI.batchGetRecentAcSubmissions(['cached_a', 'cached_b'], 50);

    // Second call should hit cache
    const result = await LeetCodeAPI.batchGetRecentAcSubmissions(['cached_a', 'cached_b'], 50);
    expect(result.cached_a).toHaveLength(1);
    expect(result.cached_b).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(1); // only the first batch call
  });

  test('handles single user without batch query', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [{ id: '1', titleSlug: 'two-sum' }],
    }));

    const result = await LeetCodeAPI.batchGetRecentAcSubmissions(['solo_user'], 50);
    expect(result.solo_user).toHaveLength(1);
  });

  test('returns empty object for empty usernames', async () => {
    const result = await LeetCodeAPI.batchGetRecentAcSubmissions([], 50);
    expect(result).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  test('falls back to individual requests on batch failure', async () => {
    fetch
      .mockRejectedValueOnce(new Error('batch failed'))  // batch query fails
      .mockRejectedValueOnce(new Error('retry1'))         // retry 1
      .mockRejectedValueOnce(new Error('retry2'))         // retry 2
      .mockRejectedValueOnce(new Error('retry3'))         // retry 3
      // Individual fallback for user a
      .mockResolvedValueOnce(mockGraphQL({
        recentAcSubmissionList: [{ id: '1', titleSlug: 'a' }],
      }))
      // Individual fallback for user b
      .mockResolvedValueOnce(mockGraphQL({
        recentAcSubmissionList: [{ id: '2', titleSlug: 'b' }],
      }));

    const result = await LeetCodeAPI.batchGetRecentAcSubmissions(['fallback_a', 'fallback_b'], 50);
    expect(result.fallback_a).toHaveLength(1);
    expect(result.fallback_b).toHaveLength(1);
  }, 30000);
});

describe('LeetCodeAPI.batchCheckSolved', () => {
  test('checks if multiple users solved a problem', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      user_0: [
        { id: '1', titleSlug: 'two-sum', title: 'Two Sum' },
        { id: '2', titleSlug: 'three-sum', title: 'Three Sum' },
      ],
      user_1: [
        { id: '3', titleSlug: 'add-two-numbers', title: 'Add Two Numbers' },
      ],
    }));

    const result = await LeetCodeAPI.batchCheckSolved(['batch_alice', 'batch_bob'], 'two-sum');
    expect(result.batch_alice.solved).toBe(true);
    expect(result.batch_alice.submission.titleSlug).toBe('two-sum');
    expect(result.batch_bob.solved).toBe(false);
  });
});

describe('LeetCodeAPI.batchGetUserProfiles', () => {
  test('fetches profiles for multiple users in one query', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      user_0: {
        username: 'profile_alice',
        profile: { realName: 'Alice', userAvatar: null, ranking: 1000, reputation: 50 },
        submitStats: { acSubmissionNum: [{ difficulty: 'All', count: 100 }] },
      },
      user_1: {
        username: 'profile_bob',
        profile: { realName: 'Bob', userAvatar: 'http://img.png', ranking: 2000, reputation: 30 },
        submitStats: { acSubmissionNum: [{ difficulty: 'Easy', count: 50 }] },
      },
    }));

    const result = await LeetCodeAPI.batchGetUserProfiles(['profile_alice', 'profile_bob']);
    expect(result.profile_alice.username).toBe('profile_alice');
    expect(result.profile_alice.ranking).toBe(1000);
    expect(result.profile_bob.avatar).toBe('http://img.png');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('handles null user in batch result', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      user_0: {
        username: 'exists',
        profile: { userAvatar: null, ranking: 100, reputation: 0, realName: null },
        submitStats: { acSubmissionNum: [] },
      },
      user_1: null,
    }));

    const result = await LeetCodeAPI.batchGetUserProfiles(['exists', 'nonexistent_batch']);
    expect(result.exists).not.toBeNull();
    expect(result.nonexistent_batch).toBeNull();
  });
});

// ============================================================
// getFullUserData
// ============================================================
describe('LeetCodeAPI.getFullUserData', () => {
  test('fetches profile, solved, and submissions', async () => {
    // getUserProfile
    fetch.mockResolvedValueOnce(mockGraphQL({
      allQuestionsCount: [],
      matchedUser: {
        username: 'full_u1',
        profile: { ranking: 100, userAvatar: null },
        submitStats: { acSubmissionNum: [], totalSubmissionNum: [] },
        submissionCalendar: '{}',
      },
    }));
    // getUserSolvedProblems
    fetch.mockResolvedValueOnce(mockGraphQL({
      userProfileUserQuestionProgressV2: {
        numAcceptedQuestions: [{ count: 10, difficulty: 'EASY' }],
        numFailedQuestions: [],
        numUntouchedQuestions: [],
        userSessionBeatsPercentage: [],
      },
    }));
    // getRecentSubmissions
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentSubmissionList: [],
    }));

    const result = await LeetCodeAPI.getFullUserData('full_u1');
    expect(result.username).toBe('full_u1');
    expect(result.profile).toBeDefined();
    expect(result.solved).toBeDefined();
    expect(result.submissions).toBeDefined();
    expect(result.fetchedAt).toBeDefined();
  }, 15000);
});

// ============================================================
// getEssentialUserData
// ============================================================
describe('LeetCodeAPI.getEssentialUserData', () => {
  test('fetches only profile and solved (no submissions)', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      allQuestionsCount: [],
      matchedUser: {
        username: 'essential_u1',
        profile: { userAvatar: null },
        submitStats: { acSubmissionNum: [], totalSubmissionNum: [] },
        submissionCalendar: '{}',
      },
    }));
    fetch.mockResolvedValueOnce(mockGraphQL({
      userProfileUserQuestionProgressV2: {
        numAcceptedQuestions: [],
        numFailedQuestions: [],
        numUntouchedQuestions: [],
        userSessionBeatsPercentage: [],
      },
    }));

    const result = await LeetCodeAPI.getEssentialUserData('essential_u1');
    expect(result.profile).toBeDefined();
    expect(result.solved).toBeDefined();
    expect(result.submissions).toBeNull();
  });
});

// ============================================================
// hasUserSolvedProblem (now GraphQL-based, no more crash bug)
// ============================================================
describe('LeetCodeAPI.hasUserSolvedProblem', () => {
  test('returns solved:true when problem found in recent AC submissions', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [
        { id: '1', titleSlug: 'two-sum', title: 'Two Sum', lang: 'python3' },
        { id: '2', titleSlug: 'add-two-numbers', title: 'Add Two Numbers', lang: 'java' },
      ],
    }));

    const result = await LeetCodeAPI.hasUserSolvedProblem('solved_check_user', 'two-sum');
    expect(result.solved).toBe(true);
    expect(result.problem.titleSlug).toBe('two-sum');
  });

  test('returns solved:false when problem not found', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [
        { id: '1', titleSlug: 'other-problem' },
      ],
    }));

    const result = await LeetCodeAPI.hasUserSolvedProblem('solved_not_found', 'two-sum');
    expect(result.solved).toBe(false);
  });

  test('returns solved:false when API returns empty list', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [],
    }));

    const result = await LeetCodeAPI.hasUserSolvedProblem('solved_empty', 'two-sum');
    expect(result.solved).toBe(false);
  });

  test('returns solved:false on API failure (no crash)', async () => {
    fetch.mockRejectedValue(new Error('fail'));
    const result = await LeetCodeAPI.hasUserSolvedProblem('solved_fail', 'two-sum');
    expect(result.solved).toBe(false);
  }, 30000);
});

// ============================================================
// getProblemSubmissions
// ============================================================
describe('LeetCodeAPI.getProblemSubmissions', () => {
  test('filters submissions by problem slug', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentSubmissionList: [
        { titleSlug: 'two-sum', statusDisplay: 'Accepted' },
        { titleSlug: 'three-sum', statusDisplay: 'Accepted' },
        { titleSlug: 'two-sum', statusDisplay: 'Wrong Answer' },
      ],
    }));

    const result = await LeetCodeAPI.getProblemSubmissions('prob_sub_user', 'two-sum');
    expect(result).toHaveLength(2);
    expect(result.every(s => s.titleSlug === 'two-sum')).toBe(true);
  });

  test('returns empty array when no submissions', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({ recentSubmissionList: [] }));
    const result = await LeetCodeAPI.getProblemSubmissions('prob_sub_empty', 'two-sum');
    expect(result).toEqual([]);
  });

  test('returns empty array on API failure', async () => {
    fetch.mockRejectedValue(new Error('fail'));
    const result = await LeetCodeAPI.getProblemSubmissions('prob_sub_fail', 'two-sum');
    expect(result).toEqual([]);
  }, 30000);
});

// ============================================================
// getUserSolvedCount
// ============================================================
describe('LeetCodeAPI.getUserSolvedCount', () => {
  test('returns solved counts by difficulty', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      userProfileUserQuestionProgressV2: {
        numAcceptedQuestions: [
          { count: 40, difficulty: 'EASY' },
          { count: 45, difficulty: 'MEDIUM' },
          { count: 15, difficulty: 'HARD' },
        ],
        numFailedQuestions: [],
        numUntouchedQuestions: [],
        userSessionBeatsPercentage: [],
      },
    }));

    const result = await LeetCodeAPI.getUserSolvedCount('count_user');
    expect(result).toEqual({ total: 100, easy: 40, medium: 45, hard: 15 });
  });

  test('returns null when user not found', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      userProfileUserQuestionProgressV2: null,
    }));

    const result = await LeetCodeAPI.getUserSolvedCount('count_nonexistent');
    expect(result).toBeNull();
  });
});

// ============================================================
// hasUserSolvedProblemGraphQL
// ============================================================
describe('LeetCodeAPI.hasUserSolvedProblemGraphQL', () => {
  test('returns solved:true with submission details when found', async () => {
    // getRecentAcSubmissions
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [
        { id: '123', titleSlug: 'two-sum', runtime: '4 ms', title: 'Two Sum' },
      ],
    }));
    // getSubmissionDetails
    fetch.mockResolvedValueOnce(mockGraphQL({
      submissionDetails: {
        runtimePercentile: 95.5,
        memoryPercentile: 80.2,
        runtimeDisplay: '4 ms',
        memoryDisplay: '16.2 MB',
      },
    }));

    const result = await LeetCodeAPI.hasUserSolvedProblemGraphQL('gql_solved_user', 'two-sum');
    expect(result.solved).toBe(true);
    expect(result.runtime).toBe('4 ms');
    expect(result.runtimePercentile).toBe(95.5);
  });

  test('returns solved:false when problem not in submissions', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [
        { id: '1', titleSlug: 'other-problem' },
      ],
    }));

    const result = await LeetCodeAPI.hasUserSolvedProblemGraphQL('gql_not_found', 'two-sum');
    expect(result.solved).toBe(false);
  });
});

// ============================================================
// getEnhancedUserData
// ============================================================
describe('LeetCodeAPI.getEnhancedUserData', () => {
  test('combines profile, solved, and recent AC data', async () => {
    // getUserProfile
    fetch.mockResolvedValueOnce(mockGraphQL({
      allQuestionsCount: [],
      matchedUser: {
        username: 'enhanced_u1',
        profile: { ranking: 1000, userAvatar: null },
        submitStats: { acSubmissionNum: [], totalSubmissionNum: [] },
        submissionCalendar: '{}',
      },
    }));
    // getUserSolvedProblems
    fetch.mockResolvedValueOnce(mockGraphQL({
      userProfileUserQuestionProgressV2: {
        numAcceptedQuestions: [{ count: 50, difficulty: 'EASY' }],
        numFailedQuestions: [],
        numUntouchedQuestions: [],
        userSessionBeatsPercentage: [],
      },
    }));
    // getRecentAcSubmissions
    fetch.mockResolvedValueOnce(mockGraphQL({
      recentAcSubmissionList: [],
    }));

    const result = await LeetCodeAPI.getEnhancedUserData('enhanced_u1');
    expect(result.username).toBe('enhanced_u1');
    expect(result.profile).toBeDefined();
    expect(result.graphql).toBeDefined();
    expect(result.graphql.recentWithBeats).toBeDefined();
  });
});
