import { DataStore } from "./data-store.mjs?v=pilot-34-0";
import { dictionaryHtml, dictionaryContextFor, sentenceAt, usageForOccurrence } from "./dictionary.mjs?v=pilot-34-0";
import { nextReview, reviewDue } from "./learning.mjs?v=pilot-34-0";
import { EVIDENCE_LABELS, unitSummary, normalisePractice, mergePractice } from "./unit-learning.mjs?v=pilot-34-0";
import { buildTaskRegistry, createTaskResolver, taskCuePolicy, rebuildPractice, calendarDay, dueUnitTracks, choosePracticeTarget, validTimeZone } from "./unit-review-scheduler.mjs?v=pilot-34-0";
import { speakSentence, mountRecorder, stopVoicePractice } from "./voice-practice.mjs?v=pilot-34-0";
const DATA_URL = "./data/runtime.json";
const ASSET_VERSION = "pilot-34-0";
function fetchData(path) {
  const url = new URL(path, window.location.href);
  url.searchParams.set("v", ASSET_VERSION);
  return fetch(url, { cache: "no-cache" });
}
const STORAGE_KEY = "ielts-semantic-world-s01-trial-v1";
const MIGRATION_BACKUP_KEY = `${STORAGE_KEY}-pre-unit-review-v3`;
let originalStorage = null;
let migrationRequired = false;
let storageReadBlocked = false;
let lastSaveFailed = false;
let taskRegistry = [];
let resolveTask = null;
let unitViewFilter = "all";
const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
const emptyPractice = () => ({ schemaVersion: 3, attempts: [], reviews: {}, listeningAttempts: [], unitReviews: {}, unitReviewMeta: { schedulerVersion: 1, timeZone: browserTimeZone() } });


const app = document.querySelector("#app");
const nav = document.querySelector("#sceneNav");
const glossaryDialog = document.querySelector("#glossaryDialog");
let glossaryReturnFocus = null;
let content;
let dataStore;
let routeGeneration = 0;
let modalGeneration = 0;
let routeSearchGeneration = 0;
let taskHistory = [];
let unitMetadata = [];
let unitPage = 0;
const UNIT_PAGE_SIZE = 50;
let contentReady = false;
let worldQuery = "";
let worldCategory = "all";
let unitQuery = "";
let unitScope = "all";
let activeBranchId = "housing";
let wordnet = null;
let dictionaryContext = {};
let dictionaryTranslations = {};
let dictionaryChinese = {};
let textTranslations = {};
let learningUnits = [];
let importCandidate = null;
const sessionRecordings = new Map();
let showDictionaryChinese = false;
const drafts = {};
let practice = readSaved();
let ui = {
  page: "home",
  sceneId: null,
  promptIndex: 0,
  reviewMode: false,
  revealed: false,
  support: "none",
  submittedAttemptId: null,
};

function readSaved() {
  try {
    originalStorage = localStorage.getItem(STORAGE_KEY);
    if (!originalStorage) return emptyPractice();
    const value = JSON.parse(originalStorage);
    migrationRequired = !value.schemaVersion || value.schemaVersion < 3;
    return normalisePractice(value);
  } catch (_) {
    // Never overwrite unreadable or future-version records with an empty state.
    storageReadBlocked = true;
    showStorageStatus("本机旧记录暂时无法读取；请先导出备份。新练习暂不写入旧记录。");
  }
  return emptyPractice();
}

function showStorageStatus(message) {
  const status = document.querySelector("#storageStatus");
  if (status) { status.hidden = false; status.textContent = message; }
}

function scheduleOptions(value = practice) {
  return { resolveContext: resolveTask, timeZone: validTimeZone(value.unitReviewMeta?.timeZone) ? value.unitReviewMeta.timeZone : browserTimeZone() };
}

