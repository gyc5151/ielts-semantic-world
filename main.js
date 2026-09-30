import { dictionaryHtml, dictionaryContextFor, sentenceAt, usageForOccurrence } from "./dictionary.mjs?v=pilot-7-0";
import { nextReview } from "./learning.mjs?v=pilot-7-0";
const DATA_URL = "./data/world.json";
const STORAGE_KEY = "ielts-semantic-world-s01-trial-v1";


const app = document.querySelector("#app");
const nav = document.querySelector("#sceneNav");
const glossaryDialog = document.querySelector("#glossaryDialog");
let glossaryReturnFocus = null;
let content;
let activeBranchId = "housing";
let wordnet = null;
let dictionaryContext = {};
let dictionaryTranslations = {};
let dictionaryChinese = {};
let textTranslations = {};
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
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (value && Array.isArray(value.attempts) && value.reviews && typeof value.reviews === "object") {
      return value;
    }
  } catch (_) {
    // A broken browser record should never block access to learning content.
  }
  return { attempts: [], reviews: {} };
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(practice)); }
  catch (_) { document.querySelector("#storageStatus").hidden = false; }
  renderChrome();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function dateLabel(iso) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(iso));
}

function getScene(id) {
  return content.microScenes.find((scene) => scene.id === id);
}

function promptsFor(scene) {
  return [...(scene.retrievalPrompts || []), ...(scene.transferPrompt ? [scene.transferPrompt] : [])];
}

function allPrompts() {
  return content.microScenes.flatMap((scene) => promptsFor(scene).map((prompt) => ({ scene, prompt })));
}

function assertWordCoverage(scene) {
  const passages = [scene.title, scene.goal, scene.situation, ...(scene.memoryNodes || []).flatMap((n) => [n.object, n.cue])];
  for (const prompt of promptsFor(scene)) {
    passages.push(prompt.function, prompt.cue, prompt.feedback, ...(prompt.acceptableAnswers || []));
  }
  const missing = new Set();
  for (const passage of passages) {
    for (const match of String(passage || "").matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)) {
      const word = match[0].toLowerCase();
      if (!scene.wordLookup[word]?.zh) missing.add(word);
    }
  }
  if (missing.size) throw new Error(`${scene.id} 有 ${missing.size} 个单词尚无情境释义：${[...missing].slice(0, 5).join(", ")}`);
}

function dueEntries() {
  const now = Date.now();
  return allPrompts().filter(({ prompt }) => {
    const record = practice.reviews[prompt.id];
    return record?.nextDue && new Date(record.nextDue).getTime() <= now;
  });
}

function latestAttempt(promptId) {
  return [...practice.attempts].reverse().find((attempt) => attempt.promptId === promptId);
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
  document.querySelector("#sidebarEyebrow").textContent = branch ? branch.kind : "IELTS / SEMANTIC WORLD";
  document.querySelector("#sidebarTitle").textContent = branch?.title || "从一个场景，走进一个世界。";
  document.querySelector("#sidebarDescription").textContent = branch?.description || "用真实的决定串起物件、动作与英语。今天只选一条路。";
  const entries = allPrompts();
  const answered = entries.filter(({ prompt }) => practice.reviews[prompt.id]).length;
  document.querySelector("#sceneCountLabel").textContent = branch ? `${branch.kind} · ${branchScenes(branch).length} 个场景` : `${content.branches.length} 条学习路线 · ${content.microScenes.length} 个场景`;
  document.querySelector("#sceneNavHint").textContent = branch ? "当前路线 · 手机可横向滑动 →" : "选择一条主线或支线 →";
  document.querySelector("#progressCount").textContent = `${answered} / ${entries.length}`;
  document.querySelector("#progressBar").style.width = `${entries.length ? (answered / entries.length) * 100 : 0}%`;
  document.querySelector("#dueCount").textContent = String(dueEntries().length);
  nav.innerHTML = `
    <button class="nav-item ${ui.page === "home" ? "active" : ""}" type="button" data-nav="home" ${ui.page === "home" ? 'aria-current="page"' : ""}><span class="nav-index">◎</span><span>世界入口</span></button>
    ${branch ? `<button class="nav-item ${ui.page === "branch" ? "active" : ""}" type="button" data-branch="${escapeHtml(branch.id)}" ${ui.page === "branch" ? 'aria-current="page"' : ""}><span class="nav-index">↳</span><span>${escapeHtml(branch.title)}<small>路线与物件</small></span></button>` : ""}
    ${branch ? branchScenes(branch).map((item, index) => {
      const total = promptsFor(item).length;
      const done = promptsFor(item).filter((prompt) => practice.reviews[prompt.id]).length;
      const selected = ui.sceneId === item.id && ["scene", "prompt"].includes(ui.page);
      return `<button class="nav-item ${selected ? "active" : ""}" type="button" data-scene="${escapeHtml(item.id)}" ${selected ? 'aria-current="page"' : ""}><span class="nav-index">${String(index + 1).padStart(2, "0")}</span><span>${escapeHtml(item.navTitle || item.title)}<small>${done}/${total} 次任务已试</small></span></button>`;
    }).join("") : content.branches.map((item) => `<button class="nav-item" type="button" data-branch="${escapeHtml(item.id)}"><span class="nav-index">${item.kind === "主线" ? "01" : "↳"}</span><span>${escapeHtml(item.title)}<small>${escapeHtml(item.kind)}</small></span></button>`).join("")}
  `;
  nav.querySelector('[data-nav="home"]').addEventListener("click", () => navigate("home"));
  nav.querySelectorAll("[data-branch]").forEach((button) => button.addEventListener("click", () => openBranch(button.dataset.branch)));
  nav.querySelectorAll("[data-scene]").forEach((button) => button.addEventListener("click", () => navigate("scene", button.dataset.scene)));
}

