// Live check that our query still matches LeetCode's schema. Scheduled only.
import { fetchProblemCatalog } from '../src/leetcode';

(async () => {
  try {
    const problems = await fetchProblemCatalog();
    if (problems.length < 4000) {
      console.error(`FAIL: catalog returned ${problems.length} problems, expected >= 4000`);
      process.exit(1);
    }
    const s = problems[0];
    const shapeOk =
      typeof s.slug === 'string' && s.slug.length > 0 &&
      typeof s.id === 'number' && s.id > 0 &&
      typeof s.paid === 'boolean' &&
      typeof s.acRate === 'number' &&
      ['Easy', 'Medium', 'Hard'].includes(s.difficulty);
    if (!shapeOk) {
      console.error('FAIL: unexpected problem shape:', JSON.stringify(s));
      process.exit(1);
    }
    console.log(`OK: catalog contract holds (${problems.length} problems)`);
  } catch (e) {
    console.error('FAIL: fetchProblemCatalog threw:', (e as Error).message);
    process.exit(1);
  }
})();
