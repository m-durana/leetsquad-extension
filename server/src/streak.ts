// Current LeetSquad streak: consecutive days (ending today, UTC) with at least one solve.
// Mirrors the client's calculateStreak so a friend's shared streak matches what they see.
type GoalDay = { completed?: number };

export function computeStreak(goals: Record<string, GoalDay>, todayStr: string): number {
  let streak = 0;
  const d = new Date(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 0;
  while (true) {
    const key = d.toISOString().split('T')[0];
    const day = goals[key];
    if (day && (day.completed || 0) > 0) {
      streak++;
      d.setUTCDate(d.getUTCDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function utcToday(): string {
  return new Date().toISOString().split('T')[0];
}