function persistPractice(next) {
  if (storageReadBlocked) { lastSaveFailed = true; return false; }
  try {
    if (migrationRequired && originalStorage && localStorage.getItem(MIGRATION_BACKUP_KEY) === null) {
      localStorage.setItem(MIGRATION_BACKUP_KEY, originalStorage);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    migrationRequired = false;
    lastSaveFailed = false;
    document.querySelector("#storageStatus").hidden = true;
    return true;
  } catch (_) {
    lastSaveFailed = true;
    showStorageStatus("本机暂不能保存记录；旧记录未被清空，请在离开前导出备份。");
    return false;
  }
}

function save() {
  if (resolveTask) practice = rebuildPractice(practice, scheduleOptions());
  const saved = persistPractice(practice);
  renderChrome();
  return saved;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function dateLabel(iso) {
  if (!iso) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function getScene(id) {
  return dataStore?.getScene(id);
}

function promptsFor(scene) {
  return [...(scene.retrievalPrompts || []), ...(scene.transferPrompt ? [scene.transferPrompt] : [])];
}

function allPrompts() {
  return content.microScenes.flatMap((scene) => promptsFor(scene).map((prompt) => ({ scene, prompt })));
}

function assertWordCoverage(scene) {
  const passages = [scene.title, scene.goal, scene.situation, scene.easySummary || "", ...unitsForScene(scene).flatMap((u) => [u.form, u.example]), ...(scene.memoryNodes || []).flatMap((n) => [n.object, n.cue])];
  for (const prompt of promptsFor(scene)) {
    passages.push(prompt.function, prompt.cue, prompt.feedback, prompt.draft || "", ...(prompt.acceptableAnswers || []));
  }
  const missing = new Set();
  for (const passage of passages) {
    for (const match of String(passage || "").matchAll(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)?/g)) {
      const word = match[0].toLowerCase().replaceAll("’", "'");
      if (!scene.wordLookup[word]?.zh) missing.add(word);
    }
  }
  if (missing.size) throw new Error(`${scene.id} 有 ${missing.size} 个单词尚无情境释义：${[...missing].slice(0, 5).join(", ")}`);
}

function dueEntries() {
  const now = Date.now();
  const today = calendarDay(new Date(now).toISOString(), scheduleOptions().timeZone);
  const units = dueUnitTracks(practice.unitReviews, today).map((entry) => {
    const target = choosePracticeTarget(entry, taskRegistry);
    const scene = getScene(target?.sceneId || entry.lastSceneId);
    const prompt = target && scene && promptsFor(scene).find((item) => item.id === target.promptId);
    return { ...entry, kind: "unit", target, scene, prompt };
  });
  const legacy = allPrompts().filter(({ prompt }) => {
    // New registered tasks are scheduled only by explicit unit assessments.
    if (prompt.unitIds?.length && latestAttempt(prompt.id)?.unitReviewContext) return false;
    const last = latestAttempt(prompt.id);
    if (prompt.unitIds?.length && last && resolveTask?.(last) &&
      ["recall", "transfer"].includes(last.taskMode) && Object.values(last.unitAssessments || {}).some((status) => status !== "unobserved")) return false;
    const record = practice.reviews[prompt.id];
    const due = reviewDue(record);
    return due && new Date(due).getTime() <= now;
  }).map((entry) => ({ ...entry, kind: "legacy" }));
  return [...units, ...legacy];
}

function unitNextDate(unitId) {
  return Object.values(practice.unitReviews[unitId]?.tracks || {}).map((track) => track.nextDueDate).filter(Boolean).sort()[0] || null;
}

async function hydrateScene(id) {
  const bundle = await dataStore.ensureScene(id);
  const full = new Map(learningUnits.map(unit => [unit.id, unit]));
  bundle.units.forEach(unit => full.set(unit.id, unit));
  learningUnits = [...full.values()];
  Object.assign(dictionaryContext, bundle.contexts);
  textTranslations[id] = bundle.translation;
  assertWordCoverage(bundle.scene);
  const current = buildTaskRegistry([bundle.scene], bundle.units, textTranslations, content.version);
  taskRegistry = [...taskRegistry.filter(task => task.sceneId !== id), ...current];
  refreshTaskResolver();
  return bundle.scene;
}

function refreshTaskResolver() {
  resolveTask = createTaskResolver(taskRegistry, taskHistory);
}

async function hydrateHistory(attempts) {
  const rows = await dataStore.taskHistoryFor(attempts);
  taskHistory = [...new Map([...taskHistory, ...rows].map(row => [row.receiptId, row])).values()];
  refreshTaskResolver();
}

function contentError(error, retry) {
  app.innerHTML = `<section class="simple-page"><h1>内容暂未载入</h1><p role="status">${escapeHtml(error.message)}</p><button class="secondary-btn" type="button" id="retryContent">重试</button></section>`;
  app.querySelector('#retryContent').addEventListener('click', retry);
}

async function openReview(entry, support = "none") {
  const target = entry.target || (entry.prompt && { sceneId: entry.scene.id, promptId: entry.prompt.id, responseMode: "written" });
  if (!target) return;
  preserveDraft();
  clearSessionRecordings(); stopVoicePractice();
  const generation = ++routeGeneration; ++modalGeneration;
  if (glossaryDialog.open) glossaryDialog.close();
  app.innerHTML = '<div class="loading">正在打开练习…</div>';
  try {
    const scene = await hydrateScene(target.sceneId);
    if (generation !== routeGeneration) return;
    const index = promptsFor(scene).findIndex(prompt => prompt.id === target.promptId);
    if (index < 0) throw new Error('这道练习不在当前课程中');
    dataStore.pinScene(scene.id);
    ui = { page: "prompt", sceneId: scene.id, promptIndex: index, reviewMode: true, revealed: false,
      support, submittedAttemptId: null, preferredResponseMode: target.responseMode,
      reviewUnitIds: entry.unitId ? [entry.unitId] : [], reviewTrackKey: entry.trackKey || null };
    // Preserve direct-review state when closing a popup. A later explicit
    // history navigation restores the scene page as it did before this release.
    const hash = `#scene/${encodeURIComponent(scene.id)}`;
    if (location.hash !== hash) history.pushState(null, '', hash);
    render(); app.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) { if (generation === routeGeneration) contentError(error, () => openReview(entry, support)); }
}

function latestAttempt(promptId) {
  return [...practice.attempts].reverse().find((attempt) => attempt.promptId === promptId);
}

// A finished attempt is navigation history, never proof of unit proficiency.
function taskCompleted(promptId) {
  return Boolean(practice.reviews[promptId] || practice.attempts.some((attempt) =>
    attempt.promptId === promptId && ["good", "partial", "again"].includes(attempt.selfRating)));
}

function getBranch(id) {
  return content.branches?.find((branch) => branch.id === id);
}

function branchForScene(scene) {
  return getBranch(scene?.branchId || "housing");
}

function branchScenes(branch) {
  return (branch?.sceneIds || []).map(getScene).filter(Boolean);
}

function openBranch(id) {
  if (!getBranch(id)) return;
  activeBranchId = id;
  navigate("branch");
}

function renderChrome() {
  if (!content) return;
  const scene = getScene(ui.sceneId);
  const branch = scene ? branchForScene(scene) : ui.page === "branch" ? getBranch(activeBranchId) : null;
  if (branch) activeBranchId = branch.id;
  document.documentElement.dataset.theme = branch?.theme || "world";
  document.documentElement.dataset.branch = branch?.id || "world";
  document.querySelector("#sidebarTitle").textContent = branch?.title || "场景";
  document.querySelector("#sceneCountLabel").textContent = branch ? branch.title : "IELTS Semantic World";
  const dueCount = dueEntries().length;
  document.querySelector("#dueCount").textContent = String(dueCount);
  document.querySelector("#dueCount").hidden = dueCount === 0;
  nav.innerHTML = `
    <button class="nav-item ${ui.page === "home" ? "active" : ""}" type="button" data-nav="home" ${ui.page === "home" ? 'aria-current="page"' : ""}><span class="nav-index">◎</span><span>世界入口</span></button>
    ${branch ? `<button class="nav-item ${ui.page === "branch" ? "active" : ""}" type="button" data-branch="${escapeHtml(branch.id)}" ${ui.page === "branch" ? 'aria-current="page"' : ""}><span class="nav-index">↳</span><span>${escapeHtml(branch.title)}</span></button>` : ""}
    ${branch ? branchScenes(branch).map((item, index) => {
      const total = promptsFor(item).length;
      const done = promptsFor(item).filter((prompt) => taskCompleted(prompt.id)).length;
      const selected = ui.sceneId === item.id && ["scene", "prompt"].includes(ui.page);
      return `<button class="nav-item ${selected ? "active" : ""}" type="button" data-scene="${escapeHtml(item.id)}" ${selected ? 'aria-current="page"' : ""}><span class="nav-index">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(item.navTitle || item.title)}</span></button>`;
    }).join("") : content.branches.map((item) => `<button class="nav-item" type="button" data-branch="${escapeHtml(item.id)}"><span class="nav-index">${item.kind === "主线" ? "01" : "↳"}</span><span>${escapeHtml(item.title)}</span></button>`).join("")}
  `;
  nav.querySelector('[data-nav="home"]').addEventListener("click", () => navigate("home"));
  nav.querySelectorAll("[data-branch]").forEach((button) => button.addEventListener("click", () => openBranch(button.dataset.branch)));
  nav.querySelectorAll("[data-scene]").forEach((button) => button.addEventListener("click", () => navigate("scene", button.dataset.scene)));
}

function preserveDraft() {
  if (ui.page === 'prompt' && !ui.revealed) {
    const input = app.querySelector('#answerInput');
    if (input) drafts[`${ui.sceneId}:${ui.promptIndex}`] = { response: input.value, support: ui.support };
  }
}

async function navigate(page, sceneId = null, { updateUrl = true } = {}) {
  if (!contentReady) return;
  preserveDraft(); clearSessionRecordings(); stopVoicePractice();
  const generation = ++routeGeneration; ++modalGeneration; ++routeSearchGeneration;
  if (glossaryDialog.open) glossaryDialog.close();
  const branchId = activeBranchId;
  if (updateUrl) {
    const hash = page === 'scene' ? `#scene/${encodeURIComponent(sceneId)}` : page === 'branch' ? `#branch/${encodeURIComponent(branchId)}` : `#${page}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }
  try {
    if (page === 'scene') {
      app.innerHTML = '<div class="loading">正在打开场景…</div>';
      await hydrateScene(sceneId);
    } else if (page === 'units') {
      app.innerHTML = '<div class="loading">正在打开表达记录…</div>';
      unitMetadata = await dataStore.unitMetadata();
      // Metadata remains complete even if its courses are not loaded.
      const complete = new Map(unitMetadata.map(unit => [unit.id, unit]));
      learningUnits.forEach(unit => { if (unit.sourceRecords) complete.set(unit.id, unit); });
      learningUnits = [...complete.values()];
    }
    if (generation !== routeGeneration) return;
    activeBranchId = branchId;
    dataStore.pinScene(page === 'scene' ? sceneId : null);
    ui = { page, sceneId, promptIndex: 0, reviewMode: false, revealed: false, support: 'none', submittedAttemptId: null };
    render(); app.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    if (generation === routeGeneration) contentError(error, () => navigate(page, sceneId, { updateUrl: false }));
  }
}

function restoreRoute() {
  let parts;
  try { parts = decodeURIComponent(window.location.hash.slice(1)).split("/"); }
  catch (_) { parts = []; }
  if (parts[0] === "branch" && getBranch(parts[1])) {
    activeBranchId = parts[1];
    return navigate("branch", null, { updateUrl: false });
  }
  if (parts[0] === "scene" && getScene(parts[1])) return navigate("scene", parts[1], { updateUrl: false });
  if (["home", "review", "about", "units"].includes(parts[0])) return navigate(parts[0], null, { updateUrl: false });
  navigate("home", null, { updateUrl: false });
}

window.addEventListener("popstate", () => { if (contentReady) restoreRoute(); });
window.addEventListener("hashchange", () => { if (contentReady) restoreRoute(); });

function render() {
  stopVoicePractice();
  if (!content) return;
  renderChrome();
  if (ui.page === "home") renderHome();
  if (ui.page === "branch") renderBranch();
  if (ui.page === "scene") renderScene();
  if (ui.page === "prompt") renderPrompt();
  if (ui.page === "review") renderReview();
  if (ui.page === "about") renderAbout();
  if (ui.page === "units") renderUnits();
}

function themeIllustration(theme) {
  const art = {
    home: '<path d="M35 103V50l57-34 57 34v53M58 103V65h33v38M106 64h22v22h-22M158 104h41l-5-23h-31zM179 81V48m0 14c-30-1-25-26-25-26 22 0 25 26 25 26m0 5c30-1 25-26 25-26-22 0-25 26-25 26"/>',
    community: '<rect x="25" y="18" width="116" height="90" rx="4"/><path d="M42 37h62M42 50h82M42 72h38m-38 13h48m3-17 20 12-20 12"/><circle cx="181" cy="56" r="29"/><path d="M181 38v20l16 9M162 100h39"/>',
    science: '<path d="M47 17h36m-28 0v34l-29 47q-4 10 7 10h64q11 0 7-10L75 51V17M41 81h47M145 33h49m-41 0v55q16 38 33 0V33M153 69h33M124 108h91"/><path d="m119 19 14 11 18-15"/>',
    media: '<rect x="27" y="20" width="73" height="90" rx="3"/><rect x="113" y="20" width="73" height="90" rx="3"/><path d="M40 40h45m-45 15h45m-45 15h30m51-30h45m-45 15h45m-45 15h30M42 89l10-10 13 12 20-24M130 89h43M190 79h20v24h-20m20-18h5a7 7 0 0 1 0 14h-5"/>',
    industry: '<path d="M22 107V59l35-21v21l35-21v21h36v48zM104 59V21h16v38M33 78h17v13H33zM65 78h17v13H65zM98 78h17v29M147 107h62M150 67h46v40h-46zM150 67l23-12 23 12M173 67v40M150 83h46M21 113h108"/>',
    urban: '<path d="M25 22h180v82H25zM25 48h180M25 78h180M66 22v82M147 22v82"/><path d="M85 58h43v11H85M104 84v19M52 29v10m113 22v12"/><circle cx="177" cy="35" r="7"/>',
    travel: '<rect x="27" y="19" width="99" height="79" rx="12"/><path d="M40 38h73v28H40zM45 98l-9 14m73-14 9 14M49 111h54M62 19v-7h30v7"/><circle cx="46" cy="81" r="4"/><circle cx="107" cy="81" r="4"/><rect x="154" y="54" width="50" height="53" rx="5"/><path d="M169 54V42h20v12M168 66v29m22-29v29M153 26h50m-9-7 9 7-9 7"/>',
    commerce: '<path d="M29 41h94l9 65H20zM46 43V31a16 16 0 0 1 32 0v12M151 16h54v92l-9-7-9 7-9-7-9 7-9-7-9 7zM162 36h32m-32 14h25m-25 16h32m-32 20h18"/><circle cx="107" cy="33" r="13"/><path d="m100 33 5 5 9-11"/>',
    kitchen: '<path d="M26 55h91v38q0 14-14 14H40q-14 0-14-14zM16 56h110M60 47h25M72 47v-7M27 68H14m103 0h13M46 33q-8-8 0-17m22 17q-8-8 0-17m22 17q-8-8 0-17M151 17h52v91h-52zM162 34h29m-29 13h22m-22 14h29m-29 20h20"/>',
    campus: '<path d="M36 14h103l22 21v77H36zM139 14v21h22M52 48h86M52 64h70M52 82h39M52 94h77"/><path d="m181 92 24-59-9-4-24 59-1 16zM181 92l-9-4M67 21l13 5"/>',
    nature: '<path d="M22 92q45-18 89 0t89 0M22 107q45-18 89 0t89 0M44 78V46m0 15L30 47m14 8 14-20M168 76V31m0 22 16-15m-16 21-16-18M79 36q9-12 18 0 9-12 18 0M111 57q9-12 18 0 9-12 18 0"/><circle cx="188" cy="20" r="9"/>',
    health: '<rect x="29" y="24" width="99" height="85" rx="7"/><rect x="58" y="14" width="40" height="19" rx="4"/><path d="M44 49h31m-31 15h68m-68 15h54m-54 15h39M150 47h49v53h-49zM166 47V35h18v12M159 65h31m-31 13h21M139 110h72"/>'
  };
  return `<svg class="theme-illustration" viewBox="0 0 230 125" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art[theme] || art.home}</svg>`;
}

function renderHome() {
  app.innerHTML = `
    <section class="hero world-hero">
      <h1>IELTS Semantic World</h1>
      
      <div class="hero-actions"><button class="primary-btn" type="button" id="startFirst">住房与通勤</button><button class="secondary-btn" type="button" id="openReview">复习</button><button class="secondary-btn" type="button" id="openUnits">表达记录</button></div>
      
    </section>
    <section class="section-heading"><h2>场景</h2></section>
    <section class="route-tools" aria-label="筛选学习路线"><label for="routeSearch">搜索场景</label><input id="routeSearch" type="search" placeholder="地点、主题或英文词" autocomplete="off" />
    <div class="route-filters" aria-label="路线分类">${[['all','全部'],['life','日常生活'],['public','社区与城市'],['study','学习与研究'],['nature','自然环境']].map(([id,label]) => `<button class="route-filter" type="button" data-route-filter="${id}" aria-pressed="${worldCategory === id}">${label}</button>`).join('')}</div><p id="routeResultCount" class="meta" role="status" aria-live="polite"></p></section>
    <div class="branch-grid">${content.branches.map((branch) => {
      const scenes = branchScenes(branch);
      const tasks = scenes.flatMap(promptsFor);
      const done = tasks.filter((prompt) => taskCompleted(prompt.id)).length;
      return `<article class="branch-card" data-branch-card="${escapeHtml(branch.id)}" data-theme="${escapeHtml(branch.theme)}">
        <div class="branch-art">${themeIllustration(branch.theme)}</div>
        <div class="branch-card-body"><h3>${escapeHtml(branch.title)}</h3><p class="branch-subtitle" lang="en">${annotatedEnglish(branch.subtitle, scenes[0])}</p>
        <div class="branch-mini-route">${branch.route.slice(0, 3).map(escapeHtml).join(' → ')} → …</div>
        
        <button class="secondary-btn" type="button" data-open-branch="${escapeHtml(branch.id)}">阅读 <span aria-hidden="true">↗</span></button></div>
      </article>`;
    }).join('')}</div>
    <div class="empty-state" id="routeEmpty" hidden>没有找到匹配的场景。</div>
    `;
  app.querySelector('#startFirst').addEventListener('click', () => openBranch('housing'));
  app.querySelector('#openReview').addEventListener('click', () => navigate('review'));
  app.querySelector('#openUnits').addEventListener('click', () => navigate('units'));
  app.querySelectorAll('[data-open-branch]').forEach((button) => button.addEventListener('click', () => openBranch(button.dataset.openBranch)));
  app.querySelector('#routeSearch').value = worldQuery;
  app.querySelector('#routeSearch').addEventListener('input', (event) => { worldQuery = event.target.value; filterRoutes(); });
  app.querySelectorAll('[data-route-filter]').forEach((button) => button.addEventListener('click', () => {
    worldCategory = button.dataset.routeFilter;
    app.querySelectorAll('[data-route-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.routeFilter === worldCategory)));
    filterRoutes();
  }));
  filterRoutes();
}

async function filterRoutes() {
  const generation = ++routeSearchGeneration;
  const groups = { home: 'life', community: 'public', urban: 'public', science: 'study', industry: 'study', media: 'study', campus: 'study', nature: 'nature', travel: 'life', commerce: 'life', kitchen: 'life', health: 'life' };
  const query = worldQuery.trim().toLocaleLowerCase();
  const category = worldCategory;
  const count = app.querySelector('#routeResultCount');
  if (!count) return;
  let matches = null;
  try {
    if (query) {
      count.textContent = '正在搜索…';
      matches = new Set((await dataStore.search(query, 'route')).map(doc => doc.id));
    }
    if (generation !== routeSearchGeneration || ui.page !== 'home') return;
    let visible = 0;
    for (const card of app.querySelectorAll('[data-branch-card]')) {
      const branch = getBranch(card.dataset.branchCard);
      const selected = (!matches || matches.has(branch.id)) && (category === 'all' || groups[branch.theme] === category);
      card.hidden = !selected;
      if (selected) visible += 1;
    }
    count.textContent = query || category !== 'all' ? `${visible} 条路线` : '';
    app.querySelector('#routeEmpty').hidden = visible !== 0;
  } catch (_) {
    if (generation !== routeSearchGeneration || ui.page !== 'home') return;
    // Previous cards are not presented as a final complete query result.
    count.textContent = '搜索暂不可用。';
    const retry = document.createElement('button'); retry.className = 'text-btn'; retry.type = 'button'; retry.textContent = '重试';
    retry.addEventListener('click', filterRoutes); count.append(retry);
    app.querySelector('#routeEmpty').hidden = true;
  }
}

const ACTIVITY_META = {
  explain: { label: '说明发生了什么', placeholder: 'Your answer…' },
  request: { label: '开口询问', placeholder: 'Your answer…' },
  compare: { label: '比较两边', placeholder: 'Your answer…' },
  rewrite: { label: '修改一句话', placeholder: 'Your answer…' },
  opinion: { label: '表达观点', placeholder: 'Your answer…' }
};

function branchObjectMapHtml(branch, scenes, next) {
  if (branch.route.length <= 15) {
    return `<ol class="object-route">${branch.route.map((object, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(object)}</strong></li>`).join('')}</ol>`;
  }
  return `<div class="route-segments">${scenes.map((scene, index) => `<details class="route-segment" ${scene.id === next.id ? 'open' : ''}><summary><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(scene.navTitle)}</strong></summary><ol class="object-route">${(scene.memoryNodes || []).map((node, n) => `<li><span>${String(n + 1).padStart(2, '0')}</span><strong>${escapeHtml(node.zh)}</strong></li>`).join('')}</ol><button class="text-btn" type="button" data-open-scene="${escapeHtml(scene.id)}">进入这一节 ↗</button></details>`).join('')}</div>`;
}

function renderBranch() {
  const branch = getBranch(activeBranchId);
  if (!branch) return navigate('home');
  const scenes = branchScenes(branch);
  const tasks = scenes.flatMap(promptsFor);
  const next = scenes.find((scene) => promptsFor(scene).some((p) => !taskCompleted(p.id))) || scenes[0];
  const done = tasks.filter((p) => taskCompleted(p.id)).length;
  app.innerHTML = `<section class="hero branch-hero">
    <div class="branch-hero-copy">
    <h1>${escapeHtml(branch.title)}</h1><p class="branch-subtitle" lang="en">${annotatedEnglish(branch.subtitle, scenes[0])}</p>
    <div class="hero-actions"><button class="primary-btn" type="button" id="startBranch">${done ? '继续阅读' : '开始阅读'}</button><button class="secondary-btn" type="button" id="backWorld">全部故事</button></div></div>
    <div class="branch-hero-art">${themeIllustration(branch.theme)}</div></section>
    <section class="memory-map" aria-label="故事里的物件">${branchObjectMapHtml(branch, scenes, next)}</section>
    <section class="section-heading"><h2>故事</h2></section>
    <div class="split-grid">${scenes.map((scene, index) => `<article class="scene-card"><span class="badge">${String(index + 1).padStart(2, '0')}</span><h3>${annotatedEnglish(scene.title, scene)}</h3><button class="secondary-btn" type="button" data-open-scene="${escapeHtml(scene.id)}">进入${escapeHtml(scene.navTitle)} ↗</button></article>`).join('')}</div>
    ${branch.entrySceneId ? `<section class="branch-return-panel"><button class="secondary-btn" id="returnMain" type="button">${escapeHtml(branch.returnLabel)} ↶</button></section>` : ``}`;
  app.querySelector('#startBranch').addEventListener('click', () => navigate('scene', next.id));
  app.querySelector('#backWorld').addEventListener('click', () => navigate('home'));
  app.querySelector('#returnMain')?.addEventListener('click', () => navigate('scene', branch.entrySceneId));
  app.querySelectorAll('[data-open-scene]').forEach((button) => button.addEventListener('click', () => navigate('scene', button.dataset.openScene)));
}

function memoryRouteHtml(scene) {
  if (!scene.memoryNodes?.length) return '';
  return `<section class="memory-stations" aria-label="本节物件线索"><h2>故事里的物件</h2><div class="memory-station-grid">${scene.memoryNodes.map((node, index) => {
    const location = node.locationRelationZh || node.locationZh;
    return `<details class="memory-station"><summary><span class="station-number">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(node.zh)}</strong></summary><div><p lang="en">${annotatedEnglish(node.object, scene)}</p><p lang="en">${annotatedEnglish(node.cue, scene)}</p>${textTranslation(node.cueZh, '中文')}${location ? `<p>${escapeHtml(location)}</p>` : ""}</div></details>`;
  }).join('')}</div></section>`;
}

