import { ResourceLoader, resourceBucket } from './resource-loader.mjs?v=pilot-31-0';

// Expand only trusted resource data. Old releases keep their original task arrays.
function expandPromptIndex(payload, release) {
  if (payload.projectionVersion == null) return payload;
  if (payload.projectionVersion !== 2 || payload.contentVersion !== release ||
      !Array.isArray(payload.prompts) || !Array.isArray(payload.taskRows) ||
      payload.prompts.length !== payload.taskRows.length) throw new Error('练习目录不完整');
  const seen = new Set();
  const tasks = payload.taskRows.map(row => {
    if (!Number.isInteger(row.promptIndex) || seen.has(row.promptIndex)) throw new Error('练习目录不完整');
    const prompt = payload.prompts[row.promptIndex];
    if (!prompt || !Array.isArray(prompt.unitIds) || !prompt.unitVersion || !prompt.taskMode ||
        Object.keys(row).some(key => !['promptIndex', 'englishTargetInput', 'responseModes', 'canOpenWithoutStory'].includes(key)))
      throw new Error('练习目录不完整');
    seen.add(row.promptIndex);
    const { promptIndex, ...flags } = row;
    return { sceneId: prompt.sceneId, promptId: prompt.id, contentVersion: release,
      unitVersion: prompt.unitVersion, unitIds: prompt.unitIds, taskMode: prompt.taskMode, ...flags };
  });
  return { prompts: payload.prompts, tasks };
}

