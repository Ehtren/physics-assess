// Storage adapter. UI and domain code only call these methods, never IndexedDB.
// A future server adapter needs the same methods: get, all, put, putMany, exportAll, importAll.
export class IDBAdapter {
  constructor(name = 'igcse-assess', stores = ['kv', 'cur', 'question', 'paper', 'assign', 'attempt', 'award', 'teach', 'status', 'review']) {
    this.name = name; this.stores = stores; this.db = null;
  }
  async open() {
    if (this.db) return;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 1);
      r.onupgradeneeded = () => this.stores.forEach(s => r.result.createObjectStore(s, { keyPath: 'id' }));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async tx(s, mode, fn) {
    await this.open();
    return new Promise((res, rej) => {
      const t = this.db.transaction(s, mode); const q = fn(t.objectStore(s));
      t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
    });
  }
  get(s, id) { return this.tx(s, 'readonly', st => st.get(id)); }
  all(s) { return this.tx(s, 'readonly', st => st.getAll()); }
  put(s, rec) { return this.tx(s, 'readwrite', st => st.put(rec)); }
  async putMany(s, recs) {
    await this.open();
    return new Promise((res, rej) => {
      const t = this.db.transaction(s, 'readwrite'); recs.forEach(r => t.objectStore(s).put(r));
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
  }
  async exportAll() { const o = {}; for (const s of this.stores) o[s] = await this.all(s); return o; }
  async importAll(o) { for (const s of this.stores) if (o[s]) await this.putMany(s, o[s]); }
}