function chunkMatches(value, scene) {
  const source = String(value || "");
  const lower = source.toLowerCase();
  const candidates = [];
  for (const entry of scene.glossary || []) {
    if ((!['chunk', 'construction'].includes(entry.type) && !entry.matchAsWhole) || !entry.text) continue;
    for (const rawText of new Set([entry.text, ...(entry.matchTexts || [])])) {
      // A quoted statement can end with a comma where its standalone example
      // ends with a full stop. Match the same words and keep punctuation outside.
      const text = rawText.replace(/[.!?,;:]+$/g, "");
      const needle = text.toLowerCase();
      if (!needle) continue;
      let from = 0;
      while (from < lower.length) {
        const start = lower.indexOf(needle, from);
        if (start < 0) break;
        const fullEnd = start + needle.length;
        if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(source[start - 1] || "") && !/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(source[fullEnd] || "")) {
          // Put the expression button after the final word, before punctuation.
          const finalWord = [...text.matchAll(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)?/g)].at(-1);
          if (finalWord) candidates.push({ start, end: start + finalWord.index + finalWord[0].length, entry });
        }
        from = fullEnd;
      }
    }
  }
  const selected = [];
  for (const match of candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (!selected.some((other) => match.start < other.end && match.end > other.start)) selected.push(match);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function annotatedEnglish(value, scene, contextExample = null) {
  const source = String(value || "");
  const chunks = chunkMatches(source, scene);
  const words = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)?/g;
  let html = "";
  let previousEnd = 0;
  for (const match of source.matchAll(words)) {
    const start = match.index;
    const end = start + match[0].length;
    html += escapeHtml(source.slice(previousEnd, start));
    const chunk = chunks.find((item) => start >= item.start && end <= item.end);
    const contextualOccurrence = contextExample ? [...String(contextExample).matchAll(words)].find((item) => item[0].toLowerCase() === match[0].toLowerCase()) : null;
    const contextOffset = contextualOccurrence ? contextualOccurrence.index : start;
    const sentence = sentenceAt(contextualOccurrence ? String(contextExample) : source, contextOffset);
    const usage = usageForOccurrence(dictionaryContext, scene.id, match[0].toLowerCase().replaceAll("’", "'"), sentence.text, contextOffset - sentence.start);
    html += `<button class="glossary-word${chunk ? " glossary-word--chunk" : ""}" type="button" data-word="${escapeHtml(match[0].toLowerCase().replaceAll("’", "'"))}" data-word-scene="${escapeHtml(scene.id)}" data-word-sentence="${escapeHtml(sentence.text)}" ${usage ? `data-word-usage="${escapeHtml(usage)}"` : ""} ${chunk ? `data-related-chunk="${escapeHtml(chunk.entry.id)}"` : ""} aria-label="查看单词 ${escapeHtml(match[0])} 的意思">${escapeHtml(match[0])}</button>`;
    if (chunk && end === chunk.end) {
      html += `<button class="glossary-chunk-marker" type="button" data-glossary-id="${escapeHtml(chunk.entry.id)}" data-glossary-scene="${escapeHtml(scene.id)}" aria-label="查看整个表达 ${escapeHtml(chunk.entry.text)} 的搭配" title="查看整个表达 ${escapeHtml(chunk.entry.text)}">↗</button>`;
    }
    previousEnd = end;
  }
  return html + escapeHtml(source.slice(previousEnd));
}

function paragraphHtml(value, scene = null) {
  return String(value || "").split(/\n\s*\n/).filter(Boolean).map((paragraph) => `<p>${scene ? annotatedEnglish(paragraph, scene) : escapeHtml(paragraph)}</p>`).join("");
}

function textTranslation(zh, label = "查看中文译解") {
  return zh ? `<details class="text-translation" data-learning-translation><summary>${escapeHtml(label)}</summary><div lang="zh-CN">${paragraphHtml(zh)}</div></details>` : "";
}

function readingHtml(scene) {
  if (scene.readingBlocks?.length) {
    return scene.readingBlocks.map(block => {
      const lines = String(block.en).split('\n').filter(Boolean);
      const headingKey = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (block.title && headingKey(lines[0]) === headingKey(block.title)) lines.shift();
      return `<section class="reading-block reading-block--${escapeHtml(block.kind)}">${block.title ? `<h2 lang="en">${annotatedEnglish(block.title, scene)}</h2>` : ''}<div class="reading-block-text">${lines.map(line => `<p lang="en">${annotatedEnglish(line, scene)}</p>`).join('')}</div>${textTranslation(block.zh, '中文')}</section>`;
    }).join('');
  }
  const translation = textTranslations[scene.id];
  const pairs = translation?.paragraphs;
  if (pairs?.length && pairs.map((pair) => pair.en).join(" ") === scene.situation) {
    return pairs.map((pair) => `<div class="bilingual-paragraph"><p lang="en">${annotatedEnglish(pair.en, scene)}</p>${textTranslation(pair.zh, "本段中文")}</div>`).join("");
  }
  return paragraphHtml(scene.situation, scene) + textTranslation(translation?.situation, "全文中文译解");
}

function markTranslationSupport() {
  if (ui.page === "prompt" && !ui.revealed) {
    if (ui.support === "none") ui.support = "translation";
  }
}

function chunkWordButtons(scene, entry) {
  return [...entry.text.matchAll(/[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’][A-Za-zÀ-ÖØ-öø-ÿ]+)?/g)].map((match) => {
    const word = match[0].toLowerCase().replaceAll("’", "'");
    const usage = usageForOccurrence(dictionaryContext, scene.id, word, entry.text, match.index);
    return `<button class="glossary-component-word" type="button" data-dialog-word="${escapeHtml(word)}" data-dialog-scene="${escapeHtml(scene.id)}" data-dialog-chunk="${escapeHtml(entry.id)}" data-dialog-sentence="${escapeHtml(entry.text)}" ${usage ? `data-word-usage="${escapeHtml(usage)}"` : ""} aria-label="查看组成单词 ${escapeHtml(match[0])}">${escapeHtml(match[0])}</button>`;
  }).join("");
}

