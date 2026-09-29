// Consecutive UTC days with a solve ending today (grace counts through yesterday). Mirrors the client.
type GoalDay = { completed?: number };

export function computeStreak(goals: Record<string, GoalDay>, todayStr: string): number {
  const d = new Date(`${todayStr}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return 0;
  const done = () => ((goals[d.toISOString().split('T')[0]]?.completed) || 0) > 0;
  if (!done()) d.setUTCDate(d.getUTCDate() - 1);

  let streak = 0;
  while (done()) {
    streak++;
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return streak;
}

export function utcToday(): string {
  return new Date().toISOString().split('T')[0];
}
