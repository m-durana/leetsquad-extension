const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql/';

const ABOUT_ME_QUERY = `
  query userPublicProfile($username: String!) {
    matchedUser(username: $username) {
      username
      profile { aboutMe }
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
  const res = await fetch(LEETCODE_GRAPHQL, {
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

export async function getPublicAboutMe(username: string): Promise<string | null> {
  const res = await fetch(LEETCODE_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'leetsquad-server/0.1 (+https://leetsquad.miro.build)',
      'Referer': `https://leetcode.com/u/${encodeURIComponent(username)}/`,
    },
    body: JSON.stringify({
      query: ABOUT_ME_QUERY,
      variables: { username },
      operationName: 'userPublicProfile',
    }),
  });

  if (!res.ok) throw new Error(`LeetCode GraphQL HTTP ${res.status}`);
  const json = (await res.json()) as {
    data?: { matchedUser?: { profile?: { aboutMe?: string | null } | null } | null };
  };
  const user = json.data?.matchedUser;
  if (!user) return null;
  return user.profile?.aboutMe ?? '';
}