function sourceDetailHtml(source) {
  if (!source) return "<p>项目编写的情境释义。</p>";
  const record = source.sourceRecord;
  const original = source.sourceDerived || (record ? {printedSurface: record.Source_Term, printedPOS: record.POS,
    printedChinese: record.Chinese_Meaning, sourceSpan: record.Source_Context} : null);
  const evidence = source.externalEvidence || [];
  return `<p>${escapeHtml(source.sourceLabel || source.kind || "来源")}</p>
    ${source.sourceRef ? `<small>${escapeHtml(source.sourceRef)}</small>` : ""}
    ${original ? `<h3>原资料</h3><p>${escapeHtml(original.printedSurface || "")}${original.printedPOS ? ` · ${escapeHtml(original.printedPOS)}` : ""}</p>${original.printedChinese ? `<p>${escapeHtml(original.printedChinese)}</p>` : ""}${original.sourceSpan && original.sourceSpan !== original.printedSurface ? `<p>${escapeHtml(original.sourceSpan)}</p>` : ""}` : ""}
    ${evidence.length ? `<details><summary>词典来源</summary>${evidence.map((item) => `<p><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.publisher || "词典")} ↗</a></p><p>${escapeHtml(item.shortParaphrase)}</p>`).join("")}</details>` : ""}
    ${source.sourceUrl ? `<a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">词典 ↗</a>` : ""}`;
}

function showEntryModal(scene, entry, trigger, relatedChunkId = null) {
  const requestToken = Symbol();
  glossaryDialog.dictionaryToken = requestToken;
  glossaryDialog.entryContext = { scene, entry, relatedChunkId };
  if (!entry.dictionaryLoadChecked) ensureDictionary(scene, entry, false).then(result => {
    if (!glossaryDialog.open || glossaryDialog.dictionaryToken !== requestToken) return;
    wordnet = result.wordnet; dictionaryTranslations = result.translations; dictionaryChinese = result.chinese;
    showEntryModal(scene, { ...entry, dictionaryLoadChecked: true, dictionaryChineseLoaded: result.chineseState === 'ready' }, null, relatedChunkId);
  }, () => {
    if (glossaryDialog.open && glossaryDialog.dictionaryToken === requestToken)
      showEntryModal(scene, { ...entry, dictionaryLoadChecked: true, dictionaryError: true }, null, relatedChunkId);
  });
  if (!glossaryDialog.open) glossaryReturnFocus = trigger;
  const source = (scene.terms || []).find((term) =>
    String(term.term).toLowerCase() === String(entry.sourceTerm || "").toLowerCase() ||
    entry.sourceSupplementOccurrenceIds?.includes(term.sourceOccurrenceId));
  const sceneUnits = unitsForScene(scene);
  const sourceUnit = (entry.sourceUnitId && sceneUnits.find(unit => unit.id === entry.sourceUnitId))
    || sceneUnits.find(unit => unit.glossaryIds?.includes(entry.id))
    || sceneUnits.find(unit => unit.form.toLowerCase() === entry.text.toLowerCase());
  const sourceRecords = entry.unitSources || sourceUnit?.sourceRecords;
  const relatedChunk = (scene.glossary || []).find((item) => item.id === relatedChunkId && (item.type !== "word" || item.matchAsWhole));
  const modalDictionaryContext = dictionaryContextFor(dictionaryContext, scene.id, entry.text.toLowerCase().replaceAll("’", "'"), entry.dictionaryUsage);
  const contextExample = modalDictionaryContext?.example;
  const wholeEntryHasSense = entry.type !== "word" && modalDictionaryContext?.senseId && !modalDictionaryContext.noMatch;
  const showProjectExample = entry.example && ((entry.type !== "word" && !wholeEntryHasSense) || !wordnet || entry.example !== contextExample);
  glossaryDialog.innerHTML = `<div class="glossary-modal">
    <div class="glossary-modal-top"><button class="glossary-close" type="button" aria-label="关闭释义窗口">×</button></div>
    <h2 class="glossary-headword" id="glossaryHeadword">${escapeHtml(entry.text)}</h2>
    ${entry.contextSentence ? `<details class="glossary-context"><summary>情境句</summary><p lang="en">${escapeHtml(entry.contextSentence)}</p></details>` : ""}
    <div class="glossary-zh"><span>本句意思</span><strong>${escapeHtml(entry.zh || "释义待补")}</strong></div>
    ${entry.note ? `<div class="glossary-note"><span>${entry.type === "word" ? "用法" : "搭配"}</span><p>${escapeHtml(entry.note)}</p></div>` : ""}
    ${entry.type !== "word" ? `<div class="glossary-components"><span>单词</span><div>${chunkWordButtons(scene, entry)}</div></div>` : ""}
    ${relatedChunk ? `<button class="glossary-related" type="button" data-related-chunk-open="${escapeHtml(relatedChunk.id)}" data-related-scene="${escapeHtml(scene.id)}">查看整块表达：${escapeHtml(relatedChunk.text)} ↗</button>` : ""}
    ${showProjectExample ? `<div class="glossary-example"><span>项目情境例句</span><p>${escapeHtml(entry.example)}</p>${textTranslation(entry.exampleZh, "例句中文")}</div>` : ""}
    ${entry.dictionaryLoadChecked && !entry.dictionaryError && wordnet ? dictionaryHtml(entry, scene.id, wordnet, dictionaryContext, dictionaryTranslations, dictionaryChinese, showDictionaryChinese && entry.dictionaryChineseLoaded) : `<p role="status" class="meta">${entry.dictionaryLoadChecked ? "词典暂不可用。" : "词典载入中…"}</p>${entry.dictionaryError ? '<button class="text-btn" type="button" data-dictionary-retry>重试词典</button>' : ''}` }
    <details class="glossary-source"><summary>来源</summary>${sourceRecords?.length ? unitSourceHtml({sourceRecords}) : sourceDetailHtml(source)}</details>
  </div>`;
  if (glossaryDialog.open) glossaryDialog.querySelector(".glossary-close").focus();
  else glossaryDialog.showModal();
  glossaryDialog.scrollTop = 0;
  if (entry.dictionaryLoadChecked && !entry.dictionaryError && showDictionaryChinese && !entry.dictionaryChineseLoaded) loadModalChinese();
}

async function openGlossary(sceneId, entryId, trigger) {
  const generation = ++modalGeneration, route = routeGeneration;
  let scene;
  try { scene = await hydrateScene(sceneId); }
  catch (error) { if (generation === modalGeneration && route === routeGeneration) showModalLoadError(error, trigger, () => openGlossary(sceneId, entryId, trigger)); return; }
  if (generation !== modalGeneration || route !== routeGeneration) return;
  const entry = scene?.glossary?.find((item) => item.id === entryId);
  if (entry) {
    markLookupSupport();
    showEntryModal(scene, entry, trigger);
  }
}

async function openWord(sceneId, word, trigger, relatedChunkId, contextSentence, dictionaryUsage) {
  const generation = ++modalGeneration, route = routeGeneration;
  let scene;
  try { scene = await hydrateScene(sceneId); }
  catch (error) { if (generation === modalGeneration && route === routeGeneration) showModalLoadError(error, trigger, () => openWord(sceneId, word, trigger, relatedChunkId, contextSentence, dictionaryUsage)); return; }
  if (generation !== modalGeneration || route !== routeGeneration) return;
  if (!scene) return;
  markLookupSupport();
  const curated = (scene.glossary || []).find((item) => item.type === "word" && item.text.toLowerCase() === word);
  const lookup = scene.wordLookup?.[word];
  const surface = trigger?.textContent?.trim() || word;
  const entry = curated ? { ...curated, text: surface } : { text: surface, type: "word", zh: lookup?.zh || "释义待补", note: lookup?.note || "" };
  const context = dictionaryContextFor(dictionaryContext, sceneId, word, dictionaryUsage);
  if (context?.zh) entry.zh = context.zh;
  if (context?.usageNote) entry.note = context.usageNote;
  if (context?.sourceUnitId) entry.sourceUnitId = context.sourceUnitId;
  if (context?.example) {
    entry.example = context.example;
    entry.exampleZh = context.exampleZh || "";
  }
  if (!entry.sourceTerm) entry.sourceTerm = (scene.terms || []).find((term) => term.term.toLowerCase() === word)?.term;
  entry.contextSentence = contextSentence;
  entry.dictionaryUsage = dictionaryUsage;
  showEntryModal(scene, entry, trigger, relatedChunkId);
}

async function openUnitExpression(unitId, trigger) {
  const generation = ++modalGeneration, route = routeGeneration;
  const meta = learningUnits.find(unit => unit.id === unitId);
  if (!meta) return;
  try {
    const scene = await hydrateScene(meta.sceneIds[0]);
    if (generation !== modalGeneration || route !== routeGeneration) return;
    const unit = unitsForScene(scene).find(value => value.id === unitId);
    if (!unit) throw new Error('表达详情尚未载入');
    markLookupSupport();
    showEntryModal(scene, { text: unit.form, type: unit.type, zh: unit.meaningZh,
      note: unitUsageNote(unit, scene), example: unit.example, exampleZh: unit.exampleZh,
      unitSources: unit.sourceRecords, sourceUnitId: unit.id,
      dictionaryUsage: unit.dictionaryUsage }, trigger);
  } catch (error) {
    if (generation === modalGeneration && route === routeGeneration)
      showModalLoadError(error, trigger, () => openUnitExpression(unitId, trigger));
  }
}

function showModalLoadError(error, trigger, retry) {
  glossaryDialog.dictionaryToken = Symbol();
  if (!glossaryDialog.open) glossaryReturnFocus = trigger;
  glossaryDialog.innerHTML = `<div class="glossary-modal"><button class="glossary-close" type="button" aria-label="关闭释义窗口">×</button><h2 id="glossaryHeadword">词义暂未载入</h2><p role="status">${escapeHtml(error.message)}</p><button class="secondary-btn" type="button" id="retryWordData">重试</button></div>`;
  glossaryDialog.querySelector('#retryWordData').addEventListener('click', retry);
  if (!glossaryDialog.open) glossaryDialog.showModal();
}

function markLookupSupport() {
  if (ui.page === "prompt" && !ui.revealed && ui.support === "none") ui.support = "word";
}

function markMemorySupport() {
  if (ui.page !== "prompt" || ui.revealed) return;
  if (ui.support === "none") ui.support = "memory";
}

