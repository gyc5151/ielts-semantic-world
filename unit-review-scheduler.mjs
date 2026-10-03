// Unit schedules are derived from explicit self-checks of the original response.
// resolveContext must validate a frozen receipt or a known historical manifest.
// It returns { verified: true, unitIds, taskMode, responseMode,
// englishTargetInput, unitVersion, sceneId, promptId }, or null.
const UNIT_ID = /^U\.[A-Z0-9_.]+$/;
const STATUSES = new Set(["unobserved", "partial", "assisted", "independent"]);
const RATINGS = new Set(["good", "partial", "again"]);
const MODES = new Set(["recall", "transfer"]);
const MODALITIES = new Set(["written", "spoken"]);
const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const minimum = (...values) => values.filter(Boolean).sort()[0] || null;
const maximum = (...values) => values.filter(Boolean).sort().at(-1) || null;

export function calendarDay(at, timeZone) {
  if (!validTime(at)) throw new Error("Invalid observation time");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(at));
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addCalendarDays(day, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(days)) throw new Error("Invalid calendar date");
  const date = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day) throw new Error("Invalid calendar date");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyTrack() {
  return { stage: 0, anchorAt: null, anchorDay: null, milestoneDueDate: null,
    reinforcementDueDate: null, nextDueDate: null, independentCount: 0 };
}

// A supported answer can request another practice without earning a milestone.
// An early unsupported success clears that request without accelerating Day 7/30.
export function advanceTrack(previous, observation, timeZone) {
  if (!observation.scheduleAction) return previous || null;
  const state = { ...(previous || emptyTrack()) };
  const day = calendarDay(observation.at, timeZone);
  const tomorrow = addCalendarDays(day, 1);
  if (observation.scheduleAction === "partial") {
    Object.assign(state, { stage: 0, anchorAt: null, anchorDay: null,
      milestoneDueDate: null, reinforcementDueDate: tomorrow });
  } else if (observation.scheduleAction === "assisted") {
    state.reinforcementDueDate = minimum(state.reinforcementDueDate, tomorrow);
  } else if (observation.scheduleAction === "independent") {
    state.independentCount += 1;
    state.reinforcementDueDate = null;
    if (state.stage === 0) {
      Object.assign(state, { stage: 1, anchorAt: observation.at, anchorDay: day,
        milestoneDueDate: tomorrow });
    } else if (state.milestoneDueDate && day >= state.milestoneDueDate) {
      if (state.stage >= 4) state.milestoneDueDate = addCalendarDays(day, 60);
      else {
        state.stage += 1;
        state.milestoneDueDate = state.stage === 4
          ? addCalendarDays(day, 60)
          : maximum(addCalendarDays(state.anchorDay, state.stage === 2 ? 7 : 30), tomorrow);
      }
    }
  }
  state.nextDueDate = minimum(state.milestoneDueDate, state.reinforcementDueDate);
  state.lastAttemptId = observation.attemptId;
  state.lastAttemptAt = observation.at;
  state.lastStatus = observation.status;
  state.lastSceneId = observation.sceneId;
  state.lastPromptId = observation.promptId;
  state.lastUnitVersion = observation.unitVersion;
  return state;
}

function hasOriginalResponse(attempt, modality) {
  if (modality === "spoken") return Number.isFinite(attempt.recording?.durationSeconds)
    && attempt.recording.durationSeconds > 0 && typeof attempt.response === "string"
    && Boolean(attempt.response.trim());
  return typeof attempt.response === "string" && Boolean(attempt.response.trim());
}

function observe(attempt, unitId, reportedStatus, context) {
  const mode = context?.taskMode || attempt.taskMode || "unknown";
  const modality = context?.responseMode || attempt.responseMode || "unknown";
  const responseExists = hasOriginalResponse(attempt, modality);
  const independentEligible = context?.verified === true && MODES.has(mode)
    && MODALITIES.has(modality) && context.englishTargetInput === false
    && attempt.support === "none" && responseExists;
  const status = !responseExists ? "unobserved"
    : reportedStatus === "independent" && !independentEligible ? "assisted" : reportedStatus;
  let scheduleAction = null;
  const validTrack = context?.verified === true && MODES.has(mode) && MODALITIES.has(modality);
  if (validTrack && status !== "unobserved") {
    if (status === "independent") scheduleAction = "independent";
    else if (status === "partial" && independentEligible) scheduleAction = "partial";
    else scheduleAction = "assisted";
  }
  return { unitId, reportedStatus, status, scheduleAction, attemptId: attempt.id,
    at: attempt.attemptedAt, dimension: mode, modality, support: attempt.support || "unknown",
    unitVersion: context?.unitVersion || attempt.unitVersion || null,
    sceneId: attempt.sceneId, promptId: attempt.promptId, evidenceSource: "self-check",
    contextVerified: context?.verified === true };
}