function navigate(page, sceneId = null, { updateUrl = true } = {}) {
  if (ui.page === "prompt" && !ui.revealed) {
    const input = app.querySelector("#answerInput");
    if (input) drafts[`${ui.sceneId}:${ui.promptIndex}`] = { response: input.value, support: ui.support };
  }
  ui = { page, sceneId, promptIndex: 0, reviewMode: false, revealed: false, support: "none", submittedAttemptId: null };
  if (updateUrl) {
    const hash = page === "scene" ? `#scene/${encodeURIComponent(sceneId)}` : page === "branch" ? `#branch/${encodeURIComponent(activeBranchId)}` : `#${page}`;
    if (window.location.hash !== hash) window.history.pushState(null, "", hash);
  }
  render();
  app.focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
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
  if (["home", "review", "about"].includes(parts[0])) return navigate(parts[0], null, { updateUrl: false });
  navigate("home", null, { updateUrl: false });
}

window.addEventListener("popstate", () => { if (content?.microScenes) restoreRoute(); });
window.addEventListener("hashchange", () => { if (content?.microScenes) restoreRoute(); });

function render() {
  if (!content) return;
  renderChrome();
  if (ui.page === "home") renderHome();
  if (ui.page === "branch") renderBranch();
  if (ui.page === "scene") renderScene();
  if (ui.page === "prompt") renderPrompt();
  if (ui.page === "review") renderReview();
  if (ui.page === "about") renderAbout();
}

function themeIllustration(theme) {
  const art = {
    home: '<path d="M35 103V50l57-34 57 34v53M58 103V65h33v38M106 64h22v22h-22M158 104h41l-5-23h-31zM179 81V48m0 14c-30-1-25-26-25-26 22 0 25 26 25 26m0 5c30-1 25-26 25-26-22 0-25 26-25 26"/>',
    community: '<rect x="25" y="18" width="116" height="90" rx="4"/><path d="M42 37h62M42 50h82M42 72h38m-38 13h48m3-17 20 12-20 12"/><circle cx="181" cy="56" r="29"/><path d="M181 38v20l16 9M162 100h39"/>',
    science: '<path d="M47 17h36m-28 0v34l-29 47q-4 10 7 10h64q11 0 7-10L75 51V17M41 81h47M145 33h49m-41 0v55q16 38 33 0V33M153 69h33M124 108h91"/><path d="m119 19 14 11 18-15"/>',
    nature: '<path d="M22 92q45-18 89 0t89 0M22 107q45-18 89 0t89 0M44 78V46m0 15L30 47m14 8 14-20M168 76V31m0 22 16-15m-16 21-16-18M79 36q9-12 18 0 9-12 18 0M111 57q9-12 18 0 9-12 18 0"/><circle cx="188" cy="20" r="9"/>'
  };
  return `<svg class="theme-illustration" viewBox="0 0 230 125" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${art[theme] || art.home}</svg>`;
}

function renderHome() {
  app.innerHTML = `
    <section class="hero world-hero"><div class="eyebrow">IELTS SEMANTIC WORLD / SITUATION → LANGUAGE</div>
      <h1>每扇侧门，<br/><em>都有一件想说的事。</em></h1>
      <p>从找房主线出发，也可以走进公告板、实验室或湿地。沿着物件经历一件事，再合上故事，用自己的英语说出来。</p>
      <div class="hero-actions"><button class="primary-btn" type="button" id="startFirst">继续找房主线</button><button class="secondary-btn" type="button" id="openReview">查看到期复习</button></div>
      <div class="world-stats"><span>${content.branches.length} 条路线</span><span>${content.microScenes.length} 个短场景</span><span>${allPrompts().length} 个表达任务</span></div>
    </section>
    <section class="section-heading"><div><div class="eyebrow">CHOOSE A SIDE DOOR</div><h2>今天，选一条路。</h2></div><p>先选 3–4 个有用表达。每条路都能回到它的起点。</p></section>
    <div class="branch-grid">${content.branches.map((branch) => {
      const scenes = branchScenes(branch);
      const tasks = scenes.flatMap(promptsFor);
      const done = tasks.filter((prompt) => practice.reviews[prompt.id]).length;
      return `<article class="branch-card" data-theme="${escapeHtml(branch.theme)}">
        <div class="branch-art">${themeIllustration(branch.theme)}<span class="branch-kind">${escapeHtml(branch.kind)}</span></div>
        <div class="branch-card-body"><h3>${escapeHtml(branch.title)}</h3><p class="branch-subtitle" lang="en">${annotatedEnglish(branch.subtitle, scenes[0])}</p>
        <p>${escapeHtml(branch.description)}</p><div class="branch-mini-route">${branch.route.slice(0, 3).map(escapeHtml).join(' → ')} → …</div>
        <div class="branch-card-meta"><span>${scenes.length} 个场景 · ${tasks.length} 个任务</span><span>${done} 次已试</span></div>
        <button class="secondary-btn" type="button" data-open-branch="${escapeHtml(branch.id)}">${branch.kind === '主线' ? '进入找房主线' : `走进${escapeHtml(branch.title)}`} <span aria-hidden="true">↗</span></button></div>
      </article>`;
    }).join('')}</div>
    <section class="principle-strip"><strong>记住路线，是为了说出事件。</strong><span>英中文辅助、单词与搭配弹窗、独立召回和到期复习，所有主题都使用同一套操作。</span></section>`;
  app.querySelector('#startFirst').addEventListener('click', () => openBranch('housing'));
  app.querySelector('#openReview').addEventListener('click', () => navigate('review'));
  app.querySelectorAll('[data-open-branch]').forEach((button) => button.addEventListener('click', () => openBranch(button.dataset.openBranch)));
}