function renderScene() {
  const scene = getScene(ui.sceneId);
  if (!scene) return navigate("home");
  const routeScenes = branchScenes(branchForScene(scene));
  const nextScene = routeScenes[routeScenes.findIndex((item) => item.id === scene.id) + 1];
  const sideDoors = content.branches.filter((branch) => branch.entrySceneId === scene.id);
  const total = promptsFor(scene).length;
  const done = promptsFor(scene).filter((prompt) => taskCompleted(prompt.id)).length;
  app.innerHTML = `
    <section class="scene-intro">
      <h1>${annotatedEnglish(scene.title, scene)}</h1>
      
      ${textTranslation(textTranslations[scene.id]?.title || "", "中文")}
      ${scene.easySummary ? `<details class="easy-summary"><summary>故事梗概</summary><p lang="en">${annotatedEnglish(scene.easySummary, scene)}</p>${textTranslation(scene.easySummaryZh, "梗概中文")}</details>` : ""}
      <div class="story-card">
        
        
        <button class="secondary-btn translation-toggle" type="button" id="toggleStoryTranslation" aria-pressed="false">显示全文译文</button>
        <div class="story-text">${readingHtml(scene)}</div>
      </div>
      ${unitLearningHtml(scene)}
      ${memoryRouteHtml(scene)}
      ${unitsForScene(scene).length ? `<section class="listening-panel" id="listeningPanel" aria-label="句中听辨练习"></section>` : ""}
      ${scene.recognitionTerms?.length ? `<details class="recognition-note"><summary>更多词语</summary><p>${scene.recognitionTerms.map((term) => annotatedEnglish(term, scene)).join(" · ")}</p></details>` : ""}
      ${sideDoors.map((branch) => `<section class="side-door"><h2>${escapeHtml(branch.title)}</h2><button class="secondary-btn" type="button" data-side-door="${escapeHtml(branch.id)}">进入 ↗</button></section>`).join('')}
      
      <div class="button-row"><button class="primary-btn" type="button" id="beginScene">${done === total ? "再练一次" : "练习"}</button>${nextScene ? `<button class="secondary-btn" type="button" id="nextScene">${escapeHtml(nextScene.navTitle || nextScene.title)} →</button>` : ""}<button class="secondary-btn" type="button" id="backHome">返回目录</button></div>
    </section>
  `;
  mountListening(scene);
  app.querySelector("#toggleStoryTranslation").addEventListener("click", (event) => {
    const show = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(show));
    event.currentTarget.textContent = show ? "隐藏全文译文" : "显示全文译文";
    app.querySelectorAll(".text-translation").forEach((detail) => { detail.open = show; });
  });
  app.querySelector("#beginScene").addEventListener("click", () => {
    ui.page = "prompt";
    const firstUntried = promptsFor(scene).findIndex((prompt) => !taskCompleted(prompt.id));
    ui.promptIndex = firstUntried >= 0 ? firstUntried : 0;
    ui.revealed = false;
    ui.support = "none";
    ui.reviewMode = false;
    render();
  });
  app.querySelector("#nextScene")?.addEventListener("click", () => navigate("scene", nextScene.id));
  app.querySelector("#backHome").addEventListener("click", () => openBranch(branchForScene(scene).id));
  app.querySelectorAll("[data-side-door]").forEach((button) => button.addEventListener("click", () => openBranch(button.dataset.sideDoor)));
}

function renderPrompt() {
  stopVoicePractice();
  const scene = getScene(ui.sceneId);
  if (!scene) return navigate("home");
  const prompts = promptsFor(scene);
  const prompt = prompts[ui.promptIndex];
  if (!prompt) return navigate("scene", scene.id);
  const isTransfer = ui.promptIndex === prompts.length - 1;
  const activity = ACTIVITY_META[prompt.activity] || ACTIVITY_META.explain;
  const draft = ui.reviewMode ? null : drafts[`${scene.id}:${ui.promptIndex}`];
  if (!ui.revealed && ui.support === "none" && draft) ui.support = draft.support;
  const translated = textTranslations[scene.id]?.prompts?.[prompt.id];
  const cuePolicy = promptCue(scene, prompt);
  if (!ui.revealed && cuePolicy.englishTargetInput && ui.support === "none") ui.support = "english-input";
  const saved = ui.submittedAttemptId ? practice.attempts.find((attempt) => attempt.id === ui.submittedAttemptId) : null;
  app.innerHTML = `
    <section class="prompt-page" data-activity="${escapeHtml(prompt.activity || "explain")}">
      
      <div class="prompt-card">
        <h1${cuePolicy.zh ? ' lang="zh-CN"' : ' lang="en"'}>${cuePolicy.zh ? escapeHtml(cuePolicy.zh) : annotatedEnglish(prompt.cue || "", scene)}</h1>
        ${cuePolicy.zh ? `<details class="text-translation" data-english-cue><summary>英文</summary><p lang="en">${annotatedEnglish(prompt.cue || "", scene)}</p></details>` : textTranslation(translated?.cue, "中文")}
        
      </div>
      ${prompt.draft ? `<section class="rewrite-draft"><span>原句</span><p lang="en">${annotatedEnglish(prompt.draft, scene)}</p>${textTranslation(translated?.draft, '中文')}</section>` : ""}
      ${ui.support === "chinese" || ui.support === "story" ? `<div class="hint-panel"><strong>${ui.support === "story" ? "原文" : "词义"}</strong>${ui.support === "story" ? readingHtml(scene) : promptHintHtml(scene, prompt, translated)}</div>` : ""}
      ${!ui.revealed ? `
        <label class="answer-label" for="answerInput">Your answer</label>
        <textarea id="answerInput" class="answer-input" rows="5" placeholder="${activity.placeholder}" autocomplete="off" spellcheck="true"></textarea>
        ${prompt.unitIds?.length ? `<div id="oralPractice"></div>` : ""}
        <div class="button-row"><button class="primary-btn" type="button" id="submitAnswer">提交回答</button><button class="secondary-btn" type="button" id="cannotRecall">暂时想不出</button></div>
        ${scene.memoryNodes?.length ? `<details class="memory-hint" data-memory-hint><summary>故事里的物件</summary>${memoryRouteHtml(scene)}</details>` : ""}
        <div class="hint-actions"><button class="text-btn" type="button" id="showChinese">提示</button>${isTransfer ? "" : `<button class="text-btn" type="button" id="showStory">原文</button>`}</div>
      ` : renderFeedback(scene, prompt, saved)}
      <div class="prompt-footer"><button class="text-btn" type="button" id="backScene">${isTransfer ? "← 返回目录" : "← 返回故事"}</button></div>
    </section>
  `;
  app.querySelector("#backScene").addEventListener("click", () => isTransfer ? openBranch(branchForScene(scene).id) : navigate("scene", scene.id));
  if (ui.revealed) {
    app.querySelectorAll("[data-rating]").forEach((button) => button.addEventListener("click", () => rateAnswer(button.dataset.rating)));
    app.querySelector("#nextPrompt").addEventListener("click", nextPrompt);
    bindFeedback(scene, prompt, saved);
    return;
  }
  if (app.querySelector("#oralPractice")) mountRecorder(app.querySelector("#oralPractice"), (recording) => submitAnswer(false, { responseMode: "spoken", recording }));
  if (ui.preferredResponseMode === "spoken") {
    const panel = app.querySelector("#oralPractice details");
    if (panel) panel.open = true;
  }
  app.querySelector("#answerInput").value = draft?.response || "";
  app.querySelector("#answerInput").addEventListener("input", (event) => { drafts[`${scene.id}:${ui.promptIndex}`] = { response: event.target.value, support: ui.support }; });
  app.querySelector("#submitAnswer").addEventListener("click", () => submitAnswer(false));
  app.querySelector("#cannotRecall").addEventListener("click", () => submitAnswer(true));
  app.querySelector("#answerInput").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submitAnswer(false);
  });
  app.querySelector("#showChinese").addEventListener("click", () => { ui.support = "chinese"; const draft = app.querySelector("#answerInput").value; renderPrompt(); app.querySelector("#answerInput").value = draft; });
  app.querySelector("#showStory")?.addEventListener("click", () => { ui.support = "story"; const draft = app.querySelector("#answerInput").value; renderPrompt(); app.querySelector("#answerInput").value = draft; });
}

function termsForPrompt(scene, prompt) {
  const names = new Set((prompt.targetTerms || []).map((term) => String(term).toLowerCase()));
  if (!names.size) return Array.isArray(prompt.targetTerms) ? [] : scene.terms || [];
  return (scene.terms || []).filter((item) => names.has(String(item.term).toLowerCase()));
}

function renderFeedback(scene, prompt, attempt) {
  const answers = prompt.acceptableAnswers || prompt.sampleAnswers || [];
  const terms = termsForPrompt(scene, prompt);
  const rating = attempt?.selfRating;
  const translated = textTranslations[scene.id]?.prompts?.[prompt.id];
  return `
    <div class="feedback" role="region" aria-label="参考表达与自评">
      
      <h2>参考表达</h2>
      
      <div class="your-answer"><span class="meta">${attempt?.responseMode === "spoken" ? "你的口头回答" : "你的原答"}</span><p>${attempt?.response ? escapeHtml(attempt.response) : "（这次暂时想不出）"}</p>${sessionRecordings.has(attempt?.id) ? `<audio class="feedback-recording" controls src="${escapeHtml(sessionRecordings.get(attempt.id))}" aria-label="回听提交前的口头回答"></audio>` : ""}</div>
      <div class="sample-answers">${answers.map((answer, index) => `<div><p lang="en">“${annotatedEnglish(answer, scene)}”</p>${textTranslation(translated?.acceptableAnswers?.[index], "参考表达中文")}</div>`).join("")}</div>
      ${unitAssessmentHtml(scene, prompt, attempt)}
      ${prompt.unitIds?.length ? `<section class="revision-panel"><label for="revisionInput">修改回答</label><textarea id="revisionInput" rows="3" class="answer-input" placeholder="Your answer…"></textarea><button type="button" class="secondary-btn" id="saveRevision">保存修订</button><p role="status" id="revisionStatus"></p>${attempt?.revisions?.length ? `<details><summary>已保存 ${attempt.revisions.length} 次修订</summary>${attempt.revisions.map((r) => `<p>${escapeHtml(r.response)}</p>`).join("")}</details>` : ""}</section>` : ""}
      ${terms.length ? `<details class="source-details"><summary>表达与来源</summary><div class="term-list">${terms.map((term) => `<div class="term-item"><span class="source-pill ${String(term.kind || "").toLowerCase()}">${escapeHtml(term.kind === "BRG" ? "SRC · BRG" : (term.kind || "候选"))}</span><strong>${escapeHtml(term.term)}</strong><span>${escapeHtml(term.sourceLabel || "")}</span>${term.sourceUrl ? `<a href="${escapeHtml(term.sourceUrl)}" target="_blank" rel="noopener noreferrer">来源 ↗</a>` : ""}${term.sourceRef ? `<small>${escapeHtml(term.sourceRef)}</small>` : ""}</div>`).join("")}</div></details>` : ""}
      <div class="self-check"><strong>这次说得怎么样？</strong><div class="rating-row">
        <button class="rating-btn ${rating === "good" ? "selected" : ""}" type="button" data-rating="good" ${rating || !attempt?.response ? "disabled" : ""}>${attempt?.support !== "none" ? "提示后能表达" : "能独立表达"}</button>
        <button class="rating-btn ${rating === "partial" ? "selected" : ""}" type="button" data-rating="partial" ${rating ? "disabled" : ""}>表达了部分</button>
        <button class="rating-btn ${rating === "again" ? "selected" : ""}" type="button" data-rating="again" ${rating ? "disabled" : ""}>还需要帮助</button>
      </div><small id="ratingStatus" ${rating ? "" : "hidden"}>${rating ? ratingDateLabel(prompt) : ""}</small></div>
      <button class="primary-btn" type="button" id="nextPrompt" ${rating ? "" : "disabled"}>${ui.reviewMode ? "完成这次复习" : "下一步 →"}</button>
    </div>
  `;
}

function submitAnswer(empty, oral = null) {
  const scene = getScene(ui.sceneId);
  const prompt = promptsFor(scene)[ui.promptIndex];
  const response = empty ? "" : oral ? "（口头回答）" : app.querySelector("#answerInput").value.trim();
  if (!empty && !response) {
    app.querySelector("#answerInput").focus();
    app.querySelector("#answerInput").setAttribute("placeholder", "请输入回答");
    return;
  }
  const now = new Date().toISOString();
  const publishedTask = taskRegistry.find((task) => task.sceneId === scene.id && task.promptId === prompt.id);
  const attempt = {
    id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    promptId: prompt.id,
    sceneId: scene.id,
    contentVersion: content.version || "v1",
    activity: prompt.activity || "explain",
    responseMode: oral?.responseMode || "written",
    recording: oral ? { durationSeconds: oral.recording.durationSeconds, audioStored: false } : null,
    taskMode: prompt.unitIds?.length ? prompt.taskMode : "application",
    unitVersion: prompt.unitVersion || null,
    unitReviewContext: publishedTask ? { schemaVersion: 1, receiptId: publishedTask.receiptId } : null,
    reviewUnitIds: ui.reviewUnitIds || [],
    reviewTrackKey: ui.reviewTrackKey || null,
    unitAssessments: {},
    revisions: [],
    attemptedAt: now,
    response,
    support: ui.support,
    reviewMode: ui.reviewMode,
    revealedAt: now,
    selfRating: null,
  };
  if (oral?.recording?.blob) sessionRecordings.set(attempt.id, URL.createObjectURL(oral.recording.blob));
  practice.attempts.push(attempt);
  delete drafts[`${scene.id}:${ui.promptIndex}`];
  ui.submittedAttemptId = attempt.id;
  ui.revealed = true;
  save();
  renderPrompt();
}

