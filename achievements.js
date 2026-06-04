// check() returns the unlock timestamp (ms), or 0 when not yet satisfied.
(function (root) {
  'use strict';

  const ACHIEVEMENTS = [
    { id: 'solve_10',    name: 'Getting Started',  description: 'Solve 10 problems',    icon: '🌱', tier: 1, check: s => volumeUnlockAt(s, 10) },
    { id: 'solve_50',    name: 'Half a Hundred',   description: 'Solve 50 problems',    icon: '🌿', tier: 2, check: s => volumeUnlockAt(s, 50) },
    { id: 'solve_100',   name: 'Century Club',     description: 'Solve 100 problems',   icon: '💯', tier: 3, check: s => volumeUnlockAt(s, 100) },
    { id: 'solve_500',   name: 'Grinder',          description: 'Solve 500 problems',   icon: '⚙️', tier: 4, check: s => volumeUnlockAt(s, 500) },
    { id: 'solve_1000',  name: 'Quadruple Digits', description: 'Solve 1000 problems',  icon: '🏔️', tier: 5, check: s => volumeUnlockAt(s, 1000) },
    { id: 'solve_2500',  name: 'Legend',           description: 'Solve 2500 problems',  icon: '👑', tier: 6, check: s => volumeUnlockAt(s, 2500) },

    // difficulty counts have no per-solve timestamps, so we stamp on first detection
    { id: 'first_easy',   name: 'First Easy',   description: 'Solve your first Easy',   icon: '🟢', check: s => (s.difficultyCounts?.Easy   || 0) >= 1   ? Date.now() : 0 },
    { id: 'first_medium', name: 'First Medium', description: 'Solve your first Medium', icon: '🟡', check: s => (s.difficultyCounts?.Medium || 0) >= 1   ? Date.now() : 0 },
    { id: 'first_hard',   name: 'First Hard',   description: 'Solve your first Hard',   icon: '🔴', check: s => (s.difficultyCounts?.Hard   || 0) >= 1   ? Date.now() : 0 },
    { id: 'mediums_50',   name: 'Mid Master',   description: 'Solve 50 Mediums',        icon: '🟧', check: s => (s.difficultyCounts?.Medium || 0) >= 50  ? Date.now() : 0 },
    { id: 'hards_25',     name: 'Hard Mode',    description: 'Solve 25 Hards',          icon: '🟥', check: s => (s.difficultyCounts?.Hard   || 0) >= 25  ? Date.now() : 0 },

    { id: 'streak_3',   name: 'On a Roll',   description: '3-day LeetSquad streak',   icon: '🔥',  check: s => streakUnlockAt(s, 3) },
    { id: 'streak_7',   name: 'One Week',    description: '7-day LeetSquad streak',   icon: '🔥🔥', check: s => streakUnlockAt(s, 7) },
    { id: 'streak_30',  name: 'Unstoppable', description: '30-day LeetSquad streak',  icon: '🚀',  check: s => streakUnlockAt(s, 30) },
    { id: 'streak_100', name: 'Centurion',   description: '100-day LeetSquad streak', icon: '🏅',  check: s => streakUnlockAt(s, 100) },

    { id: 'first_friend',   name: 'Not Alone',      description: 'Add your first friend',                            icon: '🤝',   check: s => (s.friends?.length || 0) >= 1 ? Date.now() : 0 },
    { id: 'five_friends',   name: 'Squad Up',       description: 'Add 5 friends',                                    icon: '🫂',   check: s => (s.friends?.length || 0) >= 5 ? Date.now() : 0 },
    { id: 'same_day_squad', name: 'Same-Day Squad', description: 'You and a friend solved the same problem within 24h', icon: '🤜🤛', check: sameDaySquadAt },
    { id: 'catch_up',       name: 'Catching Up',    description: 'Solved a problem 3+ friends had already done',     icon: '🎯',   check: catchUpAt },
    { id: 'trailblazer',    name: 'Trailblazer',    description: 'First in your squad to solve a problem',           icon: '🧭',   check: trailblazerAt }
  ];

  // solve timestamps are stored in seconds (LeetCode convention); multiply by 1000 for Date
  function volumeUnlockAt(s, n) {
    const slugs = s.mySolvedSet?.slugs || {};
    const tsList = Object.values(slugs).filter(Boolean).sort((a, b) => a - b);
    if (tsList.length < n) return 0;
    return tsList[n - 1] * 1000;
  }

  function streakUnlockAt(s, threshold) {
    const goals = s.dailyGoals || {};
    const dates = Object.keys(goals).filter(d => (goals[d]?.completed || 0) > 0).sort();
    if (dates.length < threshold) return 0;

    let streak = 0;
    let prev = null;
    for (const d of dates) {
      if (prev && isNextDay(prev, d)) streak++;
      else streak = 1;
      if (streak >= threshold) return new Date(d + 'T23:59:59').getTime();
      prev = d;
    }
    return 0;
  }

  function isNextDay(prevYmd, nextYmd) {
    const p = new Date(prevYmd + 'T00:00:00');
    const n = new Date(nextYmd + 'T00:00:00');
    return (n.getTime() - p.getTime()) === 24 * 60 * 60 * 1000;
  }

  function sameDaySquadAt(s) {
    const my = s.mySolvedSet?.slugs || {};
    const friends = s.friendsSolvedSets || {};
    const DAY = 24 * 60 * 60;
    let earliest = 0;
    for (const slug in my) {
      const myTs = my[slug];
      if (!myTs) continue;
      for (const f in friends) {
        const fTs = friends[f]?.slugs?.[slug];
        if (fTs && Math.abs(fTs - myTs) <= DAY) {
          const eventTs = Math.max(myTs, fTs);
          if (!earliest || eventTs < earliest) earliest = eventTs;
        }
      }
    }
    return earliest ? earliest * 1000 : 0;
  }

  function catchUpAt(s) {
    const my = s.mySolvedSet?.slugs || {};
    const friends = s.friendsSolvedSets || {};
    let earliest = 0;
    for (const slug in my) {
      const myTs = my[slug];
      if (!myTs) continue;
      let before = 0;
      for (const f in friends) {
        const fTs = friends[f]?.slugs?.[slug];
        if (fTs && fTs < myTs) before++;
      }
      if (before >= 3 && (!earliest || myTs < earliest)) earliest = myTs;
    }
    return earliest ? earliest * 1000 : 0;
  }

  function trailblazerAt(s) {
    const my = s.mySolvedSet?.slugs || {};
    const friends = s.friendsSolvedSets || {};
    const friendUsernames = Object.keys(friends);
    if (friendUsernames.length === 0) return 0;
    let earliest = 0;
    for (const slug in my) {
      const myTs = my[slug];
      if (!myTs) continue;
      let anyFriendSolved = false;
      let allLater = true;
      for (const f of friendUsernames) {
        const fTs = friends[f]?.slugs?.[slug];
        if (fTs) {
          anyFriendSolved = true;
          if (fTs <= myTs) { allLater = false; break; }
        }
      }
      if (anyFriendSolved && allLater && (!earliest || myTs < earliest)) earliest = myTs;
    }
    return earliest ? earliest * 1000 : 0;
  }

  async function buildState() {
    const [myUsername, friends, allSolvedSets, dailyGoalsRaw, cache] = await Promise.all([
      StorageManager.getMyUsername(),
      StorageManager.getFriends(),
      StorageManager.getAllSolvedSets(),
      StorageManager.get(StorageManager.KEYS.DAILY_GOALS).then(v => v || {}),
      StorageManager.get(StorageManager.KEYS.CACHE).then(v => v || {})
    ]);

    const mySolvedSet = (myUsername && allSolvedSets[myUsername]) || { slugs: {}, lastRefreshed: 0 };
    const friendsSolvedSets = {};
    for (const f of (friends || [])) {
      if (allSolvedSets[f]) friendsSolvedSets[f] = allSolvedSets[f];
    }

    let difficultyCounts = { Easy: 0, Medium: 0, Hard: 0 };
    if (myUsername) {
      const entry = cache[`${myUsername}:full`] || cache[myUsername];
      if (entry && entry.profile?.submitStatsGlobal?.acSubmissionNum) {
        for (const row of entry.profile.submitStatsGlobal.acSubmissionNum) {
          if (row.difficulty in difficultyCounts) difficultyCounts[row.difficulty] = row.count;
        }
      }
    }

    return { myUsername, mySolvedSet, friendsSolvedSets, friends, dailyGoals: dailyGoalsRaw, difficultyCounts };
  }

  function computeUnlocks(state) {
    const out = [];
    for (const a of ACHIEVEMENTS) {
      try {
        const ts = a.check(state);
        if (ts) out.push({ id: a.id, unlockedAt: Number(ts) || Date.now() });
      } catch (_) {}
    }
    return out;
  }

  async function getStored() {
    return (await StorageManager.get('leetsquad_achievements')) || {};
  }

  async function setStored(map) {
    await StorageManager.set('leetsquad_achievements', map);
  }

  async function runPass() {
    const [state, stored] = await Promise.all([buildState(), getStored()]);
    const newlyUnlocked = [];
    for (const { id, unlockedAt } of computeUnlocks(state)) {
      if (!stored[id]) {
        stored[id] = { unlockedAt };
        newlyUnlocked.push(id);
      } else if (!stored[id].unlockedAt && unlockedAt) {
        stored[id].unlockedAt = unlockedAt;
      }
    }
    if (newlyUnlocked.length) await setStored(stored);
    return { unlockedNow: newlyUnlocked, total: Object.keys(stored).length };
  }

  function getById(id) { return ACHIEVEMENTS.find(a => a.id === id) || null; }

  function formatDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  }

  const Achievements = {
    REGISTRY: ACHIEVEMENTS,
    buildState,
    computeUnlocks,
    getStored,
    setStored,
    runPass,
    getById,
    formatDate
  };

  if (typeof window !== 'undefined') window.Achievements = Achievements;
  if (typeof self !== 'undefined') self.Achievements = Achievements;
})(typeof self !== 'undefined' ? self : globalThis);