// Derived cache: all decisions are replayed from original attempts.
// Same attempt ID occurs at most once, and one assessment contributes to one track.
// No use of selfRating as a unit outcome; it only marks the assessment as committed.
export function rebuildUnitReviews(attempts, { resolveContext, timeZone = "Asia/Shanghai" } = {}) {
  if (typeof resolveContext !== "function") throw new Error("A validated context resolver is required");
  // Validate the time zone even when there are no observations.
  calendarDay("2026-01-01T00:00:00.000Z", timeZone);
  const unique = new Map();
  const issues = [];
  for (const attempt of attempts || []) {
    if (!attempt || typeof attempt.id !== "string" || !attempt.id) {
      issues.push({ reason: "invalid-attempt-id" }); continue;
    }
    if (unique.has(attempt.id)) {
      issues.push({ attemptId: attempt.id, reason: "duplicate-attempt-id" }); continue;
    }
    unique.set(attempt.id, attempt);
  }
  const ordered = [...unique.values()].filter((a) => {
    if (!validTime(a.attemptedAt)) { issues.push({ attemptId: a.id, reason: "invalid-attempt-time" }); return false; }
    return true;
  }).sort((a, b) => Date.parse(a.attemptedAt) - Date.parse(b.attemptedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const unitReviews = {};
  const observations = [];
  for (const attempt of ordered) {
    if (!RATINGS.has(attempt.selfRating)) continue;
    const context = resolveContext(attempt);
    const matched = context?.verified === true
      && context.sceneId === attempt.sceneId && context.promptId === attempt.promptId
      && context.taskMode === attempt.taskMode && context.responseMode === attempt.responseMode
      && context.unitVersion === attempt.unitVersion;
    const validContext = matched ? context : null;
    const allowed = new Set(validContext?.unitIds || []);
    if (!validContext) issues.push({ attemptId: attempt.id, reason: "unverified-context" });
    for (const [unitId, status] of Object.entries(attempt.unitAssessments || {})) {
      if (!UNIT_ID.test(unitId) || !STATUSES.has(status)) continue;
      if (validContext && !allowed.has(unitId)) {
        issues.push({ attemptId: attempt.id, unitId, reason: "unit-not-in-prompt" }); continue;
      }
      const observation = observe(attempt, unitId, status, validContext);
      observations.push(observation);
      if (!observation.scheduleAction) continue;
      unitReviews[unitId] ||= { tracks: {} };
      const key = `${observation.dimension}.${observation.modality}`;
      const tracks = unitReviews[unitId].tracks;
      tracks[key] = advanceTrack(tracks[key], observation, timeZone);
    }
  }
  return { unitReviews, observations, issues, meta: { schedulerVersion: 1, timeZone } };
}

export function migratePracticeDraft(practice, options) {
  const result = rebuildUnitReviews(practice.attempts, options);
  return { ...practice, schemaVersion: 3, unitReviews: result.unitReviews,
    unitReviewMeta: result.meta };
}

export function dueUnitTracks(unitReviews, today) {
  return Object.entries(unitReviews || {}).flatMap(([unitId, review]) =>
    Object.entries(review.tracks || {}).filter(([, track]) => track.nextDueDate && track.nextDueDate <= today)
      .map(([trackKey, track]) => ({ unitId, trackKey, ...track })))
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate)
      || a.unitId.localeCompare(b.unitId) || a.trackKey.localeCompare(b.trackKey));
}

// candidates must come from the current published lesson registry, with
// englishTargetInput evaluated for the actual visible cue and draft.
// Returning no target is intentional: missing authoring coverage is not success.
export function choosePracticeTarget({ unitId, trackKey, lastSceneId, lastPromptId }, candidates) {
  const [mode, modality] = trackKey.split(".");
  const options = (candidates || []).filter((candidate) => candidate.unitIds?.includes(unitId)
    && candidate.taskMode === mode && candidate.responseModes?.includes(modality)
    && candidate.englishTargetInput === false && candidate.canOpenWithoutStory === true);
  const ranked = options.map((candidate) => ({ candidate,
    score: mode === "transfer"
      ? (candidate.sceneId !== lastSceneId ? 0 : candidate.promptId !== lastPromptId ? 1 : 2)
      : candidate.sceneId === lastSceneId ? 0 : 1 }));
  ranked.sort((a, b) => a.score - b.score
    || a.candidate.promptId.localeCompare(b.candidate.promptId));
  if (!ranked.length) return null;
  const target = ranked[0].candidate;
  return { unitId, trackKey, sceneId: target.sceneId, promptId: target.promptId,
    responseMode: modality, requiresModeSwitch: modality === "spoken" };
}

export function validTimeZone(value) {
  if (typeof value !== "string" || value.length > 100) return false;
  try { calendarDay("2026-01-01T00:00:00.000Z", value); return true; } catch (_) { return false; }
}

const words = (text) => String(text || "").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
function containsPhrase(text, phrase) {
  const haystack = ` ${words(text).join(" ")} `;
  const needle = words(phrase).join(" ");
  return Boolean(needle) && haystack.includes(` ${needle} `);
}