function rateAnswer(rating) {
  const scene = getScene(ui.sceneId);
  const prompt = promptsFor(scene)[ui.promptIndex];
  const attempt = practice.attempts.find((item) => item.id === ui.submittedAttemptId);
  if (!attempt || attempt.selfRating) return;
  for (const control of app.querySelectorAll("[data-unit-assessment]")) {
    const status = control.value;
    attempt.unitAssessments[control.dataset.unitAssessment] = !attempt.response ? "unobserved" : status === "independent" && attempt.support !== "none" ? "assisted" : status;
  }
  attempt.evidenceSource = "self-check";
  attempt.selfRating = rating;
  attempt.ratedAt = new Date().toISOString();
  if (!prompt.unitIds?.length) {
    const previous = practice.reviews[prompt.id] || { stage: 0 };
    const schedule = nextReview(previous, attempt, new Date(attempt.attemptedAt));
    practice.reviews[prompt.id] = { ...schedule, lastRating: rating,
      lastAttemptAt: attempt.attemptedAt, lastAttemptId: attempt.id };
  }
  save();
  renderPrompt();
}

function ratingDateLabel(prompt) {
  if (lastSaveFailed) return "尚未保存，请导出备份。";
  const due = prompt.unitIds?.length
    ? prompt.unitIds.map(unitNextDate).filter(Boolean).sort()[0]
    : reviewDue(practice.reviews[prompt.id]);
  return due ? `已记录；下次 ${dateLabel(due)}。` : "已记录。";
}

function nextPrompt() {
  clearSessionRecordings();
  if (ui.reviewMode) return navigate("review");
  const scene = getScene(ui.sceneId);
  if (ui.promptIndex + 1 >= promptsFor(scene).length) return navigate("scene", scene.id);
  ui.promptIndex += 1;
  ui.revealed = false;
  ui.support = "none";
  ui.submittedAttemptId = null;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function trackLabel(key) {
  return `${key.startsWith("transfer.") ? "另一段故事 · " : ""}${key.endsWith(".spoken") ? "说一说" : "写一写"}`;
}

function renderReview() {
  const due = dueEntries();
  const reviewed = allPrompts().filter(({ prompt }) => practice.reviews[prompt.id]);
  app.innerHTML = `
    <section class="simple-page"><h1>复习</h1>
      <div class="button-row"><button type="button" class="secondary-btn" id="reviewUnits">表达记录</button></div>
      <div class="review-list">${due.length ? due.map((entry, index) => `<div class="review-item"><span>${escapeHtml(entry.scene?.navTitle || entry.lastSceneId || "原场景")}</span><strong>${entry.kind === "unit" ? escapeHtml(trackLabel(entry.trackKey)) : "旧练习"}</strong>${entry.kind === "unit" && !entry.target ? `<small>暂无对应练习</small>${entry.scene ? `<button class="text-btn" type="button" data-review-scene="${escapeHtml(entry.scene.id)}">返回场景 ↗</button>` : ""}` : `<button class="text-btn" type="button" data-review-entry="${index}">练习 ↗</button>`}</div>`).join("") : `<div class="empty-state">今天没有待复习的内容。</div>`}</div>
      ${reviewed.length ? `<details><summary>旧练习记录</summary><div class="history-list">${reviewed.map(({ scene, prompt }) => { const last = latestAttempt(prompt.id); const record = practice.reviews[prompt.id]; return `<div><span>${escapeHtml(scene.navTitle || scene.id)}</span><small>${last?.selfRating === "good" ? "自评：能表达" : last?.selfRating === "partial" ? "自评：部分" : "自评：需帮助"} · ${reviewDue(record) ? dateLabel(reviewDue(record)) : "暂无日期"}</small></div>`; }).join("")}</div></details>` : ""}
    </section>
  `;
  app.querySelector("#reviewUnits").addEventListener("click", () => navigate("units"));
  app.querySelectorAll("[data-review-entry]").forEach((button) => button.addEventListener("click", () => openReview(due[Number(button.dataset.reviewEntry)])));
  app.querySelectorAll("[data-review-scene]").forEach((button) => button.addEventListener("click", () => navigate("scene", button.dataset.reviewScene)));
}

function renderAbout() {
  app.innerHTML = `
    <section class="simple-page"><h1>关于</h1>
      <div class="about-copy">
      <details><summary>记录与备份</summary><p>记录只保存在当前浏览器，不上传答题内容。导出可备份，恢复时预览并合并。录音只保留在当前题目中，不包含在备份里。</p></details>
      <details><summary>内容与词典来源</summary><p>故事、情境例句和中文辅助由项目编写；原始词汇资料另列来源。SRC 为原资料，BRG 为跨场景借用，EXP 和 COL 为场景扩展与搭配。词条来源不代表整句来自原资料。</p><p>英文词典使用 Princeton WordNet 3.0 的义项与原例句，缺失义项或例句会标明。中文译解与机器辅助译文另行标注，机器译文尚未逐条校订。材料为原创练习，非官方 IELTS 试题。</p><p>WordNet 3.0 © 2006 Princeton University · <a href="./data/WORDNET_LICENSE.txt" target="_blank" rel="noopener noreferrer">版权与许可</a> · <a href="./data/TRANSLATION_MODEL_ATTRIBUTION.md" target="_blank" rel="noopener noreferrer">翻译模型来源</a></p></details>
      </div>
      <div class="button-row"><button class="secondary-btn" type="button" id="downloadData">导出练习记录</button><button class="secondary-btn" type="button" id="importData">恢复备份</button><button class="text-btn danger" type="button" id="clearData">清除本机练习记录</button></div>
      <section class="clear-confirm" id="clearConfirm" aria-label="清除记录确认" hidden><h2>清除前请先备份</h2><p>确认后会清除当前浏览器的答题和复习记录，无法在本页面撤销。建议先导出。</p><div class="button-row"><button class="secondary-btn" type="button" id="confirmExport">先导出记录</button><button class="secondary-btn" type="button" id="cancelClear">取消</button><button class="text-btn danger" type="button" id="confirmClear">确认清除本机记录</button></div></section>

    </section>`;
  app.querySelector("#downloadData").addEventListener("click", exportPractice);
  app.querySelector("#importData").addEventListener("click", renderImport);
  app.querySelector("#clearData").addEventListener("click", () => {
    app.querySelector("#clearConfirm").hidden = false;
    app.querySelector("#cancelClear").focus();
  });
  app.querySelector("#cancelClear").addEventListener("click", () => {
    app.querySelector("#clearConfirm").hidden = true;
    app.querySelector("#clearData").focus();
  });
  app.querySelector("#confirmExport").addEventListener("click", exportPractice);
  app.querySelector("#confirmClear").addEventListener("click", () => {
    try {
      localStorage.removeItem(MIGRATION_BACKUP_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyPractice()));
    } catch (_) { showStorageStatus("清除未完成，请检查浏览器存储后重试。"); return; }
    storageReadBlocked = false;
    migrationRequired = false;
    originalStorage = null;
    practice = emptyPractice();
    for (const key of Object.keys(drafts)) delete drafts[key];
    save();
    render();
  });
}

