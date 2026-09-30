const afterDays = (base, days) => {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
};
export function reviewDue(record) {
  if (record?.nextDue) return record.nextDue;
  // Old completed records receive maintenance without rewriting their history.
  if (record?.stage >= 4 && Number.isFinite(Date.parse(record.lastAttemptAt))) return afterDays(record.lastAttemptAt, 60);
  return null;
}
export function nextReview(previous, attempt, now = new Date()) {
  const independent = attempt.selfRating === "good" && attempt.support === "none" && Boolean(attempt.response?.trim());
  if (!independent) return { stage: 0, anchorAt: null, nextDue: afterDays(now, 1) };
  const previousDue = reviewDue(previous);
  const due = previousDue && new Date(previousDue) <= now;
  if (previous?.stage >= 4) return { stage: 4, anchorAt: previous.anchorAt, nextDue: due || !previousDue ? afterDays(now, 60) : previousDue, maintenance: true };
  if (previous?.stage > 0 && !due) return { stage: previous.stage, anchorAt: previous.anchorAt || previous.lastAttemptAt, nextDue: previousDue };
  // Day 1 / 7 / 30 are measured from the first independent success.
  const stage = Math.min((previous?.stage || 0) + 1, 4);
  const anchorAt = stage === 1 ? now.toISOString() : previous.anchorAt || previous.lastAttemptAt || now.toISOString();
  const nextDue = stage === 4 ? afterDays(now, 60) : afterDays(anchorAt, [1, 7, 30][stage - 1]);
  return { stage, anchorAt, maintenance: stage === 4, nextDue: new Date(nextDue) <= now ? afterDays(now, 1) : nextDue };
}