function renderBranch() {
  const branch = getBranch(activeBranchId);
  if (!branch) return navigate('home');
  const scenes = branchScenes(branch);
  const tasks = scenes.flatMap(promptsFor);
  const next = scenes.find((scene) => promptsFor(scene).some((p) => !practice.reviews[p.id])) || scenes[0];
  const done = tasks.filter((p) => practice.reviews[p.id]).length;
  app.innerHTML = `<section class="hero branch-hero">
    <div class="branch-hero-copy"><div class="eyebrow">${escapeHtml(branch.kind)} / ${done} OF ${tasks.length} TASKS TRIED</div>
    <h1>${escapeHtml(branch.title)}</h1><p class="branch-subtitle" lang="en">${annotatedEnglish(branch.subtitle, scenes[0])}</p><p>${escapeHtml(branch.description)}</p>
    <div class="hero-actions"><button class="primary-btn" type="button" id="startBranch">${done ? '继续这条路线' : '从第一个场景开始'}</button><button class="secondary-btn" type="button" id="backWorld">世界入口</button></div></div>
    <div class="branch-hero-art">${themeIllustration(branch.theme)}</div></section>
    <section class="memory-map" aria-label="支线物件路线"><div class="eyebrow">ENTRY → OBJECTS → RETURN</div><h2>${escapeHtml(branch.entry)}</h2><ol class="object-route">${branch.route.map((object, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(object)}</strong></li>`).join('')}</ol><p class="route-return">↶ ${escapeHtml(branch.returnLabel)} · 合上正文后，借这些物件讲清发生了什么。</p></section>
    <section class="section-heading"><div><div class="eyebrow">SHORT READINGS / REAL DECISIONS</div><h2>沿着事件，一节一节走。</h2></div><p>英文先读，中文按需展开。用自己的说法也可以。</p></section>
    <div class="split-grid">${scenes.map((scene, index) => `<article class="scene-card"><span class="badge">${String(index + 1).padStart(2, '0')} / ${escapeHtml(scene.id)}</span><h3>${annotatedEnglish(scene.title, scene)}</h3><p>${annotatedEnglish(scene.goal, scene)}</p><div class="meta">${promptsFor(scene).length - 1} 个召回任务 · 1 个新情境迁移</div><button class="secondary-btn" type="button" data-open-scene="${escapeHtml(scene.id)}">进入${escapeHtml(scene.navTitle)} ↗</button></article>`).join('')}</div>
    ${branch.entrySceneId ? `<section class="branch-return-panel"><strong>回到主线的同一个物件</strong><p>这条支线从费用与合同接入。看完房间细节与预算，回去继续核实费用。</p><button class="secondary-btn" id="returnMain" type="button">${escapeHtml(branch.returnLabel)} ↶</button></section>` : `<p class="meta">${branch.kind === '主线' ? '完成一站再走下一站，也可以从费用与合同进入蓝色账单支线。' : '本次已上线这条支线；所属站点的完整主线仍在文字资料中。'}</p>`}`;
  app.querySelector('#startBranch').addEventListener('click', () => navigate('scene', next.id));
  app.querySelector('#backWorld').addEventListener('click', () => navigate('home'));
  app.querySelector('#returnMain')?.addEventListener('click', () => navigate('scene', branch.entrySceneId));
  app.querySelectorAll('[data-open-scene]').forEach((button) => button.addEventListener('click', () => navigate('scene', button.dataset.openScene)));
}

function memoryRouteHtml(scene) {
  if (!scene.memoryNodes?.length) return '';
  return `<section class="memory-stations" aria-label="本节物件线索"><div class="eyebrow">FOLLOW THE OBJECTS</div><p class="meta">点开物件，回想它改变了哪个决定。</p><div class="memory-station-grid">${scene.memoryNodes.map((node, index) => `<details class="memory-station"><summary><span class="station-number">${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(node.zh)}</strong></summary><div><p lang="en">${annotatedEnglish(node.object, scene)}</p><p lang="en">${annotatedEnglish(node.cue, scene)}</p>${textTranslation(node.cueZh, '线索中文')}</div></details>`).join('')}</div></section>`;
}

function chunkMatches(value, scene) {
  const source = String(value || "");
  const lower = source.toLowerCase();
  const candidates = [];
  for (const entry of scene.glossary || []) {
    if (entry.type !== "chunk" || !entry.text) continue;
    const needle = entry.text.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const start = lower.indexOf(needle, from);
      if (start < 0) break;
      const end = start + needle.length;
      if (!/[A-Za-z]/.test(source[start - 1] || "") && !/[A-Za-z]/.test(source[end] || "")) {
        candidates.push({ start, end, entry });
      }
      from = end;
    }
  }
  const selected = [];
  for (const match of candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (!selected.some((other) => match.start < other.end && match.end > other.start)) selected.push(match);
  }
  return selected.sort((a, b) => a.start - b.start);
}

function annotatedEnglish(value, scene) {
  const source = String(value || "");
  const chunks = chunkMatches(source, scene);
  const words = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  let html = "";
  let previousEnd = 0;
  for (const match of source.matchAll(words)) {
    const start = match.index;
    const end = start + match[0].length;
    html += escapeHtml(source.slice(previousEnd, start));
    const chunk = chunks.find((item) => start >= item.start && end <= item.end);
    const sentence = sentenceAt(source, start);
    const usage = usageForOccurrence(dictionaryContext, scene.id, match[0].toLowerCase(), sentence.text, start - sentence.start);
    html += `<button class="glossary-word${chunk ? " glossary-word--chunk" : ""}" type="button" data-word="${escapeHtml(match[0].toLowerCase())}" data-word-scene="${escapeHtml(scene.id)}" data-word-sentence="${escapeHtml(sentence.text)}" ${usage ? `data-word-usage="${escapeHtml(usage)}"` : ""} ${chunk ? `data-related-chunk="${escapeHtml(chunk.entry.id)}"` : ""} aria-label="查看单词 ${escapeHtml(match[0])} 的意思">${escapeHtml(match[0])}</button>`;
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
  return zh ? `<details class="text-translation" data-learning-translation><summary>${escapeHtml(label)}</summary><div lang="zh-CN">${paragraphHtml(zh)}</div><small>本项目中文译解</small></details>` : "";
}

function readingHtml(scene) {
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
    const status = app.querySelector("#lookupStatus");
    if (status) { status.hidden = false; status.textContent = "这题查看过中文或查过词，记录会标记为使用提示；仍可继续用自己的英语作答。"; }
  }
}

function chunkWordButtons(scene, entry) {
  return [...entry.text.matchAll(/[A-Za-z]+(?:'[A-Za-z]+)?/g)].map((match) => {
    const word = match[0].toLowerCase();
    const usage = usageForOccurrence(dictionaryContext, scene.id, word, entry.text, match.index);
    return `<button class="glossary-component-word" type="button" data-dialog-word="${escapeHtml(word)}" data-dialog-scene="${escapeHtml(scene.id)}" data-dialog-chunk="${escapeHtml(entry.id)}" data-dialog-sentence="${escapeHtml(entry.text)}" ${usage ? `data-word-usage="${escapeHtml(usage)}"` : ""} aria-label="查看组成单词 ${escapeHtml(match[0])}">${escapeHtml(match[0])}</button>`;
  }).join("");
}

function showEntryModal(scene, entry, trigger, relatedChunkId = null) {
  if (!glossaryDialog.open) glossaryReturnFocus = trigger;
  const source = (scene.terms || []).find((term) => String(term.term).toLowerCase() === String(entry.sourceTerm || "").toLowerCase());
  const relatedChunk = (scene.glossary || []).find((item) => item.id === relatedChunkId && item.type === "chunk");
  glossaryDialog.innerHTML = `<div class="glossary-modal">
    <div class="glossary-modal-top"><span class="glossary-type">${entry.type === "word" ? "WORD / 单词" : "CHUNK / 表达块"}</span><button class="glossary-close" type="button" aria-label="关闭释义窗口">×</button></div>
    <h2 class="glossary-headword" id="glossaryHeadword">${escapeHtml(entry.text)}</h2>
    ${entry.contextSentence ? `<details class="glossary-context"><summary>查看你点到的这句话</summary><p lang="en">${escapeHtml(entry.contextSentence)}</p></details>` : ""}
    <div class="glossary-zh"><span>本项目编写 · 在本情境中</span><strong>${escapeHtml(entry.zh || "释义待补")}</strong></div>
    ${entry.note ? `<div class="glossary-note"><span>${entry.type === "word" ? "用法要点" : "搭配与调用"}</span><p>${escapeHtml(entry.note)}</p></div>` : ""}
    ${entry.type === "chunk" ? `<div class="glossary-components"><span>点组成单词，进一步查词</span><div>${chunkWordButtons(scene, entry)}</div></div>` : ""}
    ${relatedChunk ? `<button class="glossary-related" type="button" data-related-chunk-open="${escapeHtml(relatedChunk.id)}" data-related-scene="${escapeHtml(scene.id)}">查看整块表达：${escapeHtml(relatedChunk.text)} ↗</button>` : ""}
    ${entry.example ? `<div class="glossary-example"><span>项目情境例句</span><p>${escapeHtml(entry.example)}</p></div>` : ""}
    ${dictionaryHtml(entry, scene.id, wordnet, dictionaryContext, dictionaryTranslations, dictionaryChinese, showDictionaryChinese)}
    <details class="glossary-source"><summary>${entry.type === "chunk" ? "查看组成词的来源" : "查看词汇纳入依据"}</summary>${source ? `<p><strong>${escapeHtml(source.kind === "BRG" ? "SRC · BRG" : source.kind || "")}</strong> · ${escapeHtml(source.sourceLabel || "")}</p>${source.sourceRef ? `<small>${escapeHtml(source.sourceRef)}</small>` : ""}${source.sourceUrl ? `<a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">查看外部词典 ↗</a>` : ""}` : `<p>Researcher inference · 根据本场景编写的辅助释义；未改动原始词表。</p>`}</details>
  </div>`;
  if (glossaryDialog.open) glossaryDialog.querySelector(".glossary-close").focus();
  else glossaryDialog.showModal();
  glossaryDialog.scrollTop = 0;
}

function openGlossary(sceneId, entryId, trigger) {
  const scene = getScene(sceneId);
  const entry = scene?.glossary?.find((item) => item.id === entryId);
  if (entry) {
    markLookupSupport();
    showEntryModal(scene, entry, trigger);
  }
}

function openWord(sceneId, word, trigger, relatedChunkId, contextSentence, dictionaryUsage) {
  const scene = getScene(sceneId);
  if (!scene) return;
  markLookupSupport();
  const curated = (scene.glossary || []).find((item) => item.type === "word" && item.text.toLowerCase() === word);
  const lookup = scene.wordLookup?.[word];
  const surface = trigger?.textContent?.trim() || word;
  const entry = curated ? { ...curated, text: surface } : { text: surface, type: "word", zh: lookup?.zh || "释义待补", note: lookup?.note || "" };
  const context = dictionaryContextFor(dictionaryContext, sceneId, word, dictionaryUsage);
  if (context?.zh) entry.zh = context.zh;
  if (context?.usageNote) entry.note = context.usageNote;
  if (!entry.sourceTerm) entry.sourceTerm = (scene.terms || []).find((term) => term.term.toLowerCase() === word)?.term;
  entry.contextSentence = contextSentence;
  entry.dictionaryUsage = dictionaryUsage;
  showEntryModal(scene, entry, trigger, relatedChunkId);
}

function markLookupSupport() {
  if (ui.page === "prompt" && !ui.revealed && ui.support === "none") {
    ui.support = "word";
    const status = app.querySelector("#lookupStatus");
    if (status) status.hidden = false;
  }
}

function markMemorySupport() {
  if (ui.page !== "prompt" || ui.revealed) return;
  if (ui.support === "none") ui.support = "memory";
  const status = app.querySelector("#lookupStatus");
  if (status) {
    status.hidden = false;
    status.textContent = "这题打开过物件线索，记录会标记为使用提示；仍可继续用自己的英语作答。";
  }
}

function renderScene() {
  const scene = getScene(ui.sceneId);
  if (!scene) return navigate("home");
  const routeScenes = branchScenes(branchForScene(scene));
  const nextScene = routeScenes[routeScenes.findIndex((item) => item.id === scene.id) + 1];
  const sideDoors = content.branches.filter((branch) => branch.entrySceneId === scene.id);
  const total = promptsFor(scene).length;
  const done = promptsFor(scene).filter((prompt) => practice.reviews[prompt.id]).length;
  app.innerHTML = `
    <section class="scene-intro">
      <div class="eyebrow">${escapeHtml(scene.id)} · ${done}/${total} TASKS TRIED</div>
      <h1>${annotatedEnglish(scene.title, scene)}</h1>
      <p class="lead">${annotatedEnglish(scene.goal || "", scene)}</p>
      ${textTranslation(`${textTranslations[scene.id]?.title || ""}\n\n${textTranslations[scene.id]?.goal || ""}`, "标题与学习目标中文")}
      <div class="story-card">
        <span class="badge">READ FIRST / THEN CLOSE THE TEXT</span>
        <p class="glossary-help">点击任何英文单词看本句意思；表达块末尾的 ↗ 可看整块搭配。</p>
        <button class="secondary-btn translation-toggle" type="button" id="toggleStoryTranslation" aria-pressed="false">显示全文译文</button>
        <div class="story-text">${readingHtml(scene)}</div>
      </div>
      ${memoryRouteHtml(scene)}
      ${sideDoors.map((branch) => `<section class="side-door"><span>这张桌子旁还有一扇侧门</span><h2>${escapeHtml(branch.title)}</h2><p>${escapeHtml(branch.description)}</p><button class="secondary-btn" type="button" data-side-door="${escapeHtml(branch.id)}">先走这条支线 ↗</button></section>`).join('')}
      <div class="callout"><strong>下一步</strong><span>点击“合上原文，开始说英语”。练习页不会先显示目标词。卡住时可打开情节支架；系统会记录是否用了提示。</span></div>
      <div class="button-row"><button class="primary-btn" type="button" id="beginScene">${done === total ? "重新练习本场景" : "合上原文，开始说英语"}</button>${nextScene ? `<button class="secondary-btn" type="button" id="nextScene">进入下一站：${escapeHtml(nextScene.navTitle || nextScene.title)} →</button>` : ""}<button class="secondary-btn" type="button" id="backHome">返回当前路线</button></div>
    </section>
  `;
  app.querySelector("#toggleStoryTranslation").addEventListener("click", (event) => {
    const show = event.currentTarget.getAttribute("aria-pressed") !== "true";
    event.currentTarget.setAttribute("aria-pressed", String(show));
    event.currentTarget.textContent = show ? "隐藏全文译文" : "显示全文译文";
    app.querySelectorAll(".text-translation").forEach((detail) => { detail.open = show; });
  });
  app.querySelector("#beginScene").addEventListener("click", () => {
    ui.page = "prompt";
    const firstUntried = promptsFor(scene).findIndex((prompt) => !practice.reviews[prompt.id]);
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
  const scene = getScene(ui.sceneId);
  if (!scene) return navigate("home");
  const prompts = promptsFor(scene);
  const prompt = prompts[ui.promptIndex];
  if (!prompt) return navigate("scene", scene.id);
  const isTransfer = ui.promptIndex === prompts.length - 1;
  const draft = drafts[`${scene.id}:${ui.promptIndex}`];
  if (!ui.revealed && ui.support === "none" && draft) ui.support = draft.support;
  const translated = textTranslations[scene.id]?.prompts?.[prompt.id];
  const saved = ui.submittedAttemptId ? practice.attempts.find((attempt) => attempt.id === ui.submittedAttemptId) : null;
  app.innerHTML = `
    <section class="prompt-page">
      <div class="prompt-topline"><span class="eyebrow">${escapeHtml(scene.id)} / ${isTransfer ? "NEW SITUATION" : `RETRIEVAL ${ui.promptIndex + 1} OF ${prompts.length - 1}`}</span><span class="badge">${ui.reviewMode ? "到期复习" : "无英文答案提示"}</span></div>
      <h1>${isTransfer ? "换一个情境，再说一次。" : "现在轮到你说。"}</h1>
      <p class="lead">${ui.revealed ? annotatedEnglish(prompt.function || scene.goal || "", scene) : "先根据下面的情境，用自己的英语表达要说的信息、判断或请求。"}</p>
      <div class="prompt-card">
        <div class="eyebrow">SITUATION → LANGUAGE</div>
        <h2>${annotatedEnglish(prompt.cue || "", scene)}</h2>
        ${textTranslation(translated?.cue, "显示题目中文（记为提示）")}
        <p class="meta">你可以用自己的正确说法回答；不必猜中某个唯一词。</p>
      </div>
      ${ui.support === "chinese" || ui.support === "story" ? `<div class="hint-panel"><strong>${ui.support === "story" ? "原文已重新打开" : "情节支架"}</strong>${ui.support === "story" ? readingHtml(scene) : `<p>${escapeHtml(isTransfer ? "先说清新人物遇到什么问题、有哪些条件，再给出行动、判断或请求。用自己的句子表达。" : (scene.zhSupport || "先说清谁遇到什么问题、想得到什么结果，再找英语表达。"))}</p>`}<small>这次答题将标记为“使用提示”。</small></div>` : ""}
      ${!ui.revealed ? `
        <label class="answer-label" for="answerInput">Your answer <span>用英语说一两句即可</span></label>
        <textarea id="answerInput" class="answer-input" rows="5" placeholder="Write what you would actually say…" autocomplete="off" spellcheck="true"></textarea>
        <div class="button-row"><button class="primary-btn" type="button" id="submitAnswer">提交并查看参考表达</button><button class="secondary-btn" type="button" id="cannotRecall">暂时想不出</button></div>
        ${scene.memoryNodes?.length ? `<details class="memory-hint" data-memory-hint><summary>借物件路线回想（记为提示）</summary>${memoryRouteHtml(scene)}</details>` : ""}
        <div class="hint-actions"><button class="text-btn" type="button" id="showChinese">${ui.support === "chinese" ? "已显示情节支架" : "需要情节支架？"}</button>${isTransfer ? "" : `<button class="text-btn" type="button" id="showStory">重新看英文情境</button>`}</div>
        <small class="lookup-status" id="lookupStatus" ${["word", "translation", "memory"].includes(ui.support) ? "" : "hidden"}>这题查看过提示（中文、查词或物件线索），记录会标记为使用提示；仍可继续用自己的英语作答。</small>
      ` : renderFeedback(scene, prompt, saved)}
      <div class="prompt-footer"><button class="text-btn" type="button" id="backScene">${isTransfer ? "← 返回当前路线" : "← 返回情境"}</button><span>${ui.promptIndex + 1} / ${prompts.length}</span></div>
    </section>
  `;
  app.querySelector("#backScene").addEventListener("click", () => isTransfer ? openBranch(branchForScene(scene).id) : navigate("scene", scene.id));
  if (ui.revealed) {
    app.querySelectorAll("[data-rating]").forEach((button) => button.addEventListener("click", () => rateAnswer(button.dataset.rating)));
    app.querySelector("#nextPrompt").addEventListener("click", nextPrompt);
    return;
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
  if (!names.size) return scene.terms || [];
  return (scene.terms || []).filter((item) => names.has(String(item.term).toLowerCase()));
}

function renderFeedback(scene, prompt, attempt) {
  const answers = prompt.acceptableAnswers || prompt.sampleAnswers || [];
  const terms = termsForPrompt(scene, prompt);
  const rating = attempt?.selfRating;
  const translated = textTranslations[scene.id]?.prompts?.[prompt.id];
  return `
    <div class="feedback" role="region" aria-label="参考表达与自评">
      <div class="eyebrow">COMPARE / THEN DECIDE</div>
      <h2>先核对表达的意图，再核对用词。</h2>
      <div class="your-answer"><span class="meta">你的原答${attempt?.support !== "none" ? " · 使用了提示" : " · 未使用提示"}</span><p>${attempt?.response ? escapeHtml(attempt.response) : "（这次暂时想不出）"}</p></div>
      <div class="sample-answers"><strong>参考说法 <small>点单词看释义，点 ↗ 看整块表达</small></strong>${answers.map((answer, index) => `<div><p lang="en">“${annotatedEnglish(answer, scene)}”</p>${textTranslation(translated?.acceptableAnswers?.[index], "参考表达中文")}</div>`).join("")}</div>
      <p class="feedback-note">${annotatedEnglish(prompt.feedback || "比较你的说法是否完成了情境中的交流目的。合理改述也可以正确。", scene)}</p>
      ${textTranslation(translated?.feedback, "用法反馈中文")}
      ${textTranslation(translated?.function, "本题语言目标中文")}
      ${terms.length ? `<details class="source-details"><summary>查看本题相关表达与来源</summary><div class="term-list">${terms.map((term) => `<div class="term-item"><span class="source-pill ${String(term.kind || "").toLowerCase()}">${escapeHtml(term.kind === "BRG" ? "SRC · BRG" : (term.kind || "候选"))}</span><strong>${escapeHtml(term.term)}</strong><span>${escapeHtml(term.sourceLabel || "")}</span>${term.sourceUrl ? `<a href="${escapeHtml(term.sourceUrl)}" target="_blank" rel="noopener noreferrer">来源 ↗</a>` : ""}${term.sourceRef ? `<small>${escapeHtml(term.sourceRef)}</small>` : ""}</div>`).join("")}</div></details>` : ""}
      <div class="self-check"><strong>诚实记录这一次</strong><p>这里不自动判定自由回答，也不估算 IELTS 分数。你能否表达这个意图？搭配是否自然？${attempt?.support !== "none" ? "这次用了提示，因此不会推进独立复习间隔。" : ""}</p><div class="rating-row">
        <button class="rating-btn ${rating === "good" ? "selected" : ""}" type="button" data-rating="good" ${rating || !attempt?.response ? "disabled" : ""}>${attempt?.support !== "none" ? "提示后能表达" : "能独立表达"}</button>
        <button class="rating-btn ${rating === "partial" ? "selected" : ""}" type="button" data-rating="partial" ${rating ? "disabled" : ""}>表达了部分</button>
        <button class="rating-btn ${rating === "again" ? "selected" : ""}" type="button" data-rating="again" ${rating ? "disabled" : ""}>还需要帮助</button>
      </div><small id="ratingStatus">${rating ? (practice.reviews[prompt.id]?.nextDue ? `已记录；下次复习 ${dateLabel(practice.reviews[prompt.id].nextDue)}。` : "已记录；本轮间隔已完成。") : "选一项后，这次尝试才进入复习记录。"}</small></div>
      <button class="primary-btn" type="button" id="nextPrompt" ${rating ? "" : "disabled"}>${ui.reviewMode ? "完成这次复习" : "下一步 →"}</button>
    </div>
  `;
}

function submitAnswer(empty) {
  const scene = getScene(ui.sceneId);
  const prompt = promptsFor(scene)[ui.promptIndex];
  const response = empty ? "" : app.querySelector("#answerInput").value.trim();
  if (!empty && !response) {
    app.querySelector("#answerInput").focus();
    app.querySelector("#answerInput").setAttribute("placeholder", "先尝试写一句英语；如果暂时想不出，可点击旁边的按钮。");
    return;
  }
  const now = new Date().toISOString();
  const attempt = {
    id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    promptId: prompt.id,
    sceneId: scene.id,
    contentVersion: content.version || "v1",
    attemptedAt: now,
    response,
    support: ui.support,
    reviewMode: ui.reviewMode,
    revealedAt: now,
    selfRating: null,
  };
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
  attempt.selfRating = rating;
  attempt.ratedAt = new Date().toISOString();
  const previous = practice.reviews[prompt.id] || { stage: 0 };
  const schedule = nextReview(previous, attempt, new Date());
  practice.reviews[prompt.id] = {
    ...schedule,
    lastRating: rating,
    lastAttemptAt: attempt.ratedAt,
    lastAttemptId: attempt.id,
  };
  save();
  renderPrompt();
}

function nextPrompt() {
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

function renderReview() {
  const due = dueEntries();
  const reviewed = allPrompts().filter(({ prompt }) => practice.reviews[prompt.id]);
  app.innerHTML = `
    <section class="simple-page"><div class="eyebrow">REVIEW / 1 · 7 · 30 DAYS</div><h1>让情境再次叫出英语。</h1>
      <p class="lead">第 1、7、30 天从首次独立表达那天计算；提前重做不会跳过间隔。这是试行安排，系统记录原答和你的自评，不会把“看过答案”算成独立掌握。</p>
      <div class="metric-row"><div><strong>${due.length}</strong><span>现在到期</span></div><div><strong>${reviewed.length}</strong><span>已试过的任务</span></div><div><strong>${practice.attempts.length}</strong><span>答题记录</span></div></div>
      <h2>到期问题</h2>
      <div class="review-list">${due.length ? due.map(({ scene, prompt }) => `<div class="review-item"><span>${annotatedEnglish(scene.title, scene)}</span><strong>${annotatedEnglish(prompt.function || "", scene)}</strong><button class="text-btn" type="button" data-review-prompt="${escapeHtml(prompt.id)}">重新独立回答 ↗</button></div>`).join("") : `<div class="empty-state">今天没有到期问题。完成一个微场景后，系统会安排次日回访；你也可以随时重进场景练习。</div>`}</div>
      ${reviewed.length ? `<h2>最近练过</h2><div class="history-list">${reviewed.map(({ scene, prompt }) => { const last = latestAttempt(prompt.id); const record = practice.reviews[prompt.id]; return `<div><span>${annotatedEnglish(scene.title, scene)} · ${annotatedEnglish(prompt.function || "", scene)}</span><small>${last?.selfRating === "good" ? "自评：能表达" : last?.selfRating === "partial" ? "自评：部分" : "自评：需帮助"} · ${record?.nextDue ? `下次 ${dateLabel(record.nextDue)}` : "本轮间隔已完成"}</small></div>`; }).join("")}</div>` : ""}
    </section>
  `;
  app.querySelectorAll("[data-review-prompt]").forEach((button) => button.addEventListener("click", () => {
    const found = allPrompts().find(({ prompt }) => prompt.id === button.dataset.reviewPrompt);
    if (!found) return;
    ui = { page: "prompt", sceneId: found.scene.id, promptIndex: promptsFor(found.scene).findIndex((prompt) => prompt.id === found.prompt.id), reviewMode: true, revealed: false, support: "none", submittedAttemptId: null };
    render();
  }));
}

function renderAbout() {
  app.innerHTML = `
    <section class="simple-page"><div class="eyebrow">ABOUT THIS TRIAL</div><h1>这是一段学习实验。</h1>
      <div class="about-copy"><p>本原型目前包含 ${content.branches.length} 条路线、${content.microScenes.length} 个文字微场景、${allPrompts().length} 个表达任务。S01 找房主线之外，已接入住房、社区、研究与湿地支线。不同内容采用不同纸张、颜色和物件排布，学习操作保持一致。它展示从情境到英语表达的学习流程，不是正式 IELTS 考试，也不提供自动语言评分。</p>
      <p>阅读页、英文题目和答题后的参考说法中，每个英文单词都可点击查看本情境的中文意思。表达块末尾的 ↗ 打开整块搭配说明；单词弹窗里也可以跳到它所属的表达块。答题前查词会记录为使用了提示。</p>
      <p>这里的“表达块”指适合整体调用的说法，不表示其中每个词都只能这样搭配。普通单词的中文义是为本场景编写的辅助释义，不等于原始资料里的定义。</p>
      <p>阅读页可显示全文英中对照；题目、参考说法和反馈也可以展开中文。答题前查看中文算作提示，答题后查看译文不改变这次记录。词典里的“显示中文释义与例句译文”可以一次展开全部已载入译文。词典中文分为项目译解与机器辅助译文；机器译文未逐条人工校订，遇到不自然或不明确的说法，应以英文原义核对。</p>
      <p>单词弹窗另列 Princeton WordNet 3.0 的英语义项及其实际收录的原例句；正文、任务与物件线索中的词形均提供项目辅助词义；WordNet 未收录的词形会明确显示缺口。部分义项没有例句，部分原例句使用同义词。它们与本项目编写的中文情境义、情境例句分开显示；租房时的 viewing 等词若缺少对应义项，会明确提示。更多用法可通过弹窗里的链接前往剑桥学习者词典查看。WordNet 3.0 © 2006 Princeton University；<a href="./data/WORDNET_LICENSE.txt" target="_blank" rel="noopener noreferrer">完整版权声明与免责声明</a>。</p>
      <p>原始资料中的词以 SRC 标记；跨场景借用的原始词以 SRC · BRG 标记。为补全情境而提出的表达以 EXP 或 COL 标记。表达块所显示的词条依据只说明其组成词来源，不等于整句话来自原始资料。具体依据写在弹窗和每题的来源说明中，不会写回原始 Master Lexicon。</p>
      <p>练习记录保存在这台设备当前浏览器的 localStorage。导出 JSON 可留作以后查看；清除记录只影响此原型在当前浏览器的数据。</p></div>
      <div class="button-row"><button class="secondary-btn" type="button" id="downloadData">导出练习记录</button><button class="text-btn danger" type="button" id="clearData">清除本机练习记录</button></div>
      <section class="clear-confirm" id="clearConfirm" aria-label="清除记录确认" hidden><h2>清除前请先备份</h2><p>确认后会清除当前浏览器的答题和复习记录，无法在本页面撤销。建议先导出。</p><div class="button-row"><button class="secondary-btn" type="button" id="confirmExport">先导出记录</button><button class="secondary-btn" type="button" id="cancelClear">取消</button><button class="text-btn danger" type="button" id="confirmClear">确认清除本机记录</button></div></section>
      <div class="callout"><strong>如何判断值得继续？</strong><span>看 7 天和 30 天后，在新情境里、不看原故事与目标词，能否独立说出自然英语。</span></div>
    </section>`;
  app.querySelector("#downloadData").addEventListener("click", exportPractice);
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
    practice = { attempts: [], reviews: {} };
    for (const key of Object.keys(drafts)) delete drafts[key];
    save();
    render();
  });
}

function exportPractice() {
  const payload = { app: "IELTS Semantic World S01 Trial", exportedAt: new Date().toISOString(), contentVersion: content?.version || "v1", practice };
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
document.querySelector("#aboutNav").addEventListener("click", () => navigate("about"));
document.querySelector("#exportBtn").addEventListener("click", exportPractice);
app.addEventListener("click", (event) => {
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
}, true);
glossaryDialog.addEventListener("click", (event) => {
  const toggle = event.target.closest("[data-dictionary-chinese]");
  if (toggle) {
    showDictionaryChinese = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(showDictionaryChinese));
    toggle.textContent = showDictionaryChinese ? "隐藏中文释义与例句译文" : "显示中文释义与例句译文";
    glossaryDialog.querySelector(".dictionary-section").classList.toggle("dictionary-chinese-visible", showDictionaryChinese);
    glossaryDialog.querySelectorAll(".example-translation").forEach((detail) => { detail.open = showDictionaryChinese; });
    markTranslationSupport();
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
  if (glossaryReturnFocus?.isConnected) glossaryReturnFocus.focus();
  glossaryReturnFocus = null;
});

try {
  const response = await fetch(DATA_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  content = await response.json();
  if (Array.isArray(content.sceneFiles)) {
    content.microScenes = [];
    for (const path of content.sceneFiles) {
      const sceneResponse = await fetch(path, { cache: "no-store" });
      if (!sceneResponse.ok) throw new Error(`${path} 场景内容未载入（HTTP ${sceneResponse.status}）`);
      content.microScenes.push(await sceneResponse.json());
    }
  }
  if (!Array.isArray(content.microScenes) || !content.microScenes.length) throw new Error("缺少微场景内容");
  const lookups = [];
  for (const scene of content.microScenes) {
    const wordResponse = await fetch(scene.wordFile, { cache: "no-store" });
    if (!wordResponse.ok) throw new Error(`${scene.id} 词义数据未载入（HTTP ${wordResponse.status}）`);
    const lookup = await wordResponse.json();
    if (lookup.sceneId !== scene.id || !lookup.words) throw new Error(`${scene.id} 词义数据不匹配`);
    lookups.push(lookup.words);
  }
  content.microScenes.forEach((scene, index) => {
    scene.wordLookup = lookups[index];
    assertWordCoverage(scene);
  });
  if (content.uiWordsFile) {
    const response = await fetch(content.uiWordsFile, { cache: "no-store" });
    if (!response.ok) throw new Error("路线标题词义未载入");
    const labels = (await response.json()).words;
    content.microScenes.forEach((scene) => { scene.wordLookup = { ...labels, ...scene.wordLookup }; });
  }
  try {
    const dictionaryResponse = await fetch(content.dictionaryFile || "./data/wordnet-s01.json", { cache: "no-store" });
    if (dictionaryResponse.ok) wordnet = await dictionaryResponse.json();
  } catch (_) {
    // Dictionary data is supplementary; the authored scene still works offline.
  }
  for (const path of content.dictionaryContextFiles || [content.dictionaryContextFile || "./data/s01-dictionary-context.json"]) {
    try {
      const contextResponse = await fetch(path, { cache: "no-store" });
      if (contextResponse.ok) Object.assign(dictionaryContext, await contextResponse.json());
    } catch (_) { /* Unmatched senses retain an explicit caveat. */ }
  }
  try {
    const translationResponse = await fetch(content.dictionaryTranslationFile || "./data/wordnet-translations-s01.json", { cache: "no-store" });
    if (translationResponse.ok) dictionaryTranslations = await translationResponse.json();
  } catch (_) {
    // Original examples remain readable without project translations.
  }
  for (const path of content.textTranslationFiles || [content.textTranslationFile || "./data/s01-text-translations.json"]) {
    try {
      const response = await fetch(path, { cache: "no-store" });
      if (response.ok) Object.assign(textTranslations, (await response.json()).scenes || {});
    } catch (_) { /* English reading remains available without its Chinese layer. */ }
  }
  try {
    const response = await fetch(content.dictionaryChineseFile || "./data/wordnet-zh-s01.json", { cache: "no-store" });
    if (response.ok) dictionaryChinese = (await response.json()).senses || {};
  } catch (_) { /* Original dictionary data remains available. */ }
  restoreRoute();
} catch (error) {
  app.innerHTML = `<section class="simple-page"><h1>内容尚未载入</h1><p>${escapeHtml(error.message)}</p><p>请刷新重试；如果持续无法载入，请检查网络连接。</p></section>`;
}