function exportPractice() {
  const payload = { app: "IELTS Semantic World S01 Trial", exportedAt: new Date().toISOString(), contentVersion: content?.version || "v1", practice };
  if (storageReadBlocked && originalStorage) payload.unreadableOriginalStorage = originalStorage;
  const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = `ielts-semantic-world-s01-practice-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  app.querySelector("#exportPreview")?.remove();
  const preview = document.createElement("section");
  preview.id = "exportPreview";
  preview.className = "export-preview";
  preview.innerHTML = `<h2>练习记录备份</h2><p>已请求浏览器下载 JSON。若没有下载成功，可复制下面的完整内容，另存为 .json 文件。</p><label for="exportJson">完整练习记录 JSON</label><textarea id="exportJson" rows="8" readonly></textarea><button class="secondary-btn" type="button" id="copyExport">复制完整记录</button><p id="exportStatus" role="status"></p>`;
  app.append(preview);
  preview.querySelector("#exportJson").value = JSON.stringify(payload, null, 2);
  preview.querySelector("#copyExport").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(preview.querySelector("#exportJson").value);
      preview.querySelector("#exportStatus").textContent = "完整记录已复制。";
    } catch (_) {
      preview.querySelector("#exportJson").focus();
      preview.querySelector("#exportJson").select();
      preview.querySelector("#exportStatus").textContent = "请使用复制快捷键复制已选中的内容。";
    }
  });
  preview.scrollIntoView({ block: "nearest" });
}

document.querySelector("#brandLink").addEventListener("click", (event) => { event.preventDefault(); navigate("home"); });
document.querySelector("#homeNav").addEventListener("click", () => navigate("home"));
document.querySelector("#reviewTopNav").addEventListener("click", () => navigate("review"));
document.querySelector("#reviewNav").addEventListener("click", () => navigate("review"));
document.querySelector("#unitsNav").addEventListener("click", () => navigate("units"));
document.querySelector("#aboutNav").addEventListener("click", () => navigate("about"));
document.querySelector("#exportBtn").addEventListener("click", exportPractice);
app.addEventListener("click", (event) => {
  const expression = event.target.closest('[data-unit-expression]');
  if (expression && app.contains(expression)) { openUnitExpression(expression.dataset.unitExpression, expression); return; }
  const word = event.target.closest("[data-word]");
  if (word && app.contains(word)) {
    openWord(word.dataset.wordScene, word.dataset.word, word, word.dataset.relatedChunk, word.dataset.wordSentence, word.dataset.wordUsage);
    return;
  }
  const chunk = event.target.closest("[data-glossary-id]");
  if (chunk && app.contains(chunk)) openGlossary(chunk.dataset.glossaryScene, chunk.dataset.glossaryId, chunk);
});
app.addEventListener("toggle", (event) => {
  if (event.target.matches?.("[data-learning-translation]") && event.target.open) markTranslationSupport();
  if (event.target.matches?.("[data-memory-hint]") && event.target.open) markMemorySupport();
  if (event.target.matches?.("[data-english-cue]") && event.target.open && ui.page === "prompt" && !ui.revealed) {
    if (ui.support === "none") ui.support = "english-input";
  }
}, true);
glossaryDialog.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-dictionary-chinese]");
  if (event.target.closest('[data-dictionary-retry]')) {
    const current = glossaryDialog.entryContext;
    if (current) showEntryModal(current.scene, { ...current.entry, dictionaryLoadChecked: false, dictionaryError: false }, null, current.relatedChunkId);
    return;
  }
  if (toggle) {
    const current = glossaryDialog.entryContext;
    if (!current) return;
    showDictionaryChinese = toggle.getAttribute('aria-pressed') !== 'true';
    if (showDictionaryChinese && !current.entry.dictionaryChineseLoaded) { loadModalChinese(); return; }
    toggle.setAttribute('aria-pressed', String(showDictionaryChinese));
    toggle.textContent = showDictionaryChinese ? '隐藏中文释义与例句译文' : '显示中文释义与例句译文';
    glossaryDialog.querySelector('.dictionary-section').classList.toggle('dictionary-chinese-visible', showDictionaryChinese);
    glossaryDialog.querySelectorAll('.example-translation').forEach(detail => { detail.open = showDictionaryChinese; });
    if (showDictionaryChinese) markTranslationSupport();
    return;
  }
  const component = event.target.closest("[data-dialog-word]");
  if (component) {
    openWord(component.dataset.dialogScene, component.dataset.dialogWord, component, component.dataset.dialogChunk, component.dataset.dialogSentence, component.dataset.wordUsage);
    return;
  }
  const dictionaryTab = event.target.closest("[data-dictionary-tab]");
  if (dictionaryTab) {
    activateDictionaryTab(dictionaryTab.dataset.dictionaryTab);
    return;
  }
  const related = event.target.closest("[data-related-chunk-open]");
  if (related) {
    openGlossary(related.dataset.relatedScene, related.dataset.relatedChunkOpen, null);
    return;
  }
  if (event.target === glossaryDialog || event.target.closest(".glossary-close")) glossaryDialog.close();
});
function loadModalChinese() {
  const current = glossaryDialog.entryContext;
  const toggle = glossaryDialog.querySelector('[data-dictionary-chinese]');
  if (!current || !toggle || toggle.disabled) return;
  const token = glossaryDialog.dictionaryToken;
  const tab = glossaryDialog.querySelector('[data-dictionary-tab][aria-selected="true"]')?.dataset.dictionaryTab || 'current';
  toggle.disabled = true; toggle.textContent = '正在载入中文…';
  ensureDictionary(current.scene, current.entry, true).then(result => {
    if (!glossaryDialog.open || glossaryDialog.dictionaryToken !== token) return;
    wordnet = result.wordnet; dictionaryTranslations = result.translations; dictionaryChinese = result.chinese;
    showDictionaryChinese = true;
    showEntryModal(current.scene, { ...current.entry, dictionaryChineseLoaded: true }, null, current.relatedChunkId);
    activateDictionaryTab(tab); markTranslationSupport();
    glossaryDialog.querySelector('[data-dictionary-chinese]')?.focus();
  }, () => {
    if (!glossaryDialog.open || glossaryDialog.dictionaryToken !== token) return;
    showDictionaryChinese = false;
    toggle.disabled = false; toggle.setAttribute('aria-pressed', 'false');
    toggle.textContent = '中文暂未载入，重试';
  });
}

function activateDictionaryTab(id) {
  glossaryDialog.querySelectorAll("[data-dictionary-tab]").forEach((button) => {
    const selected = button.dataset.dictionaryTab === id;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  glossaryDialog.querySelectorAll('[role="tabpanel"]').forEach((panel) => { panel.hidden = panel.id !== `dictionary-panel-${id}`; });
}
glossaryDialog.addEventListener("keydown", (event) => {
  const current = event.target.closest("[data-dictionary-tab]");
  if (!current || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = [...glossaryDialog.querySelectorAll("[data-dictionary-tab]")];
  const index = tabs.indexOf(current);
  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  activateDictionaryTab(tabs[next].dataset.dictionaryTab);
  tabs[next].focus();
});
glossaryDialog.addEventListener("close", () => {
  ++modalGeneration; glossaryDialog.dictionaryToken = Symbol();
  if (glossaryReturnFocus?.isConnected) glossaryReturnFocus.focus();
  glossaryReturnFocus = null;
});

try {
  const response = await fetchData(DATA_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  dataStore = await new DataStore(await response.json()).initialize();
  content = { version: dataStore.manifest.contentVersion, release: dataStore.release,
    branches: dataStore.navigation.branches, microScenes: dataStore.navigation.scenes,
    counts: dataStore.manifest.counts };
  for (const summary of content.microScenes) {
    summary.wordLookup = { ...dataStore.uiWords, ...summary.wordLookup };
    for (const [scope, entries] of Object.entries(summary.labelContext || {}))
      dictionaryContext[scope] = { ...dictionaryContext[scope], ...entries };
  }
  taskRegistry = dataStore.prompts.tasks;
  // Resolve all local original facts before replacing a derived schedule cache.
  // A failed published history shard leaves the original storage untouched.
  await hydrateHistory(practice.attempts);
  practice = rebuildPractice(practice, scheduleOptions());
  persistPractice(practice);
  contentReady = true;
  restoreRoute();
} catch (error) { contentError(error, () => location.reload()); }

async function ensureDictionary(scene, entry, chinese = showDictionaryChinese) {
  const context = dictionaryContextFor(dictionaryContext, scene.id, entry.text.toLowerCase().replaceAll("’", "'"), entry.dictionaryUsage);
  return dataStore.dictionary(entry.text.toLowerCase().replaceAll("’", "'"), context?.dictionaryLemma || context?.headword || null, { chinese });
}

function unitsForScene(scene) {
  return learningUnits.filter((u) => u.sceneIds.includes(scene.id)).map((u) => ({
    ...u,
    tier: u.sceneTiers?.[scene.id] || u.tier,
    example: u.sceneExamples?.[scene.id] || u.example,
    exampleZh: u.sceneExampleZhs?.[scene.id] || u.exampleZh,
    sense: u.sceneSenses?.[scene.id] || u.sense,
    meaningZh: u.sceneMeaningZhs?.[scene.id] || u.meaningZh,
    memoryNodeIds: u.sceneMemoryNodeIds?.[scene.id] || u.memoryNodeIds,
  }));
}
function promptCue(scene, prompt) {
  return taskCuePolicy(scene, prompt, learningUnits, textTranslations);
}

function unitSourceHtml(unit) {
  if (!unit.sourceRecords.length) return "<p>项目编写</p>";
  return unit.sourceRecords.map(sourceDetailHtml).join("");
}
function unitUsageNote(unit, scene) {
  const curated = (scene.glossary || []).find(entry => entry.text?.toLowerCase() === unit.form.toLowerCase());
  const context = dictionaryContextFor(dictionaryContext, scene.id, unit.form.toLowerCase());
  return curated?.note || context?.usageNote || (/[\u3400-\u9fff]/.test(unit.sense || "") ? unit.sense : "");
}

function promptHintHtml(scene, prompt, translated) {
  const ids = new Set(prompt.unitIds || []);
  const meanings = [...new Set(unitsForScene(scene).filter(unit => ids.has(unit.id)).map(unit => unit.meaningZh).filter(Boolean))];
  if (meanings.length) return `<ul>${meanings.map(meaning => `<li>${escapeHtml(meaning)}</li>`).join("")}</ul>`;
  return `<p>${escapeHtml(translated?.cue || "暂无词义提示")}</p>`;
}

function unitLearningHtml(scene) {
  const units = unitsForScene(scene);
  if (!units.length) return "";
  const names = { core: "常用表达", support: "更多表达", recognition: "拓展词语" };
  return `<section class="unit-learning"><h2>词语与表达</h2>${Object.entries(names).filter(([tier]) => units.some((u) => u.tier === tier)).map(([tier, label]) => `<details><summary>${label}</summary><div class="unit-cards">${units.filter((u) => u.tier === tier).map((u) => `<article><strong lang="en">${annotatedEnglish(u.form, scene, u.type === "word" ? u.example : null)}</strong><p>${escapeHtml(u.meaningZh)}</p>${unitUsageNote(u, scene) ? `<details><summary>用法</summary><p>${escapeHtml(unitUsageNote(u, scene))}</p></details>` : ""}<p lang="en">${annotatedEnglish(u.example, scene)}</p>${textTranslation(u.exampleZh, "例句中文")}<details><summary>来源与例句</summary>${unitSourceHtml(u)}<small>例句：项目编写</small></details></article>`).join("")}</div></details>`).join("")}</section>`;
}
function unitAssessmentHtml(scene, prompt, attempt) {
  const sceneUnits = new Map(unitsForScene(scene).map((unit) => [unit.id, unit]));
  const units = (prompt.unitIds || []).map((id) => sceneUnits.get(id)).filter(Boolean);
  if (!units.length) return "";
  return `<section class="unit-assessment"><h3>表达</h3>${units.map((u) => `<label><span>${annotatedEnglish(u.form, scene, u.type === "word" ? u.example : null)} · ${escapeHtml(u.meaningZh)}</span><select data-unit-assessment="${escapeHtml(u.id)}" ${attempt?.selfRating ? "disabled" : ""}>${Object.entries(EVIDENCE_LABELS).map(([status, label]) => `<option value="${status}" ${attempt?.unitAssessments?.[u.id] === status ? "selected" : ""} ${status === "independent" && (!attempt?.response || attempt?.support !== "none") ? "disabled" : ""}>${label}</option>`).join("")}</select></label>`).join("")}</section>`;
}
function bindFeedback(scene, prompt, attempt) {
  app.querySelector("#saveRevision")?.addEventListener("click", () => {
    const response = app.querySelector("#revisionInput").value.trim();
    if (!response) { app.querySelector("#revisionInput").focus(); return; }
    attempt.revisions ||= [];
    attempt.revisions.push({ response, at: new Date().toISOString(), support: "reference" });
    save();
    app.querySelector("#revisionInput").value = "";
    app.querySelector("#revisionStatus").textContent = lastSaveFailed ? "尚未保存，请导出备份。" : "已保存";
  });
}
function renderUnits() {
  const summaries = filteredUnitRecords();
  const pages = Math.max(1, Math.ceil(summaries.length / UNIT_PAGE_SIZE));
  unitPage = Math.min(unitPage, pages - 1);
  const pageRows = summaries.slice(unitPage * UNIT_PAGE_SIZE, (unitPage + 1) * UNIT_PAGE_SIZE);
  const registeredScenes = new Set(learningUnits.flatMap((u) => u.sceneIds));
  const registeredBranches = content.branches.filter((b) => b.sceneIds.some((id) => registeredScenes.has(id)));
  const today = calendarDay(new Date().toISOString(), scheduleOptions().timeZone);
  app.innerHTML = `<section class="simple-page"><h1>表达记录</h1><section class="unit-tools" aria-label="筛选表达记录"><label for="unitSearch">搜索表达</label><input id="unitSearch" type="search" placeholder="例如：延期、预约、passport…" autocomplete="off"/><label for="unitRoute">学习路线</label><select id="unitRoute"><option value="all">全部</option>${registeredBranches.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.title)}</option>`).join("")}</select><label for="unitState">练习记录</label><select id="unitState"><option value="all">全部</option><option value="due">待复习</option><option value="independent">自己用出来了</option><option value="assisted">使用过提示</option><option value="partial">还不熟悉</option><option value="unobserved">暂无记录</option><option value="unknown">旧记录</option></select><p id="unitResultCount" role="status"></p></section><div class="unit-progress-list">${pageRows.map(({ unit: u, summary: v }) => {
    const recalled = v.observations.filter((o) => o.dimension === "recall" && o.status === "independent" && o.support === "none" && o.contextVerified);
    const transferred = v.observations.filter((o) => o.dimension === "transfer" && o.status === "independent" && o.support === "none" && o.contextVerified);
    const tracks = Object.entries(practice.unitReviews[u.id]?.tracks || {});
    const due = unitNextDate(u.id);
    const buttons = tracks.length ? tracks.map(([key, track]) => `<div><span>${escapeHtml(trackLabel(key))} · ${dateLabel(track.nextDueDate)}</span><button class="text-btn" type="button" data-unit-practice="${escapeHtml(u.id)}" data-unit-track="${escapeHtml(key)}">练习 ↗</button></div>`).join("") : `<button class="text-btn" type="button" data-unit-practice="${escapeHtml(u.id)}" data-unit-track="recall.written">练习 ↗</button>`;
    return `<article data-unit-card="${escapeHtml(u.id)}"><h2>${annotatedEnglish(u.form, dataStore.sceneDirectory.get(u.sceneIds[0]), u.type === "word" ? u.example : null)}${u.type !== "word" ? `<button class="glossary-chunk-marker" type="button" data-unit-expression="${escapeHtml(u.id)}" aria-label="查看整个表达 ${escapeHtml(u.form)} 的搭配">↗</button>` : ""}</h2><p>${escapeHtml(u.meaningZh)}</p>${v.latest || v.listening || tracks.length ? `<dl><div><dt>写出来</dt><dd>${recalled.filter((o) => o.modality === "written").length || "—"}</dd></div><div><dt>说出来</dt><dd>${recalled.filter((o) => o.modality === "spoken").length || "—"}</dd></div><div><dt>换个情境</dt><dd>${transferred.length || "—"}</dd></div><div><dt>听懂了</dt><dd>${v.listening ? escapeHtml({ independent: "自评：原先听懂", assisted: "自评：对照后理解", partial: "自评：还需练习" }[v.listening.status]) : "—"}</dd></div></dl>` : ""}${v.latest ? `<small>${v.latest.contextVerified ? `${escapeHtml(EVIDENCE_LABELS[v.latest.status])} · ${dateLabel(v.latest.at)}` : "旧记录：尚未核对任务"}</small>` : ""}${due ? `<p>${due <= today ? "待复习" : "下次"} · ${dateLabel(due)}</p>` : ""}<details><summary>练习</summary>${buttons}<p role="status" data-unit-entry-status></p></details><button class="text-btn" type="button" data-unit-scene="${escapeHtml(u.sceneIds[0])}">返回故事 ↗</button></article>`;
  }).join("")}</div><div class="button-row" aria-label="表达列表翻页"><button class="secondary-btn" id="unitPrevious" type="button" ${unitPage === 0 ? 'disabled' : ''}>上一页</button><span>${unitPage + 1} / ${pages}</span><button class="secondary-btn" id="unitNext" type="button" ${unitPage + 1 === pages ? 'disabled' : ''}>下一页</button></div></section>`;
  app.querySelector('#unitResultCount').textContent = `${summaries.length} 个表达`;
  app.querySelector('#unitPrevious').addEventListener('click', () => { unitPage -= 1; renderUnits(); app.focus({preventScroll:true}); });
  app.querySelector('#unitNext').addEventListener('click', () => { unitPage += 1; renderUnits(); app.focus({preventScroll:true}); });
  if (!registeredBranches.some((b) => b.id === unitScope)) unitScope = "all";
  app.querySelector("#unitSearch").value = unitQuery;
  app.querySelector("#unitRoute").value = unitScope;
  app.querySelector("#unitState").value = unitViewFilter;
  app.querySelector("#unitSearch").addEventListener("input", (event) => { unitQuery = event.target.value; filterUnitRecords(); });
  app.querySelector("#unitRoute").addEventListener("change", (event) => { unitScope = event.target.value; filterUnitRecords(); });
  app.querySelector("#unitState").addEventListener("change", (event) => { unitViewFilter = event.target.value; filterUnitRecords(); });
  app.querySelectorAll("[data-unit-scene]").forEach((b) => b.addEventListener("click", () => navigate("scene", b.dataset.unitScene)));
  app.querySelectorAll("[data-unit-practice]").forEach((button) => button.addEventListener("click", () => {
    const unitId = button.dataset.unitPractice;
    const trackKey = button.dataset.unitTrack;
    const unit = learningUnits.find((item) => item.id === unitId);
    const track = practice.unitReviews[unitId]?.tracks[trackKey];
    const entry = { unitId, trackKey, lastSceneId: track?.lastSceneId || unit.sceneIds[0], lastPromptId: track?.lastPromptId };
    const target = choosePracticeTarget(entry, taskRegistry);
    if (!target) { button.closest("article").querySelector("[data-unit-entry-status]").textContent = "暂无对应练习，可回到场景阅读。"; return; }
    // This page has already shown the target English; do not label immediate use independent.
    openReview({ ...entry, target }, "reference");
  }));
}