function wordForms(form) {
  const word = String(form || "").toLowerCase();
  if (!/^[a-z]+$/.test(word)) return [word];
  const forms = new Set([word, `${word}s`, `${word}es`, `${word}ed`, `${word}ing`]);
  if (word.endsWith("e")) { forms.add(`${word}d`); forms.add(`${word.slice(0, -1)}ing`); }
  if (word.endsWith("y")) { forms.add(`${word.slice(0, -1)}ies`); forms.add(`${word.slice(0, -1)}ied`); }
  if (/[aeiou][b-df-hj-np-tv-z]$/.test(word)) { forms.add(`${word}${word.at(-1)}ed`); forms.add(`${word}${word.at(-1)}ing`); }
  return [...forms];
}

// Shared with the manifest builder. Exact chunks and regular word inflections
// are checked; rewrite input is conservatively treated as an English scaffold.
// Authoring can explicitly set englishTargetInput:true for other exposed forms.
export function taskCuePolicy(scene, prompt, units, translations = {}) {
  const targets = (prompt.unitIds || []).map((id) => units.find((unit) => unit.id === id)).filter(Boolean);
  const forms = [...(prompt.targetTerms || []), ...targets.flatMap((unit) =>
    unit.type === "word" ? [...wordForms(unit.form), ...(unit.inflections || [])]
      : [unit.form, ...(unit.aliases || [])])];
  const exposed = (text) => forms.some((form) => containsPhrase(text, form));
  const translated = translations[scene.id]?.prompts?.[prompt.id]?.cue;
  const zh = prompt.cueZh || (exposed(prompt.cue) && translated && !exposed(translated) ? translated : null);
  return { zh, englishTargetInput: prompt.englishTargetInput === true
    || (!zh && exposed(prompt.cue)) || Boolean(prompt.draft) || prompt.activity === "rewrite" };
}

// Receipt identity is an exact canonical description of trusted published input,
// not a caller-provided "verified" flag and not a mastery claim.
export function buildTaskRegistry(scenes, units, translations, contentVersion, cuePolicy = taskCuePolicy) {
  const known = new Set(units.map((unit) => unit.id));
  return scenes.flatMap((scene) => [...(scene.retrievalPrompts || []), ...(scene.transferPrompt ? [scene.transferPrompt] : [])]
    .filter((prompt) => prompt.unitIds?.length).map((prompt) => {
      const unitIds = [...new Set(prompt.unitIds)].filter((id) => known.has(id));
      const cue = cuePolicy(scene, prompt, units, translations);
      const context = { sceneId: scene.id, promptId: prompt.id,
        contentVersion, unitVersion: prompt.unitVersion || null, unitIds,
        taskMode: prompt.taskMode || "unknown", englishTargetInput: cue.englishTargetInput,
        responseModes: ["written", "spoken"], canOpenWithoutStory: true };
      const receiptId = JSON.stringify([contentVersion, scene.id, prompt.id, context.unitVersion,
        unitIds, context.taskMode, cue.zh || prompt.cue || "", prompt.draft || "", cue.englishTargetInput]);
      return { ...context, receiptId };
    }));
}

export function createTaskResolver(currentTasks, historyTasks = []) {
  const records = [...historyTasks, ...currentTasks];
  const receipts = new Map(records.filter((row) => row && typeof row.receiptId === "string"
    && Array.isArray(row.unitIds) && row.unitIds.every((id) => UNIT_ID.test(id))
    && typeof row.englishTargetInput === "boolean").map((row) => [row.receiptId, row]));
  return (attempt) => {
    if (!MODALITIES.has(attempt.responseMode)) return null;
    let row;
    if (attempt.unitReviewContext?.receiptId) row = receipts.get(attempt.unitReviewContext.receiptId);
    else row = records.find((record) => record.contentVersion === attempt.contentVersion
      && record.sceneId === attempt.sceneId && record.promptId === attempt.promptId
      && record.unitVersion === attempt.unitVersion && record.taskMode === attempt.taskMode);
    if (!row || row.sceneId !== attempt.sceneId || row.promptId !== attempt.promptId
      || row.contentVersion !== attempt.contentVersion || row.unitVersion !== attempt.unitVersion
      || row.taskMode !== attempt.taskMode || !row.responseModes?.includes(attempt.responseMode)) return null;
    // All task identity fields come from the published registry, never the backup.
    return { ...row, verified: true, responseMode: attempt.responseMode };
  };
}

export function rebuildPractice(practice, options) {
  const result = rebuildUnitReviews(practice.attempts, options);
  const next = { ...practice, schemaVersion: 3, unitReviews: result.unitReviews, unitReviewMeta: result.meta };
  // Derived evidence is useful to the view but need not duplicate backup content.
  Object.defineProperty(next, "unitEvidence", { value: result.observations, enumerable: false });
  Object.defineProperty(next, "unitReviewIssues", { value: result.issues, enumerable: false });
  return next;
}