// Catalogue IDs cover the whole published world. Loaded scene count never
// becomes a vocabulary, course, or proficiency count.
export class DataStore {
  constructor(pointer, options = {}) {
    if (pointer.schemaVersion !== 2 || pointer.runtimeApiVersion !== 1 ||
      !/^pilot-\d+-\d+$/.test(pointer.release || '')) throw new Error('此内容版本暂不支持');
    this.release = pointer.release;
    this.pointer = pointer;
    this.loader = new ResourceLoader(this.release, options);
    this.sceneCache = new Map();
    this.sceneJobs = new Map();
    this.activeSceneId = null;
    this.promiseCache = new Map();
    this.searchWorker = null;
    this.searchWorkerFailed = false;
    this.searchJobs = new Map();
    this.searchSequence = 0;
  }
  async once(key, load) {
    if (!this.promiseCache.has(key)) {
      const promise = Promise.resolve().then(load);
      this.promiseCache.set(key, promise);
      promise.catch(() => { if (this.promiseCache.get(key) === promise) this.promiseCache.delete(key); });
    }
    return this.promiseCache.get(key);
  }
  async initialize() {
    this.manifest = await this.loader.read(this.pointer.manifest);
    if (this.manifest.runtimeApiVersion !== 1) throw new Error('运行时与内容目录不匹配');
    const [navigation, promptPayload, uiWords] = await Promise.all([
      this.loader.read(this.manifest.navigation), this.loader.read(this.manifest.prompts),
      this.loader.read(this.manifest.uiWords),
    ]);
    const prompts = expandPromptIndex(promptPayload, this.release);
    const ids = new Set(navigation.scenes.map(scene => scene.id));
    if (ids.size !== this.manifest.counts.scenes || navigation.branches.length !== this.manifest.counts.branches ||
      prompts.prompts.length !== this.manifest.counts.tasks || prompts.prompts.some(prompt => !ids.has(prompt.sceneId))) {
      throw new Error('全局内容目录不完整');
    }
    if (navigation.projectionVersion === 2) {
      const grouped = new Map([...ids].map(id => [id, []]));
      const promptIds = new Set();
      for (const prompt of prompts.prompts) {
        if (promptIds.has(prompt.id)) throw new Error('全局练习目录存在重复');
        promptIds.add(prompt.id); grouped.get(prompt.sceneId).push(prompt);
      }
      for (const scene of navigation.scenes) {
        const rows = grouped.get(scene.id);
        if (!rows.length || rows.at(-1).taskMode !== 'transfer' || rows.slice(0, -1).some(row => row.taskMode === 'transfer'))
          throw new Error('场景练习目录不完整');
        scene.retrievalPrompts = rows.slice(0, -1);
        scene.transferPrompt = rows.at(-1);
      }
    } else if (navigation.projectionVersion != null) throw new Error('此导航版本暂不支持');
    this.navigation = navigation;
    this.prompts = prompts;
    this.uiWords = uiWords;
    this.sceneDirectory = new Map(navigation.scenes.map(scene => [scene.id, scene]));
    this.branchDirectory = new Map(navigation.branches.map(branch => [branch.id, branch]));
    return this;
  }
  getScene(id) { return this.sceneCache.get(id)?.scene || this.sceneDirectory.get(id); }
  pinScene(id) { this.activeSceneId = id; this.trimScenes(); }
  trimScenes() {
    for (const id of this.sceneCache.keys()) {
      if (this.sceneCache.size <= 5) break;
      if (id !== this.activeSceneId) this.sceneCache.delete(id);
    }
  }
  async branchCatalog(branchId) {
    const ref = this.navigation.branchRefs[branchId];
    if (!ref) throw new Error('找不到这条路线');
    const catalog = await this.loader.read(ref);
    if (catalog.branchId !== branchId) throw new Error('路线身份不匹配');
    return catalog;
  }
  async ensureScene(id, options = {}) {
    if (this.sceneCache.has(id)) {
      const scene = this.sceneCache.get(id);
      this.sceneCache.delete(id); this.sceneCache.set(id, scene);
      return scene;
    }
    if (this.sceneJobs.has(id)) return this.sceneJobs.get(id);
    const load = (async () => {
      const summary = this.sceneDirectory.get(id);
      if (!summary) throw new Error('找不到这个场景');
      const catalog = await this.branchCatalog(summary.branchId);
      const refs = catalog.scenes[id];
      if (!refs) throw new Error('场景目录不完整');
      const [scene, words, context, translation, globalContext, parts] = await Promise.all([
        this.loader.read(refs.scene, options), this.loader.read(refs.words, options),
        this.loader.read(refs.context, options), this.loader.read(refs.text, options),
        this.loader.read(this.manifest.globalContext, options),
        Promise.all(refs.units.map(ref => this.loader.read(ref, options))),
      ]);
      if (scene.id !== id || (scene.branchId || 'housing') !== summary.branchId ||
        words.sceneId !== id || context.sceneId !== id || translation.sceneId !== id) throw new Error('场景资源身份不匹配');
      const allUnits = new Map(parts.flat().map(unit => [unit.id, unit]));
      const units = refs.unitIds.map(uid => allUnits.get(uid));
      if (units.some(unit => !unit || !unit.sceneIds.includes(id)) ||
        scene.learningUnitIds.length !== units.length || scene.learningUnitIds.some(uid => !refs.unitIds.includes(uid))) {
        throw new Error('本课表达目录不完整');
      }
      // Commit only complete combinations. A failed context request is never
      // mistaken for a successful dictionary noMatch or an absent translation.
      const result = { scene: { ...scene, wordLookup: words.words }, units,
        contexts: { '*': globalContext, [id]: context.entries }, translation: translation.text };
      this.sceneCache.set(id, result);
      this.trimScenes();
      return result;
    })();
    this.sceneJobs.set(id, load);
    try { return await load; } finally { this.sceneJobs.delete(id); }
  }
  async unitMetadata() {
    return this.once('unit-metadata', async () => {
      const catalog = await this.loader.read(this.manifest.units);
      const meta = (await Promise.all(catalog.parts.map(ref => this.loader.read(ref)))).flat();
      if (meta.length !== this.manifest.counts.units || new Set(meta.map(unit => unit.id)).size !== meta.length) {
        throw new Error('全局表达目录不完整');
      }
      this.unitMetaById = new Map(meta.map(unit => [unit.id, unit]));
      return meta;
    });
  }
  async ensureUnit(id) {
    await this.unitMetadata();
    const meta = this.unitMetaById.get(id);
    if (!meta) throw new Error('找不到这个表达');
    const part = await this.loader.read(meta.detailRef);
    const unit = part.find(value => value.id === id);
    if (!unit) throw new Error('表达详情与目录不匹配');
    return unit;
  }
  async taskHistoryFor(attempts) {
    if (!attempts.length) return [];
    const catalog = await this.loader.read(this.manifest.taskHistory);
    const keys = new Set(attempts.filter(a => typeof a.promptId === 'string').map(a => resourceBucket(a.promptId, catalog.bucketCount)));
    const rows = (await Promise.all([...keys].filter(key => catalog.buckets[key])
      .map(key => this.loader.read(catalog.buckets[key])))).flat();
    const ids = new Set(attempts.map(a => a.promptId));
    return rows.filter(row => ids.has(row.promptId));
  }
  async search(query, kind = null) {
    const docs = await this.once('search-documents', async () => {
      const catalog = await this.loader.read(this.manifest.search);
      const rows = (await Promise.all(catalog.parts.map(ref => this.loader.read(ref)))).flat();
      if (rows.length !== Object.values(catalog.counts).reduce((sum, n) => sum + n, 0)) throw new Error('检索目录不完整');
      return rows;
    });
    // Worker and fallback both preserve full substring scope and short queries.
    // A failed directory request never becomes an empty successful result.
    if (!this.searchWorkerFailed && typeof Worker !== 'undefined') {
      try { return await this.searchInWorker(docs, query, kind); }
      catch (_) { this.searchWorkerFailed = true; }
    }
    const needle = String(query).toLocaleLowerCase();
    return docs.filter(doc => (!kind || doc.kind === kind) && doc.text.toLocaleLowerCase().includes(needle));
  }
  searchInWorker(docs, query, kind) {
    let initial = false;
    if (!this.searchWorker) {
      this.searchWorker = new Worker(new URL('./search-worker.mjs?v=pilot-31-0', import.meta.url), { type: 'module' });
      initial = true;
      this.searchWorker.addEventListener('message', event => {
        const pending = this.searchJobs.get(event.data.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.searchJobs.delete(event.data.id);
        if (event.data.error) pending.reject(new Error(event.data.error));
        else pending.resolve(event.data.matches);
      });
      this.searchWorker.addEventListener('error', () => this.stopSearchWorker());
    }
    const id = ++this.searchSequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stopSearchWorker(), 15000);
      this.searchJobs.set(id, { resolve, reject, timer });
      try { this.searchWorker.postMessage({ id, query, kind, ...(initial ? { docs } : {}) }); }
      catch (error) { this.stopSearchWorker(); }
    });
  }
  stopSearchWorker() {
    this.searchWorker?.terminate(); this.searchWorker = null; this.searchWorkerFailed = true;
    for (const job of this.searchJobs.values()) { clearTimeout(job.timer); job.reject(new Error('检索后台暂不可用')); }
    this.searchJobs.clear();
  }
  async dictionaryCatalog() {
    return this.once('dictionary-catalog', () => this.loader.read(this.manifest.dictionary));
  }
  async dictionaryPart(kind, key) {
    const catalog = await this.dictionaryCatalog();
    const ref = catalog.buckets[kind]?.[resourceBucket(key, catalog.bucketCount)];
    return ref ? this.loader.read(ref) : {};
  }
  async dictionaryEntry(surface) {
    const entries = await this.dictionaryPart('entries', surface);
    const entry = entries[surface];
    if (!entry) return null; // Successful complete entry bucket, truly absent.
    const refs = new Map();
    const catalog = await this.dictionaryCatalog();
    for (const key of entry.senseKeys) {
      const b = resourceBucket(key, catalog.bucketCount);
      if (!catalog.buckets.senses[b]) throw new Error('词典义项目录不完整');
      refs.set(b, catalog.buckets.senses[b]);
    }
    const parts = await Promise.all([...refs.values()].map(ref => this.loader.read(ref)));
    const pool = Object.assign({}, ...parts);
    const senses = entry.senseKeys.map(key => pool[key]);
    if (senses.some(sense => !sense)) throw new Error('词典义项未完整载入');
    const { senseKeys, ...record } = entry;
    return { ...record, senses };
  }
  async dictionary(surface, headword = null, { chinese = false } = {}) {
    const catalog = await this.dictionaryCatalog();
    const entries = {};
    await Promise.all([...new Set([surface, headword].filter(Boolean))].map(async key => {
      const record = await this.dictionaryEntry(key);
      if (record) entries[key] = record;
    }));
    const lemma = entries[surface]?.lemma;
    if (lemma && !entries[lemma]) {
      const record = await this.dictionaryEntry(lemma);
      if (record) entries[lemma] = record;
    }
    const wordnet = { ...catalog.metadata, entries };
    if (!chinese) return { wordnet, translations: {}, chinese: {}, chineseState: 'idle' };
    const ids = new Set(Object.values(entries).flatMap(entry => entry.senses.map(sense => sense.id)));
    const keys = new Set([...ids].map(id => resourceBucket(id, catalog.bucketCount)));
    const load = async kind => {
      const parts = await Promise.all([...keys].filter(key => catalog.buckets[kind][key])
        .map(key => this.loader.read(catalog.buckets[kind][key])));
      const pool = Object.assign({}, ...parts);
      return Object.fromEntries([...ids].filter(id => pool[id]).map(id => [id, pool[id]]));
    };
    const [translations, chineseLayer] = await Promise.all([load('translations'), load('chinese')]);
    return { wordnet, translations, chinese: chineseLayer, chineseState: 'ready',
      chineseMetadata: catalog.chineseMetadata };
  }
}
