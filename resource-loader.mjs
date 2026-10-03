// Immutable public resources only; practice storage never enters this cache.
export function resourceBucket(key, count = 64) {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(key)) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return (hash % count).toString(16).padStart(2, '0');
}

export class ResourceLoader {
  constructor(release, { baseUrl = globalThis.location?.href, concurrency = 4,
    cacheBytes = 24 * 1024 * 1024, timeoutMs = 15000 } = {}) {
    this.release = release;
    this.baseUrl = baseUrl;
    this.concurrency = concurrency;
    this.cacheBytes = cacheBytes;
    this.timeoutMs = timeoutMs;
    this.ready = new Map();
    this.inFlight = new Map();
    this.states = new Map();
    this.queue = [];
    this.active = 0;
    this.backgroundActive = 0;
    this.bytes = 0;
  }
  key(ref) { return `${ref.release}:${ref.path}:${ref.sha256}`; }
  validate(ref) {
    if (!ref || ref.release !== this.release || ref.schemaVersion !== 2 ||
      !/^[a-f0-9]{64}$/.test(ref.sha256 || '') || !Number.isSafeInteger(ref.bytes) || ref.bytes <= 0 ||
      !ref.path?.startsWith(`./data/releases/${this.release}/`) ||
      ref.path.slice(2).split('/').some(part => part === '..' || part === '.' || !part)) {
      throw new Error('内容资源版本不匹配');
    }
    const base = new URL(this.baseUrl);
    const url = new URL(ref.path, base);
    const allowed = new URL(`./data/releases/${this.release}/`, base);
    if (url.origin !== base.origin || !url.href.startsWith(allowed.href) ||
      !url.pathname.endsWith('.json') || url.search || url.hash) throw new Error('无效内容资源地址');
    return url;
  }
  status(ref) { return this.states.get(this.key(ref)) || { state: 'idle' }; }
  read(ref, { priority = 'foreground' } = {}) {
    let url;
    try { url = this.validate(ref); } catch (error) { return Promise.reject(error); }
    const key = this.key(ref);
    if (this.ready.has(key)) {
      const hit = this.ready.get(key);
      this.ready.delete(key); this.ready.set(key, hit);
      return Promise.resolve(hit.value);
    }
    if (this.inFlight.has(key)) {
      if (priority === 'foreground') {
        const job = this.queue.find(item => item.key === key);
        if (job) job.priority = 'foreground';
        this.pump();
      }
      return this.inFlight.get(key);
    }
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    this.inFlight.set(key, promise);
    this.states.set(key, { state: 'queued' });
    this.queue.push({ key, ref, url, priority, resolve, reject });
    this.pump();
    return promise;
  }
  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      let index = this.queue.findIndex(job => job.priority === 'foreground');
      if (index < 0) {
        if (this.backgroundActive >= Math.min(2, this.concurrency)) break;
        index = 0;
      }
      const job = this.queue.splice(index, 1)[0];
      this.active += 1;
      const background = job.priority !== 'foreground';
      if (background) this.backgroundActive += 1;
      this.states.set(job.key, { state: 'loading' });
      this.fetchResource(job).then(value => {
        this.ready.set(job.key, { value, bytes: job.ref.bytes });
        this.bytes += job.ref.bytes;
        while (this.bytes > this.cacheBytes && this.ready.size > 1) {
          const oldest = this.ready.keys().next().value;
          this.bytes -= this.ready.get(oldest).bytes;
          this.ready.delete(oldest);
          this.states.delete(oldest);
        }
        this.states.set(job.key, { state: 'ready' });
        job.resolve(value);
      }, error => {
        this.states.set(job.key, { state: 'error', message: error.message });
        job.reject(error);
      }).finally(() => {
        this.inFlight.delete(job.key);
        this.active -= 1;
        if (background) this.backgroundActive -= 1;
        this.pump();
      });
    }
  }
  async fetchResource(job) {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(job.url, { signal: controller.signal, cache: 'default' });
        if (!response.ok) {
          const error = new Error(`内容暂不可用（HTTP ${response.status}）`);
          error.retryable = [408, 429].includes(response.status) || response.status >= 500;
          const header = response.headers.get('Retry-After');
          error.retryAfter = header && (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now());
          throw error;
        }
        const raw = await response.arrayBuffer();
        if (raw.byteLength !== job.ref.bytes) throw new Error('内容长度与发布目录不一致');
        const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)),
          byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== job.ref.sha256) throw new Error('内容指纹与发布目录不一致');
        const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
        if (payload.release !== this.release || payload.schemaVersion !== 2 || payload.kind !== job.ref.kind ||
          !Object.hasOwn(payload, 'data') || !Array.isArray(payload.resources)) throw new Error('内容身份不匹配');
        return payload.data;
      } catch (error) {
        const retryable = error.retryable || error.name === 'AbortError' || error instanceof TypeError;
        if (!retryable || attempt >= 2) throw error;
        clearTimeout(timer);
        // Retry-After is a server deadline, not an indication of absent content.
        const delay = Math.max(Number.isFinite(error.retryAfter) ? error.retryAfter : 0,
          [500, 1500][attempt] + Math.random() * 200);
        this.states.set(job.key, { state: 'loading', retry: attempt + 1 });
        await new Promise(resolve => setTimeout(resolve, delay));
      } finally { clearTimeout(timer); }
    }
  }
}
