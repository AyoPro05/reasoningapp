/** Configurable heuristic, not a validated optimum. Late retrieval has no penalty. */
export const reviewPolicy = { version: 'static-review-v1', intervals: [1, 3, 7] as readonly number[] };
export function nextReview(outcome: boolean, previousInterval: number | null, now: Date) {
  const intervals = reviewPolicy.intervals;
  const index = previousInterval === null ? -1 : intervals.indexOf(previousInterval);
  const intervalDays = outcome ? intervals[Math.min(index + 1, intervals.length - 1)]! : intervals[0]!;
  return { intervalDays, dueAt: new Date(now.getTime() + intervalDays * 86_400_000), policyVersion: reviewPolicy.version };
}
