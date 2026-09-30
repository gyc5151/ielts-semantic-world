export function nextReview(previous, attempt, now = new Date()) {
  const afterDays = (base, days) => {
    const date = new Date(base);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };
  const independent = attempt.selfRating === "good" && attempt.support === "none" && Boolean(attempt.response?.trim());
  if (!independent) return { stage: 0, anchorAt: null, nextDue: afterDays(now, 1) };
  if (previous?.stage >= 4) return { stage: 4, anchorAt: previous.anchorAt, nextDue: null };
  const due = previous?.nextDue && new Date(previous.nextDue) <= now;
  if (previous?.stage > 0 && !due) return { stage: previous.stage, anchorAt: previous.anchorAt || previous.lastAttemptAt, nextDue: previous.nextDue };
  // Day 1 / 7 / 30 are measured from the first independent success.
  const stage = Math.min((previous?.stage || 0) + 1, 4);
  const anchorAt = stage === 1 ? now.toISOString() : previous.anchorAt || previous.lastAttemptAt || now.toISOString();
  const nextDue = stage === 4 ? null : afterDays(anchorAt, [1, 7, 30][stage - 1]);
  // Imported legacy records may have an old anchor: do not schedule in the past.
  return { stage, anchorAt, nextDue: nextDue && new Date(nextDue) <= now ? afterDays(now, 1) : nextDue };
}
