require('./setup');
require('../api');

const LeetCodeAPI = window.LeetCodeAPI;

beforeEach(() => {
  jest.clearAllMocks();
  fetch.mockReset();
  LeetCodeAPI.clearMemoryCache();
});

function mockGraphQL(data) {
  return { ok: true, json: () => Promise.resolve({ data }) };
}

// ============================================================
// getMySolvedSlugs (Phase A1 - authenticated self-import)
// ============================================================
describe('LeetCodeAPI.getMySolvedSlugs', () => {
  test('paginates problemsetQuestionList until skip >= total', async () => {
    // Two pages: first returns 2 with total=3, second returns 1
    fetch
      .mockResolvedValueOnce(mockGraphQL({
        problemsetQuestionList: { total: 3, questions: [
          { titleSlug: 'two-sum' },
          { titleSlug: 'add-two-numbers' },
        ] }
      }))
      .mockResolvedValueOnce(mockGraphQL({
        problemsetQuestionList: { total: 3, questions: [
          { titleSlug: 'longest-substring-without-repeating-characters' },
        ] }
      }));

    const slugs = await LeetCodeAPI.getMySolvedSlugs({ limit: 2 });
    expect(slugs).toEqual([
      'two-sum',
      'add-two-numbers',
      'longest-substring-without-repeating-characters',
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test('sends categorySlug=all-code-essentials and filters.status=AC', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      problemsetQuestionList: { total: 0, questions: [] }
    }));
    await LeetCodeAPI.getMySolvedSlugs();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.variables.categorySlug).toBe('all-code-essentials');
    expect(body.variables.filters).toEqual({ status: 'AC' });
  });

  test('stops on empty page even if total disagrees', async () => {
    fetch.mockResolvedValue(mockGraphQL({
      problemsetQuestionList: { total: 99999, questions: [] }
    }));
    const slugs = await LeetCodeAPI.getMySolvedSlugs({ limit: 50 });
    expect(slugs).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('caps at maxPages so a misbehaving server cannot drive infinite loops', async () => {
    // Always returns one entry, never signals "done"
    fetch.mockResolvedValue(mockGraphQL({
      problemsetQuestionList: { total: 10, questions: [{ titleSlug: 'x' }] }
    }));
    const slugs = await LeetCodeAPI.getMySolvedSlugs({ limit: 1, maxPages: 3 });
    expect(slugs.length).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

// ============================================================
// getUserSolutionArticles (Phase A2 - public solutions-feed scrape)
// ============================================================
describe('LeetCodeAPI.getUserSolutionArticles', () => {
  test('walks pageInfo.hasNextPage and returns deduped {titleSlug, timestamp}', async () => {
    fetch
      .mockResolvedValueOnce(mockGraphQL({
        ugcArticleUserSolutionArticles: {
          totalNum: 3,
          pageInfo: { hasNextPage: true },
          edges: [
            { node: { questionSlug: 'two-sum', createdAt: 1000 } },
            { node: { questionSlug: 'two-sum', createdAt: 500 } }, // dedup, keep earlier ts
          ]
        }
      }))
      .mockResolvedValueOnce(mockGraphQL({
        ugcArticleUserSolutionArticles: {
          totalNum: 3,
          pageInfo: { hasNextPage: false },
          edges: [
            { node: { questionSlug: 'add-two-numbers', createdAt: 2000 } },
          ]
        }
      }));

    const entries = await LeetCodeAPI.getUserSolutionArticles('votrubac', { first: 2 });
    const byMap = Object.fromEntries(entries.map(e => [e.titleSlug, e.timestamp]));
    expect(byMap['two-sum']).toBe(500); // earliest createdAt wins
    expect(byMap['add-two-numbers']).toBe(2000);
    expect(entries.length).toBe(2);
  });

  test('does NOT require auth (no CSRF header assertion needed; pulls public data)', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      ugcArticleUserSolutionArticles: {
        totalNum: 0,
        pageInfo: { hasNextPage: false },
        edges: []
      }
    }));
    const entries = await LeetCodeAPI.getUserSolutionArticles('nobody');
    expect(entries).toEqual([]);
  });

  test('breaks on null result without throwing', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({ ugcArticleUserSolutionArticles: null }));
    const entries = await LeetCodeAPI.getUserSolutionArticles('ghost');
    expect(entries).toEqual([]);
  });

  test('skips entries with null questionSlug', async () => {
    fetch.mockResolvedValueOnce(mockGraphQL({
      ugcArticleUserSolutionArticles: {
        totalNum: 2,
        pageInfo: { hasNextPage: false },
        edges: [
          { node: { questionSlug: null, createdAt: 100 } },
          { node: { questionSlug: 'two-sum', createdAt: 100 } },
        ]
      }
    }));
    const entries = await LeetCodeAPI.getUserSolutionArticles('alice');
    expect(entries.map(e => e.titleSlug)).toEqual(['two-sum']);
  });

  test('caps at maxPages', async () => {
    fetch.mockResolvedValue(mockGraphQL({
      ugcArticleUserSolutionArticles: {
        totalNum: 99999,
        pageInfo: { hasNextPage: true },
        edges: [{ node: { questionSlug: 'x', createdAt: 0 } }]
      }
    }));
    await LeetCodeAPI.getUserSolutionArticles('infinite-loop-tester', { first: 1, maxPages: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
