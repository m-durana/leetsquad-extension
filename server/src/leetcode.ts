const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql/';
const FETCH_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetch with an abort-based timeout so a hung LeetCode connection can't block
// request-handling threads indefinitely.
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const SKILL_TAGS_QUERY = `
  query userPublicProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile { skillTags }
    }
  }
`;

const TOTAL_SOLVED_QUERY = `
  query userProblemsSolved($username: String!) {
    matchedUser(username: $username) {
      submitStatsGlobal {
        acSubmissionNum { difficulty count }
      }
    }
  }
`;

export async function getPublicSolvedCount(username: string): Promise<number | null> {
  const res = await fetchWithTimeout(LEETCODE_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'leetsquad-server/0.1 (+https://leetsquad.miro.build)',
      'Referer': `https://leetcode.com/u/${encodeURIComponent(username)}/`,
    },
    body: JSON.stringify({ query: TOTAL_SOLVED_QUERY, variables: { username } }),
  });
  if (!res.ok) throw new Error(`LeetCode GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      matchedUser?: {
        submitStatsGlobal?: { acSubmissionNum?: Array<{ difficulty: string; count: number }> } | null;
      } | null;
    };
  };
  const user = json.data?.matchedUser;
  if (!user) return null;
  const all = user.submitStatsGlobal?.acSubmissionNum?.find((s) => s.difficulty === 'All');
  return all?.count ?? 0;
}

function throwOnGraphqlErrors(json: { errors?: unknown }): void {
  if (Array.isArray(json.errors) && json.errors.length > 0) {
    throw new Error(`LeetCode GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
}

const PROBLEMSET_QUERY = `
  query problemsetQuestionList($limit: Int, $skip: Int) {
    problemsetQuestionList: questionList(categorySlug: "", limit: $limit, skip: $skip, filters: {}) {
      totalNum
      questions: data {
        titleSlug
        title
        questionFrontendId
        difficulty
        isPaidOnly
        acRate
      }
    }
  }
`;

export interface CatalogProblem {
  slug: string;
  title: string;
  id: number;
  difficulty: string;
  paid: boolean;
  acRate: number;
}

// Paginates the public problemset endpoint (server-capped at 100/page) and
// returns the full catalog. Throws if any page fails.
export async function fetchProblemCatalog(): Promise<CatalogProblem[]> {
  const PAGE = 100;
  const out: CatalogProblem[] = [];
  let skip = 0;
  let total = Infinity;
  while (skip < total) {
    if (skip > 0) await sleep(250); // be polite to LeetCode between pages
    const res = await fetchWithTimeout(LEETCODE_GRAPHQL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'leetsquad-server/0.1 (+https://leetsquad.miro.build)',
        'Referer': 'https://leetcode.com/problemset/',
      },
      body: JSON.stringify({
        query: PROBLEMSET_QUERY,
        variables: { limit: PAGE, skip },
        operationName: 'problemsetQuestionList',
      }),
    });
    if (!res.ok) throw new Error(`LeetCode catalog HTTP ${res.status}`);
    const json = (await res.json()) as {
      data?: {
        problemsetQuestionList?: {
          totalNum?: number;
          questions?: Array<{
            titleSlug: string;
            title: string;
            questionFrontendId: string;
            difficulty: string;
            isPaidOnly: boolean;
            acRate: number;
          }>;
        } | null;
      };
      errors?: unknown;
    };
    throwOnGraphqlErrors(json);
    const r = json.data?.problemsetQuestionList;
    if (!r || !Array.isArray(r.questions)) break;
    if (typeof r.totalNum === 'number') total = r.totalNum;
    for (const q of r.questions) {
      if (!q?.titleSlug) continue;
      out.push({
        slug: q.titleSlug,
        title: q.title,
        id: parseInt(q.questionFrontendId, 10) || 0,
        difficulty: q.difficulty,
        paid: !!q.isPaidOnly,
        acRate: typeof q.acRate === 'number' ? Math.round(q.acRate * 100) / 100 : 0,
      });
    }
    if (r.questions.length === 0) break;
    skip += PAGE;
  }
  return out;
}

export async function getPublicSkillTags(username: string): Promise<string[] | null> {
  const res = await fetchWithTimeout(LEETCODE_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'leetsquad-server/0.1 (+https://leetsquad.miro.build)',
      'Referer': `https://leetcode.com/u/${encodeURIComponent(username)}/`,
    },
    body: JSON.stringify({
      query: SKILL_TAGS_QUERY,
      variables: { username },
      operationName: 'userPublicProfile',
    }),
  });

  if (!res.ok) throw new Error(`LeetCode GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { matchedUser?: { profile?: { skillTags?: string[] | null } | null } | null };
    errors?: unknown;
  };
  throwOnGraphqlErrors(json);
  const user = json.data?.matchedUser;
  if (!user) return null;
  return user.profile?.skillTags ?? [];
}
