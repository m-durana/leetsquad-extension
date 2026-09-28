import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The catalog tests mock fetchProblemCatalog, so a wrong GraphQL field name (which
// makes LeetCode 400 the request in production) is invisible to them. This guards
// the real query string against the schema field renames that broke it once.
const src = readFileSync('src/leetcode.ts', 'utf8');

describe('problemset catalog query field names', () => {
  it('uses the current LeetCode schema field names', () => {
    expect(src).toContain('questionFrontendId');
    expect(src).toContain('isPaidOnly');
  });

  it('does not use the renamed legacy fields', () => {
    // Case-sensitive: legacy `paidOnly` is not a substring of `isPaidOnly`.
    expect(src).not.toContain('frontendQuestionId');
    expect(src).not.toContain('paidOnly');
  });
});
