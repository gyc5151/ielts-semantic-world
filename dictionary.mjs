const POS_LABELS = { n: "名词", v: "动词", a: "形容词", s: "形容词", r: "副词" };

function html(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function dictionaryContextFor(contexts, sceneId, surface, usageId = null) {
  for (const scope of [contexts?.[sceneId], contexts?.["*"]]) {
    const match = scope?.[surface] ? [surface, scope[surface]] : Object.entries(scope || {}).find(([, item]) => item.forms?.includes(surface));
    if (!match) continue;
    const [headword, base] = match;
    const usage = base.uses?.find((item) => item.id === usageId);
    return { ...base, ...usage, headword };
  }
  return null;
}

export function dictionaryRecordFor(wordnet, surface, headword = null) {
  const direct = wordnet?.entries?.[surface] || { lemma: surface, senses: [] };
  const base = wordnet?.entries?.[headword] || wordnet?.entries?.[direct.lemma];
  const seen = new Set();
  const senses = [...(direct.senses || []), ...(base?.senses || [])].filter((sense) => {
    if (seen.has(sense.id)) return false;
    seen.add(sense.id);
    return true;
  });
  return { lemma: base?.lemma || direct.lemma, lemmas: [...new Set([...(direct.lemmas || [direct.lemma]), ...(base?.lemmas || [])])], senses };
}

export function sentenceAt(source, offset) {
  let start = 0;
  let end = source.length;
  for (const match of source.matchAll(/[.!?](?:["'’”])?\s+|\n+/g)) {
    if (match.index + match[0].length <= offset) start = match.index + match[0].length;
    else { end = match.index + match[0].length; break; }
  }
  const text = source.slice(start, end);
  const leftTrim = text.length - text.trimStart().length;
  return { text: text.trim(), start: start + leftTrim };
}

export function usageForOccurrence(contexts, sceneId, surface, sentence, offset) {
  const context = dictionaryContextFor(contexts, sceneId, surface);
  for (const usage of context?.uses || []) {
    for (const match of sentence.matchAll(new RegExp(usage.pattern, "gi"))) {
      if (offset >= match.index && offset < match.index + match[0].length) return usage.id;
    }
  }
  return null;
}

function hasTarget(example, lemma, surface) {
  const forms = new Set([lemma, surface, lemma + "s", lemma + "ed", lemma + "ing"]);
  if (lemma.endsWith("e")) { forms.add(lemma + "d"); forms.add(lemma.slice(0, -1) + "ing"); }
  if (lemma.endsWith("y")) forms.add(lemma.slice(0, -1) + "ies");
  if (lemma === "cosy") forms.add("cozy");
  return (example.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || []).some((word) => forms.has(word));
}

function translationHtml(value, status = "project", open = false) {
  return value ? `<details class="example-translation" ${open ? "open" : ""}><summary>中文译解</summary><p lang="zh-CN">${html(value)}</p><small>${status === "machine" ? "机器辅助译文 · 未逐条校订" : "本项目译解"}</small></details>` : "";
}

function senseHtml(sense, editorial, entry, record, translations, chinese = {}, showChinese = false, full = false) {
  const translated = chinese?.[sense.id];
  const exampleTranslations = translations?.[sense.id]?.examples || {};
  const examples = [...(sense.examples || [])].sort((a, b) => {
    const score = (text) => Number(Boolean(exampleTranslations[text])) * 2 + Number(hasTarget(text, record.lemma, entry.text.toLowerCase()));
    return score(b) - score(a);
  });
  const visibleExamples = full ? examples : examples.filter((example) => hasTarget(example, record.lemma, entry.text.toLowerCase()));
  const exampleHtml = (example) => `<div class="dictionary-examples"><span>${hasTarget(example, record.lemma, entry.text.toLowerCase()) ? "WordNet 原例句" : "WordNet 原例句 · 使用同义表达"}</span><p lang="en">${html(example)}</p>${translationHtml(exampleTranslations[example] || translated?.examples?.[example]?.text, exampleTranslations[example] ? "project" : translated?.examples?.[example]?.status, showChinese)}</div>`;
  return `<article class="dictionary-sense">
    <div class="dictionary-sense-label">${html(POS_LABELS[sense.pos] || sense.pos)}${editorial?.zh ? ` · ${html(editorial.zh)}` : ""}</div>
    <p class="dictionary-definition" lang="en">${html(sense.definition)}</p>
    ${translated?.definition ? `<div class="dictionary-definition-zh" lang="zh-CN"><p>${html(translated.definition)}</p><small>${translated.definitionStatus === "project" ? "本项目译解" : "机器辅助译文 · 未逐条校订"}</small></div>` : ""}
    ${visibleExamples.length ? visibleExamples.slice(0, 2).map(exampleHtml).join("") : `<small class="dictionary-no-example">${examples.length ? "该词义组的原例句使用同义词；完整词典中可查看原句。" : "WordNet 未给此义项配原例句。"}</small>`}
    ${visibleExamples.length > 2 ? `<details class="dictionary-more"><summary>其余 ${visibleExamples.length - 2} 条词典原例句</summary>${visibleExamples.slice(2).map(exampleHtml).join("")}</details>` : ""}
    ${editorial?.example ? `<div class="dictionary-project-example"><span>本项目情境例句</span><p lang="en">${html(editorial.example)}</p>${translationHtml(editorial.exampleZh, "project", showChinese)}</div>` : ""}
  </article>`;
}

export function dictionaryHtml(entry, sceneId, wordnet, contexts, translations, chinese = {}, showChinese = false) {
  const surface = entry.text.toLowerCase().replaceAll("’", "'");
  const context = dictionaryContextFor(contexts, sceneId, surface, entry.dictionaryUsage);
  if (entry.type !== "word") {
    const candidates = [...(context?.externalReferences || []), ...(entry.externalEvidence || []).map(item => ({url: item.url, label: item.publisher || "词典参考"}))];
    const references = [...new Map(candidates.filter(item => /^https?:\/\//i.test(item.url || "")).map(item => [item.url, item])).values()];
    if (!context?.noMatch && !references.length) return "";
    return `<section class="dictionary-section" aria-label="表达参考资料">${context?.noMatch && context.note ? `<p class="dictionary-guidance">${html(context.note)}</p>` : ""}${references.length ? `<div class="dictionary-links">${references.map(item => `<a href="${html(item.url)}" target="_blank" rel="noopener noreferrer">${html(item.label)} ↗</a>`).join("")}</div>` : ""}</section>`;
  }
  const record = dictionaryRecordFor(wordnet, surface, context?.dictionaryLemma || context?.headword);
  const senses = record.senses || [];
  const matching = context?.senseId ? senses.find((sense) => sense.id === context.senseId) : null;
  const contrasts = (context?.contrasts || []).map((editorial) => ({ editorial, sense: senses.find((sense) => sense.id === editorial.senseId) })).filter((item) => item.sense);
  const currentHtml = matching
    ? senseHtml(matching, { ...context, zh: entry.zh }, entry, record, translations, chinese, showChinese)
    : `<p class="dictionary-guidance">${context?.noMatch ? html(context.note || "本地词典未收录本句义项。") : "本句词典义项尚未校订。"}</p>${context?.example ? `<div class="dictionary-project-example"><span>本项目情境例句</span><p lang="en">${html(context.example)}</p>${translationHtml(context.exampleZh, "project", showChinese)}</div>` : ""}`;
  const references = (context?.externalReferences || []).filter((reference) => /^https?:\/\//i.test(reference.url || ""));
  const referenceHtml = references.length
    ? `<div class="dictionary-links">${references.map((reference) => `<a href="${html(reference.url)}" target="_blank" rel="noopener noreferrer">${html(reference.label)} ↗</a>`).join("")}</div><small>外部参考仅提供链接；本项目选义与例句另行标记。</small>`
    : "";
  const contrastHtml = contrasts.length
    ? `<div class="dictionary-senses">${contrasts.map(({ sense, editorial }) => senseHtml(sense, editorial, entry, record, translations, chinese, showChinese)).join("")}</div>`
    : `<p class="dictionary-guidance">多义对比待补充。</p>`;
  const fullHtml = senses.length
    ? `<p class="dictionary-guidance">WordNet 全部义项。原例句可能使用同义词；排序不代表本句用法。</p><div class="dictionary-full-list">${senses.map((sense) => `<details class="dictionary-full-sense"><summary><span>${html(POS_LABELS[sense.pos] || sense.pos)}</span> ${html(sense.definition)}${chinese[sense.id]?.definition ? `<span class="dictionary-definition-zh" lang="zh-CN">${html(chinese[sense.id].definition)}</span>` : ""}</summary>${senseHtml(sense, null, entry, record, translations, chinese, showChinese, true)}</details>`).join("")}</div>`
    : `<p class="dictionary-empty">${wordnet ? "WordNet 没有收录这个词形的可用义项。" : "词典资料暂未载入。"}仍可通过下方链接查词。</p>`;
  return `<section class="dictionary-section${showChinese ? " dictionary-chinese-visible" : ""}" aria-label="外部词典义项">
    <div class="dictionary-heading"><span>英语词典资料</span><strong>Princeton WordNet 3.0</strong></div>
    <button class="secondary-btn dictionary-translation-toggle" type="button" data-dictionary-chinese aria-pressed="${showChinese}">${showChinese ? "隐藏中文释义与例句译文" : "显示中文释义与例句译文"}</button>
    ${record.lemmas.length > 1 ? `<p class="dictionary-lemma">词形可能对应：${record.lemmas.map(html).join(" / ")}；需结合本句判断。</p>` : record.lemma !== surface ? `<p class="dictionary-lemma">${html(entry.text)} → 词元 ${html(record.lemma)}</p>` : ""}
    <div class="dictionary-tabs" role="tablist" aria-label="选择词典内容">
      ${[["current", "本句用法"], ["contrasts", "一词多义"], ["full", "完整词典"]].map(([id, label]) => `<button type="button" role="tab" id="dictionary-tab-${id}" aria-controls="dictionary-panel-${id}" aria-selected="${id === "current"}" tabindex="${id === "current" ? "0" : "-1"}" data-dictionary-tab="${id}">${label}</button>`).join("")}
    </div>
    <div role="tabpanel" id="dictionary-panel-current" aria-labelledby="dictionary-tab-current">${currentHtml}${referenceHtml}</div>
    <div role="tabpanel" id="dictionary-panel-contrasts" aria-labelledby="dictionary-tab-contrasts" hidden>${contrastHtml}</div>
    <div role="tabpanel" id="dictionary-panel-full" aria-labelledby="dictionary-tab-full" hidden>${fullHtml}</div>
    <div class="dictionary-links"><a href="https://dictionary.cambridge.org/dictionary/english/${html(encodeURIComponent(context?.headword || record.lemma || surface))}" target="_blank" rel="noopener noreferrer">剑桥学习者词典 ↗</a><a href="https://wordnet.princeton.edu/" target="_blank" rel="noopener noreferrer">WordNet 来源 ↗</a></div>
    <small class="dictionary-credit">WordNet 3.0 © 2006 Princeton University；<a href="./data/WORDNET_LICENSE.txt" target="_blank" rel="noopener noreferrer">版权声明与免责声明</a>。中文译解和情境例句由本项目编写。</small>
  </section>`;
}