function mountListening(scene) {
  const host = app.querySelector("#listeningPanel");
  if (!host) return;
  const units = unitsForScene(scene).filter((u) => u.tier === "core");
  host.innerHTML = `<h2>听一听</h2><label for="listeningUnit">表达</label><select id="listeningUnit">${units.map((u) => `<option value="${u.id}">${escapeHtml(u.meaningZh)}</option>`).join("")}</select><div class="button-row"><button class="secondary-btn" type="button" id="listenSentence">播放英语短句</button></div><p id="listenStatus" role="status"></p><label for="listeningMeaning">你听到的意思</label><textarea id="listeningMeaning" class="answer-input" rows="2"></textarea><button class="secondary-btn" type="button" id="compareListening">核对原句</button><div id="listeningCompare" hidden></div>`;
  let played = false, shown = false, eligible = false, firstMeaning = "", saved = false, audioGeneration = 0;
  const chosen = () => units.find((u) => u.id === host.querySelector("select").value);
  host.querySelector("select").addEventListener("change", () => { audioGeneration += 1; window.speechSynthesis?.cancel(); played = shown = eligible = saved = false; firstMeaning = ""; host.querySelector("textarea").value = ""; host.querySelector("#listeningCompare").hidden = true; host.querySelector("#listenStatus").textContent = ""; });
  host.querySelector("#listenSentence").addEventListener("click", () => {
    if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) { host.querySelector("#listenStatus").textContent = "此浏览器没有朗读功能，可继续文字学习。"; return; }
    const generation = ++audioGeneration;
    played = false;
    speakSentence(chosen().example, (msg) => { if (host.isConnected && generation === audioGeneration) host.querySelector("#listenStatus").textContent = msg; }, () => { if (generation === audioGeneration && host.isConnected) played = true; });
  });
  host.querySelector("#compareListening").addEventListener("click", () => {
    const u = chosen();
    if (!shown) { firstMeaning = host.querySelector("textarea").value.trim(); eligible = played && Boolean(firstMeaning); }
    shown = true;
    const compare = host.querySelector("#listeningCompare"); compare.hidden = false;
    compare.innerHTML = `<p lang="en">${annotatedEnglish(u.example, scene)}</p><p>${escapeHtml(u.meaningZh)}</p><div class="button-row"><button class="secondary-btn" type="button" data-listen-rating="independent" ${saved ? "disabled" : ""}>${eligible ? "原先听懂了" : "对照后理解了"}</button><button class="secondary-btn" type="button" data-listen-rating="partial" ${saved ? "disabled" : ""}>还需再听</button></div>`;
    compare.querySelectorAll("[data-listen-rating]").forEach((button) => button.addEventListener("click", () => {
      if (saved) return;
      practice.listeningAttempts ||= [];
      practice.listeningAttempts.push({ id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`, unitId: u.id, sceneId: scene.id, at: new Date().toISOString(), response: firstMeaning, status: button.dataset.listenRating === "independent" ? eligible ? "independent" : "assisted" : "partial", evidenceSource: "self-check", audioSource: "browser-synthetic", contentVersion: content.version });
      saved = true; const persisted = save(); compare.querySelectorAll("button").forEach((b) => b.disabled = true);
      host.querySelector("#listenStatus").textContent = persisted ? "已保存" : "尚未保存，请导出备份。";
    }));
  });
}
function renderImport() {
  importCandidate = null;
  app.querySelector("#importPanel")?.remove();
  const panel = document.createElement("section"); panel.id = "importPanel"; panel.className = "import-panel";
  panel.innerHTML = `<h2>恢复练习备份</h2><p>重复答题保留本机原答；复习日期按合并后的表达记录重新计算。</p><label for="importFile">备份文件</label><input type="file" id="importFile" accept=".json,application/json"/><p id="importStatus" role="status"></p><button type="button" class="secondary-btn" id="confirmImport" disabled>确认合并记录</button>`;
  app.append(panel); panel.scrollIntoView({ block: "nearest" });
  panel.querySelector("input").addEventListener("change", async (event) => {
    importCandidate = null; panel.querySelector("button").disabled = true;
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("文件超过10MB，请检查备份内容");
      const payload = JSON.parse(await file.text());
      if (!payload.app?.startsWith("IELTS Semantic World")) throw new Error("这不是本应用导出的备份");
      if (payload.unreadableOriginalStorage != null) throw new Error("此备份还包含未修复的原始旧记录，请保留原文件；不能把它当作空记录恢复");
      if (payload.practice?.schemaVersion > 3) throw new Error("备份版本较新，请先更新应用");
      importCandidate = normalisePractice(payload.practice);
      const localIds = new Set(practice.attempts.map((a) => a.id));
      const duplicate = importCandidate.attempts.filter((a) => localIds.has(a.id)).length;
      const zoneNote = validTimeZone(importCandidate.unitReviewMeta?.timeZone) && importCandidate.unitReviewMeta.timeZone !== scheduleOptions().timeZone ? `日期按本机已固定时区 ${scheduleOptions().timeZone} 重新计算。` : "";
      panel.querySelector("#importStatus").textContent = `${importCandidate.attempts.length} 条答题、${importCandidate.listeningAttempts.length} 条听辨；其中 ${duplicate} 条答题ID重复，将保留本机版本。备份课程版本：${payload.contentVersion || "旧版"}。${zoneNote}尚未写入。`;
      panel.querySelector("button").disabled = false;
    } catch (error) { panel.querySelector("#importStatus").textContent = `未导入：${error.message}`; }
  });
  panel.querySelector("button").addEventListener("click", async () => {
    if (!importCandidate) return;
    const candidate = importCandidate;
    panel.querySelector("button").disabled = true;
    let merged;
    try {
      await hydrateHistory([...practice.attempts, ...candidate.attempts]);
      if (importCandidate !== candidate || !panel.isConnected) return;
      merged = mergePractice(practice, candidate, scheduleOptions());
    }
    catch (error) { panel.querySelector("#importStatus").textContent = `未合并：${error.message}`; panel.querySelector("button").disabled = false; return; }
    if (!persistPractice(merged)) { panel.querySelector("#importStatus").textContent = "未合并：本机暂不能保存，请保留备份。"; panel.querySelector("button").disabled = false; return; }
    practice = merged; importCandidate = null; panel.querySelector("button").disabled = true;
    panel.querySelector("#importStatus").textContent = "已合并并保存；本机原答保留。"; renderChrome();
  });
}

function clearSessionRecordings() {
  app.querySelectorAll("audio").forEach((audio) => audio.pause());
  for (const url of sessionRecordings.values()) URL.revokeObjectURL(url);
  sessionRecordings.clear();
}

function filteredUnitRecords() {
  const query = unitQuery.trim().toLocaleLowerCase();
  const today = calendarDay(new Date().toISOString(), scheduleOptions().timeZone);
  return learningUnits.map(unit => ({ unit, summary: unitSummary(practice, unit.id) })).filter(({ unit, summary }) => {
    const observed = summary.observations.filter(o => o.status !== 'unobserved');
    const due = unitNextDate(unit.id);
    const inRoute = unitScope === 'all' || unit.sceneIds.some(id => branchForScene(getScene(id))?.id === unitScope);
    const inState = unitViewFilter === 'all'
      || (unitViewFilter === 'due' && due && due <= today)
      || (unitViewFilter === 'unobserved' && !observed.length)
      || (unitViewFilter === 'unknown' && observed.some(o => !o.contextVerified))
      || (['independent', 'assisted', 'partial'].includes(unitViewFilter) && observed.some(o => o.contextVerified && o.status === unitViewFilter));
    return inRoute && inState && (!query || [unit.form, unit.meaningZh, unit.sense].join(' ').toLocaleLowerCase().includes(query));
  });
}

function filterUnitRecords() {
  const focus = document.activeElement;
  const inputId = focus?.id;
  const selection = inputId === 'unitSearch' ? [focus.selectionStart, focus.selectionEnd] : null;
  unitPage = 0;
  renderUnits();
  const restored = inputId && app.querySelector(`#${inputId}`);
  if (restored) { restored.focus({ preventScroll: true }); if (selection) restored.setSelectionRange(...selection); }
}
