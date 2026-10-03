// Unit evidence is self-checked; legacy task ratings never imply unit mastery.
import { rebuildPractice, validTimeZone } from "./unit-review-scheduler.mjs?v=pilot-21-0-r2";
export const EVIDENCE_LABELS = { unobserved: "未记录", partial: "还不熟悉", assisted: "看提示后会用", independent: "自己用出来了" };
const evidenceIndexes = new WeakMap();
function indexesFor(practice) {
  if (!evidenceIndexes.has(practice)) {
    const byUnit = new Map(), listening = new Map();
    const observations = Array.isArray(practice.unitEvidence) ? practice.unitEvidence
      : (practice.attempts || []).flatMap(attempt => Object.entries(attempt.unitAssessments || {}).map(([unitId, status]) => ({
        unitId, reportedStatus: status, status: status === 'independent' ? 'assisted' : status,
        dimension: attempt.taskMode || 'unknown', modality: attempt.responseMode || 'unknown',
        at: attempt.attemptedAt, attemptId: attempt.id, support: attempt.support || 'unknown',
        unitVersion: attempt.unitVersion, contextVerified: false })));
    for (const observation of observations) {
      if (!byUnit.has(observation.unitId)) byUnit.set(observation.unitId, []);
      byUnit.get(observation.unitId).push(observation);
    }
    for (const attempt of practice.listeningAttempts || []) listening.set(attempt.unitId, attempt);
    evidenceIndexes.set(practice, { byUnit, listening });
  }
  return evidenceIndexes.get(practice);
}
export function observationsFor(practice, unitId) {
  return indexesFor(practice).byUnit.get(unitId) || [];
}
export function unitSummary(practice, unitId) {
  const observations = observationsFor(practice, unitId);
  return { observations, latest: observations.at(-1) || null,
    independentRecall: observations.filter(o => o.dimension === 'recall' && o.status === 'independent' && o.support === 'none' && o.contextVerified).length,
    independentTransfer: observations.filter(o => o.dimension === 'transfer' && o.status === 'independent' && o.support === 'none' && o.contextVerified).length,
    listening: indexesFor(practice).listening.get(unitId) || null };
}
export function normalisePractice(value) {
  if (value?.schemaVersion != null && (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 1)) throw new Error("备份版本格式无效");
  if (value?.schemaVersion > 3) throw new Error("备份版本较新，请先更新应用");
  if (!value || !Array.isArray(value.attempts) || !value.reviews || typeof value.reviews !== "object" || Array.isArray(value.reviews)) throw new Error("备份缺少有效答题及复习记录");
  if (value.listeningAttempts != null && !Array.isArray(value.listeningAttempts)) throw new Error("听辨记录格式无效");
  if (value.attempts.length > 100000 || (value.listeningAttempts || []).length > 100000) throw new Error("备份记录过多");
  const seen = new Set();
  const attempts = value.attempts.map((a) => {
    if (!a || typeof a.id !== "string" || !a.id || seen.has(a.id) || typeof a.promptId !== "string" || typeof a.sceneId !== "string" || typeof a.response !== "string" || !Number.isFinite(Date.parse(a.attemptedAt))) throw new Error("答题记录字段缺失、日期无效或ID重复");
    seen.add(a.id);
    const unitAssessments = Object.fromEntries(Object.entries(a.unitAssessments || {}).filter(([id, status]) => /^U\.[A-Z0-9_.]+$/.test(id) && Object.hasOwn(EVIDENCE_LABELS, status)));
    const revisions = (Array.isArray(a.revisions) ? a.revisions : []).filter((r) => r && typeof r.response === "string" && Number.isFinite(Date.parse(r.at))).map((r) => ({ response: r.response, at: r.at, support: "reference" }));
    return { ...a, unitAssessments, revisions };
  });
  const reviews = Object.fromEntries(Object.entries(value.reviews).filter(([id, r]) => /^[A-Z0-9.]+$/.test(id) && r && Number.isInteger(r.stage) && r.stage >= 0 && r.stage <= 4 && (!r.nextDue || Number.isFinite(Date.parse(r.nextDue)))));
  const listeningAttempts = (Array.isArray(value.listeningAttempts) ? value.listeningAttempts : []).filter((a) => a && typeof a.id === "string" && /^U\.[A-Z0-9_.]+$/.test(a.unitId) && ["independent", "assisted", "partial"].includes(a.status) && Number.isFinite(Date.parse(a.at))).map((a) => ({ ...a, evidenceSource: "self-check" }));
  const timeZone = validTimeZone(value.unitReviewMeta?.timeZone) ? value.unitReviewMeta.timeZone : null;
  // Imported schedules are never authoritative. Rebuild after merging originals.
  return { ...value, attempts, reviews, listeningAttempts, schemaVersion: 3,
    unitReviews: {}, unitReviewMeta: { schedulerVersion: 1, timeZone } };
}
export function mergePractice(current, incoming, options) {
  // Local duplicates win: this prevents replacing an original answer after seeing feedback.
  const attempts = new Map(incoming.attempts.map((a) => [a.id, a]));
  current.attempts.forEach((a) => attempts.set(a.id, a));
  const sorted = [...attempts.values()].sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt));
  const reviews = { ...current.reviews };
  for (const [id, record] of Object.entries(incoming.reviews)) {
    if (!reviews[id] || Date.parse(record.lastAttemptAt || 0) > Date.parse(reviews[id].lastAttemptAt || 0)) reviews[id] = record;
  }
  const listening = new Map((incoming.listeningAttempts || []).map((a) => [a.id, a]));
  (current.listeningAttempts || []).forEach((a) => listening.set(a.id, a));
  return rebuildPractice({ ...current, schemaVersion: 3, attempts: sorted, reviews,
    listeningAttempts: [...listening.values()] }, options);
}
