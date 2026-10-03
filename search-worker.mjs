// Only the public compiled search directory enters this worker.
let documents = null;
self.addEventListener('message', event => {
  const { id, docs, query, kind } = event.data;
  if (docs) documents = docs;
  if (!documents) { self.postMessage({ id, error: '检索目录未载入' }); return; }
  const needle = String(query).toLocaleLowerCase();
  const matches = documents.filter(doc => (!kind || doc.kind === kind) && doc.text.toLocaleLowerCase().includes(needle));
  self.postMessage({ id, matches });
});
